-- 取件碼直接寄給收件人，寄件人不再經手。
--
-- 上一版是由寄件人按「產生取件碼」、看到明碼、自己轉交。那是沒有通知管道時的
-- 退路，不是正常設計：取件碼是一把鑰匙，鑰匙落在寄件人手上，就代表寄件人可以
-- 自己把東西拿回去而系統記成「收件人已取件」，「誰取走的」也就不再可證明。
-- 對一個以可稽核交付為賣點的系統來說，那是設計上的破口。
--
-- 現在車輛回報抵達的當下就發碼寄信，寄件人只看得到通知狀態。
begin;

-- 車輛抵達時由系統發起交付。與 issue_recipient_pickup_code 同樣的效果，
-- 但行為者是系統而不是寄件人，而且順便把寄信需要的收件人資料交出來 ——
-- 刻意不做成一支通用的「給我收件人 email」函式，那種東西一旦存在就會被
-- 用在別的地方。這裡只在交付真正開始的那一刻交出，且僅限 service_role。
create or replace function public.begin_recipient_handover(
  p_delivery_id uuid,
  p_digest bytea,
  p_pepper_version smallint,
  p_expires_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  delivery_row public.deliveries;
  recipient_row private.delivery_recipients;
  prior_status public.delivery_status;
  dropoff_name text;
begin
  if auth.role() <> 'service_role' then raise exception 'RLS_DENIED' using errcode = '42501'; end if;
  select * into delivery_row from public.deliveries where id = p_delivery_id for update;
  if delivery_row.id is null then raise exception 'DELIVERY_INVALID_TRANSITION'; end if;
  if delivery_row.status not in ('arrived_dropoff', 'awaiting_recipient') then
    raise exception 'DELIVERY_INVALID_TRANSITION';
  end if;

  -- 重發時舊碼必須當場作廢，否則會有兩組碼同時有效。
  update private.pickup_credentials
  set state = 'expired', delete_after = now() + interval '24 hours'
  where delivery_id = delivery_row.id and state in ('pending', 'active', 'locked');

  perform private.activate_pickup_credentials(
    delivery_row.id, p_digest, null, p_pepper_version, p_expires_at
  );

  if delivery_row.status = 'arrived_dropoff' then
    prior_status := delivery_row.status;
    update public.deliveries set status = 'awaiting_recipient', version = version + 1, updated_at = now()
    where id = delivery_row.id returning * into delivery_row;
    insert into public.delivery_status_history(
      delivery_id, version, from_status, to_status, event, actor_type, safe_metadata)
    values (
      delivery_row.id, delivery_row.version, prior_status, 'awaiting_recipient',
      'RECIPIENT_HANDOVER_READY', 'system',
      jsonb_build_object('credential', 'human_code', 'notify', 'email')
    );
  end if;

  select * into recipient_row from private.delivery_recipients where delivery_id = delivery_row.id;
  select name into dropoff_name from public.delivery_locations where id = delivery_row.dropoff_location_id;
  perform private.broadcast_delivery_projection(delivery_row.id);

  return jsonb_build_object(
    'projection', private.safe_delivery_projection(delivery_row.id),
    'publicRef', delivery_row.public_ref,
    'dropoffName', dropoff_name,
    'recipientName', recipient_row.recipient_name,
    -- 沒有同意 email 通知就不交出地址，寄信端會據此記成 unconfigured。
    'recipientEmail', case when recipient_row.email_notification_consent then recipient_row.email else null end
  );
end;
$$;
revoke all on function public.begin_recipient_handover(uuid,bytea,smallint,timestamptz) from public, anon, authenticated;
grant execute on function public.begin_recipient_handover(uuid,bytea,smallint,timestamptz) to service_role;

-- 通知結果只留遮蔽後的地址與供應商回傳的訊息 id，不存完整信箱。
create or replace function public.record_delivery_notification(
  p_delivery_id uuid,
  p_channel public.notification_channel,
  p_state public.notification_state,
  p_masked_destination text,
  p_template_version text,
  p_provider_message_id text,
  p_idempotency_key text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() <> 'service_role' then raise exception 'RLS_DENIED' using errcode = '42501'; end if;
  insert into public.notifications(
    delivery_id, channel, template_version, masked_destination, state, provider_message_id, idempotency_key)
  values (
    p_delivery_id, p_channel, p_template_version, p_masked_destination, p_state,
    p_provider_message_id, p_idempotency_key)
  on conflict (delivery_id, channel, idempotency_key) do update
  set state = excluded.state,
      provider_message_id = coalesce(excluded.provider_message_id, public.notifications.provider_message_id),
      updated_at = now();
  perform private.broadcast_delivery_projection(p_delivery_id);
end;
$$;
revoke all on function public.record_delivery_notification(uuid,public.notification_channel,public.notification_state,text,text,text,text) from public, anon, authenticated;
grant execute on function public.record_delivery_notification(uuid,public.notification_channel,public.notification_state,text,text,text,text) to service_role;

-- 寄件人發碼降級為退路：只有在通知真的送不出去時才准。信寄得出去卻還讓
-- 寄件人看到明碼，等於把上面那個破口原封不動留著。
create or replace function public.issue_recipient_pickup_code(
  p_delivery_id uuid,
  p_digest bytea,
  p_pepper_version smallint,
  p_expires_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  delivery_row public.deliveries;
  latest_state public.notification_state;
  prior_status public.delivery_status;
begin
  if auth.uid() is null then raise exception 'RLS_DENIED' using errcode = '42501'; end if;
  select * into delivery_row from public.deliveries where id = p_delivery_id for update;
  if delivery_row.id is null or delivery_row.sender_id <> auth.uid() then
    raise exception 'RLS_DENIED' using errcode = '42501';
  end if;
  if delivery_row.status not in ('arrived_dropoff', 'awaiting_recipient') then
    raise exception 'DELIVERY_INVALID_TRANSITION';
  end if;

  select notification.state into latest_state from public.notifications notification
  where notification.delivery_id = delivery_row.id
  order by notification.created_at desc limit 1;
  if latest_state is not null and latest_state not in ('failed', 'unconfigured') then
    raise exception 'NOTIFICATION_ALREADY_DELIVERED';
  end if;

  update private.pickup_credentials
  set state = 'expired', delete_after = now() + interval '24 hours'
  where delivery_id = delivery_row.id and state in ('pending', 'active', 'locked');

  perform private.activate_pickup_credentials(
    delivery_row.id, p_digest, null, p_pepper_version, p_expires_at
  );

  if delivery_row.status = 'arrived_dropoff' then
    prior_status := delivery_row.status;
    update public.deliveries set status = 'awaiting_recipient', version = version + 1, updated_at = now()
    where id = delivery_row.id returning * into delivery_row;
    insert into public.delivery_status_history(
      delivery_id, version, from_status, to_status, event, actor_type, actor_id, safe_metadata)
    values (
      delivery_row.id, delivery_row.version, prior_status, 'awaiting_recipient',
      'RECIPIENT_HANDOVER_READY', 'sender', auth.uid(),
      jsonb_build_object('credential', 'human_code', 'notify', 'sender_relay')
    );
  end if;

  -- 明碼經過寄件人這件事必須留下紀錄，日後追查取件爭議時看得到。
  insert into public.audit_logs(actor_type, actor_id, intent, target_type, target_id, request_id, result, safe_metadata)
  values ('sender', auth.uid(), 'ISSUE_PICKUP_CODE', 'delivery', delivery_row.id, gen_random_uuid(),
    'fallback_reveal', jsonb_build_object('notificationState', coalesce(latest_state::text, 'none')));
  perform private.broadcast_delivery_projection(delivery_row.id);
  return private.safe_delivery_projection(delivery_row.id);
end;
$$;
revoke all on function public.issue_recipient_pickup_code(uuid,bytea,smallint,timestamptz) from public, anon;
grant execute on function public.issue_recipient_pickup_code(uuid,bytea,smallint,timestamptz) to authenticated;


-- projection 帶上通知結果，寄件人才知道信寄出去了沒 —— 但看不到碼。
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
    -- 寄件人看得到通知怎麼了，但看不到取件碼本身。
    'notification', (
      select jsonb_build_object(
        'state', notification.state,
        'channel', notification.channel,
        'maskedDestination', notification.masked_destination,
        'updatedAt', notification.updated_at
      )
      from public.notifications notification
      where notification.delivery_id = delivery.id
      order by notification.created_at desc limit 1
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
  left join public.route_jobs job on job.id = progress.route_job_id
  left join public.route_job_legs leg on leg.route_job_id = job.id and leg.leg_index = progress.leg_index
  left join public.vehicle_state_current vehicle_state on vehicle_state.vehicle_id = delivery.vehicle_id
  left join public.vehicles vehicle on vehicle.id = delivery.vehicle_id
  where delivery.id = p_delivery_id;
$$;
revoke all on function private.safe_delivery_projection(uuid) from public, anon, authenticated;

commit;
