begin;

create index if not exists deliveries_pickup_location_idx
  on public.deliveries(pickup_location_id);
create index if not exists deliveries_dropoff_location_idx
  on public.deliveries(dropoff_location_id);
create index if not exists deliveries_route_graph_version_idx
  on public.deliveries(route_graph_version_id);
create index if not exists deliveries_vehicle_idx
  on public.deliveries(vehicle_id);
create index if not exists delivery_progress_route_job_idx
  on public.delivery_progress_current(route_job_id);
create index if not exists robot_faults_delivery_idx
  on public.robot_faults(delivery_id);
create index if not exists robot_faults_route_job_idx
  on public.robot_faults(route_job_id);
create index if not exists route_job_legs_command_idx
  on public.route_job_legs(command_id);
create index if not exists route_jobs_route_graph_version_idx
  on public.route_jobs(route_graph_version_id);
create index if not exists support_requests_delivery_idx
  on public.support_requests(delivery_id);
create index if not exists vehicle_commands_delivery_idx
  on public.vehicle_commands(delivery_id);
create index if not exists vehicle_commands_route_job_idx
  on public.vehicle_commands(route_job_id);
create index if not exists vehicle_state_current_route_job_idx
  on public.vehicle_state_current(current_route_job_id);
create index if not exists vehicle_telemetry_route_job_idx
  on public.vehicle_telemetry(route_job_id);

drop policy profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
for select to authenticated using (id = (select auth.uid()));

drop policy deliveries_select_own on public.deliveries;
create policy deliveries_select_own on public.deliveries
for select to authenticated using (sender_id = (select auth.uid()));

drop policy delivery_history_select_own on public.delivery_status_history;
create policy delivery_history_select_own on public.delivery_status_history
for select to authenticated using (exists (
  select 1 from public.deliveries delivery
  where delivery.id = delivery_id and delivery.sender_id = (select auth.uid())
));

drop policy delivery_progress_select_own on public.delivery_progress_current;
create policy delivery_progress_select_own on public.delivery_progress_current
for select to authenticated using (exists (
  select 1 from public.deliveries delivery
  where delivery.id = delivery_id and delivery.sender_id = (select auth.uid())
));

drop policy vehicle_commands_select_safe_own on public.vehicle_commands;
create policy vehicle_commands_select_safe_own on public.vehicle_commands
for select to authenticated using (exists (
  select 1 from public.deliveries delivery
  where delivery.id = delivery_id and delivery.sender_id = (select auth.uid())
));

drop policy notifications_select_own on public.notifications;
create policy notifications_select_own on public.notifications
for select to authenticated using (exists (
  select 1 from public.deliveries delivery
  where delivery.id = delivery_id and delivery.sender_id = (select auth.uid())
));

drop policy robot_faults_select_own on public.robot_faults;
create policy robot_faults_select_own on public.robot_faults
for select to authenticated using (delivery_id is not null and exists (
  select 1 from public.deliveries delivery
  where delivery.id = delivery_id and delivery.sender_id = (select auth.uid())
));

drop policy support_requests_select_own on public.support_requests;
create policy support_requests_select_own on public.support_requests
for select to authenticated using (
  creator_id = (select auth.uid()) or exists (
    select 1 from public.deliveries delivery
    where delivery.id = delivery_id and delivery.sender_id = (select auth.uid())
  )
);

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
    where role.user_id = (select auth.uid())
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
