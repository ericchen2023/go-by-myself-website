begin;

create or replace function private.is_active_operator(required_role text default 'operator')
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.user_roles role
    join public.profiles profile on profile.id = role.user_id
    where role.user_id = auth.uid()
      and role.role in (required_role, 'admin')
      and role.revoked_at is null
      and profile.account_status = 'active'
      and profile.auth_assurance in ('google_hd', 'app_email_verified')
  );
$$;
revoke all on function private.is_active_operator(text) from public, anon, authenticated;
grant usage on schema private to authenticated;
grant execute on function private.is_active_operator(text) to authenticated;

commit;
