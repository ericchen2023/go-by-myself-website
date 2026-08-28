begin;

alter table public.vehicles
  add column current_stop_code text,
  add column home_stop_code text,
  add column capabilities jsonb not null default '{}'::jsonb,
  add column route_validation_enabled boolean not null default false,
  add constraint vehicles_current_stop_known check (current_stop_code is null or current_stop_code in ('LIBRARY','ADMIN','HSS1','HSS2')),
  add constraint vehicles_home_stop_known check (home_stop_code is null or home_stop_code in ('LIBRARY','ADMIN','HSS1','HSS2')),
  add constraint vehicles_capabilities_object check (jsonb_typeof(capabilities) = 'object');

create table public.route_jobs (
  id uuid primary key default gen_random_uuid(),
  delivery_id uuid references public.deliveries(id) on delete restrict,
  vehicle_id uuid not null references public.vehicles(id) on delete restrict,
  kind public.route_job_kind not null,
  state public.route_job_state not null default 'queued',
  route_graph_version_id uuid not null references public.route_graph_versions(id) on delete restrict,
  route_graph_checksum text not null,
  from_stop_code text not null,
  to_stop_code text not null,
  current_leg_index integer not null default 0 check (current_leg_index >= 0),
  leg_count integer not null check (leg_count >= 1),
  initiated_by uuid,
  terminal_reason text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint route_job_stops_known check (
    from_stop_code in ('LIBRARY','ADMIN','HSS1','HSS2') and
    to_stop_code in ('LIBRARY','ADMIN','HSS1','HSS2') and
    from_stop_code <> to_stop_code
  ),
  constraint route_job_delivery_scope check (
    (kind in ('to_pickup','to_dropoff') and delivery_id is not null) or
    (kind in ('validation','return'))
  )
);
create index route_jobs_vehicle_active_idx on public.route_jobs(vehicle_id, updated_at desc)
where state in ('queued','running','safe_stop_requested');
create index route_jobs_delivery_idx on public.route_jobs(delivery_id, created_at desc) where delivery_id is not null;

create table public.route_job_legs (
  id uuid primary key default gen_random_uuid(),
  route_job_id uuid not null references public.route_jobs(id) on delete restrict,
  leg_index integer not null check (leg_index >= 0),
  leg_id text not null,
  from_stop_code text not null,
  to_stop_code text not null,
  allowed_segment_ids text[] not null,
  command_id uuid,
  state public.route_leg_state not null default 'queued',
  accepted_at timestamptz,
  completed_at timestamptz,
  safe_evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(route_job_id, leg_index),
  unique(route_job_id, leg_id),
  constraint route_leg_has_segments check (cardinality(allowed_segment_ids) > 0),
  constraint route_leg_evidence_object check (jsonb_typeof(safe_evidence) = 'object')
);

create table public.vehicle_boot_sessions (
  vehicle_id uuid not null references public.vehicles(id) on delete restrict,
  boot_id uuid not null,
  first_observed_at timestamptz not null,
  last_observed_at timestamptz not null,
  last_sequence bigint not null check (last_sequence >= 0),
  retired_at timestamptz,
  primary key(vehicle_id, boot_id),
  constraint vehicle_boot_observed_order check (last_observed_at >= first_observed_at)
);
comment on table public.vehicle_boot_sessions is
  'Robot boot epochs used to reject a retired boot ID after a vehicle restart.';

alter table public.vehicle_reservations alter column delivery_id drop not null;
alter table public.vehicle_reservations add column route_job_id uuid references public.route_jobs(id) on delete restrict;
alter table public.vehicle_reservations add constraint reservation_has_scope check (delivery_id is not null or route_job_id is not null);
create unique index vehicle_reservations_route_job_active on public.vehicle_reservations(route_job_id) where state = 'active' and route_job_id is not null;

alter table public.vehicle_commands alter column delivery_id drop not null;
alter table public.vehicle_commands alter column expected_vehicle_state drop not null;
alter table public.vehicle_commands alter column expected_delivery_version drop not null;
alter table public.vehicle_commands
  add column route_job_id uuid references public.route_jobs(id) on delete restrict,
  add column schema_version smallint not null default 2,
  add column preconditions jsonb not null default '{}'::jsonb,
  add constraint command_target_present check (delivery_id is not null or route_job_id is not null),
  add constraint command_preconditions_object check (jsonb_typeof(preconditions) = 'object');
update public.vehicle_commands set schema_version = 1 where route_job_id is null;
alter table public.route_job_legs add constraint route_job_leg_command_fk foreign key(command_id) references public.vehicle_commands(command_id) on delete restrict;

alter table public.vehicle_state_current alter column battery drop not null;
alter table public.vehicle_state_current
  add column battery_voltage numeric(6,2),
  add column vehicle_state public.vehicle_runtime_state not null default 'idle',
  add column quality text not null default 'invalid' check (quality in ('valid','degraded','invalid','off_route')),
  add column current_route_job_id uuid references public.route_jobs(id) on delete restrict,
  add column current_leg_id text;

