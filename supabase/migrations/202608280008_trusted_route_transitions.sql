begin;

create or replace function private.release_delivery_reservation(p_delivery_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  reserved_vehicle_id uuid;
begin
  update public.vehicle_reservations
  set state = 'released', ended_at = now()
  where delivery_id = p_delivery_id and state = 'active'
  returning vehicle_id into reserved_vehicle_id;
  if reserved_vehicle_id is not null then
    update public.vehicles
    set operational_status = 'available', updated_at = now()
    where id = reserved_vehicle_id and active;
  end if;
end;
$$;
revoke all on function private.release_delivery_reservation(uuid) from public;

create or replace function private.release_terminal_delivery_reservation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status in ('completed','cancelled','delivery_failed') and old.status <> new.status then
    perform private.release_delivery_reservation(new.id);
  end if;
  return new;
end;
$$;
revoke all on function private.release_terminal_delivery_reservation() from public;
create trigger deliveries_release_terminal_reservation
after update of status on public.deliveries
for each row execute function private.release_terminal_delivery_reservation();

create or replace function public.execute_delivery_intent(
  p_delivery_id uuid,
  p_intent text,
  p_expected_version integer,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  delivery_row public.deliveries;
  prior_status public.delivery_status;
  next_status public.delivery_status;
  selected_vehicle public.vehicles;
  pickup_code text;
  selected_route_job_id uuid;
  created_command_id uuid;
  prior_response jsonb;
begin
  if auth.uid() is null then raise exception 'RLS_DENIED' using errcode = '42501'; end if;
  select response_data into prior_response from private.idempotency_records
  where actor_scope = auth.uid()::text and operation = p_intent
    and idempotency_key = p_idempotency_key and expires_at > now();
  if prior_response is not null then return prior_response; end if;

  select * into delivery_row from public.deliveries where id = p_delivery_id for update;
  if delivery_row.id is null or delivery_row.sender_id <> auth.uid() then raise exception 'RLS_DENIED' using errcode = '42501'; end if;
  if delivery_row.version <> p_expected_version then raise exception 'DELIVERY_CONFLICT'; end if;
  prior_status := delivery_row.status;
  select code into pickup_code from public.delivery_locations where id = delivery_row.pickup_location_id;

  case p_intent
    when 'REQUEST_DISPATCH' then
      if delivery_row.status <> 'confirmed' then raise exception 'DELIVERY_INVALID_TRANSITION'; end if;
      select vehicle.* into selected_vehicle from public.vehicles vehicle
      where vehicle.active and vehicle.operational_status = 'available' and vehicle.current_stop_code is not null
        and not exists (
          select 1 from public.vehicle_reservations reservation
          where reservation.vehicle_id = vehicle.id and reservation.state = 'active'
        )
      order by vehicle.code for update skip locked limit 1;
      if selected_vehicle.id is null then raise exception 'VEHICLE_UNAVAILABLE'; end if;
      insert into public.vehicle_reservations(vehicle_id, delivery_id)
      values (selected_vehicle.id, p_delivery_id);
      update public.vehicles set operational_status = 'reserved', updated_at = now() where id = selected_vehicle.id;
      if selected_vehicle.current_stop_code = pickup_code then
        next_status := 'arrived_pickup';
      else
        selected_route_job_id := private.create_schematic_route_job(
          p_delivery_id, selected_vehicle.id, 'to_pickup', selected_vehicle.current_stop_code, pickup_code, auth.uid()
        );
        update public.vehicle_reservations set route_job_id = selected_route_job_id
        where delivery_id = p_delivery_id and state = 'active';
        next_status := 'dispatching';
      end if;
    when 'REQUEST_SENDER_OPEN' then
      if delivery_row.status <> 'arrived_pickup' then raise exception 'DELIVERY_INVALID_TRANSITION'; end if;
      insert into public.vehicle_commands(
        correlation_id, delivery_id, vehicle_id, type, idempotency_key,
        expected_delivery_version, schema_version, preconditions, expires_at, payload
      ) values (
        gen_random_uuid(), p_delivery_id, delivery_row.vehicle_id, 'OPEN_COMPARTMENT', p_idempotency_key,
        delivery_row.version, 2, jsonb_build_object('allowedVehicleStates', jsonb_build_array('at_stop')),
        now() + interval '5 minutes', jsonb_build_object('actor','sender')
      ) returning command_id into created_command_id;
      next_status := delivery_row.status;
    when 'LOAD_CONFIRMED' then
      if delivery_row.status <> 'compartment_open_for_sender' then raise exception 'DELIVERY_INVALID_TRANSITION'; end if;
      next_status := 'loaded';
    when 'REQUEST_CANCEL' then
      if delivery_row.status = 'confirmed' and delivery_row.vehicle_id is null then
        next_status := 'cancelled';
      elsif delivery_row.status in ('dispatching','arrived_pickup','compartment_open_for_sender','loaded','in_transit') then
        next_status := 'cancel_requested';
        select id into selected_route_job_id from public.route_jobs
        where delivery_id = delivery_row.id and state in ('queued','running','safe_stop_requested')
        order by created_at desc limit 1 for update;
        insert into public.vehicle_commands(
          correlation_id, delivery_id, route_job_id, vehicle_id, type, idempotency_key,
          expected_delivery_version, schema_version, preconditions, expires_at, payload
        ) values (
          gen_random_uuid(), p_delivery_id, selected_route_job_id, delivery_row.vehicle_id, 'CANCEL', p_idempotency_key,
          delivery_row.version, 2, '{}'::jsonb, now() + interval '30 minutes', '{}'::jsonb
        ) returning command_id into created_command_id;
        if selected_route_job_id is not null then
          update public.route_jobs set state = 'safe_stop_requested', updated_at = now() where id = selected_route_job_id;
        end if;
      else
        raise exception 'DELIVERY_INVALID_TRANSITION';
      end if;
    else
      raise exception 'DELIVERY_INVALID_TRANSITION';
  end case;

  update public.deliveries set
    status = next_status,
    version = version + 1,
    vehicle_id = coalesce(public.deliveries.vehicle_id, selected_vehicle.id),
    updated_at = now(),
    terminal_reason = case when next_status = 'cancelled' then 'cancelled_before_reservation' else terminal_reason end
  where id = p_delivery_id returning * into delivery_row;

  insert into public.delivery_status_history(delivery_id, version, from_status, to_status, event, actor_type, actor_id)
  values (
    p_delivery_id, delivery_row.version, prior_status, next_status,
    case when next_status = 'arrived_pickup' then 'VEHICLE_ARRIVED_PICKUP' else p_intent end,
    case when next_status = 'arrived_pickup' then 'system'::public.actor_type else 'sender'::public.actor_type end,
    auth.uid()
  );

  prior_response := private.safe_delivery_projection(p_delivery_id);
  insert into private.idempotency_records(actor_scope, operation, idempotency_key, request_hash, response_data, response_reference)
  values (
    auth.uid()::text, p_intent, p_idempotency_key,
    encode(extensions.digest(concat_ws('|', p_delivery_id, p_expected_version, p_intent), 'sha256'), 'hex'),
    prior_response, p_delivery_id
  );
  insert into public.audit_logs(actor_type, actor_id, intent, target_type, target_id, request_id, result)
  values ('sender', auth.uid(), p_intent, 'delivery', p_delivery_id, gen_random_uuid(), 'success');
  perform private.broadcast_delivery_projection(p_delivery_id);
  return prior_response;
end;
$$;
revoke all on function public.execute_delivery_intent(uuid,text,integer,text) from public;
grant execute on function public.execute_delivery_intent(uuid,text,integer,text) to authenticated;

create or replace function public.record_departure_ready(p_delivery_id uuid, p_safe_evidence jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  delivery_row public.deliveries;
  pickup_code text;
  dropoff_code text;
  current_stop text;
  created_job_id uuid;
begin
  if auth.role() <> 'service_role' and not private.is_active_operator('operator') then
    raise exception 'RLS_DENIED' using errcode = '42501';
  end if;
  select * into delivery_row from public.deliveries where id = p_delivery_id for update;
  if delivery_row.status <> 'loaded' then raise exception 'DELIVERY_INVALID_TRANSITION'; end if;
  select code into pickup_code from public.delivery_locations where id = delivery_row.pickup_location_id;
  select code into dropoff_code from public.delivery_locations where id = delivery_row.dropoff_location_id;
  select current_stop_code into current_stop from public.vehicles where id = delivery_row.vehicle_id for update;
  if current_stop is null or current_stop <> pickup_code then raise exception 'ROBOT_STATE_INVALID'; end if;
  created_job_id := private.create_schematic_route_job(
    delivery_row.id, delivery_row.vehicle_id, 'to_dropoff', pickup_code, dropoff_code, auth.uid()
  );
  update public.vehicle_reservations set route_job_id = created_job_id
  where delivery_id = delivery_row.id and state = 'active';
  update public.deliveries set status = 'in_transit', version = version + 1, updated_at = now()
  where id = delivery_row.id returning * into delivery_row;
  insert into public.delivery_status_history(delivery_id, version, from_status, to_status, event, actor_type, actor_id, safe_metadata)
  values (
    delivery_row.id, delivery_row.version, 'loaded', 'in_transit', 'DOOR_CLOSED_AND_DEPARTED',
    case when auth.role() = 'service_role' then 'system'::public.actor_type else 'operator'::public.actor_type end,
    auth.uid(), coalesce(p_safe_evidence, '{}'::jsonb) - array['rawPose','token','phone','email']
  );
  perform private.broadcast_delivery_projection(delivery_row.id);
  return private.safe_delivery_projection(delivery_row.id);
end;
$$;
revoke all on function public.record_departure_ready(uuid,jsonb) from public, anon;
grant execute on function public.record_departure_ready(uuid,jsonb) to authenticated, service_role;

create or replace function public.get_operator_route_validation_workspace()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when not private.is_active_operator('operator') then
    jsonb_build_object('error','RLS_DENIED')
  else jsonb_build_object(
    'capabilityEnabled', exists (
      select 1 from public.vehicles vehicle
      where vehicle.active and vehicle.route_validation_enabled
    ) and not exists (
      select 1 from public.physical_route_legs leg
      join public.route_graph_versions graph on graph.id = leg.route_graph_version_id and graph.status = 'active'
      where not leg.mapping_approved
    ),
    'mappingStatus', case when exists (
      select 1 from public.physical_route_legs leg
      join public.route_graph_versions graph on graph.id = leg.route_graph_version_id and graph.status = 'active'
      where not leg.mapping_approved
    ) then 'unapproved' else 'approved' end,
    'vehicles', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', vehicle.id,
        'code', vehicle.code,
        'displayName', vehicle.display_name,
        'operationalStatus', vehicle.operational_status,
        'routeValidationEnabled', vehicle.route_validation_enabled
      ) order by vehicle.code)
      from public.vehicles vehicle where vehicle.active
    ), '[]'::jsonb),
    'legs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'legId', leg.leg_id,
        'physicalFrom', leg.physical_from,
        'physicalTo', leg.physical_to,
        'fromStopCode', leg.from_stop_code,
        'toStopCode', leg.to_stop_code,
        'mappingApproved', leg.mapping_approved
      ) order by leg.leg_id)
      from public.physical_route_legs leg
      join public.route_graph_versions graph on graph.id = leg.route_graph_version_id and graph.status = 'active'
    ), '[]'::jsonb),
    'activeRun', (
      select private.safe_route_job_projection(job.id)
      from public.route_jobs job
      where job.kind = 'validation' and job.state in ('queued','running','safe_stop_requested')
      order by job.created_at desc limit 1
    )
  ) end;
