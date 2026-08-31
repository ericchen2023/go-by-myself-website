-- Route graph v5: the schematic now follows the surveyed road.
--
-- v4 drew LIBRARY and ADMIN as the ends of a trunk with HSS1/HSS2 on spurs, so
-- a LIBRARY->ADMIN plan bypassed both HSS stops. The surveyed centreline in the
-- vehicle repository (routes_site/pass_spine.csv, shared by all eight taught
-- legs) puts the four stops on one corridor in the order
-- LIBRARY - HSS2 - HSS1 - ADMIN, so the direct route drives past both. A car
-- reported against v4 was drawn on a spur it never travelled.
--
-- v5 is that corridor: four nodes, three edges carrying the road's shape. Each
-- taught leg now matches exactly one edge (A_B, B_C, C_D) or the three of them
-- in sequence (A_D), which is why the edge ids were replaced rather than moved.
--
-- v4 rows are retired, not deleted: existing deliveries still reference them.

begin;

update public.route_graph_versions
set status = 'retired'
where status = 'active' and version <> 'ndhu-four-stop-route-v5';

insert into public.route_graph_versions(version, checksum, status, graph, activated_at)
values ('ndhu-four-stop-route-v5', 'sha256:903ad46062842c61458665472452f6f56bdeddd32c1f8bc6948214a5081ffd9e', 'active', '{"viewBox":[0,0,1000,650],"source":"contracts/route-graph.v5.json","physicalCalibration":"pending","visibleStops":["LIBRARY","HSS2","HSS1","ADMIN"],"edgeIds":["edge-library-hss2","edge-hss2-hss1","edge-hss1-admin"]}'::jsonb, now())
on conflict (version) do update set
  checksum = excluded.checksum,
  status = 'active',
  graph = excluded.graph,
  activated_at = excluded.activated_at;

insert into public.delivery_locations(route_graph_version_id, code, name, detail, route_node_id, active)
select graph.id, location.code, location.name, location.detail, location.node_id, true
from public.route_graph_versions graph
cross join (values
  ('LIBRARY', '圖資中心', '圖資大樓正門・公車站前', 'LIBRARY'),
  ('HSS2', '人社二館', '人社院北側取放點', 'HSS2'),
  ('HSS1', '人社一館', '人社院南側取放點', 'HSS1'),
  ('ADMIN', '行政大樓', '郵局旁', 'ADMIN')
) as location(code, name, detail, node_id)
where graph.version = 'ndhu-four-stop-route-v5'
on conflict (route_graph_version_id, code) do update set
  name = excluded.name,
  detail = excluded.detail,
  route_node_id = excluded.route_node_id,
  active = true;

insert into public.route_pair_plans(route_graph_version_id, from_stop_code, to_stop_code, allowed_segment_ids)
select graph.id, plan.from_code, plan.to_code, plan.edges
from public.route_graph_versions graph
cross join (values
  ('LIBRARY','HSS2',array['edge-library-hss2']::text[]),
  ('LIBRARY','HSS1',array['edge-library-hss2','edge-hss2-hss1']::text[]),
  ('LIBRARY','ADMIN',array['edge-library-hss2','edge-hss2-hss1','edge-hss1-admin']::text[]),
  ('HSS2','LIBRARY',array['edge-library-hss2']::text[]),
  ('HSS2','HSS1',array['edge-hss2-hss1']::text[]),
  ('HSS2','ADMIN',array['edge-hss2-hss1','edge-hss1-admin']::text[]),
  ('HSS1','LIBRARY',array['edge-hss2-hss1','edge-library-hss2']::text[]),
  ('HSS1','HSS2',array['edge-hss2-hss1']::text[]),
  ('HSS1','ADMIN',array['edge-hss1-admin']::text[]),
  ('ADMIN','LIBRARY',array['edge-hss1-admin','edge-hss2-hss1','edge-library-hss2']::text[]),
  ('ADMIN','HSS2',array['edge-hss1-admin','edge-hss2-hss1']::text[]),
  ('ADMIN','HSS1',array['edge-hss1-admin']::text[])
) as plan(from_code, to_code, edges)
where graph.version = 'ndhu-four-stop-route-v5'
on conflict (route_graph_version_id, from_stop_code, to_stop_code) do update set
  allowed_segment_ids = excluded.allowed_segment_ids;

-- The eight taught legs, still unapproved: A/B/C/D carry no stop codes and no
-- allowed segments here, so physical capability stays shut until sign-off.
insert into public.physical_route_legs(route_graph_version_id, leg_id, physical_from, physical_to)
select graph.id, leg.leg_id, leg.from_code, leg.to_code
from public.route_graph_versions graph
cross join (values
  ('A_B','A','B'),('B_A','B','A'),('B_C','B','C'),('C_B','C','B'),
  ('C_D','C','D'),('D_C','D','C'),('A_D','A','D'),('D_A','D','A')
) as leg(leg_id, from_code, to_code)
where graph.version = 'ndhu-four-stop-route-v5'
on conflict (route_graph_version_id, leg_id) do nothing;

-- Telemetry ingest hard-coded the graph version, so any graph bump would have
-- rejected every route payload until this function was rewritten. Read the
-- version the route job was actually created against instead.
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

commit;
