-- 給每筆投遞一組人打得出來的取件代號。
--
-- 收件頁的網址帶的是 public_ref，一串 uuid —— 沒有人會手打它，所以收件人只能
-- 靠別人給的連結進來。信不見了、進了垃圾信件匣，就沒有第二條路。
--
-- 代號是識別碼，不是秘密：取件仍然要輸入取件碼，而取件碼有 5 次鎖定與每日
-- 上限。代號用 6 碼（32^6 ≈ 10.7 億）並沿用同一份速率限制，讓「掃過整個代號
-- 空間找出有哪些投遞」在實務上做不到。
begin;

alter table public.deliveries add column if not exists pickup_ref text;

-- 0/O 與 1/I 不放進來 —— 這組字要從信裡被抄到網頁上。
create or replace function private.new_pickup_ref()
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  candidate text;
  attempts integer := 0;
begin
  loop
    candidate := '';
    for i in 1..6 loop
      -- 32 整除 256，所以取餘數不會讓某些字母比較常出現。
      candidate := candidate || substr(alphabet, 1 + (get_byte(extensions.gen_random_bytes(1), 0) % 32), 1);
    end loop;
    exit when not exists (select 1 from public.deliveries where pickup_ref = candidate);
    attempts := attempts + 1;
    if attempts > 50 then raise exception 'PICKUP_REF_EXHAUSTED'; end if;
  end loop;
  return candidate;
end;
$$;
revoke all on function private.new_pickup_ref() from public, anon, authenticated;

-- 用 trigger 而不是改 create_and_confirm_delivery：那支函式被後來的 migration
-- 改名成 _unlocked 再包了一層 idempotency 防護，照舊名重寫會把那層蓋掉。
create or replace function private.assign_pickup_ref()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.pickup_ref is null then new.pickup_ref := private.new_pickup_ref(); end if;
  return new;
end;
$$;
drop trigger if exists deliveries_assign_pickup_ref on public.deliveries;
create trigger deliveries_assign_pickup_ref
before insert on public.deliveries
for each row execute function private.assign_pickup_ref();

-- 逐筆補舊資料：一次 update 全部的話，每次產生都看到同一份快照，會撞號。
do $$
declare target uuid;
begin
  for target in select id from public.deliveries where pickup_ref is null loop
    update public.deliveries set pickup_ref = private.new_pickup_ref() where id = target;
  end loop;
end $$;

alter table public.deliveries alter column pickup_ref set not null;
create unique index if not exists deliveries_pickup_ref_key on public.deliveries(pickup_ref);

-- 用代號換取件頁。與輸入取件碼共用同一份每日額度 —— 那份額度本來就是用來擋
-- 「一個一個試」的，兩種試法沒有理由分開計算。
create or replace function public.resolve_pickup_ref(p_pickup_ref text, p_rate_scope bytea)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized text;
  delivery_row public.deliveries;
begin
  if auth.role() <> 'service_role' then raise exception 'RLS_DENIED' using errcode = '42501'; end if;
  insert into private.pickup_rate_limits(scope_hash, attempts)
  values (p_rate_scope, 1)
  on conflict (scope_hash) do update set attempts = private.pickup_rate_limits.attempts + 1;
  if (select attempts from private.pickup_rate_limits where scope_hash = p_rate_scope) > 20 then
    raise exception 'RATE_LIMITED';
  end if;

  normalized := upper(regexp_replace(coalesce(p_pickup_ref, ''), '[^A-Za-z0-9]', '', 'g'));
  select * into delivery_row from public.deliveries where pickup_ref = normalized;
  -- 找不到、或還沒到可取件的階段，回同一種答案：代號存不存在本身也是資訊。
  if delivery_row.id is null or delivery_row.status not in
    ('arrived_dropoff', 'awaiting_recipient', 'compartment_open_for_recipient', 'picked_up', 'completed') then
    raise exception 'PICKUP_REF_INVALID';
  end if;
  return jsonb_build_object('publicRef', delivery_row.public_ref);
