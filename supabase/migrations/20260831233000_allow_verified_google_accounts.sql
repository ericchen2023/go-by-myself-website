begin;

update public.profiles profile
set auth_assurance = 'pending', updated_at = now()
where profile.auth_assurance = 'app_email_verified'
  and not exists (
    select 1
    from auth.identities identity
    where identity.user_id = profile.id
      and identity.provider = 'google'
  );

create or replace function public.finalize_auth_assurance()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  identity_record auth.identities;
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
    update public.profiles
    set auth_assurance = 'pending', updated_at = now()
    where id = auth.uid() and account_status = 'active';
    return 'pending';
  end if;

  hosted_domain := identity_record.identity_data ->> 'hd';
  verified := coalesce((identity_record.identity_data ->> 'email_verified')::boolean, false);
  if verified is not true then
    raise exception 'AUTH_EMAIL_UNVERIFIED' using errcode = '42501';
  end if;

  if hosted_domain = 'gms.ndhu.edu.tw' then
    update public.profiles
    set auth_assurance = 'google_hd', updated_at = now()
    where id = auth.uid() and account_status = 'active';
    return 'google_hd';
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
