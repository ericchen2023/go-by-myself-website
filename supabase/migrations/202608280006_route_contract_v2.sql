-- Contract-v2 types are committed before later migrations use their values.
alter type public.position_quality add value if not exists 'degraded';
alter type public.position_quality add value if not exists 'invalid';

do $$ begin
  create type public.vehicle_runtime_state as enum (
    'idle', 'preparing', 'localizing', 'moving', 'at_stop',
    'safe_stopped', 'returning_to_base', 'fault'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.route_job_kind as enum ('to_pickup', 'to_dropoff', 'validation', 'return');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.route_job_state as enum ('queued', 'running', 'safe_stop_requested', 'completed', 'cancelled', 'failed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.route_leg_state as enum ('queued', 'accepted', 'completed', 'failed', 'cancelled');
exception when duplicate_object then null; end $$;

begin;

update public.route_graph_versions
set status = 'retired'
where status = 'active' and version <> 'ndhu-four-stop-route-v4';

insert into public.route_graph_versions(version, checksum, status, graph, activated_at)
values (
  'ndhu-four-stop-route-v4',
  'sha256:712c4b12e3932647eb0856699fe4ace4bd9a2434c325b97451e07abbd7120ef9',
  'active',
  '{"viewBox":[0,0,1000,650],"source":"contracts/route-graph.v4.json","physicalCalibration":"pending","visibleStops":["LIBRARY","ADMIN","HSS1","HSS2"],"edgeIds":["edge-north-library","edge-trunk-north","edge-hss-junction","edge-hss2-turn","edge-hss2","edge-hss1-turn","edge-hss1","edge-trunk-south","edge-admin-turn","edge-admin"]}'::jsonb,
  now()
)
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
  ('ADMIN', '行政大樓', '郵局旁', 'ADMIN'),
  ('HSS1', '人社一館', '人社院南側取放點', 'HSS1'),
  ('HSS2', '人社二館', '人社院北側取放點', 'HSS2')
) as location(code, name, detail, node_id)
where graph.version = 'ndhu-four-stop-route-v4'
on conflict (route_graph_version_id, code) do update set
  name = excluded.name,
  detail = excluded.detail,
  route_node_id = excluded.route_node_id,
  active = true;

create table public.route_pair_plans (
  route_graph_version_id uuid not null references public.route_graph_versions(id) on delete restrict,
  from_stop_code text not null,
  to_stop_code text not null,
  allowed_segment_ids text[] not null,
  primary key(route_graph_version_id, from_stop_code, to_stop_code),
  constraint route_pair_different_stops check (from_stop_code <> to_stop_code),
  constraint route_pair_known_stops check (
    from_stop_code in ('LIBRARY','ADMIN','HSS1','HSS2') and
    to_stop_code in ('LIBRARY','ADMIN','HSS1','HSS2')
  ),
  constraint route_pair_has_segments check (cardinality(allowed_segment_ids) > 0)
);

insert into public.route_pair_plans(route_graph_version_id, from_stop_code, to_stop_code, allowed_segment_ids)
select graph.id, plan.from_code, plan.to_code, plan.edges
from public.route_graph_versions graph
cross join (values
  ('LIBRARY','ADMIN',array['edge-north-library','edge-trunk-north','edge-trunk-south','edge-admin-turn','edge-admin']::text[]),
  ('LIBRARY','HSS1',array['edge-north-library','edge-trunk-north','edge-hss-junction','edge-hss1-turn','edge-hss1']::text[]),
  ('LIBRARY','HSS2',array['edge-north-library','edge-trunk-north','edge-hss-junction','edge-hss2-turn','edge-hss2']::text[]),
  ('ADMIN','LIBRARY',array['edge-admin','edge-admin-turn','edge-trunk-south','edge-trunk-north','edge-north-library']::text[]),
  ('ADMIN','HSS1',array['edge-admin','edge-admin-turn','edge-trunk-south','edge-hss-junction','edge-hss1-turn','edge-hss1']::text[]),
  ('ADMIN','HSS2',array['edge-admin','edge-admin-turn','edge-trunk-south','edge-hss-junction','edge-hss2-turn','edge-hss2']::text[]),
  ('HSS1','LIBRARY',array['edge-hss1','edge-hss1-turn','edge-hss-junction','edge-trunk-north','edge-north-library']::text[]),
  ('HSS1','ADMIN',array['edge-hss1','edge-hss1-turn','edge-hss-junction','edge-trunk-south','edge-admin-turn','edge-admin']::text[]),
  ('HSS1','HSS2',array['edge-hss1','edge-hss1-turn','edge-hss2-turn','edge-hss2']::text[]),
  ('HSS2','LIBRARY',array['edge-hss2','edge-hss2-turn','edge-hss-junction','edge-trunk-north','edge-north-library']::text[]),
  ('HSS2','ADMIN',array['edge-hss2','edge-hss2-turn','edge-hss-junction','edge-trunk-south','edge-admin-turn','edge-admin']::text[]),
  ('HSS2','HSS1',array['edge-hss2','edge-hss2-turn','edge-hss1-turn','edge-hss1']::text[])
) as plan(from_code, to_code, edges)
where graph.version = 'ndhu-four-stop-route-v4';

create table public.physical_route_legs (
  route_graph_version_id uuid not null references public.route_graph_versions(id) on delete restrict,
  leg_id text not null,
  physical_from text not null check (physical_from in ('A','B','C','D')),
  physical_to text not null check (physical_to in ('A','B','C','D')),
  from_stop_code text,
  to_stop_code text,
  allowed_segment_ids text[] not null default '{}',
  mapping_approved boolean not null default false,
  approved_by uuid,
  approved_at timestamptz,
  primary key(route_graph_version_id, leg_id),
  constraint physical_route_mapping_complete check (
    (mapping_approved = false) or
    (from_stop_code is not null and to_stop_code is not null and cardinality(allowed_segment_ids) > 0 and approved_by is not null and approved_at is not null)
  )
);

insert into public.physical_route_legs(route_graph_version_id, leg_id, physical_from, physical_to)
select graph.id, leg.leg_id, leg.from_code, leg.to_code
from public.route_graph_versions graph
cross join (values
  ('A_B','A','B'),('B_A','B','A'),('B_C','B','C'),('C_B','C','B'),
  ('C_D','C','D'),('D_C','D','C'),('A_D','A','D'),('D_A','D','A')
) as leg(leg_id, from_code, to_code)
where graph.version = 'ndhu-four-stop-route-v4';

alter table public.route_pair_plans enable row level security;
alter table public.physical_route_legs enable row level security;
revoke all on public.route_pair_plans, public.physical_route_legs from anon, authenticated;

commit;