end;
$$;
revoke all on function public.resolve_pickup_ref(text,bytea) from public, anon, authenticated;
grant execute on function public.resolve_pickup_ref(text,bytea) to service_role;


-- 兩邊的 projection 都帶上代號。
create or replace function private.safe_delivery_projection(p_delivery_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'delivery', jsonb_build_object(
      'id', delivery.id,
      'publicRef', delivery.public_ref,
      -- 寄信失敗改人工轉交時，寄件人要同時給代號和取件碼。
      'pickupRef', delivery.pickup_ref,
      'status', delivery.status,
      'version', delivery.version,
      'pickupCode', pickup.code,
      'dropoffCode', dropoff.code,
      'itemType', delivery.item_type,
      'createdAt', delivery.created_at,
      'updatedAt', delivery.updated_at,
      'completedAt', delivery.completed_at,
      'terminalReason', delivery.terminal_reason
    ),
    'telemetry', jsonb_build_object(
      'projectionVersion', coalesce(progress.projection_version, 0),
      'position', case when progress.position_quality in ('valid','degraded') and progress.segment_id is not null
        then jsonb_build_object('segmentId', progress.segment_id, 'progress', progress.progress) else null end,
      'observedAt', progress.observed_at,
      'connectivity', coalesce(progress.connectivity, 'offline'::public.connectivity_state),
      'positionQuality', coalesce(progress.position_quality, 'pending'::public.position_quality),
      'activeEdgeIds', coalesce(to_jsonb(leg.allowed_segment_ids), '[]'::jsonb),
      'routePhase', job.kind,
      'routeFromStopCode', job.from_stop_code,
      'routeToStopCode', job.to_stop_code,
      'legIndex', progress.leg_index,
      'legCount', progress.leg_count,
      'vehicleState', vehicle_state.vehicle_state
    ),
    -- 最近一筆指令。errorCode 取該指令最後一個帶錯誤碼的事件，
    -- 讓畫面能說出車輛拒絕的理由，而不是靜靜地把按鈕重新打開。
    'command', (
      select jsonb_build_object(
        'type', latest_command.type,
        'state', latest_command.status,
        'issuedAt', latest_command.issued_at,
        'errorCode', (
          select event.error_code from public.vehicle_command_events event
          where event.command_id = latest_command.command_id and event.error_code is not null
          order by event.source_sequence desc limit 1
        )
      )
      from public.vehicle_commands latest_command
      where latest_command.delivery_id = delivery.id
      order by latest_command.issued_at desc, latest_command.command_id desc
      limit 1
    ),
    -- 這台車有沒有可遙控的置物艙。畫面要據此決定是等車輛開艙，還是請寄件人自己確認。
    'vehicle', jsonb_build_object('hasCompartment', coalesce(vehicle.has_compartment, true)),
    -- 寄件人看得到通知怎麼了，但看不到取件碼本身。
    'notification', (
      select jsonb_build_object(
        'state', notification.state,
        'channel', notification.channel,
        'maskedDestination', notification.masked_destination,
        'updatedAt', notification.updated_at
      )
      from public.notifications notification
      where notification.delivery_id = delivery.id
      order by notification.created_at desc limit 1
    ),
    'notificationState', (
      select notification.state from public.notifications notification
      where notification.delivery_id = delivery.id
      order by notification.created_at desc limit 1
    )
  )
  from public.deliveries delivery
  join public.delivery_locations pickup on pickup.id = delivery.pickup_location_id
  join public.delivery_locations dropoff on dropoff.id = delivery.dropoff_location_id
  left join public.delivery_progress_current progress on progress.delivery_id = delivery.id
  left join public.route_jobs job on job.id = progress.route_job_id
  left join public.route_job_legs leg on leg.route_job_id = job.id and leg.leg_index = progress.leg_index
  left join public.vehicle_state_current vehicle_state on vehicle_state.vehicle_id = delivery.vehicle_id
  left join public.vehicles vehicle on vehicle.id = delivery.vehicle_id
  where delivery.id = p_delivery_id;
$$;
revoke all on function private.safe_delivery_projection(uuid) from public, anon, authenticated;

