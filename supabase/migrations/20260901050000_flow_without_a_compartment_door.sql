-- 沒有艙門的車，流程改由寄件人／收件人確認。
--
-- GBM-01 沒有置物艙硬體。原本的流程要求 OPEN_COMPARTMENT 指令回報 completed
-- 才會前進，而車上 bridge 誠實地以 COMMAND_TYPE_UNSUPPORTED 拒絕它 —— 所以
-- arrived_pickup 是一條死路，正式紀錄裡同一位寄件人在 1.5 秒內按了四次開艙。
--
-- 這裡不偽造感測器證據：改成把「有沒有艙門」寫成車輛能力，沒有艙門時由人
-- 宣稱「已放入／已取出」，並在 delivery_status_history 裡如實記成人工證據。
begin;

alter table public.vehicles add column if not exists has_compartment boolean not null default true;
comment on column public.vehicles.has_compartment is
  '車輛是否有可遙控的置物艙。false 時不發 OPEN_COMPARTMENT 指令，改由當事人確認，證據記為 sender/recipient 宣稱。';

-- 目前唯一的車沒有艙門。之後裝上了就把這裡改回 true，流程會自動走回指令路徑。
update public.vehicles set has_compartment = false, updated_at = now() where code = 'GBM-01';

-- 出發的動作原本只藏在 record_departure_ready 裡，而那道門只收 operator 與
-- service_role。沒有艙門就沒有關門感測器，寄件人按下「關閉置物櫃」就是最後
-- 一個訊號，所以把出發抽成共用函式，兩條路徑都用它。
create or replace function private.depart_from_pickup(
  p_delivery_id uuid,
  p_actor public.actor_type,
  p_safe_evidence jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  delivery_row public.deliveries;
  pickup_code text;
  dropoff_code text;
  current_stop text;
  created_job_id uuid;
begin
  select * into delivery_row from public.deliveries where id = p_delivery_id for update;
  if delivery_row.status <> 'loaded' then raise exception 'DELIVERY_INVALID_TRANSITION'; end if;
  select code into pickup_code from public.delivery_locations where id = delivery_row.pickup_location_id;
  select code into dropoff_code from public.delivery_locations where id = delivery_row.dropoff_location_id;
  select current_stop_code into current_stop from public.vehicles where id = delivery_row.vehicle_id for update;
  if current_stop is null or current_stop <> pickup_code then raise exception 'ROBOT_STATE_INVALID'; end if;
  created_job_id := private.create_schematic_route_job(
    delivery_row.id, delivery_row.vehicle_id, 'to_dropoff', pickup_code, dropoff_code, auth.uid()
  );
  update public.vehicle_reservations set route_job_id = created_job_id
  where delivery_id = delivery_row.id and state = 'active';
  update public.deliveries set status = 'in_transit', version = version + 1, updated_at = now()
  where id = delivery_row.id returning * into delivery_row;
  insert into public.delivery_status_history(delivery_id, version, from_status, to_status, event, actor_type, actor_id, safe_metadata)
  values (
    delivery_row.id, delivery_row.version, 'loaded', 'in_transit', 'DOOR_CLOSED_AND_DEPARTED',
    p_actor, auth.uid(), coalesce(p_safe_evidence, '{}'::jsonb) - array['rawPose','token','phone','email']
  );
end;
$$;
revoke all on function private.depart_from_pickup(uuid,public.actor_type,jsonb) from public, anon, authenticated;

create or replace function public.record_departure_ready(p_delivery_id uuid, p_safe_evidence jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() <> 'service_role' and not private.is_active_operator('operator') then
    raise exception 'RLS_DENIED' using errcode = '42501';
  end if;
  perform private.depart_from_pickup(
    p_delivery_id,
    case when auth.role() = 'service_role' then 'system'::public.actor_type else 'operator'::public.actor_type end,
    p_safe_evidence
  );
  perform private.broadcast_delivery_projection(p_delivery_id);
  return private.safe_delivery_projection(p_delivery_id);
end;
$$;
revoke all on function public.record_departure_ready(uuid,jsonb) from public, anon;
grant execute on function public.record_departure_ready(uuid,jsonb) to authenticated, service_role;

-- 注意：要改的是內層。202608280010 把原本的函式改名為 execute_delivery_intent_unlocked，
-- 另外建了一個同名外層來擋 idempotency key 重用；用舊版本 create or replace 同名函式
-- 會把那層防護整個蓋掉。
create or replace function public.execute_delivery_intent_unlocked(
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
  selected_vehicle public.vehicles;
  pickup_code text;
  selected_route_job_id uuid;
  created_command_id uuid;
  vehicle_has_compartment boolean;
  intent_evidence jsonb := '{}'::jsonb;
  prior_response jsonb;
begin
  if auth.uid() is null then raise exception 'RLS_DENIED' using errcode = '42501'; end if;
  select response_data into prior_response from private.idempotency_records
  where actor_scope = auth.uid()::text and operation = p_intent
    and idempotency_key = p_idempotency_key and expires_at > now();
  if prior_response is not null then return prior_response; end if;

  select * into delivery_row from public.deliveries where id = p_delivery_id for update;
  if delivery_row.id is null or delivery_row.sender_id <> auth.uid() then raise exception 'RLS_DENIED' using errcode = '42501'; end if;
  if delivery_row.version <> p_expected_version then raise exception 'DELIVERY_CONFLICT'; end if;
  prior_status := delivery_row.status;
  select code into pickup_code from public.delivery_locations where id = delivery_row.pickup_location_id;

  case p_intent
    when 'REQUEST_DISPATCH' then
      if delivery_row.status <> 'confirmed' then raise exception 'DELIVERY_INVALID_TRANSITION'; end if;
      select vehicle.* into selected_vehicle from public.vehicles vehicle
      where vehicle.active and vehicle.operational_status = 'available' and vehicle.current_stop_code is not null
        and not exists (
          select 1 from public.vehicle_reservations reservation
          where reservation.vehicle_id = vehicle.id and reservation.state = 'active'
        )
      order by vehicle.code for update skip locked limit 1;
      if selected_vehicle.id is null then raise exception 'VEHICLE_UNAVAILABLE'; end if;
      insert into public.vehicle_reservations(vehicle_id, delivery_id)
      values (selected_vehicle.id, p_delivery_id);
      update public.vehicles set operational_status = 'reserved', updated_at = now() where id = selected_vehicle.id;
      if selected_vehicle.current_stop_code = pickup_code then
        next_status := 'arrived_pickup';
      else
        selected_route_job_id := private.create_schematic_route_job(
          p_delivery_id, selected_vehicle.id, 'to_pickup', selected_vehicle.current_stop_code, pickup_code, auth.uid()
        );
        update public.vehicle_reservations set route_job_id = selected_route_job_id
        where delivery_id = p_delivery_id and state = 'active';
        next_status := 'dispatching';
      end if;
    when 'REQUEST_SENDER_OPEN' then
      if delivery_row.status <> 'arrived_pickup' then raise exception 'DELIVERY_INVALID_TRANSITION'; end if;
      select vehicle.has_compartment into vehicle_has_compartment
      from public.vehicles vehicle where vehicle.id = delivery_row.vehicle_id;
      if not coalesce(vehicle_has_compartment, true) then
        -- 沒有艙門就沒有東西可以開，也沒有指令可以等。原本這裡會送出一道車輛
        -- 必定以 COMMAND_TYPE_UNSUPPORTED 拒絕的指令，把投遞留在 arrived_pickup。
        next_status := 'compartment_open_for_sender';
        intent_evidence := jsonb_build_object('compartment', 'absent', 'assertedBy', 'sender');
      else
        insert into public.vehicle_commands(
          correlation_id, delivery_id, vehicle_id, type, idempotency_key,
          expected_delivery_version, schema_version, preconditions, expires_at, payload
        ) values (
          gen_random_uuid(), p_delivery_id, delivery_row.vehicle_id, 'OPEN_COMPARTMENT', p_idempotency_key,
          delivery_row.version, 2, jsonb_build_object('allowedVehicleStates', jsonb_build_array('at_stop')),
          now() + interval '5 minutes', jsonb_build_object('actor','sender')
        ) returning command_id into created_command_id;
        next_status := delivery_row.status;
      end if;
    when 'LOAD_CONFIRMED' then
      if delivery_row.status <> 'compartment_open_for_sender' then raise exception 'DELIVERY_INVALID_TRANSITION'; end if;
      next_status := 'loaded';
    when 'REQUEST_CANCEL' then
      if delivery_row.status = 'confirmed' and delivery_row.vehicle_id is null then
        next_status := 'cancelled';
      elsif delivery_row.status in ('dispatching','arrived_pickup','compartment_open_for_sender','loaded','in_transit') then
        next_status := 'cancel_requested';
        select id into selected_route_job_id from public.route_jobs
        where delivery_id = delivery_row.id and state in ('queued','running','safe_stop_requested')
        order by created_at desc limit 1 for update;
        insert into public.vehicle_commands(
          correlation_id, delivery_id, route_job_id, vehicle_id, type, idempotency_key,
          expected_delivery_version, schema_version, preconditions, expires_at, payload
        ) values (
          gen_random_uuid(), p_delivery_id, selected_route_job_id, delivery_row.vehicle_id, 'CANCEL', p_idempotency_key,
          delivery_row.version, 2, '{}'::jsonb, now() + interval '30 minutes', '{}'::jsonb
        ) returning command_id into created_command_id;
        if selected_route_job_id is not null then
          update public.route_jobs set state = 'safe_stop_requested', updated_at = now() where id = selected_route_job_id;
        end if;
      else
        raise exception 'DELIVERY_INVALID_TRANSITION';
      end if;
    else
      raise exception 'DELIVERY_INVALID_TRANSITION';
  end case;

  update public.deliveries set
    status = next_status,
    version = version + 1,
    vehicle_id = coalesce(public.deliveries.vehicle_id, selected_vehicle.id),
    updated_at = now(),
    terminal_reason = case when next_status = 'cancelled' then 'cancelled_before_reservation' else terminal_reason end
  where id = p_delivery_id returning * into delivery_row;

  insert into public.delivery_status_history(delivery_id, version, from_status, to_status, event, actor_type, actor_id, safe_metadata)
  values (
    p_delivery_id, delivery_row.version, prior_status, next_status,
    case when next_status = 'arrived_pickup' then 'VEHICLE_ARRIVED_PICKUP' else p_intent end,
    case when next_status = 'arrived_pickup' then 'system'::public.actor_type else 'sender'::public.actor_type end,
    auth.uid(), intent_evidence
  );

  -- 沒有艙門就沒有關門感測器：寄件人按下「關閉置物櫃」是最後一個訊號，
  -- 出發只能由這裡帶出去，否則投遞會停在 loaded 等一個永遠不會來的回報。
  if p_intent = 'LOAD_CONFIRMED' and not coalesce(
    (select vehicle.has_compartment from public.vehicles vehicle where vehicle.id = delivery_row.vehicle_id), true) then
    perform private.depart_from_pickup(
      p_delivery_id, 'sender'::public.actor_type,
      jsonb_build_object('compartment', 'absent', 'assertedBy', 'sender')
    );
  end if;

  prior_response := private.safe_delivery_projection(p_delivery_id);
  insert into private.idempotency_records(actor_scope, operation, idempotency_key, request_hash, response_data, response_reference)
  values (
    auth.uid()::text, p_intent, p_idempotency_key,
    encode(extensions.digest(concat_ws('|', p_delivery_id, p_expected_version, p_intent), 'sha256'), 'hex'),
    prior_response, p_delivery_id
  );
  insert into public.audit_logs(actor_type, actor_id, intent, target_type, target_id, request_id, result)
  values ('sender', auth.uid(), p_intent, 'delivery', p_delivery_id, gen_random_uuid(), 'success');
  perform private.broadcast_delivery_projection(p_delivery_id);
  return prior_response;
end;
$$;
revoke all on function public.execute_delivery_intent_unlocked(uuid,text,integer,text)
from public, anon, authenticated;


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
  vehicle_has_compartment boolean;
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

  select vehicle.has_compartment into vehicle_has_compartment
  from public.vehicles vehicle where vehicle.id = delivery_row.vehicle_id;
  if not coalesce(vehicle_has_compartment, true) then
    -- 沒有艙門，車上是開放式載台：驗證碼本來就是唯一的關卡，這裡不再多發
    -- 一道車輛必定拒絕的開艙指令，改為直接開放取件並記成人工證據。
    update private.pickup_credentials set state = 'used', used_at = now(),
      verified_attempt_id = coalesce(verified_attempt_id, p_attempt_id),
      delete_after = now() + interval '24 hours'
    where id = credential_row.id;
    if delivery_row.status = 'awaiting_recipient' then
      update public.deliveries set status = 'compartment_open_for_recipient', version = version + 1, updated_at = now()
      where id = delivery_row.id returning * into delivery_row;
      insert into public.delivery_status_history(delivery_id, version, from_status, to_status, event, actor_type, safe_metadata)
      values (
        delivery_row.id, delivery_row.version, 'awaiting_recipient', 'compartment_open_for_recipient',
        'RECIPIENT_OPEN_COMPLETED', 'recipient',
        jsonb_build_object('compartment', 'absent', 'assertedBy', 'recipient')
      );
      perform private.broadcast_delivery_projection(delivery_row.id);
    end if;
    insert into public.audit_logs(actor_type, intent, target_type, target_id, request_id, result)
    values ('recipient', 'REDEEM_PICKUP_CREDENTIAL', 'delivery', delivery_row.id, p_attempt_id, 'verified_open_without_compartment');
    return jsonb_build_object(
      'authorized', true,
      'requestId', p_attempt_id,
      'delivery', jsonb_build_object('publicRef', delivery_row.public_ref, 'status', delivery_row.status, 'version', delivery_row.version),
      'commandState', 'completed',
      'recipientAttempt', jsonb_build_object('verified', true, 'phase', 'open')
    );
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


-- projection 也要說出這台車有沒有艙門，否則畫面無從決定要顯示哪一種指示。
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
      'projectionVersion', coalesce(progress.projection_version, 0),
      'position', case when progress.position_quality in ('valid','degraded') and progress.segment_id is not null
        then jsonb_build_object('segmentId', progress.segment_id, 'progress', progress.progress) else null end,
      'observedAt', progress.observed_at,
      'connectivity', coalesce(progress.connectivity, 'offline'::public.connectivity_state),
      'positionQuality', coalesce(progress.position_quality, 'pending'::public.position_quality),
      'activeEdgeIds', coalesce(to_jsonb(leg.allowed_segment_ids), '[]'::jsonb),
      'routePhase', job.kind,
      'routeFromStopCode', job.from_stop_code,
      'routeToStopCode', job.to_stop_code,
      'legIndex', progress.leg_index,
      'legCount', progress.leg_count,
      'vehicleState', vehicle_state.vehicle_state
    ),
    -- 最近一筆指令。errorCode 取該指令最後一個帶錯誤碼的事件，
    -- 讓畫面能說出車輛拒絕的理由，而不是靜靜地把按鈕重新打開。
    'command', (
      select jsonb_build_object(
        'type', latest_command.type,
        'state', latest_command.status,
        'issuedAt', latest_command.issued_at,
        'errorCode', (
          select event.error_code from public.vehicle_command_events event
          where event.command_id = latest_command.command_id and event.error_code is not null
          order by event.source_sequence desc limit 1
        )
      )
      from public.vehicle_commands latest_command
      where latest_command.delivery_id = delivery.id
      order by latest_command.issued_at desc, latest_command.command_id desc
      limit 1
    ),
    -- 這台車有沒有可遙控的置物艙。畫面要據此決定是等車輛開艙，還是請寄件人自己確認。
    'vehicle', jsonb_build_object('hasCompartment', coalesce(vehicle.has_compartment, true)),
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
  left join public.route_jobs job on job.id = progress.route_job_id
  left join public.route_job_legs leg on leg.route_job_id = job.id and leg.leg_index = progress.leg_index
  left join public.vehicle_state_current vehicle_state on vehicle_state.vehicle_id = delivery.vehicle_id
  left join public.vehicles vehicle on vehicle.id = delivery.vehicle_id
  where delivery.id = p_delivery_id;
$$;
revoke all on function private.safe_delivery_projection(uuid) from public, anon, authenticated;

commit;
