begin;

insert into public.route_graph_versions(version, checksum, status, graph, activated_at)
values (
  'ndhu-supplied-schematic-v2',
  'sha256:user-supplied-schematic-topology-v2',
  'active',
  '{"viewBox":"0 0 1000 650","source":"user-supplied-schematic","physicalCalibration":"pending"}'::jsonb,
  now()
);

insert into public.delivery_locations(route_graph_version_id, code, name, detail, route_node_id)
select graph.id, location.code, location.name, location.detail, location.node_id
from public.route_graph_versions graph
cross join (values
  ('LIBRARY', '圖資中心', '圖資大樓正門・公車站前', 'LIBRARY'),
  ('ADMIN', '行政大樓', '郵局旁', 'ADMIN'),
  ('HSS1', '人社一館', '人社院南側取放點', 'HSS1'),
  ('HSS2', '人社二館', '人社院北側取放點', 'HSS2')
) as location(code, name, detail, node_id)
where graph.version = 'ndhu-supplied-schematic-v2';

-- Simulator vehicle only. Staging/production provisioning must replace this row
-- with a scoped, audited robot identity before enabling physical capability.
insert into public.vehicles(code, display_name, operational_status, active)
values ('GBM-01', 'GBM-01 · 綠白識別', 'disabled', false);

commit;
