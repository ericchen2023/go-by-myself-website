begin;

revoke execute on function public.finalize_auth_assurance() from public, anon;
revoke execute on function public.get_active_delivery_projection() from public, anon;

grant execute on function public.finalize_auth_assurance() to authenticated;
grant execute on function public.get_active_delivery_projection() to authenticated;

commit;
