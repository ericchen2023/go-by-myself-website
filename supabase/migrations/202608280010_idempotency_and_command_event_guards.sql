begin;

create or replace function private.lock_idempotency_scope(
  p_actor_scope text,
  p_operation text,
  p_idempotency_key text
)
returns void
language sql
security definer
set search_path = ''
as $$
  select pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_actor_scope || '|' || p_operation || '|' || p_idempotency_key, 0)
  );
$$;
revoke all on function private.lock_idempotency_scope(text,text,text) from public, anon, authenticated;

alter function public.create_and_confirm_delivery(
  text,text,text,text,text,boolean,public.item_type,text,text
) rename to create_and_confirm_delivery_unlocked;
revoke all on function public.create_and_confirm_delivery_unlocked(
  text,text,text,text,text,boolean,public.item_type,text,text
) from public, anon, authenticated;

create function public.create_and_confirm_delivery(
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
  computed_hash text;
  stored_hash text;
  prior_response jsonb;
begin
  if auth.uid() is null then raise exception 'RLS_DENIED' using errcode = '42501'; end if;
  computed_hash := encode(extensions.digest(concat_ws('|', p_pickup_code, p_dropoff_code, p_recipient_name, p_phone_e164, coalesce(p_recipient_email, ''), p_item_type, p_note), 'sha256'), 'hex');
  perform private.lock_idempotency_scope(auth.uid()::text, 'CREATE_AND_CONFIRM', p_idempotency_key);
  select request_hash, response_data into stored_hash, prior_response
  from private.idempotency_records
  where actor_scope = auth.uid()::text and operation = 'CREATE_AND_CONFIRM'
    and idempotency_key = p_idempotency_key and expires_at > now();
  if prior_response is not null then
    if stored_hash is distinct from computed_hash then raise exception 'IDEMPOTENCY_KEY_REUSED'; end if;
    return prior_response;
  end if;
  return public.create_and_confirm_delivery_unlocked(
    p_pickup_code, p_dropoff_code, p_recipient_name, p_phone_e164,
    p_recipient_email, p_email_consent, p_item_type, p_note, p_idempotency_key
  );
end;
$$;
revoke all on function public.create_and_confirm_delivery(
  text,text,text,text,text,boolean,public.item_type,text,text
) from public, anon;
grant execute on function public.create_and_confirm_delivery(
  text,text,text,text,text,boolean,public.item_type,text,text
) to authenticated;

alter function public.execute_delivery_intent(uuid,text,integer,text)
rename to execute_delivery_intent_unlocked;
revoke all on function public.execute_delivery_intent_unlocked(uuid,text,integer,text)
from public, anon, authenticated;

create function public.execute_delivery_intent(
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
  computed_hash text;
  stored_hash text;
  prior_response jsonb;
begin
  if auth.uid() is null then raise exception 'RLS_DENIED' using errcode = '42501'; end if;
  computed_hash := encode(extensions.digest(concat_ws('|', p_delivery_id, p_expected_version, p_intent), 'sha256'), 'hex');
  perform private.lock_idempotency_scope(auth.uid()::text, p_intent, p_idempotency_key);
  select request_hash, response_data into stored_hash, prior_response
  from private.idempotency_records
  where actor_scope = auth.uid()::text and operation = p_intent
    and idempotency_key = p_idempotency_key and expires_at > now();
  if prior_response is not null then
    if stored_hash is distinct from computed_hash then raise exception 'IDEMPOTENCY_KEY_REUSED'; end if;
    return prior_response;
  end if;
  return public.execute_delivery_intent_unlocked(
    p_delivery_id, p_intent, p_expected_version, p_idempotency_key
  );
end;
$$;
revoke all on function public.execute_delivery_intent(uuid,text,integer,text) from public, anon;
grant execute on function public.execute_delivery_intent(uuid,text,integer,text) to authenticated;

alter function public.create_route_validation_job(uuid,text,text)
rename to create_route_validation_job_unlocked;
revoke all on function public.create_route_validation_job_unlocked(uuid,text,text)
from public, anon, authenticated;

create function public.create_route_validation_job(
  p_vehicle_id uuid,
  p_leg_id text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  computed_hash text;
  stored_hash text;
  prior_response jsonb;
begin
  if not private.is_active_operator('operator') then raise exception 'RLS_DENIED' using errcode = '42501'; end if;
  computed_hash := encode(extensions.digest(concat_ws('|', p_vehicle_id, p_leg_id), 'sha256'), 'hex');
  perform private.lock_idempotency_scope(auth.uid()::text, 'CREATE_ROUTE_VALIDATION', p_idempotency_key);
  select request_hash, response_data into stored_hash, prior_response
  from private.idempotency_records
  where actor_scope = auth.uid()::text and operation = 'CREATE_ROUTE_VALIDATION'
    and idempotency_key = p_idempotency_key and expires_at > now();
  if prior_response is not null then
    if stored_hash is distinct from computed_hash then raise exception 'IDEMPOTENCY_KEY_REUSED'; end if;
    return prior_response;
  end if;
  return public.create_route_validation_job_unlocked(p_vehicle_id, p_leg_id, p_idempotency_key);
end;
$$;
revoke all on function public.create_route_validation_job(uuid,text,text) from public, anon;
grant execute on function public.create_route_validation_job(uuid,text,text) to authenticated;

create or replace function private.guard_vehicle_command_event_transition()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_status public.command_state;
begin
  select status into current_status
  from public.vehicle_commands
  where command_id = new.command_id;
  if current_status in ('rejected','completed','failed','expired') then
    raise exception 'COMMAND_EVENT_INVALID_TRANSITION';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_vehicle_command_event_transition() from public, anon, authenticated;

create trigger command_events_guard_transition
before insert on public.vehicle_command_events
for each row execute function private.guard_vehicle_command_event_transition();

create or replace function public.reconcile_robot_runtime()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  progress_row record;
  target_connectivity public.connectivity_state;
  changed_count integer := 0;
  expired_row record;
begin
  for progress_row in
    select progress.delivery_id, progress.connectivity, progress.updated_at, delivery.vehicle_id
    from public.delivery_progress_current progress
    join public.deliveries delivery on delivery.id = progress.delivery_id
    where delivery.status not in ('completed','cancelled','delivery_failed')
  loop
    target_connectivity := case
      when progress_row.updated_at is null or progress_row.updated_at < now() - interval '60 seconds' then 'offline'
      when progress_row.updated_at < now() - interval '10 seconds' then 'stale'
      else 'online'
    end;
    if target_connectivity <> progress_row.connectivity then
      update public.delivery_progress_current
      set connectivity = target_connectivity, projection_version = projection_version + 1
      where delivery_id = progress_row.delivery_id;
      update public.vehicle_state_current set connectivity = target_connectivity where vehicle_id = progress_row.vehicle_id;
      perform private.broadcast_delivery_projection(progress_row.delivery_id);
      changed_count := changed_count + 1;
    end if;
  end loop;

  for expired_row in
    select command.command_id, command.route_job_id, job.delivery_id, job.kind
    from public.vehicle_commands command
    left join public.route_jobs job on job.id = command.route_job_id
    where command.status = 'queued' and command.expires_at <= now()
    for update of command skip locked
  loop
    update public.vehicle_commands set status = 'expired', completed_at = now() where command_id = expired_row.command_id;
    if expired_row.route_job_id is not null then
      update public.route_jobs set state = 'failed', terminal_reason = 'COMMAND_EXPIRED', completed_at = now(), updated_at = now()
      where id = expired_row.route_job_id;
      if expired_row.delivery_id is not null and expired_row.kind = 'to_pickup' then
        update public.deliveries set status = 'confirmed', vehicle_id = null, version = version + 1, updated_at = now()
        where id = expired_row.delivery_id and status = 'dispatching';
        if found then
          perform private.release_route_job_reservation(expired_row.route_job_id);
          perform private.broadcast_delivery_projection(expired_row.delivery_id);
        end if;
      elsif expired_row.delivery_id is null then
        perform private.release_route_job_reservation(expired_row.route_job_id);
        perform private.broadcast_route_job_projection(expired_row.route_job_id);
      end if;
    end if;
  end loop;
  return changed_count;
end;
$$;
revoke all on function public.reconcile_robot_runtime() from public, anon, authenticated;
grant execute on function public.reconcile_robot_runtime() to service_role;

commit;
