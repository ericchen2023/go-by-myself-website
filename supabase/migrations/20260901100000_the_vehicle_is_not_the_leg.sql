-- 車輛的連線狀態不是某一段路的快照。
--
-- projection 的 connectivity 取自 delivery_progress_current，而那一列只在有段路
-- 在跑的時候更新；路跑完就停在最後一次的值。於是車輛明明六秒前才回報過，
-- 畫面仍然對使用者大字寫著「車輛目前離線」—— 而且前端只有在收到 online 時才
-- 會記下本地時戳，所以它永遠回不來。
--
-- 順帶讓取件頁知道這台車有沒有艙門：沒有的話就沒有關門回報可等。
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
      -- 車輛還在不在，是車輛自己的事。progress 那一列是「這段路」的快照，
      -- 路跑完就凍結了 —— 拿它當車輛的連線狀態，會在車子好端端回報的時候
      -- 對使用者大字宣告「車輛目前離線」。
      'connectivity', coalesce(vehicle_state.connectivity, progress.connectivity, 'offline'::public.connectivity_state),
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
      'ready', delivery.status in ('awaiting_recipient','compartment_open_for_recipient','picked_up','completed'),
      -- 沒有艙門就沒有關門感測器可以等，取件頁要據此決定顯示什麼。
      'hasCompartment', coalesce(vehicle.has_compartment, true)
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

commit;
