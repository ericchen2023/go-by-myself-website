-- 把收件端接起來。
--
-- 這一半從來沒有實作過：沒有任何地方會把狀態設成 awaiting_recipient，
-- private.activate_pickup_credentials 沒有任何呼叫者，所以取件碼永遠發不出去；
-- redeem_pickup_credential 又只在 awaiting_recipient 才收碼。結果是車輛開到
-- 目的地就停在 arrived_dropoff，投遞永遠不會結束，而它抓著的預約就是整個車隊。
-- 正式環境已經因此卡死過一次。
--
-- GBM-01 沒有艙門，取件同樣沒有感測器可以回報。與放件端相同做法：由當事人
-- 確認，證據如實記成人工宣稱，不偽造感測器讀值。
begin;

-- 取件碼的 digest 是 HMAC(pepper, code)，pepper 只存在 Edge function 的環境裡，
-- 資料庫算不出來也存不到明碼 —— 所以這裡只收 digest，明碼由呼叫端產生後交給
-- 收件人，不落地。重發會讓舊碼立刻失效。
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
      delivery_id, version, from_status, to_status, event, actor_type, actor_id, safe_metadata)
    values (
      delivery_row.id, delivery_row.version, prior_status, 'awaiting_recipient',
      'RECIPIENT_HANDOVER_READY', 'sender', auth.uid(),
      jsonb_build_object('credential', 'human_code')
    );
  end if;

  insert into public.audit_logs(actor_type, actor_id, intent, target_type, target_id, request_id, result)
  values ('sender', auth.uid(), 'ISSUE_PICKUP_CODE', 'delivery', delivery_row.id, gen_random_uuid(), 'issued');
  perform private.broadcast_delivery_projection(delivery_row.id);
  return private.safe_delivery_projection(delivery_row.id);
end;
$$;
revoke all on function public.issue_recipient_pickup_code(uuid,bytea,smallint,timestamptz) from public, anon;
grant execute on function public.issue_recipient_pickup_code(uuid,bytea,smallint,timestamptz) to authenticated;

-- 取件完成。有艙門的車要等車輛回報取物與關門，這條路徑不碰它 —— 只有沒有
-- 艙門、因而根本沒有那個回報可等的車，才由收件人自己確認。
create or replace function public.confirm_recipient_pickup(p_public_ref uuid, p_attempt_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  delivery_row public.deliveries;
  has_compartment boolean;
begin
  if auth.role() <> 'service_role' then raise exception 'RLS_DENIED' using errcode = '42501'; end if;
  select * into delivery_row from public.deliveries where public_ref = p_public_ref for update;
  if delivery_row.id is null or delivery_row.status <> 'compartment_open_for_recipient' then
    raise exception 'DELIVERY_INVALID_TRANSITION';
  end if;
  select vehicle.has_compartment into has_compartment
  from public.vehicles vehicle where vehicle.id = delivery_row.vehicle_id;
  if coalesce(has_compartment, true) then
    -- 有艙門就有感測器，網頁不得代替它宣告取件完成。
    raise exception 'DELIVERY_INVALID_TRANSITION';
  end if;

  -- 沒有門可關，「已取出」和「已結束」之間沒有任何東西 —— 中間再放一個沒人
  -- 能離開的狀態，就是重蹈這次要修的覆轍。
  update public.deliveries
  set status = 'completed', version = version + 1, completed_at = now(), updated_at = now(),
      terminal_reason = coalesce(terminal_reason, 'recipient_confirmed_pickup')
  where id = delivery_row.id returning * into delivery_row;
  insert into public.delivery_status_history(
    delivery_id, version, from_status, to_status, event, actor_type, safe_metadata)
  values (
    delivery_row.id, delivery_row.version, 'compartment_open_for_recipient', 'completed',
    'RECIPIENT_PICKUP_CONFIRMED', 'recipient',
    jsonb_build_object('compartment', 'absent', 'assertedBy', 'recipient')
  );
  update private.pickup_credentials
  set state = 'used', used_at = coalesce(used_at, now()), delete_after = now() + interval '24 hours'
  where delivery_id = delivery_row.id and state <> 'used';
  insert into public.audit_logs(actor_type, intent, target_type, target_id, request_id, result)
  values ('recipient', 'CONFIRM_PICKUP', 'delivery', delivery_row.id, p_attempt_id, 'completed');
  perform private.broadcast_delivery_projection(delivery_row.id);
  return private.safe_delivery_projection(delivery_row.id);
end;
$$;
revoke all on function public.confirm_recipient_pickup(uuid,uuid) from public, anon, authenticated;
grant execute on function public.confirm_recipient_pickup(uuid,uuid) to service_role;

commit;
