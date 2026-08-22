begin;

create schema if not exists private;
create schema if not exists extensions;
revoke all on schema private from public, anon, authenticated;

create extension if not exists pgcrypto with schema extensions;

create type public.auth_assurance as enum ('pending', 'google_hd', 'app_email_verified', 'demo_synthetic');
create type public.account_status as enum ('active', 'revoked', 'suspended');
create type public.delivery_status as enum (
  'draft', 'confirmed', 'dispatching', 'arrived_pickup',
  'compartment_open_for_sender', 'loaded', 'in_transit',
  'arrived_dropoff', 'awaiting_recipient',
  'compartment_open_for_recipient', 'picked_up', 'completed',
  'cancel_requested', 'returning_to_base', 'cancelled', 'delivery_failed'
);
create type public.item_type as enum ('document', 'book', 'small_parcel', 'equipment');
create type public.actor_type as enum ('sender', 'recipient', 'robot', 'gateway', 'system', 'operator', 'admin');
create type public.vehicle_operational_status as enum ('available', 'reserved', 'maintenance', 'disabled');
create type public.reservation_state as enum ('active', 'released', 'completed');
create type public.command_type as enum ('DISPATCH', 'OPEN_COMPARTMENT', 'CANCEL', 'RETURN_TO_BASE');
create type public.command_state as enum ('queued', 'accepted', 'rejected', 'completed', 'failed', 'expired');
create type public.command_event_type as enum ('accepted', 'rejected', 'completed', 'failed');
create type public.connectivity_state as enum ('online', 'stale', 'offline');
create type public.position_quality as enum ('valid', 'pending', 'off_route');
create type public.notification_channel as enum ('sms', 'email');
create type public.notification_state as enum ('queued', 'sending', 'retrying', 'accepted', 'delivered', 'failed', 'unconfigured');
create type public.credential_type as enum ('human_code', 'qr_secret');
create type public.credential_state as enum ('pending', 'active', 'locked', 'used', 'expired', 'revoked');
create type public.fault_severity as enum ('info', 'warning', 'critical');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  normalized_email text not null,
  auth_assurance public.auth_assurance not null default 'pending',
  account_status public.account_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_display_name_length check (char_length(display_name) between 0 and 80),
  constraint profiles_email_normalized check (normalized_email = lower(trim(normalized_email)) and char_length(normalized_email) <= 254)
);
create unique index profiles_normalized_email_key on public.profiles(normalized_email);

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete restrict,
  role text not null check (role in ('operator', 'support', 'admin')),
  granted_by uuid,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz
);
create unique index user_roles_one_active on public.user_roles(user_id, role) where revoked_at is null;

create table public.route_graph_versions (
  id uuid primary key default gen_random_uuid(),
  version text not null unique,
  checksum text not null unique,
  status text not null check (status in ('draft', 'active', 'retired')),
  graph jsonb not null,
  activated_at timestamptz,
  created_at timestamptz not null default now(),
  constraint route_graph_object check (jsonb_typeof(graph) = 'object')
);
create unique index route_graph_one_active on public.route_graph_versions((status)) where status = 'active';

create table public.delivery_locations (
  id uuid primary key default gen_random_uuid(),
  route_graph_version_id uuid not null references public.route_graph_versions(id) on delete restrict,
  code text not null,
  name text not null,
  detail text not null,
  route_node_id text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(route_graph_version_id, code),
  constraint delivery_location_code check (code in ('LIBRARY', 'ADMIN', 'HSS1', 'HSS2'))
);

