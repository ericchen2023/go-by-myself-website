begin;

create or replace function private.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles(id, display_name, normalized_email, auth_assurance, account_status)
  values (
    new.id,
    left(coalesce(new.raw_user_meta_data ->> 'full_name', ''), 80),
    lower(coalesce(new.email, '')),
    'pending',
    'active'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
revoke all on function private.handle_new_auth_user() from public;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function private.handle_new_auth_user();

create or replace function public.finalize_auth_assurance()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  identity_record auth.identities;
  user_record auth.users;
  verified boolean;
  hosted_domain text;
begin
  if auth.uid() is null then raise exception 'RLS_DENIED' using errcode = '42501'; end if;
  if not exists (
    select 1 from public.profiles profile
    where profile.id = auth.uid() and profile.account_status = 'active'
  ) then
    raise exception 'AUTH_ACCOUNT_INACTIVE' using errcode = '42501';
  end if;
  select identity.* into identity_record
  from auth.identities identity
  where identity.user_id = auth.uid() and identity.provider = 'google'
  order by identity.created_at desc limit 1;
  if identity_record.id is null then
    select auth_user.* into user_record from auth.users auth_user where auth_user.id = auth.uid();
    if user_record.email_confirmed_at is not null
      and lower(user_record.email) ~ '^[^@]+@gms\.ndhu\.edu\.tw$'
      and exists (select 1 from auth.identities email_identity where email_identity.user_id = auth.uid() and email_identity.provider = 'email') then
      update public.profiles set auth_assurance = 'app_email_verified', updated_at = now()
      where id = auth.uid() and account_status = 'active';
      return 'app_email_verified';
    end if;
    return 'pending';
  end if;

  hosted_domain := identity_record.identity_data ->> 'hd';
  verified := coalesce((identity_record.identity_data ->> 'email_verified')::boolean, false);
  if hosted_domain <> 'gms.ndhu.edu.tw' or verified is not true then
    raise exception 'AUTH_DOMAIN_NOT_ALLOWED' using errcode = '42501';
  end if;
  update public.profiles
  set auth_assurance = 'google_hd', updated_at = now()
  where id = auth.uid() and account_status = 'active';
  return 'google_hd';
end;
$$;
revoke all on function public.finalize_auth_assurance() from public;
grant execute on function public.finalize_auth_assurance() to authenticated;

create or replace function private.activate_pickup_credentials(
  p_delivery_id uuid,
  p_human_digest bytea,
  p_qr_digest bytea,
  p_pepper_version smallint,
  p_expires_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_expires_at <= now() or p_expires_at > now() + interval '1 hour' then
    raise exception 'PICKUP_CREDENTIAL_EXPIRY_INVALID';
  end if;
  insert into private.pickup_credentials(delivery_id, type, digest, pepper_version, expires_at, state, delete_after)
  values (p_delivery_id, 'human_code', p_human_digest, p_pepper_version, p_expires_at, 'active', p_expires_at + interval '24 hours');
  if p_qr_digest is not null then
    insert into private.pickup_credentials(delivery_id, type, digest, pepper_version, expires_at, state, delete_after)
    values (p_delivery_id, 'qr_secret', p_qr_digest, p_pepper_version, p_expires_at, 'pending', p_expires_at + interval '24 hours');
  end if;
end;
$$;
revoke all on function private.activate_pickup_credentials(uuid,bytea,bytea,smallint,timestamptz) from public;

create or replace function public.get_pickup_context(p_public_ref uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'delivery', jsonb_build_object(
      'publicRef', delivery.public_ref,
      'status', delivery.status,
      'version', delivery.version,
      'dropoffCode', dropoff.code
    ),
    'pickupContext', jsonb_build_object(
      'stopName', dropoff.name,
      'stopDetail', dropoff.detail,
      'vehicleDisplayName', vehicle.display_name,
      'ready', delivery.status in ('awaiting_recipient','compartment_open_for_recipient','picked_up','completed')
    ),
    'recipientAttempt', jsonb_build_object('attempts', 0, 'verified', false, 'phase', 'idle', 'error', '')
  )
  from public.deliveries delivery
  join public.delivery_locations dropoff on dropoff.id = delivery.dropoff_location_id
  left join public.vehicles vehicle on vehicle.id = delivery.vehicle_id
  where delivery.public_ref = p_public_ref
    and delivery.status in ('arrived_dropoff','awaiting_recipient','compartment_open_for_recipient','picked_up','completed');
$$;
revoke all on function public.get_pickup_context(uuid) from public, anon, authenticated;
grant execute on function public.get_pickup_context(uuid) to service_role;

create or replace function public.redeem_pickup_credential(
  p_public_ref uuid,
  p_digest bytea,
  p_attempt_id uuid,
  p_rate_scope bytea
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  delivery_row public.deliveries;
  credential_row private.pickup_credentials;
  created_command_id uuid;
begin
  insert into private.pickup_rate_limits(scope_hash, attempts)
  values (p_rate_scope, 1)
  on conflict (scope_hash) do update set attempts = private.pickup_rate_limits.attempts + 1;
  if (select attempts from private.pickup_rate_limits where scope_hash = p_rate_scope) > 20 then
    raise exception 'RATE_LIMITED';
  end if;
  select * into delivery_row from public.deliveries where public_ref = p_public_ref for update;
  if delivery_row.id is null or delivery_row.status <> 'awaiting_recipient' then
    raise exception 'PICKUP_CREDENTIAL_INVALID';
  end if;
  select * into credential_row from private.pickup_credentials
  where delivery_id = delivery_row.id and type = 'human_code' and state in ('active', 'locked')
  for update;
  if credential_row.id is null or credential_row.expires_at <= now() or credential_row.state = 'locked' then
    raise exception 'PICKUP_CREDENTIAL_INVALID';
  end if;

  if credential_row.digest <> p_digest then
    update private.pickup_credentials
    set attempts = least(attempts + 1, 5), state = case when attempts + 1 >= 5 then 'locked'::public.credential_state else state end
    where id = credential_row.id;
    insert into public.audit_logs(actor_type, intent, target_type, target_id, request_id, result)
    values ('recipient', 'REDEEM_PICKUP_CREDENTIAL', 'delivery', delivery_row.id, p_attempt_id, 'invalid');
    return jsonb_build_object('authorized', false);
  end if;

  if credential_row.verified_attempt_id is not null then
    select vehicle_command.command_id into created_command_id from public.vehicle_commands vehicle_command
    where vehicle_command.idempotency_key = credential_row.verified_attempt_id::text and vehicle_command.delivery_id = delivery_row.id;
  else
    update private.pickup_credentials set verified_attempt_id = p_attempt_id where id = credential_row.id;
    insert into public.vehicle_commands(
      correlation_id, delivery_id, vehicle_id, type, idempotency_key,
      expected_vehicle_state, expected_delivery_version, expires_at, payload
    ) values (
      gen_random_uuid(), delivery_row.id, delivery_row.vehicle_id, 'OPEN_COMPARTMENT', p_attempt_id::text,
      'arrived_dropoff', delivery_row.version, least(credential_row.expires_at, now() + interval '5 minutes'),
      jsonb_build_object('actor', 'recipient', 'credentialType', 'human_code')
    ) returning command_id into created_command_id;
  end if;

  insert into public.audit_logs(actor_type, intent, target_type, target_id, request_id, result)
  values ('recipient', 'REDEEM_PICKUP_CREDENTIAL', 'delivery', delivery_row.id, p_attempt_id, 'verified_open_pending');
  return jsonb_build_object(
    'authorized', true,
    'requestId', p_attempt_id,
    'delivery', jsonb_build_object('publicRef', delivery_row.public_ref, 'status', delivery_row.status, 'version', delivery_row.version),
    'commandState', 'queued',
    'recipientAttempt', jsonb_build_object('verified', true, 'phase', 'opening')
  );
exception
  when others then
    if sqlerrm like 'PICKUP_CREDENTIAL_%' then
      raise exception 'PICKUP_CREDENTIAL_INVALID';
    end if;
    raise;
end;
$$;
revoke all on function public.redeem_pickup_credential(uuid,bytea,uuid,bytea) from public, anon, authenticated;
grant execute on function public.redeem_pickup_credential(uuid,bytea,uuid,bytea) to service_role;

commit;
