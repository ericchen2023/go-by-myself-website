begin;
select plan(22);

select has_table('public', 'deliveries', 'deliveries table exists');
select has_table('private', 'delivery_recipients', 'recipient PII is private');
select has_table('private', 'pickup_credentials', 'credential digests are private');
select has_function('public', 'execute_delivery_intent', array['uuid','text','integer','text'], 'trusted intent RPC exists');
select has_function('public', 'create_and_confirm_delivery', 'trusted create RPC exists');
select has_table('public', 'route_pair_plans', 'generated schematic route plans exist');
select has_table('public', 'physical_route_legs', 'physical mapping gate exists');
select has_table('public', 'route_jobs', 'route jobs are separate from delivery lifecycle');
select has_table('public', 'route_job_legs', 'multi-leg execution state exists');
select has_table('public', 'vehicle_boot_sessions', 'retired robot boot IDs are tracked');
select has_function('public', 'ingest_robot_telemetry_v2', array['uuid','jsonb'], 'telemetry uses one trusted transaction');
select has_function('public', 'record_departure_ready', array['uuid','jsonb'], 'departure evidence has a trusted transition');
select has_function('public', 'create_route_validation_job', array['uuid','text','text'], 'operator route validation RPC exists');
select has_function('public', 'reconcile_robot_runtime', 'connectivity and expiry reconciliation exists');

select policies_are('public', 'deliveries', array['deliveries_operator_select','deliveries_select_own'], 'deliveries policies are explicit');
select policies_are('public', 'delivery_status_history', array['delivery_history_select_own','history_operator_select'], 'history policies are explicit');
select policies_are('public', 'vehicle_telemetry', array[]::text[], 'raw telemetry has no user policy');
select policies_are('public', 'audit_logs', array[]::text[], 'audit logs have no direct user policy');
select policies_are('public', 'route_jobs', array['route_jobs_operator_select'], 'route jobs are operator-only');

select col_is_unique('public', 'deliveries', array['public_ref'], 'public ref is unique');
select col_is_pk('public', 'vehicle_commands', 'command_id', 'command id is the primary key');
select triggers_are('public', 'audit_logs', array['audit_logs_append_only'], 'audit is append-only');

select * from finish();
rollback;