$$;
revoke all on function public.get_operator_route_validation_workspace() from public, anon;
grant execute on function public.get_operator_route_validation_workspace() to authenticated;

create or replace function public.create_route_validation_job(
  p_vehicle_id uuid,
  p_leg_id text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  vehicle_row public.vehicles;
  graph_row public.route_graph_versions;
  manifest_leg public.physical_route_legs;
  created_job_id uuid;
  prior_response jsonb;
begin
  if not private.is_active_operator('operator') then raise exception 'RLS_DENIED' using errcode = '42501'; end if;
  select response_data into prior_response from private.idempotency_records
  where actor_scope = auth.uid()::text and operation = 'CREATE_ROUTE_VALIDATION'
    and idempotency_key = p_idempotency_key and expires_at > now();
  if prior_response is not null then return prior_response; end if;
  select * into vehicle_row from public.vehicles where id = p_vehicle_id for update;
  select * into graph_row from public.route_graph_versions where status = 'active';
  select * into manifest_leg from public.physical_route_legs
  where route_graph_version_id = graph_row.id and leg_id = p_leg_id;
  if vehicle_row.id is null or not vehicle_row.active or vehicle_row.operational_status <> 'available' then raise exception 'VEHICLE_UNAVAILABLE'; end if;
  if not vehicle_row.route_validation_enabled or not manifest_leg.mapping_approved then raise exception 'PHYSICAL_CAPABILITY_DISABLED'; end if;
  if exists (select 1 from public.physical_route_legs where route_graph_version_id = graph_row.id and not mapping_approved) then
    raise exception 'PHYSICAL_MAPPING_UNAPPROVED';
  end if;
  insert into public.route_jobs(
    vehicle_id, kind, route_graph_version_id, route_graph_checksum,
    from_stop_code, to_stop_code, leg_count, initiated_by
  ) values (
    vehicle_row.id, 'validation', graph_row.id, graph_row.checksum,
    manifest_leg.from_stop_code, manifest_leg.to_stop_code, 1, auth.uid()
  ) returning id into created_job_id;
  insert into public.route_job_legs(route_job_id, leg_index, leg_id, from_stop_code, to_stop_code, allowed_segment_ids)
  values (created_job_id, 0, manifest_leg.leg_id, manifest_leg.from_stop_code, manifest_leg.to_stop_code, manifest_leg.allowed_segment_ids);
  insert into public.vehicle_reservations(vehicle_id, route_job_id) values (vehicle_row.id, created_job_id);
  update public.vehicles set operational_status = 'reserved', updated_at = now() where id = vehicle_row.id;
  perform private.enqueue_route_job_leg(created_job_id, 0);
  prior_response := private.safe_route_job_projection(created_job_id);
  insert into private.idempotency_records(actor_scope, operation, idempotency_key, request_hash, response_data, response_reference)
  values (
    auth.uid()::text, 'CREATE_ROUTE_VALIDATION', p_idempotency_key,
    encode(extensions.digest(concat_ws('|',p_vehicle_id,p_leg_id), 'sha256'), 'hex'),
    prior_response, created_job_id
  );
  insert into public.audit_logs(actor_type, actor_id, intent, target_type, target_id, request_id, result)
  values ('operator', auth.uid(), 'CREATE_ROUTE_VALIDATION', 'route_job', created_job_id, gen_random_uuid(), 'success');
  perform private.broadcast_route_job_projection(created_job_id);
  return prior_response;
end;
$$;
revoke all on function public.create_route_validation_job(uuid,text,text) from public, anon;
grant execute on function public.create_route_validation_job(uuid,text,text) to authenticated;

create or replace function public.request_route_validation_stop(p_route_job_id uuid, p_idempotency_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  job_row public.route_jobs;
begin
  if not private.is_active_operator('operator') then raise exception 'RLS_DENIED' using errcode = '42501'; end if;
  select * into job_row from public.route_jobs where id = p_route_job_id and kind = 'validation' for update;
  if job_row.state not in ('queued','running','safe_stop_requested') then raise exception 'DELIVERY_INVALID_TRANSITION'; end if;
  if job_row.state <> 'safe_stop_requested' then
    update public.route_jobs set state = 'safe_stop_requested', updated_at = now() where id = job_row.id;
    insert into public.vehicle_commands(
      correlation_id, route_job_id, vehicle_id, type, idempotency_key,
      schema_version, preconditions, expires_at, payload
    ) values (
      gen_random_uuid(), job_row.id, job_row.vehicle_id, 'CANCEL', p_idempotency_key,
      2, '{}'::jsonb, now() + interval '30 minutes', '{}'::jsonb
    );
  end if;
  insert into public.audit_logs(actor_type, actor_id, intent, target_type, target_id, request_id, result)
  values ('operator', auth.uid(), 'REQUEST_ROUTE_VALIDATION_STOP', 'route_job', job_row.id, gen_random_uuid(), 'accepted');
  perform private.broadcast_route_job_projection(job_row.id);
  return private.safe_route_job_projection(job_row.id);
end;
$$;
revoke all on function public.request_route_validation_stop(uuid,text) from public, anon;
grant execute on function public.request_route_validation_stop(uuid,text) to authenticated;

commit;
