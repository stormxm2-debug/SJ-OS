-- SJ OS — Supabase Row Level Security (RLS) policy draft
-- REVIEW CAREFULLY before production use. Never disable RLS on business tables.
-- Rules: owner/admin = company-wide; team-leader = own team; fc = own records.
-- Run AFTER SJ_OS_SUPABASE_SCHEMA.sql.

-- === helper functions (SECURITY DEFINER, read profiles for the current user) ===
create or replace function public.current_user_role()
returns text language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.current_user_team_id()
returns uuid language sql stable security definer set search_path = public as $$
  select team_id from public.profiles where id = auth.uid()
$$;

create or replace function public.is_owner_or_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select public.current_user_role() in ('owner','admin')
$$;

create or replace function public.is_team_leader()
returns boolean language sql stable security definer set search_path = public as $$
  select public.current_user_role() = 'team-leader'
$$;

create or replace function public.is_fc()
returns boolean language sql stable security definer set search_path = public as $$
  select public.current_user_role() = 'fc'
$$;

-- === enable RLS on all business tables ===
alter table public.profiles            enable row level security;
alter table public.teams               enable row level security;
alter table public.attendance_records  enable row level security;
alter table public.customers           enable row level security;
alter table public.consultations       enable row level security;
alter table public.schedule_events     enable row level security;
alter table public.performance_records enable row level security;
alter table public.notices             enable row level security;

-- === profiles ===
-- Everyone can read their own profile; owner/admin can read all; team leader reads team.
create policy profiles_select on public.profiles for select using (
  id = auth.uid()
  or public.is_owner_or_admin()
  or (public.is_team_leader() and team_id = public.current_user_team_id())
);
create policy profiles_update_self on public.profiles for update using (id = auth.uid());
create policy profiles_admin_manage on public.profiles for all using (public.is_owner_or_admin())
  with check (public.is_owner_or_admin());

-- === teams === (readable by authenticated; managed by owner/admin)
create policy teams_select on public.teams for select using (auth.role() = 'authenticated');
create policy teams_admin_manage on public.teams for all using (public.is_owner_or_admin())
  with check (public.is_owner_or_admin());

-- === customers === owner/admin=all, team-leader=team (read), fc=own
-- SELECT: owner/admin see all; team-leader sees own-team rows; everyone sees own.
create policy customers_select on public.customers for select using (
  public.is_owner_or_admin()
  or (public.is_team_leader() and team_id = public.current_user_team_id())
  or owner_staff_id = auth.uid()
);
-- INSERT: a non-admin may only create rows they OWN (owner_staff_id = auth.uid()).
-- This guarantees FC inserts cannot spoof another owner. owner/admin may insert any.
create policy customers_insert on public.customers for insert with check (
  public.is_owner_or_admin() or owner_staff_id = auth.uid()
);
-- UPDATE/DELETE: owner/admin all; others only their own rows.
create policy customers_modify_own on public.customers for update using (
  public.is_owner_or_admin() or owner_staff_id = auth.uid()
) with check (
  public.is_owner_or_admin() or owner_staff_id = auth.uid()
);
create policy customers_delete_own on public.customers for delete using (
  public.is_owner_or_admin() or owner_staff_id = auth.uid()
);

-- === consultations === own staff rows; owner/admin all; team-leader team
-- SELECT: owner/admin all; own staff rows; team-leader via the customer's team_id.
create policy consultations_select on public.consultations for select using (
  public.is_owner_or_admin()
  or staff_id = auth.uid()
  or (public.is_team_leader() and exists (
        select 1 from public.customers c
        where c.id = consultations.customer_id and c.team_id = public.current_user_team_id()))
);
-- INSERT: a non-admin may only create rows they OWN (staff_id = auth.uid()); the
-- customer must be one they can see (RLS on customers already scopes selection).
create policy consultations_insert on public.consultations for insert with check (
  public.is_owner_or_admin() or staff_id = auth.uid()
);
-- UPDATE/DELETE: owner/admin all; others only their own rows.
create policy consultations_modify_own on public.consultations for update using (
  public.is_owner_or_admin() or staff_id = auth.uid()
) with check (
  public.is_owner_or_admin() or staff_id = auth.uid()
);
create policy consultations_delete_own on public.consultations for delete using (
  public.is_owner_or_admin() or staff_id = auth.uid()
);

-- === schedule_events === own staff rows; owner/admin all; team-leader team
-- SELECT: owner/admin all; own staff rows; team-leader for own-team staff OR the
-- linked customer's team.
create policy schedule_select on public.schedule_events for select using (
  public.is_owner_or_admin()
  or staff_id = auth.uid()
  or (public.is_team_leader() and (
        exists (select 1 from public.profiles p where p.id = schedule_events.staff_id and p.team_id = public.current_user_team_id())
        or exists (select 1 from public.customers c where c.id = schedule_events.customer_id and c.team_id = public.current_user_team_id())
      ))
);
-- INSERT: a non-admin may only create rows they OWN (staff_id = auth.uid()).
create policy schedule_insert on public.schedule_events for insert with check (
  public.is_owner_or_admin() or staff_id = auth.uid()
);
-- UPDATE/DELETE: owner/admin all; others only their own rows.
create policy schedule_modify_own on public.schedule_events for update using (
  public.is_owner_or_admin() or staff_id = auth.uid()
) with check (
  public.is_owner_or_admin() or staff_id = auth.uid()
);
create policy schedule_delete_own on public.schedule_events for delete using (
  public.is_owner_or_admin() or staff_id = auth.uid()
);

-- === attendance_records === own; owner/admin all; team-leader team members
create policy attendance_select on public.attendance_records for select using (
  public.is_owner_or_admin()
  or staff_id = auth.uid()
  or (public.is_team_leader() and exists (
        select 1 from public.profiles p
        where p.id = attendance_records.staff_id and p.team_id = public.current_user_team_id()))
);
-- INSERT: a staff member may only record their OWN attendance (staff_id = auth.uid()).
create policy attendance_insert on public.attendance_records for insert with check (
  public.is_owner_or_admin() or staff_id = auth.uid()
);
-- UPDATE: own rows (e.g. memo) or owner/admin. DELETE: owner/admin only (audit trail).
create policy attendance_modify_own on public.attendance_records for update using (
  public.is_owner_or_admin() or staff_id = auth.uid()
) with check (
  public.is_owner_or_admin() or staff_id = auth.uid()
);
create policy attendance_delete_admin on public.attendance_records for delete using (
  public.is_owner_or_admin()
);

-- === performance_records === own; owner/admin all; team-leader team
create policy performance_select on public.performance_records for select using (
  public.is_owner_or_admin()
  or staff_id = auth.uid()
  or (public.is_team_leader() and team_id = public.current_user_team_id())
);
create policy performance_write_own on public.performance_records for all using (
  public.is_owner_or_admin() or staff_id = auth.uid()
) with check (
  public.is_owner_or_admin() or staff_id = auth.uid()
);

-- === notices === authenticated users read notices targeted to their role (or all);
-- owner/admin create/update.
create policy notices_select on public.notices for select using (
  auth.role() = 'authenticated'
  and (
    cardinality(target_roles) = 0
    or public.current_user_role() = any(target_roles)
    or public.is_owner_or_admin()
  )
);
create policy notices_admin_manage on public.notices for all using (public.is_owner_or_admin())
  with check (public.is_owner_or_admin());

-- NOTE: These policies are a DRAFT. Review team-scoping, insert paths, and
-- edge cases (e.g. reassignment) against your real org before production.
