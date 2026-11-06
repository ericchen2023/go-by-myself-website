-- 驗證等級不再依特定學校網域判斷。
--
-- 先前 finalize_auth_assurance() 會把某一校的 Google Workspace 網域另標為
-- google_hd；但產品決策早已是「任何已驗證 Google 帳號皆可使用」，而 RLS 也把
-- google_hd 與 app_email_verified 視為同等。這裡移除網域特判，讓網站不再寫死
-- 任何校名或網域。既有的 google_hd 資料列維持有效，不需回填。
begin;

create or replace function public.finalize_auth_assurance()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  identity_record auth.identities;
  verified boolean;
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
    update public.profiles
    set auth_assurance = 'pending', updated_at = now()
    where id = auth.uid() and account_status = 'active';
    return 'pending';
  end if;

  verified := coalesce((identity_record.identity_data ->> 'email_verified')::boolean, false);
  if verified is not true then
    raise exception 'AUTH_EMAIL_UNVERIFIED' using errcode = '42501';
  end if;


  update public.profiles
  set auth_assurance = 'app_email_verified', updated_at = now()
  where id = auth.uid() and account_status = 'active';
  return 'app_email_verified';
end;
$$;

revoke all on function public.finalize_auth_assurance() from public, anon;
grant execute on function public.finalize_auth_assurance() to authenticated;

commit;
