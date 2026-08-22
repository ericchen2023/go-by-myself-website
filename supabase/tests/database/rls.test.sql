begin;
select plan(12);

select has_table('public', 'deliveries', 'deliveries table exists');
select has_table('private', 'delivery_recipients', 'recipient PII is private');
select has_table('private', 'pickup_credentials', 'credential digests are private');
select has_function('public', 'execute_delivery_intent', array['uuid','text','integer','text'], 'trusted intent RPC exists');
select has_function('public', 'create_and_confirm_delivery', 'trusted create RPC exists');

select policies_are('public', 'deliveries', array['deliveries_operator_select','deliveries_select_own'], 'deliveries policies are explicit');
select policies_are('public', 'delivery_status_history', array['delivery_history_select_own','history_operator_select'], 'history policies are explicit');
select policies_are('public', 'vehicle_telemetry', array[]::text[], 'raw telemetry has no user policy');
select policies_are('public', 'audit_logs', array[]::text[], 'audit logs have no direct user policy');

select col_is_unique('public', 'deliveries', array['public_ref'], 'public ref is unique');
select col_is_unique('public', 'vehicle_commands', array['command_id'], 'command id is unique');
select triggers_are('public', 'audit_logs', array['audit_logs_append_only'], 'audit is append-only');

select * from finish();
rollback;
