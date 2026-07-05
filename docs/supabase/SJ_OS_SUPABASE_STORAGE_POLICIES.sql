-- SJ OS — Supabase Storage policy DRAFT for attendance photos
-- ⚠️ PRODUCTION REVIEW REQUIRED. This is a starting point, NOT production-ready.
-- The app DEFERS photo upload this sprint; apply these only when you enable it.
--
-- Bucket: attendance-photos  (PRIVATE — never public)
-- Convention: object path is prefixed with the owner's auth uid, e.g.
--   attendance-photos/<auth-uid>/<yyyy-mm-dd>/<uuid>.jpg
-- so ownership can be derived from the first path segment.

-- 1) Create a PRIVATE bucket (Dashboard → Storage, or SQL below). Not public.
insert into storage.buckets (id, name, public)
values ('attendance-photos', 'attendance-photos', false)
on conflict (id) do nothing;

-- 2) RLS on storage.objects is enabled by Supabase. Add scoped policies:

-- INSERT: an authenticated user may upload only under their OWN uid prefix.
create policy attendance_photo_insert on storage.objects for insert to authenticated
with check (
  bucket_id = 'attendance-photos'
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- SELECT own: a user may read their own photos.
create policy attendance_photo_select_own on storage.objects for select to authenticated
using (
  bucket_id = 'attendance-photos'
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- SELECT owner/admin: full read across the bucket.
create policy attendance_photo_select_admin on storage.objects for select to authenticated
using (
  bucket_id = 'attendance-photos'
  and public.is_owner_or_admin()
);

-- SELECT team-leader: read photos owned by their team members.
-- (Maps the path's uid prefix to profiles.team_id.)
create policy attendance_photo_select_team on storage.objects for select to authenticated
using (
  bucket_id = 'attendance-photos'
  and public.is_team_leader()
  and exists (
    select 1 from public.profiles p
    where p.id::text = (storage.foldername(name))[1]
      and p.team_id = public.current_user_team_id()
  )
);

-- NOTE: never make this bucket public. Review path conventions, size limits, and
-- content-type restrictions before production. The service_role key is NEVER used
-- from the renderer.