create table public.vehicles (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  display_name text not null,
  operational_status public.vehicle_operational_status not null default 'disabled',
  active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.deliveries (
  id uuid primary key default gen_random_uuid(),
  public_ref uuid not null default gen_random_uuid() unique,
  sender_id uuid not null references public.profiles(id) on delete restrict,
  pickup_location_id uuid not null references public.delivery_locations(id) on delete restrict,
  dropoff_location_id uuid not null references public.delivery_locations(id) on delete restrict,
  route_graph_version_id uuid not null references public.route_graph_versions(id) on delete restrict,
  vehicle_id uuid references public.vehicles(id) on delete restrict,
  status public.delivery_status not null default 'draft',
  version integer not null default 1 check (version >= 1),
  item_type public.item_type not null,
  note text not null default '',
  terminal_reason text,
  custody_resolution text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  confirmed_at timestamptz,
  completed_at timestamptz,
  constraint deliveries_different_locations check (pickup_location_id <> dropoff_location_id),
  constraint deliveries_note_length check (char_length(note) <= 300)
);
create index deliveries_sender_created_idx on public.deliveries(sender_id, created_at desc);
create index deliveries_status_updated_idx on public.deliveries(status, updated_at desc);
create unique index deliveries_one_active_per_sender on public.deliveries(sender_id)
where status not in ('completed', 'cancelled', 'delivery_failed');

create table private.delivery_recipients (
  delivery_id uuid primary key references public.deliveries(id) on delete restrict,
  recipient_name text not null,
  phone_e164 text not null,
  email text,
  email_notification_consent boolean not null default false,
  created_at timestamptz not null default now(),
  delete_after timestamptz,
  constraint recipient_name_length check (char_length(recipient_name) between 1 and 50),
  constraint recipient_phone_tw check (phone_e164 ~ '^\+8869[0-9]{8}$'),
  constraint recipient_email_length check (email is null or char_length(email) <= 254),
  constraint recipient_email_consent check (email is not null or email_notification_consent = false)
);

create table public.vehicle_reservations (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.vehicles(id) on delete restrict,
  delivery_id uuid not null references public.deliveries(id) on delete restrict,
  state public.reservation_state not null default 'active',
  started_at timestamptz not null default now(),
  ended_at timestamptz
);
create unique index vehicle_reservations_vehicle_active on public.vehicle_reservations(vehicle_id) where state = 'active';
create unique index vehicle_reservations_delivery_active on public.vehicle_reservations(delivery_id) where state = 'active';

create table public.delivery_status_history (
  id bigint generated always as identity primary key,
  delivery_id uuid not null references public.deliveries(id) on delete restrict,
  version integer not null,
  from_status public.delivery_status,
  to_status public.delivery_status not null,
  event text not null,
  actor_type public.actor_type not null,
  actor_id uuid,
  reason text,
  safe_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(delivery_id, version),
  constraint history_metadata_object check (jsonb_typeof(safe_metadata) = 'object')
);
create index delivery_history_created_idx on public.delivery_status_history(delivery_id, created_at);

create table public.vehicle_state_current (
  vehicle_id uuid primary key references public.vehicles(id) on delete restrict,
  boot_id uuid not null,
  sequence bigint not null check (sequence >= 0),
  frame_id text not null,
  pose_x double precision not null,
  pose_y double precision not null,
  heading double precision not null,
  battery numeric(5,2) not null check (battery between 0 and 100),
  connectivity public.connectivity_state not null default 'offline',
  observed_at timestamptz not null,
  received_at timestamptz not null default now()
);

create table public.vehicle_telemetry (
  id bigint generated always as identity primary key,
  vehicle_id uuid not null references public.vehicles(id) on delete restrict,
  boot_id uuid not null,
  sequence bigint not null check (sequence >= 0),
  message_id uuid not null unique,
  frame_id text not null,
  pose_x double precision not null,
  pose_y double precision not null,
  heading double precision not null,
  speed double precision check (speed is null or speed >= 0),
  battery numeric(5,2) not null check (battery between 0 and 100),
  quality text not null check (quality in ('valid', 'degraded', 'invalid')),
  observed_at timestamptz not null,
  received_at timestamptz not null default now(),
  delete_after timestamptz not null default (now() + interval '7 days'),
  unique(vehicle_id, boot_id, sequence)
);
create index vehicle_telemetry_recent_idx on public.vehicle_telemetry(vehicle_id, observed_at desc);

create table public.delivery_progress_current (
  delivery_id uuid primary key references public.deliveries(id) on delete restrict,
  version integer not null check (version >= 1),
  segment_id text,
  progress numeric(6,5) check (progress is null or progress between 0 and 1),
  connectivity public.connectivity_state not null default 'offline',
  position_quality public.position_quality not null default 'pending',
  observed_at timestamptz,
  eta_min_seconds integer check (eta_min_seconds is null or eta_min_seconds >= 0),
  eta_max_seconds integer check (eta_max_seconds is null or eta_max_seconds >= eta_min_seconds),
  updated_at timestamptz not null default now()
);

create table public.vehicle_commands (
  command_id uuid primary key default gen_random_uuid(),
  correlation_id uuid not null,
  delivery_id uuid not null references public.deliveries(id) on delete restrict,
  vehicle_id uuid not null references public.vehicles(id) on delete restrict,
  type public.command_type not null,
  idempotency_key text not null,
  expected_vehicle_state text not null,
  expected_delivery_version integer not null,
  status public.command_state not null default 'queued',
  payload jsonb not null default '{}'::jsonb,
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  completed_at timestamptz,
  unique(vehicle_id, idempotency_key),
  constraint command_expiry_order check (expires_at > issued_at),
  constraint command_payload_object check (jsonb_typeof(payload) = 'object')
);
create index vehicle_commands_queue_idx on public.vehicle_commands(vehicle_id, issued_at) where status = 'queued';

create table public.vehicle_command_events (
  id bigint generated always as identity primary key,
  command_id uuid not null references public.vehicle_commands(command_id) on delete restrict,
  event_id uuid not null unique,
  event public.command_event_type not null,
  source_sequence bigint not null check (source_sequence >= 0),
  error_code text,
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(command_id, source_sequence),
  constraint command_event_evidence_object check (jsonb_typeof(evidence) = 'object')
);

create table private.pickup_credentials (
  id uuid primary key default gen_random_uuid(),
  delivery_id uuid not null references public.deliveries(id) on delete restrict,
  type public.credential_type not null,
  digest bytea not null,
  pepper_version smallint not null,
  expires_at timestamptz not null,
  attempts smallint not null default 0 check (attempts between 0 and 5),
  used_at timestamptz,
  state public.credential_state not null default 'pending',
  verified_attempt_id uuid,
  delete_after timestamptz not null,
  created_at timestamptz not null default now()
);
create unique index pickup_credentials_one_active_type on private.pickup_credentials(delivery_id, type)
where state in ('pending', 'active', 'locked');

create table private.pickup_rate_limits (
  scope_hash bytea primary key,
  attempts integer not null default 0 check (attempts between 0 and 1000),
  window_started_at timestamptz not null default now(),
  delete_after timestamptz not null default (now() + interval '2 days')
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  delivery_id uuid not null references public.deliveries(id) on delete restrict,
  channel public.notification_channel not null,
  template_version text not null,
  masked_destination text not null,
  state public.notification_state not null default 'queued',
  provider_message_id text,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(delivery_id, channel, idempotency_key)
);

create table public.notification_attempts (
  id bigint generated always as identity primary key,
  notification_id uuid not null references public.notifications(id) on delete restrict,
  attempt smallint not null check (attempt > 0),
  request_state public.notification_state not null,
  receipt_state public.notification_state,
  error_code text,
  created_at timestamptz not null default now(),
  unique(notification_id, attempt)
);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  actor_type public.actor_type not null,
  actor_id uuid,
  intent text not null,
  target_type text not null,
  target_id uuid,
  request_id uuid not null,
  result text not null,
  safe_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint audit_metadata_object check (jsonb_typeof(safe_metadata) = 'object')
);
create index audit_target_time_idx on public.audit_logs(target_type, target_id, created_at desc);

