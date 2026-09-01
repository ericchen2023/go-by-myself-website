begin;
select plan(81);

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

-- A cancel the vehicle has confirmed must free the vehicle. Leaving the
-- delivery in cancel_requested held its reservation open for good, and with one
-- vehicle that stopped every later dispatch with VEHICLE_UNAVAILABLE.
do $$
declare
  context route_test_context;
  cancel_command uuid;
begin
  select * into context from route_test_context;
  insert into public.vehicle_reservations(vehicle_id, delivery_id, route_job_id, state)
  values (context.vehicle_id, context.delivery_one, context.job_one, 'active');
  update public.vehicles set operational_status = 'reserved' where id = context.vehicle_id;
  update public.route_jobs set state = 'running' where id = context.job_one;
  update public.deliveries set status = 'cancel_requested', version = version + 1
  where id = context.delivery_one;

  insert into public.vehicle_commands(
    correlation_id, delivery_id, route_job_id, vehicle_id, type, idempotency_key,
    schema_version, expires_at, payload
  ) values (
    gen_random_uuid(), context.delivery_one, context.job_one, context.vehicle_id, 'CANCEL',
    'route-test-cancel-release', 2, now() + interval '30 minutes',
    jsonb_build_object('actor','sender')
  ) returning command_id into cancel_command;

  perform public.process_robot_command_event(
    context.vehicle_id, cancel_command, gen_random_uuid(), 'completed', 9001,
    jsonb_build_object('safeStop', true), null
  );
end $$;
select is(
  (select status::text from public.deliveries where id = (select delivery_one from route_test_context)),
  'cancelled',
  'a vehicle-confirmed cancel finalises the delivery'
);
select is(
  (select state::text from public.route_jobs where id = (select job_one from route_test_context)),
  'cancelled',
  'a vehicle-confirmed cancel closes the route job'
);
select is(
  (select state::text from public.vehicle_reservations
    where delivery_id = (select delivery_one from route_test_context) order by started_at desc limit 1),
  'released',
  'a vehicle-confirmed cancel releases the reservation'
);
select is(
  (select operational_status::text from public.vehicles where id = (select vehicle_id from route_test_context)),
  'available',
  'the vehicle is dispatchable again after a confirmed cancel'
);

-- The other cancel door: once the vehicle has arrived there is no running route
-- job for the cancel to attach to, and requiring one left the delivery stuck in
-- cancel_requested with its reservation held.
do $$
declare
  context route_test_context;
  cancel_command uuid;
begin
  select * into context from route_test_context;
  insert into public.vehicle_reservations(vehicle_id, delivery_id, route_job_id, state)
  values (context.vehicle_id, context.delivery_two, null, 'active');
  update public.vehicles set operational_status = 'reserved' where id = context.vehicle_id;
  update public.deliveries set status = 'cancel_requested', version = version + 1
  where id = context.delivery_two;

  insert into public.vehicle_commands(
    correlation_id, delivery_id, route_job_id, vehicle_id, type, idempotency_key,
    schema_version, expires_at, payload
  ) values (
    gen_random_uuid(), context.delivery_two, null, context.vehicle_id, 'CANCEL',
    'route-test-cancel-no-job', 2, now() + interval '30 minutes',
    jsonb_build_object('actor','sender')
  ) returning command_id into cancel_command;

  perform public.process_robot_command_event(
    context.vehicle_id, cancel_command, gen_random_uuid(), 'completed', 9002,
    jsonb_build_object('safeStop', true), null
  );
end $$;
select is(
  (select status::text from public.deliveries where id = (select delivery_two from route_test_context)),
  'cancelled',
  'a cancel with no route job still finalises the delivery'
);
select is(
  (select operational_status::text from public.vehicles where id = (select vehicle_id from route_test_context)),
  'available',
  'a cancel with no route job still frees the vehicle'
);


-- ---------------------------------------------------------------------------
-- 沒有艙門的車：開艙不再是一道注定被拒絕的指令，關艙就是出發訊號。
-- ---------------------------------------------------------------------------
alter table route_test_context add column delivery_three uuid;
alter table route_test_context add column delivery_four uuid;

update public.vehicles
set active = true, operational_status = 'available', current_stop_code = 'LIBRARY',
    home_stop_code = 'LIBRARY', has_compartment = false
where code = 'GBM-01';

do $$ begin
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
end $$;

