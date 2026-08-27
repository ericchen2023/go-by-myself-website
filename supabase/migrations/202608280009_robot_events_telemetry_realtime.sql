begin;

create or replace function public.process_robot_command_event(
  p_vehicle_id uuid,
  p_command_id uuid,
  p_event_id uuid,
  p_event public.command_event_type,
  p_source_sequence bigint,
  p_evidence jsonb,
  p_error_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  command_row public.vehicle_commands;
  delivery_row public.deliveries;
  job_row public.route_jobs;
  leg_row public.route_job_legs;
  prior_leg_state public.route_leg_state;
  from_status public.delivery_status;
  next_status public.delivery_status;
  sanitized_evidence jsonb;
  next_leg_index integer;
begin
  select * into command_row from public.vehicle_commands where command_id = p_command_id for update;
  if command_row.command_id is null or command_row.vehicle_id <> p_vehicle_id or command_row.schema_version <> 2 then
    raise exception 'ROBOT_SCOPE_DENIED' using errcode = '42501';
  end if;
  if exists (select 1 from public.vehicle_command_events where event_id = p_event_id) then
    if command_row.delivery_id is not null then return private.safe_delivery_projection(command_row.delivery_id); end if;
    return private.safe_route_job_projection(command_row.route_job_id);
  end if;
  if command_row.expires_at <= now() and p_event = 'accepted' then raise exception 'COMMAND_EXPIRED'; end if;

  sanitized_evidence := coalesce(p_evidence, '{}'::jsonb) - array['rawPose','token','authorization','phone','email','credential'];
  insert into public.vehicle_command_events(command_id, event_id, event, source_sequence, error_code, evidence)
  values (p_command_id, p_event_id, p_event, p_source_sequence, left(p_error_code, 64), sanitized_evidence);
  update public.vehicle_commands set
    status = p_event::text::public.command_state,
    completed_at = case when p_event in ('completed','failed','rejected') then now() else completed_at end
  where command_id = p_command_id;

  if command_row.route_job_id is not null then
    select * into job_row from public.route_jobs where id = command_row.route_job_id for update;
  end if;
  if command_row.type = 'DISPATCH' and job_row.id is not null then
    select * into leg_row from public.route_job_legs where command_id = command_row.command_id for update;
    prior_leg_state := leg_row.state;
    if p_event = 'accepted' then
      update public.route_job_legs set state = 'accepted', accepted_at = coalesce(accepted_at, now()) where id = leg_row.id;
      update public.route_jobs set state = 'running', started_at = coalesce(started_at, now()), updated_at = now() where id = job_row.id;
    elsif p_event = 'completed' then
      update public.route_job_legs set state = 'completed', completed_at = now(), safe_evidence = sanitized_evidence where id = leg_row.id;
      next_leg_index := leg_row.leg_index + 1;
      if next_leg_index < job_row.leg_count then
        update public.route_jobs set current_leg_index = next_leg_index, state = 'queued', updated_at = now() where id = job_row.id;
        perform private.enqueue_route_job_leg(job_row.id, next_leg_index);
      else
        update public.route_jobs set state = 'completed', completed_at = now(), updated_at = now() where id = job_row.id;
        update public.vehicles set current_stop_code = job_row.to_stop_code, updated_at = now() where id = job_row.vehicle_id;
        if job_row.delivery_id is not null then
          select * into delivery_row from public.deliveries where id = job_row.delivery_id for update;
          from_status := delivery_row.status;
          if job_row.kind = 'to_pickup' and delivery_row.status = 'dispatching' then next_status := 'arrived_pickup'; end if;
          if job_row.kind = 'to_dropoff' and delivery_row.status = 'in_transit' then next_status := 'arrived_dropoff'; end if;
          if next_status is not null then
            update public.deliveries set status = next_status, version = version + 1, updated_at = now()
            where id = delivery_row.id returning * into delivery_row;
            insert into public.delivery_status_history(delivery_id, version, from_status, to_status, event, actor_type, safe_metadata)
            values (
              delivery_row.id, delivery_row.version, from_status, next_status,
              case next_status when 'arrived_pickup' then 'VEHICLE_ARRIVED_PICKUP' else 'VEHICLE_ARRIVED_DROPOFF' end,
              'gateway', jsonb_build_object('routeJobId',job_row.id,'commandId',p_command_id)
            );
          end if;
        else
          perform private.release_route_job_reservation(job_row.id);
        end if;
      end if;
    elsif p_event in ('failed','rejected') then
      update public.route_job_legs set state = 'failed', completed_at = now(), safe_evidence = sanitized_evidence where id = leg_row.id;
      update public.route_jobs set state = 'failed', terminal_reason = coalesce(p_error_code,'COMMAND_FAILED'), completed_at = now(), updated_at = now() where id = job_row.id;
      if job_row.delivery_id is not null then
        select * into delivery_row from public.deliveries where id = job_row.delivery_id for update;
        if p_error_code = 'COMMAND_EXPIRED' and prior_leg_state = 'queued' and job_row.kind = 'to_pickup' and delivery_row.status = 'dispatching' then
          update public.deliveries set status = 'confirmed', vehicle_id = null, version = version + 1, updated_at = now()
          where id = delivery_row.id returning * into delivery_row;
          insert into public.delivery_status_history(delivery_id, version, from_status, to_status, event, actor_type, reason, safe_metadata)
          values (delivery_row.id, delivery_row.version, 'dispatching', 'confirmed', 'DISPATCH_EXPIRED_UNACCEPTED', 'system', 'COMMAND_EXPIRED', jsonb_build_object('routeJobId',job_row.id));
          perform private.release_route_job_reservation(job_row.id);
        else
          insert into public.robot_faults(vehicle_id, delivery_id, route_job_id, type, severity, safe_evidence, observed_at)
          values (p_vehicle_id, delivery_row.id, job_row.id, coalesce(p_error_code,'COMMAND_FAILED'), 'warning', jsonb_build_object('commandId',p_command_id), now());
        end if;
      else
        insert into public.robot_faults(vehicle_id, route_job_id, type, severity, safe_evidence, observed_at)
        values (p_vehicle_id, job_row.id, coalesce(p_error_code,'COMMAND_FAILED'), 'warning', jsonb_build_object('commandId',p_command_id), now());
        perform private.release_route_job_reservation(job_row.id);
      end if;
    end if;
  elsif command_row.type = 'CANCEL' and job_row.id is not null and p_event = 'completed' then
    update public.route_jobs set state = 'cancelled', terminal_reason = 'safe_stop_completed', completed_at = now(), updated_at = now() where id = job_row.id;
    if job_row.delivery_id is null then perform private.release_route_job_reservation(job_row.id); end if;
  elsif command_row.type = 'OPEN_COMPARTMENT' and p_event = 'completed' and command_row.delivery_id is not null then
    select * into delivery_row from public.deliveries where id = command_row.delivery_id for update;
    from_status := delivery_row.status;
    if delivery_row.status = 'arrived_pickup' and command_row.payload ->> 'actor' = 'sender' then
      next_status := 'compartment_open_for_sender';
    elsif delivery_row.status = 'awaiting_recipient' and command_row.payload ->> 'actor' = 'recipient' then
      next_status := 'compartment_open_for_recipient';
      update private.pickup_credentials set state = 'used', used_at = now(), delete_after = now() + interval '24 hours'
      where delivery_id = delivery_row.id and verified_attempt_id::text = command_row.idempotency_key and state = 'active';
    end if;
    if next_status is not null then
      update public.deliveries set status = next_status, version = version + 1, updated_at = now()
      where id = delivery_row.id returning * into delivery_row;
      insert into public.delivery_status_history(delivery_id, version, from_status, to_status, event, actor_type, safe_metadata)
      values (
        delivery_row.id, delivery_row.version, from_status, next_status,
        case next_status when 'compartment_open_for_sender' then 'SENDER_OPEN_COMPLETED' else 'RECIPIENT_OPEN_COMPLETED' end,
        'gateway', jsonb_build_object('commandId',p_command_id)
      );
    end if;
  elsif p_event in ('failed','rejected') then
    insert into public.robot_faults(vehicle_id, delivery_id, route_job_id, type, severity, safe_evidence, observed_at)
    values (p_vehicle_id, command_row.delivery_id, command_row.route_job_id, coalesce(p_error_code,'COMMAND_FAILED'), 'warning', jsonb_build_object('commandId',p_command_id), now());
  end if;

  insert into public.audit_logs(actor_type, intent, target_type, target_id, request_id, result, safe_metadata)
  values (
    'gateway', 'COMMAND_' || upper(p_event::text),
    case when command_row.route_job_id is not null then 'route_job' else 'delivery' end,
    coalesce(command_row.route_job_id, command_row.delivery_id), p_event_id, p_event::text,
    jsonb_build_object('commandId',p_command_id)
  );
  if command_row.delivery_id is not null then
    perform private.broadcast_delivery_projection(command_row.delivery_id);
  end if;
  if command_row.route_job_id is not null then
    select * into job_row from public.route_jobs where id = command_row.route_job_id;
    if job_row.kind = 'validation' then perform private.broadcast_route_job_projection(job_row.id); end if;
  end if;
  if command_row.delivery_id is not null then return private.safe_delivery_projection(command_row.delivery_id); end if;
  return private.safe_route_job_projection(command_row.route_job_id);
end;
$$;
revoke all on function public.process_robot_command_event(uuid,uuid,uuid,public.command_event_type,bigint,jsonb,text) from public, anon, authenticated;
grant execute on function public.process_robot_command_event(uuid,uuid,uuid,public.command_event_type,bigint,jsonb,text) to service_role;

create or replace function public.ingest_robot_telemetry_v2(p_vehicle_id uuid, p_envelope jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
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
    if job_row.id is null then raise exception 'ROUTE_SEGMENT_NOT_ALLOWED'; end if;
    select * into leg_row from public.route_job_legs
    where route_job_id = job_row.id and leg_index = job_row.current_leg_index for update;
    if route_payload ->> 'routeGraphVersion' <> 'ndhu-four-stop-route-v4'
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
    connectivity, observed_at, received_at
  ) values (
    p_vehicle_id, incoming_boot_id, incoming_sequence, p_envelope #>> '{pose,frameId}',
    (p_envelope #>> '{pose,x}')::double precision, (p_envelope #>> '{pose,y}')::double precision,
    (p_envelope #>> '{pose,heading}')::double precision, (p_envelope #>> '{battery,percent}')::numeric,
    (p_envelope #>> '{battery,voltageV}')::numeric, (p_envelope ->> 'vehicleState')::public.vehicle_runtime_state,
    incoming_quality, job_row.id, leg_row.leg_id, 'online', observed_at, received_at
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
      'ndhu-four-stop-route-v4', job_row.route_graph_checksum, 1
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
begin
  for progress_row in
    select progress.delivery_id, progress.connectivity, progress.observed_at, delivery.vehicle_id
    from public.delivery_progress_current progress
    join public.deliveries delivery on delivery.id = progress.delivery_id
    where delivery.status not in ('completed','cancelled','delivery_failed')
  loop
    target_connectivity := case
      when progress_row.observed_at is null or progress_row.observed_at < now() - interval '60 seconds' then 'offline'
      when progress_row.observed_at < now() - interval '10 seconds' then 'stale'
      else 'online'
    end;
    if target_connectivity <> progress_row.connectivity then
      update public.delivery_progress_current
      set connectivity = target_connectivity, projection_version = projection_version + 1, updated_at = now()
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
  return changed_count;
end;
$$;
revoke all on function public.reconcile_robot_runtime() from public, anon, authenticated;
grant execute on function public.reconcile_robot_runtime() to service_role;

create or replace function private.can_access_realtime_topic(p_topic text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target_id uuid;
begin
  if p_topic like 'delivery:%' then
    target_id := split_part(p_topic, ':', 2)::uuid;
    return exists (
      select 1 from public.deliveries delivery
      where delivery.id = target_id and (delivery.sender_id = auth.uid() or private.is_active_operator('operator'))
    );
  end if;
  if p_topic like 'route-validation:%' then
    target_id := split_part(p_topic, ':', 2)::uuid;
    return private.is_active_operator('operator') and exists (select 1 from public.route_jobs where id = target_id and kind = 'validation');
  end if;
  return false;
exception when invalid_text_representation then return false;
end;
$$;
revoke all on function private.can_access_realtime_topic(text) from public;

alter table realtime.messages enable row level security;
create policy gbm_private_topic_read on realtime.messages
for select to authenticated using (private.can_access_realtime_topic(realtime.topic()));

commit;

create extension if not exists pg_cron with schema pg_catalog;
do $$
begin
  if not exists (select 1 from cron.job where jobname = 'gbm-reconcile-robot-runtime') then
    perform cron.schedule('gbm-reconcile-robot-runtime', '10 seconds', 'select public.reconcile_robot_runtime();');
  end if;
end;
$$;
