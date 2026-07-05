-- SJ OS — announcements RLS DRAFT. REVIEW before production. Never disable RLS,
-- never add a public-read policy. Requires base helpers (current_user_role,
-- current_user_team_id, is_owner_or_admin).

alter table public.announcements      enable row level security;
alter table public.announcement_reads enable row level security;

-- === announcements ===
-- SELECT: owner/admin see ALL; staff see ONLY published rows targeted to them.
-- (draft/hidden/archived are never visible to staff.)
create policy announcements_select on public.announcements for select to authenticated
using (
  public.is_owner_or_admin()
  or (
    status = 'published'
    and (
      target_type = 'all'
      or (target_type = 'role' and target_role = public.current_user_role())
      or (target_type = 'team' and target_team_id = public.current_user_team_id())
    )
  )
);

-- INSERT/UPDATE/DELETE: owner/admin ONLY. FC/team-leader cannot author company notices.
create policy announcements_insert_admin on public.announcements for insert to authenticated
with check ( public.is_owner_or_admin() );
create policy announcements_update_admin on public.announcements for update to authenticated
using ( public.is_owner_or_admin() ) with check ( public.is_owner_or_admin() );
create policy announcements_delete_admin on public.announcements for delete to authenticated
using ( public.is_owner_or_admin() );

-- === announcement_reads ===
-- A user may read/insert/update ONLY their OWN read records. Owner/admin can read all.
create policy reads_select_own on public.announcement_reads for select to authenticated
using ( profile_id = auth.uid() or public.is_owner_or_admin() );
create policy reads_insert_own on public.announcement_reads for insert to authenticated
with check ( profile_id = auth.uid() );
create policy reads_update_own on public.announcement_reads for update to authenticated
using ( profile_id = auth.uid() ) with check ( profile_id = auth.uid() );

-- Do NOT add a public/anon "for select using (true)" policy. Staff cannot mark reads
-- for other users (profile_id must equal auth.uid()).
