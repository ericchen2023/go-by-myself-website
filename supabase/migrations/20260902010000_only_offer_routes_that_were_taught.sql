-- 只開放實際示教過的站點組合。
--
-- 車上只有八段示教路線（A_B、B_A、B_C、C_B、C_D、D_C、A_D、D_A），對應到
-- 四組站點：LIBRARY↔HSS2、HSS2↔HSS1、HSS1↔ADMIN、LIBRARY↔ADMIN。
-- 剩下的兩組 —— LIBRARY↔HSS1 與 HSS2↔ADMIN —— 沒有地圖，也沒有路徑。
--
-- 這不是偏好設定，是硬事實：讓人選一個沒有路可走的組合，就是讓他一路填到
-- 派車那一步才發現走不了。
--
-- 用 trigger 而不是改 create_and_confirm_delivery：那個名字現在屬於一層包著
-- idempotency 防護的 wrapper，照舊名重寫會把防護蓋掉（見 20260901080000 的
-- 同一段註解）。而且 trigger 擋的是所有寫入路徑，不只那一支函式。
begin;

create table if not exists public.serviceable_stop_pairs (
  from_stop_code text not null,
  to_stop_code text not null,
  leg_id text not null,
  taught_at date,
  note text not null default '',
  primary key (from_stop_code, to_stop_code)
);
comment on table public.serviceable_stop_pairs is
  '實際示教過、車上有 .stcm 與 plan 的站點組合。沒列在這裡就沒有路可走。';

insert into public.serviceable_stop_pairs(from_stop_code, to_stop_code, leg_id, note) values
  ('LIBRARY', 'HSS2',    'A_B', '圖資中心 → 人社二館'),
  ('HSS2',    'LIBRARY', 'B_A', '人社二館 → 圖資中心'),
  ('HSS2',    'HSS1',    'B_C', '人社二館 → 人社一館'),
  ('HSS1',    'HSS2',    'C_B', '人社一館 → 人社二館'),
  ('HSS1',    'ADMIN',   'C_D', '人社一館 → 行政大樓'),
  ('ADMIN',   'HSS1',    'D_C', '行政大樓 → 人社一館'),
  ('LIBRARY', 'ADMIN',   'A_D', '圖資中心 → 行政大樓'),
  ('ADMIN',   'LIBRARY', 'D_A', '行政大樓 → 圖資中心')
on conflict (from_stop_code, to_stop_code) do nothing;

create or replace function private.reject_unserviceable_stop_pair()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  from_code text;
  to_code text;
begin
  select code into from_code from public.delivery_locations where id = new.pickup_location_id;
  select code into to_code from public.delivery_locations where id = new.dropoff_location_id;
  if not exists (
    select 1 from public.serviceable_stop_pairs
    where from_stop_code = from_code and to_stop_code = to_code
  ) then
    raise exception 'STOP_PAIR_NOT_SERVICEABLE';
  end if;
  return new;
end;
$$;
revoke all on function private.reject_unserviceable_stop_pair() from public, anon, authenticated;
drop trigger if exists deliveries_reject_unserviceable_pair on public.deliveries;
create trigger deliveries_reject_unserviceable_pair
before insert on public.deliveries
for each row execute function private.reject_unserviceable_stop_pair();

-- 給畫面用：哪些組合走得了。這不是機密 —— 它就是「本服務目前開哪幾條線」。
create or replace function public.get_serviceable_stop_pairs()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'fromStopCode', pair.from_stop_code,
    'toStopCode', pair.to_stop_code
  ) order by pair.from_stop_code, pair.to_stop_code), '[]'::jsonb)
  from public.serviceable_stop_pairs pair;
$$;
revoke all on function public.get_serviceable_stop_pairs() from public;
grant execute on function public.get_serviceable_stop_pairs() to anon, authenticated, service_role;

alter table public.serviceable_stop_pairs enable row level security;

commit;
