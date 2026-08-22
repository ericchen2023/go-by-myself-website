begin;

alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.route_graph_versions enable row level security;
alter table public.delivery_locations enable row level security;
alter table public.vehicles enable row level security;
alter table public.deliveries enable row level security;
alter table private.delivery_recipients enable row level security;
alter table public.vehicle_reservations enable row level security;
alter table public.delivery_status_history enable row level security;
alter table public.vehicle_state_current enable row level security;
alter table public.vehicle_telemetry enable row level security;
alter table public.delivery_progress_current enable row level security;
alter table public.vehicle_commands enable row level security;
alter table public.vehicle_command_events enable row level security;
alter table private.pickup_credentials enable row level security;
alter table private.pickup_rate_limits enable row level security;
alter table public.notifications enable row level security;
alter table public.notification_attempts enable row level security;
alter table public.audit_logs enable row level security;
alter table public.robot_faults enable row level security;
alter table public.support_requests enable row level security;
alter table private.idempotency_records enable row level security;

revoke all on all tables in schema public from anon, authenticated;
revoke all on all tables in schema private from anon, authenticated;

grant usage on schema public to authenticated;
grant select on public.route_graph_versions, public.delivery_locations to authenticated;
grant select on public.profiles, public.deliveries, public.delivery_status_history,
  public.delivery_progress_current, public.notifications,
  public.robot_faults, public.support_requests to authenticated;
grant select(command_id, delivery_id, type, status, issued_at, completed_at)
  on public.vehicle_commands to authenticated;

create policy profiles_select_own on public.profiles
for select to authenticated using (id = auth.uid());

create policy route_graph_select_active on public.route_graph_versions
for select to authenticated using (status = 'active');

create policy locations_select_active on public.delivery_locations
for select to authenticated using (active = true and exists (
  select 1 from public.route_graph_versions graph
  where graph.id = route_graph_version_id and graph.status = 'active'
));

create policy deliveries_select_own on public.deliveries
for select to authenticated using (sender_id = auth.uid());

create policy delivery_history_select_own on public.delivery_status_history
for select to authenticated using (exists (
  select 1 from public.deliveries delivery
  where delivery.id = delivery_id and delivery.sender_id = auth.uid()
));

create policy delivery_progress_select_own on public.delivery_progress_current
for select to authenticated using (exists (
  select 1 from public.deliveries delivery
  where delivery.id = delivery_id and delivery.sender_id = auth.uid()
));

create policy vehicle_commands_select_safe_own on public.vehicle_commands
for select to authenticated using (exists (
  select 1 from public.deliveries delivery
  where delivery.id = delivery_id and delivery.sender_id = auth.uid()
));

create policy notifications_select_own on public.notifications
for select to authenticated using (exists (
  select 1 from public.deliveries delivery
  where delivery.id = delivery_id and delivery.sender_id = auth.uid()
));

create policy robot_faults_select_own on public.robot_faults
for select to authenticated using (delivery_id is not null and exists (
  select 1 from public.deliveries delivery
  where delivery.id = delivery_id and delivery.sender_id = auth.uid()
));

create policy support_requests_select_own on public.support_requests
for select to authenticated using (creator_id = auth.uid() or exists (
  select 1 from public.deliveries delivery
  where delivery.id = delivery_id and delivery.sender_id = auth.uid()
));

create or replace function private.is_active_operator(required_role text default 'operator')
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.user_roles role
    join public.profiles profile on profile.id = role.user_id
    where role.user_id = auth.uid()
      and role.role in (required_role, 'admin')
      and role.revoked_at is null
      and profile.account_status = 'active'
  );
$$;
revoke all on function private.is_active_operator(text) from public;

create policy deliveries_operator_select on public.deliveries
for select to authenticated using (private.is_active_operator('operator'));
create policy history_operator_select on public.delivery_status_history
for select to authenticated using (private.is_active_operator('operator'));
create policy progress_operator_select on public.delivery_progress_current
for select to authenticated using (private.is_active_operator('operator'));
create policy commands_operator_select on public.vehicle_commands
for select to authenticated using (private.is_active_operator('operator'));
create policy faults_operator_select on public.robot_faults
for select to authenticated using (private.is_active_operator('operator'));

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
      'position', case when progress.position_quality = 'valid' then jsonb_build_object('segmentId', progress.segment_id, 'progress', progress.progress) else null end,
      'observedAt', progress.observed_at,
      'connectivity', coalesce(progress.connectivity, 'offline'::public.connectivity_state),
      'positionQuality', coalesce(progress.position_quality, 'pending'::public.position_quality),
      'activeEdgeIds', '[]'::jsonb
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
  where delivery.id = p_delivery_id;
$$;
revoke all on function private.safe_delivery_projection(uuid) from public;

create or replace function public.get_active_delivery_projection()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  delivery_id uuid;
begin
  if auth.uid() is null then raise exception 'RLS_DENIED' using errcode = '42501'; end if;
  select id into delivery_id from public.deliveries
  where sender_id = auth.uid()
    and status not in ('completed', 'cancelled', 'delivery_failed')
  order by created_at desc limit 1;
  if delivery_id is null then return jsonb_build_object('delivery', null); end if;
  return private.safe_delivery_projection(delivery_id);
