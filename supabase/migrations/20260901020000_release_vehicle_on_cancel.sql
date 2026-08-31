-- Release the vehicle when it confirms a cancel.
--
-- process_robot_command_event marked the route job cancelled and then released
-- the reservation only when the job had no delivery. With a delivery attached
-- it did nothing further, so the delivery stayed in cancel_requested and its
-- vehicle_reservations row stayed active. Nothing else moves a delivery out of
-- cancel_requested: the expiry reconciler only recovers deliveries still in
-- dispatching.
--
-- One cancelled delivery therefore held the vehicle for good. With a single
-- vehicle that is the entire fleet, and every later dispatch failed with
-- VEHICLE_UNAVAILABLE. It happened twice on 2026-08-31, the second time after
-- the first was cleared by hand.
--
-- The vehicle confirming safe stop is the last thing the cancel was waiting
-- for, so the delivery becomes cancelled there. The existing
-- deliveries_release_terminal_reservation trigger frees the vehicle.

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
    if job_row.delivery_id is null then
      perform private.release_route_job_reservation(job_row.id);
    else
      -- The vehicle has confirmed it stopped, which is the last thing anyone was
      -- waiting for. Leaving the delivery in cancel_requested holds its vehicle
      -- reservation open for good, and with one vehicle that is the whole fleet.
      select * into delivery_row from public.deliveries where id = job_row.delivery_id for update;
      if delivery_row.status = 'cancel_requested' then
        from_status := delivery_row.status;
        update public.deliveries set status = 'cancelled', version = version + 1, updated_at = now()
        where id = delivery_row.id returning * into delivery_row;
        insert into public.delivery_status_history(delivery_id, version, from_status, to_status, event, actor_type, safe_metadata)
        values (
          delivery_row.id, delivery_row.version, from_status, 'cancelled',
          'VEHICLE_SAFE_STOP_CONFIRMED', 'gateway',
          jsonb_build_object('routeJobId', job_row.id, 'commandId', p_command_id)
        );
        -- deliveries_release_terminal_reservation releases the vehicle from here.
      end if;
    end if;
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

commit;
