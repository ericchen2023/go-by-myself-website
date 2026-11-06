-- 車子沒回應的取消，要有人收尾。
--
-- 2026-09-09 staging 上一筆投遞在派車 5 秒後取消；那時沒有 gateway 在線，
-- DISPATCH 和 CANCEL 兩道指令都在 30 分鐘後過期。reconcile_robot_runtime()
-- 只把仍在 dispatching 的投遞退回 confirmed，於是這筆停在 cancel_requested，
-- 畫面一直顯示「取消要求已收到，但尚未完成」，車輛預約也沒釋放，之後所有派車
-- 都會 VEHICLE_UNAVAILABLE。
--
-- 這裡讓 reconciler 在已經沒有任何指令等待車輛回應時收尾（規則見函式內註解）。
-- 因為是逐次掃描 cancel_requested，已經卡住的那筆也會在下一次排程時被處理。

begin;

create or replace function public.reconcile_robot_runtime()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  progress_row record;
  target_connectivity public.connectivity_state;
  changed_count integer := 0;
  expired_row record;
  stuck_row record;
  vehicle_reached boolean;
  cancelled_from public.delivery_status;
  next_status public.delivery_status;
begin
  for progress_row in
    select progress.delivery_id, progress.connectivity, progress.updated_at, delivery.vehicle_id
    from public.delivery_progress_current progress
    join public.deliveries delivery on delivery.id = progress.delivery_id
    where delivery.status not in ('completed','cancelled','delivery_failed')
  loop
    target_connectivity := case
      when progress_row.updated_at is null or progress_row.updated_at < now() - interval '60 seconds' then 'offline'
      when progress_row.updated_at < now() - interval '10 seconds' then 'stale'
      else 'online'
    end;
    if target_connectivity <> progress_row.connectivity then
      update public.delivery_progress_current
      set connectivity = target_connectivity, projection_version = projection_version + 1
      where delivery_id = progress_row.delivery_id;
      update public.vehicle_state_current set connectivity = target_connectivity where vehicle_id = progress_row.vehicle_id;
      perform private.broadcast_delivery_projection(progress_row.delivery_id);
      changed_count := changed_count + 1;
    end if;
  end loop;

  for expired_row in
    select command.command_id, command.route_job_id, job.delivery_id, job.kind
    from public.vehicle_commands command
    left join public.route_jobs job on job.id = command.route_job_id
    where command.status = 'queued' and command.expires_at <= now()
    for update of command skip locked
  loop
    update public.vehicle_commands set status = 'expired', completed_at = now() where command_id = expired_row.command_id;
    if expired_row.route_job_id is not null then
      update public.route_jobs set state = 'failed', terminal_reason = 'COMMAND_EXPIRED', completed_at = now(), updated_at = now()
      where id = expired_row.route_job_id;
      if expired_row.delivery_id is not null and expired_row.kind = 'to_pickup' then
        update public.deliveries set status = 'confirmed', vehicle_id = null, version = version + 1, updated_at = now()
        where id = expired_row.delivery_id and status = 'dispatching';
        if found then
          perform private.release_route_job_reservation(expired_row.route_job_id);
          perform private.broadcast_delivery_projection(expired_row.delivery_id);
        end if;
      elsif expired_row.delivery_id is null then
        perform private.release_route_job_reservation(expired_row.route_job_id);
        perform private.broadcast_route_job_projection(expired_row.route_job_id);
      end if;
    end if;
  end loop;
  -- 取消要求送出後，車子再也沒有回應（指令全部過期、失敗或被拒），
  -- 這筆投遞就永遠停在 cancel_requested，還一直佔著唯一的那台車。
  -- 只有車確認安全停止才會離開這個狀態，而沒有人在聽的時候那永遠不會發生。
  --
  -- 已經沒有指令在等車回應時，由系統收尾：
  -- * 車從沒收到過任何指令、也沒開始過路線，而且取消發生在放件之前 → 已取消。
  --   車沒動過、艙裡沒有物品，沒有什麼需要安全處置。
  -- * 其他情況（車可能在路上，或物品可能已在艙內）→ 投遞失敗，請現場人員處理。
  --   不能假裝取消成功。
  for stuck_row in
    select delivery.id
    from public.deliveries delivery
    where delivery.status = 'cancel_requested'
      and not exists (
        select 1 from public.vehicle_commands command
        where command.delivery_id = delivery.id and command.status in ('queued','accepted')
      )
      and exists (
        select 1 from public.vehicle_commands command
        where command.delivery_id = delivery.id and command.type = 'CANCEL'
          and command.status in ('expired','failed','rejected')
      )
    for update of delivery skip locked
  loop
    vehicle_reached := exists (
      select 1 from public.vehicle_commands command
      where command.delivery_id = stuck_row.id and command.status in ('accepted','completed','failed')
    ) or exists (
      select 1 from public.route_jobs job
      where job.delivery_id = stuck_row.id and job.started_at is not null
    );
    select history.from_status into cancelled_from
    from public.delivery_status_history history
    where history.delivery_id = stuck_row.id and history.to_status = 'cancel_requested'
    order by history.version desc limit 1;

    next_status := case
      when not vehicle_reached and cancelled_from in ('confirmed','dispatching') then 'cancelled'
      else 'delivery_failed'
    end::public.delivery_status;

    update public.route_jobs
    set state = 'failed', terminal_reason = 'CANCEL_UNANSWERED', completed_at = now(), updated_at = now()
    where delivery_id = stuck_row.id and state in ('queued','running','safe_stop_requested');

    update public.deliveries
    set status = next_status, version = version + 1, terminal_reason = 'cancel_unanswered',
        completed_at = now(), updated_at = now()
    where id = stuck_row.id;
    insert into public.delivery_status_history(delivery_id, version, from_status, to_status, event, actor_type, reason, safe_metadata)
    select delivery.id, delivery.version, 'cancel_requested', next_status,
      case next_status when 'cancelled' then 'CANCEL_BEFORE_VEHICLE_ANSWERED' else 'CANNOT_RECOVER' end,
      'system', 'CANCEL_UNANSWERED',
      jsonb_build_object('vehicleReached', vehicle_reached, 'cancelledFrom', cancelled_from)
    from public.deliveries delivery where delivery.id = stuck_row.id;
    -- deliveries_release_terminal_reservation 會在這裡釋放車輛。
    perform private.broadcast_delivery_projection(stuck_row.id);
    changed_count := changed_count + 1;
  end loop;
  return changed_count;
end;
$$;
revoke all on function public.reconcile_robot_runtime() from public, anon, authenticated;
grant execute on function public.reconcile_robot_runtime() to service_role;

commit;