end;
$$;
revoke all on function public.get_active_delivery_projection() from public;
grant execute on function public.get_active_delivery_projection() to authenticated;

create or replace function public.create_and_confirm_delivery(
  p_pickup_code text,
  p_dropoff_code text,
  p_recipient_name text,
  p_phone_e164 text,
  p_recipient_email text,
  p_email_consent boolean,
  p_item_type public.item_type,
  p_note text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  profile_row public.profiles;
  graph_id uuid;
  pickup_id uuid;
  dropoff_id uuid;
  delivery_id uuid;
  request_hash text;
  prior_response jsonb;
begin
  if auth.uid() is null then raise exception 'RLS_DENIED' using errcode = '42501'; end if;
  select * into profile_row from public.profiles where id = auth.uid() for update;
  if profile_row.account_status <> 'active' or profile_row.auth_assurance not in ('google_hd', 'app_email_verified') then
    raise exception 'AUTH_DOMAIN_NOT_ALLOWED' using errcode = '42501';
  end if;
  if p_pickup_code = p_dropoff_code then raise exception 'DELIVERY_VALIDATION_FAILED'; end if;
  if char_length(trim(p_recipient_name)) not between 1 and 50 then raise exception 'DELIVERY_VALIDATION_FAILED'; end if;
  if p_phone_e164 !~ '^\+8869[0-9]{8}$' then raise exception 'DELIVERY_VALIDATION_FAILED'; end if;
  if char_length(coalesce(p_note, '')) > 300 then raise exception 'DELIVERY_VALIDATION_FAILED'; end if;

  request_hash := encode(extensions.digest(concat_ws('|', p_pickup_code, p_dropoff_code, p_recipient_name, p_phone_e164, coalesce(p_recipient_email, ''), p_item_type, p_note), 'sha256'), 'hex');
  select response_data into prior_response from private.idempotency_records
  where actor_scope = auth.uid()::text and operation = 'CREATE_AND_CONFIRM'
    and idempotency_key = p_idempotency_key and expires_at > now();
  if prior_response is not null then return prior_response; end if;

  select id into graph_id from public.route_graph_versions where status = 'active';
  select id into pickup_id from public.delivery_locations where route_graph_version_id = graph_id and code = p_pickup_code and active;
  select id into dropoff_id from public.delivery_locations where route_graph_version_id = graph_id and code = p_dropoff_code and active;
  if pickup_id is null or dropoff_id is null then raise exception 'DELIVERY_VALIDATION_FAILED'; end if;

  insert into public.deliveries(sender_id, pickup_location_id, dropoff_location_id, route_graph_version_id, status, version, item_type, note, confirmed_at)
  values (auth.uid(), pickup_id, dropoff_id, graph_id, 'confirmed', 2, p_item_type, trim(coalesce(p_note, '')), now())
  returning id into delivery_id;

  insert into private.delivery_recipients(delivery_id, recipient_name, phone_e164, email, email_notification_consent)
  values (delivery_id, normalize(trim(p_recipient_name), NFC), p_phone_e164, nullif(lower(trim(p_recipient_email)), ''), p_email_consent);

  insert into public.delivery_status_history(delivery_id, version, from_status, to_status, event, actor_type, actor_id)
  values (delivery_id, 2, 'draft', 'confirmed', 'CONFIRM', 'sender', auth.uid());

  prior_response := private.safe_delivery_projection(delivery_id);
  insert into private.idempotency_records(actor_scope, operation, idempotency_key, request_hash, response_data, response_reference)
  values (auth.uid()::text, 'CREATE_AND_CONFIRM', p_idempotency_key, request_hash, prior_response, delivery_id);
  insert into public.audit_logs(actor_type, actor_id, intent, target_type, target_id, request_id, result)
  values ('sender', auth.uid(), 'CREATE_AND_CONFIRM', 'delivery', delivery_id, gen_random_uuid(), 'success');
  return prior_response;
exception
  when unique_violation then
    raise exception 'DELIVERY_CONFLICT';
end;
$$;
revoke all on function public.create_and_confirm_delivery(text,text,text,text,text,boolean,public.item_type,text,text) from public;
grant execute on function public.create_and_confirm_delivery(text,text,text,text,text,boolean,public.item_type,text,text) to authenticated;

create or replace function public.execute_delivery_intent(
  p_delivery_id uuid,
  p_intent text,
  p_expected_version integer,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  delivery_row public.deliveries;
  prior_status public.delivery_status;
  next_status public.delivery_status;
  selected_vehicle_id uuid;
  command_kind public.command_type;
  prior_response jsonb;
begin
  if auth.uid() is null then raise exception 'RLS_DENIED' using errcode = '42501'; end if;
  select response_data into prior_response from private.idempotency_records
  where actor_scope = auth.uid()::text and operation = p_intent and idempotency_key = p_idempotency_key and expires_at > now();
  if prior_response is not null then return prior_response; end if;

  select * into delivery_row from public.deliveries where id = p_delivery_id for update;
  if delivery_row.id is null or delivery_row.sender_id <> auth.uid() then raise exception 'RLS_DENIED' using errcode = '42501'; end if;
  if delivery_row.version <> p_expected_version then raise exception 'DELIVERY_CONFLICT'; end if;
  prior_status := delivery_row.status;

  case p_intent
    when 'REQUEST_DISPATCH' then
      if delivery_row.status <> 'confirmed' then raise exception 'DELIVERY_INVALID_TRANSITION'; end if;
      select vehicle.id into selected_vehicle_id from public.vehicles vehicle
      where vehicle.active and vehicle.operational_status = 'available'
        and not exists (select 1 from public.vehicle_reservations reservation where reservation.vehicle_id = vehicle.id and reservation.state = 'active')
      order by vehicle.code for update skip locked limit 1;
      if selected_vehicle_id is null then raise exception 'VEHICLE_UNAVAILABLE'; end if;
      insert into public.vehicle_reservations(vehicle_id, delivery_id) values (selected_vehicle_id, p_delivery_id);
      update public.vehicles set operational_status = 'reserved', updated_at = now() where id = selected_vehicle_id;
      next_status := 'dispatching'; command_kind := 'DISPATCH';
    when 'REQUEST_SENDER_OPEN' then
      if delivery_row.status <> 'arrived_pickup' then raise exception 'DELIVERY_INVALID_TRANSITION'; end if;
      selected_vehicle_id := delivery_row.vehicle_id; next_status := delivery_row.status; command_kind := 'OPEN_COMPARTMENT';
    when 'LOAD_CONFIRMED' then
      if delivery_row.status <> 'compartment_open_for_sender' then raise exception 'DELIVERY_INVALID_TRANSITION'; end if;
      selected_vehicle_id := delivery_row.vehicle_id; next_status := 'loaded';
    when 'REQUEST_CANCEL' then
      if delivery_row.status = 'confirmed' and delivery_row.vehicle_id is null then next_status := 'cancelled';
      elsif delivery_row.status in ('dispatching','arrived_pickup','compartment_open_for_sender','loaded','in_transit') then
        next_status := 'cancel_requested'; selected_vehicle_id := delivery_row.vehicle_id; command_kind := 'CANCEL';
      else raise exception 'DELIVERY_INVALID_TRANSITION'; end if;
    else raise exception 'DELIVERY_INVALID_TRANSITION';
  end case;

  update public.deliveries set
    status = next_status,
    version = version + 1,
    vehicle_id = coalesce(public.deliveries.vehicle_id, selected_vehicle_id),
    updated_at = now(),
    terminal_reason = case when next_status = 'cancelled' then 'cancelled_before_reservation' else terminal_reason end
  where id = p_delivery_id returning * into delivery_row;

  insert into public.delivery_status_history(delivery_id, version, from_status, to_status, event, actor_type, actor_id)
  values (p_delivery_id, delivery_row.version, prior_status, next_status, p_intent, 'sender', auth.uid());

  if command_kind is not null then
    insert into public.vehicle_commands(correlation_id, delivery_id, vehicle_id, type, idempotency_key, expected_vehicle_state, expected_delivery_version, expires_at, payload)
    values (gen_random_uuid(), p_delivery_id, selected_vehicle_id, command_kind, p_idempotency_key,
      case command_kind when 'DISPATCH' then 'idle' when 'OPEN_COMPARTMENT' then 'arrived' when 'CANCEL' then 'assigned' else 'known' end,
      delivery_row.version, now() + interval '5 minutes', jsonb_build_object(
        'routeGraphVersionId', delivery_row.route_graph_version_id,
        'actor', case when p_intent = 'REQUEST_SENDER_OPEN' then 'sender' else 'system' end
      ));
  end if;

  prior_response := private.safe_delivery_projection(p_delivery_id);
  insert into private.idempotency_records(actor_scope, operation, idempotency_key, request_hash, response_data, response_reference)
  values (auth.uid()::text, p_intent, p_idempotency_key,
    encode(extensions.digest(concat_ws('|', p_delivery_id, p_expected_version, p_intent), 'sha256'), 'hex'), prior_response, p_delivery_id);
  insert into public.audit_logs(actor_type, actor_id, intent, target_type, target_id, request_id, result)
  values ('sender', auth.uid(), p_intent, 'delivery', p_delivery_id, gen_random_uuid(), 'success');
  return prior_response;
end;
$$;
revoke all on function public.execute_delivery_intent(uuid,text,integer,text) from public;
grant execute on function public.execute_delivery_intent(uuid,text,integer,text) to authenticated;

create or replace function private.prevent_append_only_change()
returns trigger
language plpgsql
set search_path = ''
as $$ begin raise exception 'APPEND_ONLY_TABLE'; end; $$;
revoke all on function private.prevent_append_only_change() from public;

create trigger delivery_history_append_only before update or delete on public.delivery_status_history
for each row execute function private.prevent_append_only_change();
create trigger command_events_append_only before update or delete on public.vehicle_command_events
for each row execute function private.prevent_append_only_change();
create trigger audit_logs_append_only before update or delete on public.audit_logs
for each row execute function private.prevent_append_only_change();

commit;
