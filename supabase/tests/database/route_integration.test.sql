begin;
select plan(40);

select ok(
  has_schema_privilege('authenticated', 'private', 'USAGE'),
  'authenticated can resolve the private RLS helper schema'
);
select ok(
  has_function_privilege('authenticated', 'private.is_active_operator(text)', 'EXECUTE'),
  'authenticated can execute the operator RLS helper'
);
select ok(
  not has_function_privilege('anon', 'private.is_active_operator(text)', 'EXECUTE'),
  'anonymous callers cannot execute the operator RLS helper'
);

insert into auth.users(
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'sender-one@gms.ndhu.edu.tw', '', now(), '{}'::jsonb, '{"full_name":"Sender One"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'sender-two@gms.ndhu.edu.tw', '', now(), '{}'::jsonb, '{"full_name":"Sender Two"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'operator@gms.ndhu.edu.tw', '', now(), '{}'::jsonb, '{"full_name":"Operator"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'pending-operator@example.com', '', now(), '{}'::jsonb, '{"full_name":"Pending Operator"}'::jsonb, now(), now());

update public.profiles
set auth_assurance = 'google_hd'
where id in (
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002',
  '00000000-0000-4000-8000-000000000003'
);
insert into public.user_roles(user_id, role, granted_by)
values
  ('00000000-0000-4000-8000-000000000003', 'operator', '00000000-0000-4000-8000-000000000003'),
  ('00000000-0000-4000-8000-000000000004', 'operator', '00000000-0000-4000-8000-000000000003');

select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000000004","role":"authenticated"}',
  true
);
select is(
  public.get_operator_route_validation_workspace() ->> 'error',
  'RLS_DENIED',
  'an operator role without trusted auth assurance is denied'
);

update public.vehicles
set active = true,
    operational_status = 'available',
    current_stop_code = 'HSS1',
    home_stop_code = 'HSS1',
    route_validation_enabled = false
where code = 'GBM-01';

create temporary table route_test_context (
  delivery_one uuid,
  job_one uuid,
  leg_one uuid,
  command_one uuid,
  vehicle_id uuid,
  delivery_two uuid,
  job_two uuid,
  command_two uuid,
  validation_job uuid,
  out_of_order_result jsonb,
  retired_boot_result jsonb
);
insert into route_test_context(vehicle_id)
select id from public.vehicles where code = 'GBM-01';

do $$ begin
  perform set_config(
    'request.jwt.claims',
    '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',
    true
  );
end $$;

with created as (
  select public.create_and_confirm_delivery(
    'LIBRARY', 'ADMIN', '測試收件人', '+886912345678', '', false,
    'document', 'integration test', 'route-test-create-one'
  ) as payload
)
update route_test_context
set delivery_one = (created.payload #>> '{delivery,id}')::uuid
from created;

select throws_ok(
  $$ select public.create_and_confirm_delivery(
    'LIBRARY', 'ADMIN', '不同收件人', '+886912345678', '', false,
    'document', 'integration test', 'route-test-create-one'
  ) $$,
  'P0001',
  'IDEMPOTENCY_KEY_REUSED',
  'a create idempotency key cannot be reused with different input'
);

do $$
declare target_delivery uuid;
begin
  select delivery_one into target_delivery from route_test_context;
  perform public.execute_delivery_intent(target_delivery, 'REQUEST_DISPATCH', 2, 'route-test-dispatch-one');
end $$;

select lives_ok(
  $$ select public.execute_delivery_intent(
    (select delivery_one from route_test_context), 'REQUEST_DISPATCH', 2, 'route-test-dispatch-one'
  ) $$,
  'an identical delivery intent retry returns its prior response'
);
select throws_ok(
  $$ select public.execute_delivery_intent(
    (select delivery_one from route_test_context), 'REQUEST_DISPATCH', 999, 'route-test-dispatch-one'
  ) $$,
  'P0001',
  'IDEMPOTENCY_KEY_REUSED',
  'a delivery intent key cannot be reused for a different request hash'
);

update route_test_context context
set job_one = job.id,
    leg_one = leg.id,
    command_one = command.command_id
from public.route_jobs job
join public.route_job_legs leg on leg.route_job_id = job.id and leg.leg_index = 0
join public.vehicle_commands command on command.command_id = leg.command_id
where job.delivery_id = context.delivery_one;

select is(
  (select status::text from public.deliveries where id = (select delivery_one from route_test_context)),
  'dispatching',
  'dispatch creates a non-terminal delivery transition'
);
select is(
  (select kind::text || ':' || state::text from public.route_jobs where id = (select job_one from route_test_context)),
  'to_pickup:queued',
  'dispatch creates a queued pickup route job'
);
select is(
  (select schema_version::text || ':' || type::text from public.vehicle_commands where command_id = (select command_one from route_test_context)),
  '2:DISPATCH',
  'route leg enqueues a v2 DISPATCH command'
);
select ok(
  exists (
    select 1 from public.vehicle_reservations reservation
    where reservation.delivery_id = (select delivery_one from route_test_context)
      and reservation.route_job_id = (select job_one from route_test_context)
      and reservation.state = 'active'
  ),
  'delivery and route job share one active vehicle reservation'
);

do $$
declare context route_test_context;
begin
  select * into context from route_test_context;
  perform public.process_robot_command_event(
    context.vehicle_id, context.command_one, '10000000-0000-4000-8000-000000000001',
    'accepted', 1, '{"agent":"integration"}'::jsonb, null
  );
end $$;
select is(
  (select state::text from public.route_job_legs where id = (select leg_one from route_test_context)),
  'accepted',
  'accepted ACK starts the route leg without completing it'
);

do $$
declare context route_test_context;
declare graph_checksum text;
begin
  select * into context from route_test_context;
  select checksum into graph_checksum from public.route_graph_versions where status = 'active';
  perform public.ingest_robot_telemetry_v2(context.vehicle_id, jsonb_build_object(
    'schemaVersion', 2,
    'vehicleId', context.vehicle_id,
    'bootId', '20000000-0000-4000-8000-000000000001',
    'sequence', 1,
    'messageId', '30000000-0000-4000-8000-000000000001',
    'observedAt', now(),
    'vehicleState', 'moving',
    'pose', jsonb_build_object('frameId','site-v1','x',1.0,'y',2.0,'heading',0.0),
    'speedMps', 0.5,
    'battery', jsonb_build_object('voltageV',23.7,'percent',null),
    'quality', 'valid',
    'route', jsonb_build_object(
      'legId','SIM_HSS1_LIBRARY','segmentId','edge-hss2-hss1','progress',0.2,'lateralM',0.1,
      'routeGraphVersion','ndhu-four-stop-route-v5','routeGraphChecksum',graph_checksum
    )
  ));
end $$;
select is(
  (select current_leg_id || ':' || quality from public.vehicle_state_current where vehicle_id = (select vehicle_id from route_test_context)),
  'SIM_HSS1_LIBRARY:valid',
  'valid telemetry updates authoritative vehicle state'
);
select is(
  (select segment_id || ':' || progress::text from public.delivery_progress_current where delivery_id = (select delivery_one from route_test_context)),
  'edge-hss2-hss1:0.20000',
  'valid telemetry updates the privacy-safe marker projection'
);

do $$
declare context route_test_context;
declare graph_checksum text;
begin
  select * into context from route_test_context;
  select checksum into graph_checksum from public.route_graph_versions where status = 'active';
  perform public.ingest_robot_telemetry_v2(context.vehicle_id, jsonb_build_object(
    'schemaVersion', 2,
    'vehicleId', context.vehicle_id,
    'bootId', '20000000-0000-4000-8000-000000000001',
    'sequence', 2,
    'messageId', '30000000-0000-4000-8000-000000000002',
    'observedAt', now() + interval '1 second',
    'vehicleState', 'moving',
    'pose', jsonb_build_object('frameId','site-v1','x',99.0,'y',99.0,'heading',0.0),
    'speedMps', 0.5,
    'battery', jsonb_build_object('voltageV',23.6,'percent',null),
    'quality', 'valid',
    'route', jsonb_build_object(
      'legId','SIM_HSS1_LIBRARY','segmentId','edge-not-approved','progress',0.8,'lateralM',4.2,
      'routeGraphVersion','ndhu-four-stop-route-v5','routeGraphChecksum',graph_checksum
    )
  ));
end $$;
select is(
  (select position_quality::text from public.delivery_progress_current where delivery_id = (select delivery_one from route_test_context)),
  'off_route',
  'an unknown segment is downgraded to off_route'
);
select is(
  (select segment_id || ':' || progress::text from public.delivery_progress_current where delivery_id = (select delivery_one from route_test_context)),
  'edge-hss2-hss1:0.20000',
  'off-route telemetry cannot overwrite the last-known-good marker'
);

update public.delivery_progress_current
set observed_at = now() + interval '1 hour', updated_at = now() - interval '61 seconds', connectivity = 'online'
where delivery_id = (select delivery_one from route_test_context);
select lives_ok(
  $$ select public.reconcile_robot_runtime() $$,
  'connectivity reconciliation accepts a future-skewed robot timestamp'
);
select is(
  (select connectivity::text from public.delivery_progress_current
   where delivery_id = (select delivery_one from route_test_context)),
  'offline',
  'connectivity uses trusted server receipt time instead of the robot clock'
);

do $$
declare context route_test_context;
declare graph_checksum text;
declare result jsonb;
begin
  select * into context from route_test_context;
  select checksum into graph_checksum from public.route_graph_versions where status = 'active';
  result := public.ingest_robot_telemetry_v2(context.vehicle_id, jsonb_build_object(
    'schemaVersion',2,'vehicleId',context.vehicle_id,
    'bootId','20000000-0000-4000-8000-000000000001','sequence',0,
    'messageId','30000000-0000-4000-8000-000000000003','observedAt',now() + interval '2 seconds',
    'vehicleState','moving','pose',jsonb_build_object('frameId','site-v1','x',2.0,'y',2.0,'heading',0.0),
    'speedMps',0.5,'battery',jsonb_build_object('voltageV',23.5,'percent',null),'quality','valid',
    'route',jsonb_build_object(
      'legId','SIM_HSS1_LIBRARY','segmentId','edge-hss2-hss1','progress',0.1,'lateralM',0.1,
      'routeGraphVersion','ndhu-four-stop-route-v5','routeGraphChecksum',graph_checksum
    )
  ));
  update route_test_context set out_of_order_result = result;
end $$;
select is(
  (select out_of_order_result ->> 'errorCode' from route_test_context),
  'TELEMETRY_OUT_OF_ORDER',
  'a decreasing sequence is rejected after raw audit storage'
);

do $$
declare context route_test_context;
declare graph_checksum text;
begin
  select * into context from route_test_context;
  select checksum into graph_checksum from public.route_graph_versions where status = 'active';
  perform public.ingest_robot_telemetry_v2(context.vehicle_id, jsonb_build_object(
    'schemaVersion',2,'vehicleId',context.vehicle_id,
    'bootId','20000000-0000-4000-8000-000000000002','sequence',1,
    'messageId','30000000-0000-4000-8000-000000000004','observedAt',now() + interval '3 seconds',
    'vehicleState','moving','pose',jsonb_build_object('frameId','site-v1','x',3.0,'y',2.0,'heading',0.0),
    'speedMps',0.5,'battery',jsonb_build_object('voltageV',23.4,'percent',null),'quality','degraded',
    'route',jsonb_build_object(
      'legId','SIM_HSS1_LIBRARY','segmentId','edge-hss2-hss1','progress',0.3,'lateralM',0.3,
      'routeGraphVersion','ndhu-four-stop-route-v5','routeGraphChecksum',graph_checksum
    )
  ));
end $$;
select is(
  (select boot_id::text from public.vehicle_state_current where vehicle_id = (select vehicle_id from route_test_context)),
  '20000000-0000-4000-8000-000000000002',
  'a newer boot epoch becomes authoritative'
);

do $$
declare context route_test_context;
declare graph_checksum text;
declare result jsonb;
begin
  select * into context from route_test_context;
  select checksum into graph_checksum from public.route_graph_versions where status = 'active';
  result := public.ingest_robot_telemetry_v2(context.vehicle_id, jsonb_build_object(
    'schemaVersion',2,'vehicleId',context.vehicle_id,
    'bootId','20000000-0000-4000-8000-000000000001','sequence',3,
    'messageId','30000000-0000-4000-8000-000000000005','observedAt',now() + interval '4 seconds',
    'vehicleState','moving','pose',jsonb_build_object('frameId','site-v1','x',9.0,'y',9.0,'heading',0.0),
    'speedMps',0.5,'battery',jsonb_build_object('voltageV',23.3,'percent',null),'quality','valid',
    'route',jsonb_build_object(
      'legId','SIM_HSS1_LIBRARY','segmentId','edge-hss2-hss1','progress',0.9,'lateralM',0.1,
      'routeGraphVersion','ndhu-four-stop-route-v5','routeGraphChecksum',graph_checksum
    )
  ));
  update route_test_context set retired_boot_result = result;
end $$;
select is(
  (select retired_boot_result ->> 'errorCode' from route_test_context),
  'TELEMETRY_OUT_OF_ORDER',
  'a retired boot cannot reclaim authoritative state'
);
select ok(
  (select retired_at is not null from public.vehicle_boot_sessions
   where vehicle_id = (select vehicle_id from route_test_context)
     and boot_id = '20000000-0000-4000-8000-000000000001'),
  'the previous boot epoch is durably retired'
);

do $$
declare context route_test_context;
begin
  select * into context from route_test_context;
  perform public.process_robot_command_event(
    context.vehicle_id, context.command_one, '10000000-0000-4000-8000-000000000002',
    'completed', 2, '{"arrival":"verified"}'::jsonb, null
  );
end $$;
select is(
  (select status::text from public.deliveries where id = (select delivery_one from route_test_context)),
  'arrived_pickup',
  'final pickup leg completion advances only to arrived_pickup'
);
select isnt(
  (select status::text from public.deliveries where id = (select delivery_one from route_test_context)),
  'completed',
  'route arrival never fabricates delivery completion'
);
select is(
  (select current_stop_code from public.vehicles where id = (select vehicle_id from route_test_context)),
  'LIBRARY',
  'route completion updates the audited current stop'
);
select is(
  (select state::text from public.route_jobs where id = (select job_one from route_test_context)),
  'completed',
  'final leg completion closes the route job'
);

select throws_ok(
  $$ select public.process_robot_command_event(
    (select vehicle_id from route_test_context),
    (select command_one from route_test_context),
    '10000000-0000-4000-8000-000000000003',
    'accepted', 3, '{}'::jsonb, null
  ) $$,
  'P0001',
  'COMMAND_EVENT_INVALID_TRANSITION',
  'a late accepted event cannot regress a completed command'
);
select is(
  (select state::text from public.route_jobs where id = (select job_one from route_test_context)),
  'completed',
  'late command events leave the terminal route state unchanged'
);

select throws_ok(
  $$ select public.record_robot_fault(
    'b0000000-0000-4000-8000-000000000001',
    jsonb_build_object(
      'schemaVersion', 2,
      'vehicleId', 'b0000000-0000-4000-8000-000000000001',
      'routeJobId', (select job_one from route_test_context),
      'type', 'ROUTE_DEVIATION', 'severity', 'warning', 'observedAt', now(), 'evidence', '{}'::jsonb
    )
  ) $$,
  '42501',
  'ROBOT_SCOPE_DENIED',
  'a robot cannot attach a fault to another vehicle route job'
);
select is(
  (public.record_robot_fault(
    (select vehicle_id from route_test_context),
    jsonb_build_object(
      'schemaVersion', 2,
      'vehicleId', (select vehicle_id from route_test_context),
      'routeJobId', (select job_one from route_test_context),
      'type', 'LOCALIZATION_DEGRADED', 'severity', 'warning', 'observedAt', now(),
      'evidence', jsonb_build_object('code','SLAM_QUALITY_LOW','component','localization','recoverable',true)
    )
  ) ->> 'accepted')::boolean,
  true,
  'an assigned robot can record an allow-listed route fault'
);

select ok(
  private.can_access_realtime_topic('delivery:' || (select delivery_one::text from route_test_context)),
  'sender can authorize the private topic for their own delivery'
);
do $$ begin
  perform set_config(
    'request.jwt.claims',
    '{"sub":"00000000-0000-4000-8000-000000000002","role":"authenticated"}',
    true
  );
end $$;
select isnt(
  private.can_access_realtime_topic('delivery:' || (select delivery_one::text from route_test_context)),
  true,
  'another sender cannot authorize the delivery topic'
);

do $$ begin
  perform set_config(
    'request.jwt.claims',
    '{"sub":"00000000-0000-4000-8000-000000000003","role":"authenticated"}',
    true
  );
end $$;

update public.deliveries
set status = 'delivery_failed', terminal_reason = 'test_cleanup', version = version + 1
where id = (select delivery_one from route_test_context);
select is(
  (select state::text from public.vehicle_reservations where delivery_id = (select delivery_one from route_test_context)),
  'released',
  'terminal delivery transition releases its vehicle reservation'
);

select throws_ok(
  $$ select public.create_route_validation_job(
    (select vehicle_id from route_test_context), 'A_B', 'validation-disabled-test'
  ) $$,
  'P0001',
  'PHYSICAL_CAPABILITY_DISABLED',
  'unapproved physical mapping fails closed for an operator'
);

with graph as (
  select id, checksum from public.route_graph_versions where status = 'active'
), inserted as (
  insert into public.route_jobs(
    vehicle_id, kind, route_graph_version_id, route_graph_checksum,
    from_stop_code, to_stop_code, leg_count, initiated_by
  )
  select context.vehicle_id, 'validation', graph.id, graph.checksum,
         'LIBRARY', 'ADMIN', 1, '00000000-0000-4000-8000-000000000003'
  from route_test_context context cross join graph
  returning id
)
update route_test_context set validation_job = inserted.id from inserted;
select ok(
  private.can_access_realtime_topic('route-validation:' || (select validation_job::text from route_test_context)),
  'active operator can authorize a route-validation topic'
);

do $$ begin
  perform set_config(
    'request.jwt.claims',
    '{"sub":"00000000-0000-4000-8000-000000000002","role":"authenticated"}',
    true
  );
end $$;
with created as (
  select public.create_and_confirm_delivery(
    'ADMIN', 'HSS2', '第二收件人', '+886923456789', '', false,
    'book', 'expiry test', 'route-test-create-two'
  ) as payload
)
update route_test_context
set delivery_two = (created.payload #>> '{delivery,id}')::uuid
from created;
do $$
declare target_delivery uuid;
begin
  select delivery_two into target_delivery from route_test_context;
  perform public.execute_delivery_intent(target_delivery, 'REQUEST_DISPATCH', 2, 'route-test-dispatch-two');
end $$;
update route_test_context context
set job_two = job.id,
    command_two = command.command_id
from public.route_jobs job
join public.route_job_legs leg on leg.route_job_id = job.id and leg.leg_index = 0
join public.vehicle_commands command on command.command_id = leg.command_id
where job.delivery_id = context.delivery_two;
update public.vehicle_commands
set issued_at = now() - interval '31 minutes', expires_at = now() - interval '1 minute'
where command_id = (select command_two from route_test_context);
select lives_ok(
  $$ select public.reconcile_robot_runtime() $$,
  'connectivity reconciliation safely handles an unaccepted expired dispatch'
);
select is(
  (select status::text from public.deliveries where id = (select delivery_two from route_test_context)),
  'confirmed',
  'an unaccepted expired pickup dispatch returns to confirmed'
);
select is(
  (select vehicle_id::text from public.deliveries where id = (select delivery_two from route_test_context)),
  null,
  'expired unaccepted dispatch clears the delivery vehicle assignment'
);
select is(
  (select state::text from public.vehicle_reservations where delivery_id = (select delivery_two from route_test_context)),
  'released',
  'expired unaccepted dispatch releases the reservation'
);
select is(
  (select operational_status::text from public.vehicles where id = (select vehicle_id from route_test_context)),
  'available',
  'vehicle returns to available after safe expiry recovery'
);

select * from finish();
rollback;