with created as (
  select public.create_and_confirm_delivery(
    'LIBRARY', 'ADMIN', '無艙門收件人', '+886912345678', '', false,
    'document', 'doorless flow', 'doorless-create'
  ) as payload
)
update route_test_context set delivery_three = (created.payload #>> '{delivery,id}')::uuid from created;

do $$
declare target uuid;
begin
  select delivery_three into target from route_test_context;
  perform public.execute_delivery_intent(target, 'REQUEST_DISPATCH', 2, 'doorless-dispatch');
  perform public.execute_delivery_intent(target, 'REQUEST_SENDER_OPEN', 3, 'doorless-open');
end $$;

select is(
  (select status::text from public.deliveries where id = (select delivery_three from route_test_context)),
  'compartment_open_for_sender',
  'a vehicle with no compartment opens for the sender instead of waiting on a command'
);
select is(
  (select count(*) from public.vehicle_commands
   where delivery_id = (select delivery_three from route_test_context) and type = 'OPEN_COMPARTMENT'),
  0::bigint,
  'no compartment command is sent to a vehicle that has no compartment to open'
);
select is(
  (select safe_metadata ->> 'assertedBy' from public.delivery_status_history
   where delivery_id = (select delivery_three from route_test_context)
     and to_status = 'compartment_open_for_sender'),
  'sender',
  'the open is recorded as a sender assertion rather than a sensor reading'
);

do $$
declare target uuid;
begin
  select delivery_three into target from route_test_context;
  perform public.execute_delivery_intent(target, 'LOAD_CONFIRMED', 4, 'doorless-load');
end $$;

select is(
  (select status::text from public.deliveries where id = (select delivery_three from route_test_context)),
  'in_transit',
  'confirming the load departs the vehicle when there is no door sensor to wait for'
);
select is(
  (select count(*) from public.route_jobs
   where delivery_id = (select delivery_three from route_test_context) and kind = 'to_dropoff'),
  1::bigint,
  'the departure creates the route job to the dropoff'
);
select is(
  (select actor_type::text from public.delivery_status_history
   where delivery_id = (select delivery_three from route_test_context) and to_status = 'in_transit'),
  'sender',
  'the departure names the sender as the actor, because the sender is what confirmed it'
);

-- 對照組：有艙門的車必須維持原本的指令路徑。
insert into public.vehicles(code, display_name, operational_status, active, current_stop_code, home_stop_code, route_validation_enabled, has_compartment)
values ('GBM-02', '有艙門測試車', 'available', true, 'LIBRARY', 'LIBRARY', false, true);

do $$ begin
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
end $$;

with created as (
  select public.create_and_confirm_delivery(
    'LIBRARY', 'ADMIN', '有艙門收件人', '+886912345678', '', false,
    'document', 'compartment flow', 'compartment-create'
  ) as payload
)
update route_test_context set delivery_four = (created.payload #>> '{delivery,id}')::uuid from created;

do $$
declare target uuid;
begin
  select delivery_four into target from route_test_context;
  perform public.execute_delivery_intent(target, 'REQUEST_DISPATCH', 2, 'compartment-dispatch');
  perform public.execute_delivery_intent(target, 'REQUEST_SENDER_OPEN', 3, 'compartment-open');
end $$;

select is(
  (select count(*) from public.vehicle_commands
   where delivery_id = (select delivery_four from route_test_context) and type = 'OPEN_COMPARTMENT'),
  1::bigint,
  'a vehicle that has a compartment is still asked to open it'
);
select is(
  (select status::text from public.deliveries where id = (select delivery_four from route_test_context)),
  'arrived_pickup',
  'a vehicle that has a compartment still waits for the command before the sender loads'
);


-- ---------------------------------------------------------------------------
-- 收件端：沒有艙門的車由收件人自己確認取件，有艙門的車不得走這條路。
-- ---------------------------------------------------------------------------
-- delivery_three 已經在路上（in_transit）。把它推到目的地，模擬車輛抵達。
update public.deliveries set status = 'arrived_dropoff', version = version + 1, updated_at = now()
where id = (select delivery_three from route_test_context);

do $$ begin
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
end $$;

select throws_ok(
  $$ select public.confirm_recipient_pickup(
    (select public_ref from public.deliveries where id = (select delivery_three from route_test_context)),
    gen_random_uuid()
  ) $$,
  -- RLS_DENIED 是用 errcode 42501 丟的，不是預設的 P0001。
  '42501',
  'RLS_DENIED',
  'a signed-in visitor cannot confirm a pickup; only the pickup endpoint may'
);

do $$
declare target uuid;
begin
  select delivery_three into target from route_test_context;
  perform public.issue_recipient_pickup_code(target, '\x01'::bytea, 1::smallint, now() + interval '30 minutes');
end $$;

select is(
  (select status::text from public.deliveries where id = (select delivery_three from route_test_context)),
  'awaiting_recipient',
  'issuing the code opens the delivery for the recipient'
);
select is(
  (select count(*) from private.pickup_credentials
   where delivery_id = (select delivery_three from route_test_context) and state = 'active'),
  1::bigint,
  'exactly one pickup credential is active'
);

-- 重發：舊碼必須當場失效，不能兩組同時有效。
do $$
declare target uuid;
begin
  select delivery_three into target from route_test_context;
  perform public.issue_recipient_pickup_code(target, '\x02'::bytea, 1::smallint, now() + interval '30 minutes');
end $$;

select is(
  (select count(*) from private.pickup_credentials
   where delivery_id = (select delivery_three from route_test_context) and state = 'active'),
  1::bigint,
  'reissuing a code leaves only the newest one active'
);
select is(
  (select digest from private.pickup_credentials
   where delivery_id = (select delivery_three from route_test_context) and state = 'active'),
  '\x02'::bytea,
  'the active credential is the one just issued'
);

-- 收件人驗證通過（沒有艙門 → 直接開放取件），再自己確認完成。
do $$
declare target uuid; ref uuid;
begin
  select delivery_three into target from route_test_context;
  select public_ref into ref from public.deliveries where id = target;
  -- auth.role() 讀的是 request.jwt.claims，不是 role GUC。
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform public.redeem_pickup_credential(ref, '\x02'::bytea, gen_random_uuid(), '\xaa'::bytea);
end $$;

select is(
  (select status::text from public.deliveries where id = (select delivery_three from route_test_context)),
  'compartment_open_for_recipient',
  'a verified code opens a doorless deck without waiting on a command'
);

do $$
declare ref uuid;
begin
  select public_ref into ref from public.deliveries where id = (select delivery_three from route_test_context);
  -- auth.role() 讀的是 request.jwt.claims，不是 role GUC。
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform public.confirm_recipient_pickup(ref, gen_random_uuid());
end $$;

select is(
  (select status::text from public.deliveries where id = (select delivery_three from route_test_context)),
  'completed',
  'the recipient confirming the pickup completes the delivery'
);
select is(
  (select safe_metadata ->> 'assertedBy' from public.delivery_status_history
   where delivery_id = (select delivery_three from route_test_context) and to_status = 'completed'),
  'recipient',
  'completion is recorded as a recipient assertion rather than a sensor reading'
);
select is(
  (select operational_status::text from public.vehicles where id = (select vehicle_id from route_test_context)),
  'available',
  'completing the delivery frees the vehicle it was holding'
);


-- ---------------------------------------------------------------------------
-- 取件碼直接寄給收件人：寄件人只有在寄不出去時才准經手。
-- delivery_four 在 GBM-02（有艙門），且收件人沒有留信箱。
-- ---------------------------------------------------------------------------
update public.deliveries set status = 'arrived_dropoff', version = version + 1, updated_at = now()
where id = (select delivery_four from route_test_context);

do $$ begin
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
end $$;

select throws_ok(
  $$ select public.begin_recipient_handover(
    (select delivery_four from route_test_context), '\x11'::bytea, 1::smallint, now() + interval '30 minutes'
  ) $$,
  '42501',
  'RLS_DENIED',
  'a signed-in sender cannot start the handover; only the arrival path may'
);

alter table route_test_context add column handover jsonb;
do $$
declare payload jsonb;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  select public.begin_recipient_handover(
    (select delivery_four from route_test_context), '\x11'::bytea, 1::smallint, now() + interval '30 minutes'
  ) into payload;
  update route_test_context set handover = payload;
end $$;

select is(
  (select status::text from public.deliveries where id = (select delivery_four from route_test_context)),
  'awaiting_recipient',
  'the arrival handover opens the delivery for the recipient'
);
select is(
  (select handover ->> 'recipientEmail' from route_test_context),
  null,
  'a recipient who gave no email address hands out no address to mail'
);
select is(
  (select actor_type::text from public.delivery_status_history
   where delivery_id = (select delivery_four from route_test_context) and to_status = 'awaiting_recipient'),
  'system',
  'the handover is recorded as the system acting on arrival, not as the sender'
);

do $$ begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform public.record_delivery_notification(
    (select delivery_four from route_test_context), 'email', 'accepted',
    'h***@example.com', 'pickup-code-v1', 'provider-1', 'arrival-test-1'
  );
end $$;

select is(
  (select private.safe_delivery_projection((select delivery_four from route_test_context))
     #>> '{notification,maskedDestination}'),
  'h***@example.com',
  'the sender can see where the code went, in masked form'
);

do $$ begin
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
end $$;
select throws_ok(
  $$ select public.issue_recipient_pickup_code(
    (select delivery_four from route_test_context), '\x12'::bytea, 1::smallint, now() + interval '30 minutes'
  ) $$,
  'P0001',
  'NOTIFICATION_ALREADY_DELIVERED',
  'once the code has been mailed the sender cannot have a copy of it'
);

-- 有艙門的車不得由網頁宣告取件完成 —— 那是感測器的工作。
update public.deliveries set status = 'compartment_open_for_recipient', version = version + 1, updated_at = now()
where id = (select delivery_four from route_test_context);
do $$ begin
  -- 要驗的是「有艙門」這道閘門，所以得先過 service_role 那道，否則只會撞到前者。
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
end $$;
select throws_ok(
  $$ select public.confirm_recipient_pickup(
    (select public_ref from public.deliveries where id = (select delivery_four from route_test_context)),
    gen_random_uuid()
  ) $$,
  'P0001',
  'DELIVERY_INVALID_TRANSITION',
  'a vehicle that has a compartment still needs its own evidence, not a web click'
);


-- ---------------------------------------------------------------------------
-- 取件代號：人打得出來的入口。代號是識別碼，取件碼才是秘密。
-- ---------------------------------------------------------------------------
select isnt(
  (select pickup_ref from public.deliveries where id = (select delivery_one from route_test_context)),
  null,
  'every delivery is given a reference someone can type'
);
select is(
  (select count(distinct pickup_ref) from public.deliveries),
  (select count(*) from public.deliveries),
  'no two deliveries share a reference'
);
select is(
  (select length(pickup_ref) from public.deliveries where id = (select delivery_one from route_test_context)),
  6,
  'the reference is six characters, short enough to copy from an email'
);
select ok(
  (select pickup_ref !~ '[01OI]' from public.deliveries where id = (select delivery_one from route_test_context)),
  'the reference avoids characters that are read wrong'
);

do $$ begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
end $$;
select is(
  public.resolve_pickup_ref(
    (select lower(pickup_ref) from public.deliveries where id = (select delivery_four from route_test_context)),
    '\xb1'::bytea
  ) ->> 'publicRef',
  (select public_ref::text from public.deliveries where id = (select delivery_four from route_test_context)),
  'a reference resolves however it was typed, in any case'
);
select throws_ok(
  $$ select public.resolve_pickup_ref('ZZZZZZ', '\xb2'::bytea) $$,
  'P0001',
  'PICKUP_REF_INVALID',
  'a reference that matches nothing says only that it is invalid'
);
select throws_ok(
  $$ select public.resolve_pickup_ref(
    (select pickup_ref from public.deliveries where id = (select delivery_one from route_test_context)),
    '\xb3'::bytea
  ) $$,
  'P0001',
  'PICKUP_REF_INVALID',
  'a delivery not yet ready for pickup is indistinguishable from one that does not exist'
);

do $$ begin
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
end $$;
select throws_ok(
  $$ select public.resolve_pickup_ref('ZZZZZZ', '\xb4'::bytea) $$,
  '42501',
  'RLS_DENIED',
  'only the pickup endpoint may resolve a reference'
);


-- ---------------------------------------------------------------------------
-- 車輛的連線狀態來自車輛本身，不是某一段路的快照。
-- ---------------------------------------------------------------------------
-- delivery_three 是用 UPDATE 直接推狀態的，沒走過遙測，所以沒有 progress 那一列。
-- 這裡把情境明確建出來：一段跑完的路（凍結在 offline），配一台仍在回報的車。
insert into public.delivery_progress_current(
  delivery_id, version, segment_id, progress, connectivity, position_quality, observed_at)
values (
  (select delivery_three from route_test_context), 1, 'SEG_LIBRARY_HSS2', 1.0,
  'offline', 'valid', now() - interval '10 minutes')
on conflict (delivery_id) do update
set connectivity = 'offline', position_quality = 'valid',
    observed_at = now() - interval '10 minutes';
update public.vehicle_state_current
set connectivity = 'online', observed_at = now()
where vehicle_id = (select vehicle_id from route_test_context);

select is(
  private.safe_delivery_projection((select delivery_three from route_test_context))
    #>> '{telemetry,connectivity}',
  'online',
  'a finished leg does not make a vehicle that is still reporting look offline'
);
select is(
  private.safe_delivery_projection((select delivery_three from route_test_context))
    #>> '{telemetry,positionQuality}',
  'valid',
  'the position still comes from the leg, which is what knows where it went'
);
select is(
  public.get_pickup_context((select public_ref from public.deliveries where id = (select delivery_three from route_test_context)))
    #>> '{pickupContext,hasCompartment}',
  'false',
  'the pickup page is told the vehicle has no door to wait on'
);

select * from finish();
rollback;