insert into public.vehicle_boot_sessions(vehicle_id, boot_id, first_observed_at, last_observed_at, last_sequence)
select vehicle_id, boot_id, observed_at, observed_at, sequence
from public.vehicle_state_current
on conflict (vehicle_id, boot_id) do nothing;

alter table public.vehicle_telemetry alter column battery drop not null;
alter table public.vehicle_telemetry drop constraint vehicle_telemetry_quality_check;
alter table public.vehicle_telemetry
  add column battery_voltage numeric(6,2),
  add column vehicle_state public.vehicle_runtime_state not null default 'idle',
  add column route_job_id uuid references public.route_jobs(id) on delete restrict,
  add column leg_id text,
  add column segment_id text,
  add column progress numeric(7,6) check (progress is null or progress between 0 and 1),
  add column lateral_m numeric(8,3) check (lateral_m is null or lateral_m >= 0),
  add column route_graph_version text,
  add column route_graph_checksum text,
  add constraint vehicle_telemetry_quality_v2_check check (quality in ('valid','degraded','invalid','off_route'));

alter table public.delivery_progress_current
  add column route_job_id uuid references public.route_jobs(id) on delete restrict,
  add column leg_id text,
  add column leg_index integer,
  add column leg_count integer,
  add column lateral_m numeric(8,3),
  add column route_adherence text not null default 'unknown' check (route_adherence in ('unknown','on_route','off_route')),
  add column boot_id uuid,
  add column sequence bigint,
  add column last_known_good_at timestamptz,
  add column route_graph_version text,
  add column route_graph_checksum text,
  add column projection_version bigint not null default 1;

alter table public.robot_faults add column route_job_id uuid references public.route_jobs(id) on delete restrict;

alter table public.route_jobs enable row level security;
alter table public.route_job_legs enable row level security;
alter table public.vehicle_boot_sessions enable row level security;
revoke all on public.route_jobs, public.route_job_legs, public.vehicle_boot_sessions from anon, authenticated;
grant select on public.route_jobs, public.route_job_legs to authenticated;
create policy route_jobs_operator_select on public.route_jobs
for select to authenticated using (private.is_active_operator('operator'));
create policy route_job_legs_operator_select on public.route_job_legs
for select to authenticated using (private.is_active_operator('operator'));

create policy route_pair_plans_operator_select on public.route_pair_plans
for select to authenticated using (private.is_active_operator('operator'));
create policy physical_route_legs_operator_select on public.physical_route_legs
for select to authenticated using (private.is_active_operator('operator'));

