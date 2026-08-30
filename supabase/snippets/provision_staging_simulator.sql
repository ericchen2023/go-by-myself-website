-- STAGING ONLY. This keeps every physical capability closed while enabling the
-- synthetic vehicle used by the production-shaped simulator.
begin;

do $$
declare
  staging_vehicle_id uuid;
begin
  if not exists (
    select 1 from public.route_graph_versions
    where version = 'ndhu-four-stop-route-v4' and status = 'active'
  ) then
    raise exception 'STAGING_ROUTE_GRAPH_NOT_READY';
  end if;

  if exists (select 1 from public.physical_route_legs where mapping_approved) then
    raise exception 'STAGING_PHYSICAL_GATE_MUST_REMAIN_CLOSED';
  end if;

  update public.vehicles
  set operational_status = 'available',
      active = true,
      current_stop_code = 'HSS1',
      home_stop_code = 'HSS1',
      capabilities = '{"syntheticCompartment":true,"telemetryV2":true}'::jsonb,
      route_validation_enabled = false,
      updated_at = now()
  where code = 'GBM-01'
  returning id into staging_vehicle_id;

  if staging_vehicle_id is null then
    raise exception 'STAGING_VEHICLE_NOT_FOUND';
  end if;

  insert into public.audit_logs(
    actor_type, intent, target_type, target_id, request_id, result, safe_metadata
  ) values (
    'system', 'PROVISION_STAGING_SIMULATOR', 'vehicle', staging_vehicle_id,
    gen_random_uuid(), 'success',
    jsonb_build_object('routeValidationEnabled', false, 'physicalMappingApproved', false)
  );
end;
$$;

commit;
