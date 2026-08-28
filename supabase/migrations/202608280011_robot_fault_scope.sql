begin;

create or replace function public.record_robot_fault(p_vehicle_id uuid, p_envelope jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_delivery_id uuid := nullif(p_envelope ->> 'deliveryId', '')::uuid;
  target_route_job_id uuid := nullif(p_envelope ->> 'routeJobId', '')::uuid;
  scoped_delivery_id uuid;
  safe_evidence jsonb;
  created_fault_id uuid;
begin
  if (p_envelope ->> 'vehicleId') is distinct from p_vehicle_id::text
    or (p_envelope ->> 'schemaVersion')::integer <> 2 then
    raise exception 'ROBOT_SCOPE_DENIED' using errcode = '42501';
  end if;

  if target_route_job_id is not null then
    select delivery_id into scoped_delivery_id
    from public.route_jobs
    where id = target_route_job_id and vehicle_id = p_vehicle_id;
    if not found or (target_delivery_id is not null and target_delivery_id is distinct from scoped_delivery_id) then
      raise exception 'ROBOT_SCOPE_DENIED' using errcode = '42501';
    end if;
    target_delivery_id := coalesce(target_delivery_id, scoped_delivery_id);
  elsif target_delivery_id is not null and not exists (
    select 1 from public.deliveries
    where id = target_delivery_id and vehicle_id = p_vehicle_id
  ) then
    raise exception 'ROBOT_SCOPE_DENIED' using errcode = '42501';
  end if;

  safe_evidence := jsonb_strip_nulls(jsonb_build_object(
    'code', p_envelope #> '{evidence,code}',
    'component', p_envelope #> '{evidence,component}',
    'recoverable', p_envelope #> '{evidence,recoverable}',
    'safeStop', p_envelope #> '{evidence,safeStop}',
    'doorState', p_envelope #> '{evidence,doorState}',
    'vehicleState', p_envelope #> '{evidence,vehicleState}',
    'legId', p_envelope #> '{evidence,legId}',
    'commandId', p_envelope #> '{evidence,commandId}'
  ));

  insert into public.robot_faults(
    vehicle_id, delivery_id, route_job_id, type, severity, safe_evidence, observed_at
  ) values (
    p_vehicle_id, target_delivery_id, target_route_job_id,
    p_envelope ->> 'type', (p_envelope ->> 'severity')::public.fault_severity,
    safe_evidence, (p_envelope ->> 'observedAt')::timestamptz
  ) returning id into created_fault_id;

  return jsonb_build_object('accepted', true, 'faultId', created_fault_id);
end;
$$;
revoke all on function public.record_robot_fault(uuid,jsonb) from public, anon, authenticated;
grant execute on function public.record_robot_fault(uuid,jsonb) to service_role;

commit;
