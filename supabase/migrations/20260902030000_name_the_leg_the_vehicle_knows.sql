-- 派車指令要用車上認得的那個名字。
--
-- 車端 legs.json 登錄的是八個示教過的 legId：A_B、B_A、B_C、C_B、C_D、D_C、
-- A_D、D_A。bridge 只認這些 —— valid_leg_id 直接查集合，不做寬鬆比對。
--
-- 伺服器卻一律發 SIM_<FROM>_<TO>，而真實 bridge 對 SIM_* 是**直接拒絕**的
-- （allow_synthetic_legs=False）：合成 leg 沒有對應的 .stcm，放行等於讓車去跑
-- 一條不存在的路線。所以接上真車之後，第一個派車指令會在 socket 就被打回來。
--
-- 對照表本來就已經在 serviceable_stop_pairs 裡了（那張表的 leg_id 欄位），
-- 這裡只是去查它。mock bridge 也收真實 legId（valid_leg_id 一律接受那八個），
-- 所以模擬跑的會是跟真車同一組名字，投影也會走 calibration 而不是合成路徑。
begin;

create or replace function private.create_schematic_route_job(
  p_delivery_id uuid,
  p_vehicle_id uuid,
  p_kind public.route_job_kind,
  p_from_stop_code text,
  p_to_stop_code text,
  p_initiated_by uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  delivery_row public.deliveries;
  graph_row public.route_graph_versions;
  plan_row public.route_pair_plans;
  created_job_id uuid;
  physical_leg_id text;
begin
  select * into delivery_row from public.deliveries where id = p_delivery_id;
  select * into graph_row from public.route_graph_versions where id = delivery_row.route_graph_version_id;
  select * into plan_row from public.route_pair_plans
  where route_graph_version_id = graph_row.id and from_stop_code = p_from_stop_code and to_stop_code = p_to_stop_code;
  if plan_row.route_graph_version_id is null then raise exception 'ROUTE_SEGMENT_NOT_ALLOWED'; end if;
  insert into public.route_jobs(
    delivery_id, vehicle_id, kind, route_graph_version_id, route_graph_checksum,
    from_stop_code, to_stop_code, leg_count, initiated_by
  ) values (
    p_delivery_id, p_vehicle_id, p_kind, graph_row.id, graph_row.checksum,
    p_from_stop_code, p_to_stop_code, 1, p_initiated_by
  ) returning id into created_job_id;
  -- 車上只認那八個示教過的 legId（A_B、B_A…）。先前這裡一律發
  -- SIM_<FROM>_<TO>，而真實 bridge 對 SIM_* 是直接拒絕的 —— 合成 leg 沒有對應
  -- 的 .stcm，放行等於讓車去跑一條不存在的路線。所以真車連第一個派車指令都
  -- 接不到。這裡改成查出實體 legId 再發。
  --
  -- 查不到就仍然發 SIM_：那是尚未示教的組合，真實 bridge 拒絕它是正確的行為，
  -- 而且會吵鬧地失敗，不會安靜地跑錯。
  select pair.leg_id into physical_leg_id from public.serviceable_stop_pairs pair
  where pair.from_stop_code = p_from_stop_code and pair.to_stop_code = p_to_stop_code;

  insert into public.route_job_legs(route_job_id, leg_index, leg_id, from_stop_code, to_stop_code, allowed_segment_ids)
  values (created_job_id, 0,
    coalesce(physical_leg_id, 'SIM_' || p_from_stop_code || '_' || p_to_stop_code),
    p_from_stop_code, p_to_stop_code, plan_row.allowed_segment_ids);
  perform private.enqueue_route_job_leg(created_job_id, 0);
  return created_job_id;
end;
$$;
revoke all on function private.create_schematic_route_job(uuid,uuid,public.route_job_kind,text,text,uuid) from public;


-- 去接件的那一段也要示教過，否則派出去只會在車端被拒絕。
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
        -- 車子還得先開到放件站，而那一段同樣需要示教過。車停在人社一館、
        -- 放件站在圖資中心時沒有地圖也沒有路徑 —— 派出去只會在車端被拒絕。
        if not exists (
          select 1 from public.serviceable_stop_pairs pair
          where pair.from_stop_code = selected_vehicle.current_stop_code
            and pair.to_stop_code = pickup_code
        ) then
          raise exception 'NO_TAUGHT_ROUTE_TO_PICKUP';
        end if;
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


commit;
