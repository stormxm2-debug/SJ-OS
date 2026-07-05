-- SJ OS — admin phone login RLS DRAFT. REVIEW before production.
-- CRITICAL: never expose the full registered-phone list to anon/FC. Never disable RLS.
-- Run AFTER SJ_OS_SUPABASE_ADMIN_PHONE_LOGIN_SCHEMA.sql and the base RLS helpers
-- (current_user_role / current_user_team_id / is_owner_or_admin / is_team_leader).

alter table public.staff_login_accounts    enable row level security;
alter table public.password_reset_requests enable row level security;

-- === staff_login_accounts ===
-- SELECT: owner/admin see all; team-leader sees ONLY their own team (never other
-- teams' phone numbers). FC/anon get NO list access.
create policy staff_login_select_admin on public.staff_login_accounts for select to authenticated
using ( public.is_owner_or_admin() );

create policy staff_login_select_team on public.staff_login_accounts for select to authenticated
using ( public.is_team_leader() and team_id = public.current_user_team_id() );

-- INSERT/UPDATE: owner/admin ONLY. Team-leaders CANNOT create or manage accounts in
-- this sprint (no insert/update policy grants them access). FC has no access at all.
create policy staff_login_insert_admin on public.staff_login_accounts for insert to authenticated
with check ( public.is_owner_or_admin() );

create policy staff_login_update_admin on public.staff_login_accounts for update to authenticated
using ( public.is_owner_or_admin() ) with check ( public.is_owner_or_admin() );

-- NOTE: the login-time "is this phone registered / password set?" check must NOT be
-- a public SELECT (that would leak the phone list). Do it inside a SECURITY DEFINER
-- RPC or the server Edge Function that returns only a minimal gate result — never the
-- full row set. See SUPABASE_PHONE_LOGIN_EDGE_FUNCTION_PLAN.md.

-- === password_reset_requests ===
-- INSERT: prefer a SECURITY DEFINER function / Edge Function so anon cannot enumerate.
-- SELECT/UPDATE (approve): owner/admin only.
create policy reset_select_admin on public.password_reset_requests for select to authenticated
using ( public.is_owner_or_admin() );

create policy reset_update_admin on public.password_reset_requests for update to authenticated
using ( public.is_owner_or_admin() ) with check ( public.is_owner_or_admin() );

-- Do NOT add a public/anon "for select using (true)" policy on either table.