create table public.robot_faults (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.vehicles(id) on delete restrict,
  delivery_id uuid references public.deliveries(id) on delete restrict,
  type text not null,
  severity public.fault_severity not null,
  safe_evidence jsonb not null default '{}'::jsonb,
  observed_at timestamptz not null,
  resolved_at timestamptz,
  resolved_by uuid,
  constraint fault_evidence_object check (jsonb_typeof(safe_evidence) = 'object')
);
create index robot_faults_unresolved_idx on public.robot_faults(vehicle_id, severity) where resolved_at is null;

create table public.support_requests (
  id uuid primary key default gen_random_uuid(),
  delivery_id uuid not null references public.deliveries(id) on delete restrict,
  creator_id uuid,
  category text not null,
  state text not null check (state in ('open', 'assigned', 'resolved', 'closed')),
  assigned_to uuid,
  description text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  delete_after timestamptz not null default (now() + interval '90 days'),
  constraint support_description_length check (char_length(description) <= 1000)
);
create index support_requests_active_idx on public.support_requests(state, created_at) where state in ('open', 'assigned');

create table private.idempotency_records (
  id uuid primary key default gen_random_uuid(),
  actor_scope text not null,
  operation text not null,
  idempotency_key text not null,
  request_hash text not null,
  response_data jsonb,
  response_reference uuid,
  expires_at timestamptz not null default (now() + interval '48 hours'),
  created_at timestamptz not null default now(),
  unique(actor_scope, operation, idempotency_key)
);

comment on schema private is 'PII, credentials, and server-only idempotency data; never exposed through the Data API.';
comment on table public.vehicle_telemetry is 'Precise robot telemetry. Users receive only delivery_progress_current projection.';
comment on table private.pickup_credentials is 'Only HMAC digests are stored. Raw human/QR secrets must never be persisted.';
comment on table private.pickup_rate_limits is 'Privacy-safe rotating HMAC scope only; raw IP addresses are never stored.';

commit;
