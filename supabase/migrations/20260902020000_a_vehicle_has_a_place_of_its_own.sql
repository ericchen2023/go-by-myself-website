-- 車輛自己也有位置，不只投遞有進度。
--
-- 先前位置只存在 delivery_progress_current，而遙測只要帶 route 卻沒有進行中的
-- 路線工作，整包就會被 ROUTE_SEGMENT_NOT_ALLOWED 拒絕。結果是：車子沒在送件時
-- 地圖上找不到它 —— 但它明明就停在某個地方。
--
-- 把兩件事分開：車輛有位置（這裡），投遞有進度（維持原樣，仍用 leg 的
-- allowed_segment_ids 驗證）。沒有工作時改用路線圖本身驗證那條邊存不存在。
begin;

alter table public.vehicle_state_current
  add column if not exists segment_id text,
  add column if not exists segment_progress numeric(6,5) check (segment_progress is null or segment_progress between 0 and 1),
  add column if not exists lateral_m numeric(8,3) check (lateral_m is null or lateral_m >= 0);

comment on column public.vehicle_state_current.segment_id is
  '車輛目前所在的示意圖邊。與投遞無關 —— 停著的車也有位置。';

create or replace function public.ingest_robot_telemetry_v2(p_vehicle_id uuid, p_envelope jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  graph_version text;
  current_row public.vehicle_state_current;
  job_row public.route_jobs;
  leg_row public.route_job_legs;
  delivery_row public.deliveries;
  inserted_count integer;
  incoming_quality text;
  route_payload jsonb;
  received_at timestamptz := now();
  observed_at timestamptz;
  incoming_boot_id uuid;
  incoming_sequence bigint;
  route_segment text;
  route_progress numeric;
  route_lateral numeric;
  graph_id uuid;
begin
  if (p_envelope ->> 'schemaVersion')::integer <> 2 or p_envelope ->> 'vehicleId' <> p_vehicle_id::text then
    raise exception 'ROBOT_SCOPE_DENIED' using errcode = '42501';
  end if;
  observed_at := (p_envelope ->> 'observedAt')::timestamptz;
  incoming_boot_id := (p_envelope ->> 'bootId')::uuid;
  incoming_sequence := (p_envelope ->> 'sequence')::bigint;
  incoming_quality := p_envelope ->> 'quality';
  if incoming_quality not in ('valid','degraded','invalid','off_route') then raise exception 'TELEMETRY_SCHEMA_INVALID'; end if;
  route_payload := p_envelope -> 'route';

  if route_payload is not null and jsonb_typeof(route_payload) <> 'null' then
    select * into job_row from public.route_jobs
    where vehicle_id = p_vehicle_id and state in ('queued','running','safe_stop_requested')
      and id = (select current_route_job_id from public.vehicle_state_current where vehicle_id = p_vehicle_id)
    for update;
    if job_row.id is null then
      select * into job_row from public.route_jobs
      where vehicle_id = p_vehicle_id and state in ('queued','running','safe_stop_requested')
      order by created_at desc limit 1 for update;
    end if;
    if job_row.id is null then
      -- 沒有進行中的工作，不代表車子不在路上。停著的車也有位置 —— 這裡先前
      -- 直接拒絕整包遙測，於是車輛只要沒在送件，地圖上就找不到它。
      --
      -- 沒有工作就沒有 allowed_segment_ids 可比對，改用路線圖本身驗證：這條邊
      -- 必須真的存在於目前啟用的圖裡。位置只寫進車輛自己的狀態，不碰
      -- delivery_progress —— 那是投遞的進度，不是車輛的位置。
      select version, id into graph_version, graph_id
      from public.route_graph_versions where status = 'active' limit 1;
      if route_payload ->> 'routeGraphVersion' is distinct from graph_version then
        raise exception 'ROUTE_VERSION_MISMATCH';
      end if;
      route_segment := route_payload ->> 'segmentId';
      -- 存下來的圖是 edgeIds（字串陣列），不是 edges（物件陣列）。
      if not exists (
        select 1 from public.route_graph_versions graph,
             lateral jsonb_array_elements_text(graph.graph -> 'edgeIds') edge_id
        where graph.id = graph_id and edge_id = route_segment
      ) then
        raise exception 'ROUTE_SEGMENT_NOT_ALLOWED';
      end if;
      route_progress := (route_payload ->> 'progress')::numeric;
      route_lateral := (route_payload ->> 'lateralM')::numeric;
    else
      -- 有工作：位置是這一段路的進度，仍然用該段的 allowed_segment_ids 驗證。
      select version into graph_version from public.route_graph_versions where id = job_row.route_graph_version_id;
      select * into leg_row from public.route_job_legs
      where route_job_id = job_row.id and leg_index = job_row.current_leg_index for update;
      if route_payload ->> 'routeGraphVersion' is distinct from graph_version
        or route_payload ->> 'routeGraphChecksum' <> job_row.route_graph_checksum then
        raise exception 'ROUTE_VERSION_MISMATCH';
      end if;
      if route_payload ->> 'legId' <> leg_row.leg_id then raise exception 'ROUTE_SEGMENT_NOT_ALLOWED'; end if;
      route_segment := route_payload ->> 'segmentId';
      route_progress := (route_payload ->> 'progress')::numeric;
      route_lateral := (route_payload ->> 'lateralM')::numeric;
      if not route_segment = any(leg_row.allowed_segment_ids) then
        incoming_quality := 'off_route';
        insert into public.robot_faults(vehicle_id, delivery_id, route_job_id, type, severity, safe_evidence, observed_at)
        values (p_vehicle_id, job_row.delivery_id, job_row.id, 'ROUTE_SEGMENT_NOT_ALLOWED', 'warning', jsonb_build_object('legId',leg_row.leg_id), observed_at);
      end if;
    end if;
  end if;

  insert into public.vehicle_telemetry(
    vehicle_id, boot_id, sequence, message_id, frame_id, pose_x, pose_y, heading,
    speed, battery, battery_voltage, quality, vehicle_state, route_job_id, leg_id,
    segment_id, progress, lateral_m, route_graph_version, route_graph_checksum,
    observed_at, received_at
  ) values (
    p_vehicle_id, incoming_boot_id, incoming_sequence, (p_envelope ->> 'messageId')::uuid,
    p_envelope #>> '{pose,frameId}', (p_envelope #>> '{pose,x}')::double precision,
    (p_envelope #>> '{pose,y}')::double precision, (p_envelope #>> '{pose,heading}')::double precision,
    (p_envelope ->> 'speedMps')::double precision, (p_envelope #>> '{battery,percent}')::numeric,
    (p_envelope #>> '{battery,voltageV}')::numeric, incoming_quality,
    (p_envelope ->> 'vehicleState')::public.vehicle_runtime_state,
    job_row.id, leg_row.leg_id, route_segment, route_progress, route_lateral,
    route_payload ->> 'routeGraphVersion', route_payload ->> 'routeGraphChecksum',
    observed_at, received_at
  ) on conflict do nothing;
  get diagnostics inserted_count = row_count;
  if inserted_count = 0 then return jsonb_build_object('accepted',true,'duplicate',true,'currentUpdated',false); end if;

  select * into current_row from public.vehicle_state_current where vehicle_id = p_vehicle_id for update;
  if current_row.vehicle_id is not null and current_row.boot_id = incoming_boot_id
    and current_row.sequence >= incoming_sequence then
    return jsonb_build_object(
      'accepted', false, 'duplicate', false, 'rawRecorded', true,
      'currentUpdated', false, 'errorCode', 'TELEMETRY_OUT_OF_ORDER'
    );
  end if;
  if current_row.vehicle_id is not null and current_row.boot_id <> incoming_boot_id and (
    current_row.observed_at >= observed_at or exists (
      select 1 from public.vehicle_boot_sessions boot
      where boot.vehicle_id = p_vehicle_id and boot.boot_id = incoming_boot_id
    )
  ) then
    return jsonb_build_object(
      'accepted', false, 'duplicate', false, 'rawRecorded', true,
      'currentUpdated', false, 'errorCode', 'TELEMETRY_OUT_OF_ORDER'
    );
  end if;

  if current_row.vehicle_id is null then
    insert into public.vehicle_boot_sessions(
      vehicle_id, boot_id, first_observed_at, last_observed_at, last_sequence
    ) values (p_vehicle_id, incoming_boot_id, observed_at, observed_at, incoming_sequence)
    on conflict (vehicle_id, boot_id) do update set
      last_observed_at = greatest(public.vehicle_boot_sessions.last_observed_at, excluded.last_observed_at),
      last_sequence = greatest(public.vehicle_boot_sessions.last_sequence, excluded.last_sequence);
  elsif current_row.boot_id <> incoming_boot_id then
    update public.vehicle_boot_sessions
    set retired_at = coalesce(retired_at, received_at)
    where vehicle_id = p_vehicle_id and boot_id = current_row.boot_id;
    insert into public.vehicle_boot_sessions(
      vehicle_id, boot_id, first_observed_at, last_observed_at, last_sequence
    ) values (p_vehicle_id, incoming_boot_id, observed_at, observed_at, incoming_sequence);
  else
    update public.vehicle_boot_sessions
    set last_observed_at = greatest(last_observed_at, observed_at),
        last_sequence = greatest(last_sequence, incoming_sequence)
    where vehicle_id = p_vehicle_id and boot_id = incoming_boot_id;
  end if;

  insert into public.vehicle_state_current(
    vehicle_id, boot_id, sequence, frame_id, pose_x, pose_y, heading, battery,
    battery_voltage, vehicle_state, quality, current_route_job_id, current_leg_id,
    segment_id, segment_progress, lateral_m,
    connectivity, observed_at, received_at
  ) values (
    p_vehicle_id, incoming_boot_id, incoming_sequence, p_envelope #>> '{pose,frameId}',
    (p_envelope #>> '{pose,x}')::double precision, (p_envelope #>> '{pose,y}')::double precision,
    (p_envelope #>> '{pose,heading}')::double precision, (p_envelope #>> '{battery,percent}')::numeric,
    (p_envelope #>> '{battery,voltageV}')::numeric, (p_envelope ->> 'vehicleState')::public.vehicle_runtime_state,
    incoming_quality, job_row.id, leg_row.leg_id,
    route_segment, route_progress, route_lateral,
    'online', observed_at, received_at
  ) on conflict (vehicle_id) do update set
    boot_id = excluded.boot_id,
    sequence = excluded.sequence,
    frame_id = excluded.frame_id,
    pose_x = excluded.pose_x,
    pose_y = excluded.pose_y,
    heading = excluded.heading,
    battery = excluded.battery,
    battery_voltage = excluded.battery_voltage,
    vehicle_state = excluded.vehicle_state,
    quality = excluded.quality,
    current_route_job_id = excluded.current_route_job_id,
    current_leg_id = excluded.current_leg_id,
    -- 位置只在這一筆真的帶了位置時才覆蓋 —— 否則車子一停下來（不再送 route），
    -- 地圖上的它就會消失，而它其實還在原地。
    segment_id = coalesce(excluded.segment_id, public.vehicle_state_current.segment_id),
    segment_progress = coalesce(excluded.segment_progress, public.vehicle_state_current.segment_progress),
    lateral_m = coalesce(excluded.lateral_m, public.vehicle_state_current.lateral_m),
    connectivity = 'online',
    observed_at = excluded.observed_at,
    received_at = excluded.received_at;

  if job_row.delivery_id is not null then
    select * into delivery_row from public.deliveries where id = job_row.delivery_id;
    insert into public.delivery_progress_current(
      delivery_id, version, segment_id, progress, connectivity, position_quality,
      observed_at, updated_at, route_job_id, leg_id, leg_index, leg_count, lateral_m,
      route_adherence, boot_id, sequence, last_known_good_at,
      route_graph_version, route_graph_checksum, projection_version
    ) values (
      delivery_row.id, delivery_row.version,
      case when incoming_quality in ('valid','degraded') then route_segment else null end,
      case when incoming_quality in ('valid','degraded') then route_progress else null end,
      'online', incoming_quality::public.position_quality, observed_at, received_at,
      job_row.id, leg_row.leg_id, leg_row.leg_index, job_row.leg_count, route_lateral,
      case when incoming_quality = 'off_route' then 'off_route' else 'on_route' end,
      incoming_boot_id, incoming_sequence,
      case when incoming_quality in ('valid','degraded') then observed_at else null end,
      graph_version, job_row.route_graph_checksum, 1
    ) on conflict (delivery_id) do update set
      version = excluded.version,
      segment_id = case when incoming_quality in ('valid','degraded') then excluded.segment_id else public.delivery_progress_current.segment_id end,
      progress = case when incoming_quality in ('valid','degraded') then excluded.progress else public.delivery_progress_current.progress end,
      connectivity = 'online',
      position_quality = excluded.position_quality,
      observed_at = excluded.observed_at,
      updated_at = excluded.updated_at,
      route_job_id = excluded.route_job_id,
      leg_id = excluded.leg_id,
      leg_index = excluded.leg_index,
      leg_count = excluded.leg_count,
      lateral_m = excluded.lateral_m,
      route_adherence = excluded.route_adherence,
      boot_id = excluded.boot_id,
      sequence = excluded.sequence,
      last_known_good_at = case when incoming_quality in ('valid','degraded') then excluded.last_known_good_at else public.delivery_progress_current.last_known_good_at end,
      route_graph_version = excluded.route_graph_version,
      route_graph_checksum = excluded.route_graph_checksum,
      projection_version = public.delivery_progress_current.projection_version + 1;
    perform private.broadcast_delivery_projection(delivery_row.id);
  end if;
  if job_row.kind = 'validation' then perform private.broadcast_route_job_projection(job_row.id); end if;
  return jsonb_build_object('accepted',true,'duplicate',false,'currentUpdated',true);
end;
$$;

revoke all on function public.ingest_robot_telemetry_v2(uuid,jsonb) from public, anon, authenticated;
grant execute on function public.ingest_robot_telemetry_v2(uuid,jsonb) to service_role;


-- projection 把車輛自己的位置也交出來。
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
      'vehicleState', vehicle_state.vehicle_state,
      -- 車輛自己在哪，跟這筆投遞走到哪是兩件事。停著的車沒有投遞進度，
      -- 但它仍然在某個地方 —— 地圖要畫得出來。
      'vehiclePosition', case when vehicle_state.segment_id is not null
        then jsonb_build_object('segmentId', vehicle_state.segment_id,
                                'progress', vehicle_state.segment_progress)
        else null end
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

commit;