create or replace function private.release_route_job_reservation(p_route_job_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  reservation_row public.vehicle_reservations;
begin
  update public.vehicle_reservations
  set state = 'released', ended_at = now()
  where route_job_id = p_route_job_id and state = 'active'
  returning * into reservation_row;
  if reservation_row.id is not null then
    update public.vehicles
    set operational_status = 'available', updated_at = now()
    where id = reservation_row.vehicle_id and active;
  end if;
end;
$$;
revoke all on function private.release_route_job_reservation(uuid) from public;

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
revoke all on function private.safe_delivery_projection(uuid) from public;

create or replace function private.safe_route_job_projection(p_route_job_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'routeJob', jsonb_build_object(
      'id', job.id,
      'kind', job.kind,
      'state', job.state,
      'fromStopCode', job.from_stop_code,
      'toStopCode', job.to_stop_code,
      'currentLegIndex', job.current_leg_index,
      'legCount', job.leg_count,
      'routeGraphVersion', graph.version,
      'routeGraphChecksum', job.route_graph_checksum,
      'createdAt', job.created_at,
      'updatedAt', job.updated_at,
      'terminalReason', job.terminal_reason
    ),
    'vehicle', jsonb_build_object(
      'id', vehicle.id,
      'code', vehicle.code,
      'displayName', vehicle.display_name,
      'state', current_state.vehicle_state,
      'connectivity', current_state.connectivity,
      'quality', current_state.quality,
      'battery', jsonb_build_object('voltageV', current_state.battery_voltage, 'percent', current_state.battery),
      'observedAt', current_state.observed_at
    ),
    'route', jsonb_build_object(
      'legId', current_state.current_leg_id,
      'segmentId', telemetry.segment_id,
      'progress', telemetry.progress,
      'lateralM', telemetry.lateral_m
    ),
    'diagnostics', jsonb_build_object(
      'frameId', current_state.frame_id,
      'x', current_state.pose_x,
      'y', current_state.pose_y,
      'heading', current_state.heading,
      'bootId', current_state.boot_id,
      'sequence', current_state.sequence
    )
  )
  from public.route_jobs job
  join public.route_graph_versions graph on graph.id = job.route_graph_version_id
  join public.vehicles vehicle on vehicle.id = job.vehicle_id
  left join public.vehicle_state_current current_state on current_state.vehicle_id = vehicle.id
  left join lateral (
    select item.segment_id, item.progress, item.lateral_m
    from public.vehicle_telemetry item
    where item.vehicle_id = vehicle.id and item.route_job_id = job.id
    order by item.received_at desc limit 1
  ) telemetry on true
  where job.id = p_route_job_id;
$$;
revoke all on function private.safe_route_job_projection(uuid) from public;

create or replace function private.broadcast_delivery_projection(p_delivery_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform realtime.send(private.safe_delivery_projection(p_delivery_id), 'projection', 'delivery:' || p_delivery_id::text, true);
end;
$$;
revoke all on function private.broadcast_delivery_projection(uuid) from public;

create or replace function private.broadcast_route_job_projection(p_route_job_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform realtime.send(private.safe_route_job_projection(p_route_job_id), 'projection', 'route-validation:' || p_route_job_id::text, true);
end;
$$;
revoke all on function private.broadcast_route_job_projection(uuid) from public;

create or replace function private.enqueue_route_job_leg(p_route_job_id uuid, p_leg_index integer)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  job_row public.route_jobs;
  leg_row public.route_job_legs;
  graph_row public.route_graph_versions;
  created_command_id uuid;
begin
  select * into job_row from public.route_jobs where id = p_route_job_id for update;
  select * into leg_row from public.route_job_legs where route_job_id = p_route_job_id and leg_index = p_leg_index for update;
  select * into graph_row from public.route_graph_versions where id = job_row.route_graph_version_id;
  if job_row.id is null or leg_row.id is null then raise exception 'ROUTE_SEGMENT_NOT_ALLOWED'; end if;
  insert into public.vehicle_commands(
    correlation_id, delivery_id, route_job_id, vehicle_id, type, idempotency_key,
    expected_vehicle_state, expected_delivery_version, schema_version, preconditions,
    expires_at, payload
  ) values (
    gen_random_uuid(), job_row.delivery_id, job_row.id, job_row.vehicle_id, 'DISPATCH',
    job_row.id::text || ':' || leg_row.leg_index::text,
    null, null, 2,
    jsonb_build_object('allowedVehicleStates', jsonb_build_array('idle','at_stop','safe_stopped')),
    now() + interval '30 minutes',
    jsonb_build_object(
      'phase', job_row.kind,
      'legId', leg_row.leg_id,
      'legIndex', leg_row.leg_index,
      'legCount', job_row.leg_count,
      'fromStopCode', leg_row.from_stop_code,
      'toStopCode', leg_row.to_stop_code,
      'routeGraphVersion', graph_row.version,
      'routeGraphChecksum', job_row.route_graph_checksum
    )
  ) returning command_id into created_command_id;
  update public.route_job_legs set command_id = created_command_id where id = leg_row.id;
  return created_command_id;
end;
$$;
revoke all on function private.enqueue_route_job_leg(uuid,integer) from public;

create or replace function private.create_schematic_route_job(
  p_delivery_id uuid,
  p_vehicle_id uuid,
  p_kind public.route_job_kind,
  p_from_stop_code text,
  p_to_stop_code text,
  p_initiated_by uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  delivery_row public.deliveries;
  graph_row public.route_graph_versions;
  plan_row public.route_pair_plans;
  created_job_id uuid;
begin
  select * into delivery_row from public.deliveries where id = p_delivery_id;
  select * into graph_row from public.route_graph_versions where id = delivery_row.route_graph_version_id;
  select * into plan_row from public.route_pair_plans
  where route_graph_version_id = graph_row.id and from_stop_code = p_from_stop_code and to_stop_code = p_to_stop_code;
  if plan_row.route_graph_version_id is null then raise exception 'ROUTE_SEGMENT_NOT_ALLOWED'; end if;
  insert into public.route_jobs(
    delivery_id, vehicle_id, kind, route_graph_version_id, route_graph_checksum,
    from_stop_code, to_stop_code, leg_count, initiated_by
  ) values (
    p_delivery_id, p_vehicle_id, p_kind, graph_row.id, graph_row.checksum,
    p_from_stop_code, p_to_stop_code, 1, p_initiated_by
  ) returning id into created_job_id;
  insert into public.route_job_legs(route_job_id, leg_index, leg_id, from_stop_code, to_stop_code, allowed_segment_ids)
  values (created_job_id, 0, 'SIM_' || p_from_stop_code || '_' || p_to_stop_code, p_from_stop_code, p_to_stop_code, plan_row.allowed_segment_ids);
  perform private.enqueue_route_job_leg(created_job_id, 0);
  return created_job_id;
end;
$$;
revoke all on function private.create_schematic_route_job(uuid,uuid,public.route_job_kind,text,text,uuid) from public;

commit;