create or replace function public.get_pickup_context(p_public_ref uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'delivery', jsonb_build_object(
      'publicRef', delivery.public_ref,
      'pickupRef', delivery.pickup_ref,
      'status', delivery.status,
      'version', delivery.version,
      'dropoffCode', dropoff.code
    ),
    'pickupContext', jsonb_build_object(
      'stopName', dropoff.name,
      'stopDetail', dropoff.detail,
      'vehicleDisplayName', vehicle.display_name,
      'ready', delivery.status in ('awaiting_recipient','compartment_open_for_recipient','picked_up','completed')
    ),
    'recipientAttempt', jsonb_build_object('attempts', 0, 'verified', false, 'phase', 'idle', 'error', '')
  )
  from public.deliveries delivery
  join public.delivery_locations dropoff on dropoff.id = delivery.dropoff_location_id
  left join public.vehicles vehicle on vehicle.id = delivery.vehicle_id
  where delivery.public_ref = p_public_ref
    and delivery.status in ('arrived_dropoff','awaiting_recipient','compartment_open_for_recipient','picked_up','completed');
$$;
revoke all on function public.get_pickup_context(uuid) from public, anon, authenticated;
grant execute on function public.get_pickup_context(uuid) to service_role;


-- 交付開始時把代號一併交出來，信裡才寫得上。
create or replace function public.begin_recipient_handover(
  p_delivery_id uuid,
  p_digest bytea,
  p_pepper_version smallint,
  p_expires_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  delivery_row public.deliveries;
  recipient_row private.delivery_recipients;
  prior_status public.delivery_status;
  dropoff_name text;
begin
  if auth.role() <> 'service_role' then raise exception 'RLS_DENIED' using errcode = '42501'; end if;
  select * into delivery_row from public.deliveries where id = p_delivery_id for update;
  if delivery_row.id is null then raise exception 'DELIVERY_INVALID_TRANSITION'; end if;
  if delivery_row.status not in ('arrived_dropoff', 'awaiting_recipient') then
    raise exception 'DELIVERY_INVALID_TRANSITION';
  end if;

  -- 重發時舊碼必須當場作廢，否則會有兩組碼同時有效。
  update private.pickup_credentials
  set state = 'expired', delete_after = now() + interval '24 hours'
  where delivery_id = delivery_row.id and state in ('pending', 'active', 'locked');

  perform private.activate_pickup_credentials(
    delivery_row.id, p_digest, null, p_pepper_version, p_expires_at
  );

  if delivery_row.status = 'arrived_dropoff' then
    prior_status := delivery_row.status;
    update public.deliveries set status = 'awaiting_recipient', version = version + 1, updated_at = now()
    where id = delivery_row.id returning * into delivery_row;
    insert into public.delivery_status_history(
      delivery_id, version, from_status, to_status, event, actor_type, safe_metadata)
    values (
      delivery_row.id, delivery_row.version, prior_status, 'awaiting_recipient',
      'RECIPIENT_HANDOVER_READY', 'system',
      jsonb_build_object('credential', 'human_code', 'notify', 'email')
    );
  end if;

  select * into recipient_row from private.delivery_recipients where delivery_id = delivery_row.id;
  select name into dropoff_name from public.delivery_locations where id = delivery_row.dropoff_location_id;
  perform private.broadcast_delivery_projection(delivery_row.id);

  return jsonb_build_object(
    'projection', private.safe_delivery_projection(delivery_row.id),
    'publicRef', delivery_row.public_ref,
    'pickupRef', delivery_row.pickup_ref,
    'dropoffName', dropoff_name,
    'recipientName', recipient_row.recipient_name,
    -- 沒有同意 email 通知就不交出地址，寄信端會據此記成 unconfigured。
    'recipientEmail', case when recipient_row.email_notification_consent then recipient_row.email else null end
  );
end;
$$;
revoke all on function public.begin_recipient_handover(uuid,bytea,smallint,timestamptz) from public, anon, authenticated;
grant execute on function public.begin_recipient_handover(uuid,bytea,smallint,timestamptz) to service_role;

commit;
