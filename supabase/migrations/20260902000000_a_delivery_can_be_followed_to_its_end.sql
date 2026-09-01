-- 讓寄件人的畫面看得到自己那筆投遞的結局。
--
-- get_active_delivery_projection 刻意排除所有終態，所以投遞一結束，畫面就再也
-- 問不到它 —— 前端只好把它當成「不存在」而清掉，於是寄件人從第七步被丟回表單，
-- 完成畫面沒人看得到，連收件人頁都會因為找不到那筆而顯示「找不到取件資訊」。
--
-- 這支只回傳自己的投遞，終態也照給。它不取代 get_active_delivery_projection：
-- 那支回答「我現在有沒有在進行的投遞」，這支回答「這一筆後來怎麼了」。
begin;

create or replace function public.get_delivery_projection(p_delivery_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner uuid;
begin
  if auth.uid() is null then raise exception 'RLS_DENIED' using errcode = '42501'; end if;
  select sender_id into owner from public.deliveries where id = p_delivery_id;
  if owner is null or owner <> auth.uid() then
    raise exception 'RLS_DENIED' using errcode = '42501';
  end if;
  return private.safe_delivery_projection(p_delivery_id);
end;
$$;
revoke all on function public.get_delivery_projection(uuid) from public, anon;
grant execute on function public.get_delivery_projection(uuid) to authenticated;

commit;
