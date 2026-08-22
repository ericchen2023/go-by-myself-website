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
  from_status public.delivery_status;
  next_status public.delivery_status;
  safe_evidence jsonb;
begin
  select * into command_row from public.vehicle_commands where command_id = p_command_id for update;
  if command_row.command_id is null or command_row.vehicle_id <> p_vehicle_id then
    raise exception 'ROBOT_SCOPE_DENIED' using errcode = '42501';
  end if;
  if exists (select 1 from public.vehicle_command_events where event_id = p_event_id) then
    return private.safe_delivery_projection(command_row.delivery_id);
  end if;
  if command_row.expires_at <= now() and p_event = 'accepted' then
    raise exception 'COMMAND_EXPIRED';
  end if;

  safe_evidence := coalesce(p_evidence, '{}'::jsonb) - array['rawPose','token','authorization','phone','email'];
  insert into public.vehicle_command_events(command_id, event_id, event, source_sequence, error_code, evidence)
  values (p_command_id, p_event_id, p_event, p_source_sequence, left(p_error_code, 64), safe_evidence);

  update public.vehicle_commands set
    status = p_event::text::public.command_state,
    completed_at = case when p_event in ('completed','failed','rejected') then now() else completed_at end
  where command_id = p_command_id;

  select * into delivery_row from public.deliveries where id = command_row.delivery_id for update;
  from_status := delivery_row.status;

  if p_event = 'completed' and command_row.type = 'OPEN_COMPARTMENT' then
    if delivery_row.status = 'arrived_pickup' and command_row.payload ->> 'actor' = 'sender' then
      next_status := 'compartment_open_for_sender';
    elsif delivery_row.status = 'awaiting_recipient' and command_row.payload ->> 'actor' = 'recipient' then
      next_status := 'compartment_open_for_recipient';
      update private.pickup_credentials
      set state = 'used', used_at = now(), delete_after = now() + interval '24 hours'
      where delivery_id = delivery_row.id and verified_attempt_id::text = command_row.idempotency_key and state = 'active';
    else
      insert into public.robot_faults(vehicle_id, delivery_id, type, severity, safe_evidence, observed_at)
      values (p_vehicle_id, delivery_row.id, 'COMMAND_COMPLETED_STATE_MISMATCH', 'warning', jsonb_build_object('commandId', p_command_id, 'deliveryStatus', delivery_row.status), now());
    end if;
  end if;

  if next_status is not null then
    update public.deliveries set status = next_status, version = version + 1, updated_at = now()
    where id = delivery_row.id returning * into delivery_row;
    insert into public.delivery_status_history(delivery_id, version, from_status, to_status, event, actor_type, actor_id, safe_metadata)
    values (delivery_row.id, delivery_row.version, from_status, next_status,
      case next_status when 'compartment_open_for_sender' then 'SENDER_OPEN_COMPLETED' else 'RECIPIENT_OPEN_COMPLETED' end,
      'gateway', null, jsonb_build_object('commandId', p_command_id));
  elsif p_event in ('failed','rejected') then
    insert into public.robot_faults(vehicle_id, delivery_id, type, severity, safe_evidence, observed_at)
    values (p_vehicle_id, delivery_row.id, coalesce(p_error_code, 'COMMAND_FAILED'), 'warning', jsonb_build_object('commandId', p_command_id), now());
  end if;

  insert into public.audit_logs(actor_type, intent, target_type, target_id, request_id, result, safe_metadata)
  values ('gateway', 'COMMAND_' || upper(p_event::text), 'delivery', delivery_row.id, p_event_id, p_event::text, jsonb_build_object('commandId', p_command_id));
  return private.safe_delivery_projection(delivery_row.id);
end;
$$;
revoke all on function public.process_robot_command_event(uuid,uuid,uuid,public.command_event_type,bigint,jsonb,text) from public, anon, authenticated;
grant execute on function public.process_robot_command_event(uuid,uuid,uuid,public.command_event_type,bigint,jsonb,text) to service_role;

commit;
