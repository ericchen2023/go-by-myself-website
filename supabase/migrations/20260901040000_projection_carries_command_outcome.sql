-- 投遞 projection 帶上最近一筆指令的結果。
--
-- 在此之前，寄件人的畫面完全看不到車輛怎麼回應指令：按下「開啟置物艙」之後，
-- 車輛以 COMMAND_TYPE_UNSUPPORTED 拒絕（這台車沒有置物艙硬體），但畫面沒有任何
-- 變化，按鈕又立刻可以再按。實際紀錄顯示同一位寄件人在 1.5 秒內按了四次。
--
-- 只加欄位，不改任何既有欄位的語意。
begin;

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
  where delivery.id = p_delivery_id;
$$;
revoke all on function private.safe_delivery_projection(uuid) from public, anon, authenticated;

commit;
