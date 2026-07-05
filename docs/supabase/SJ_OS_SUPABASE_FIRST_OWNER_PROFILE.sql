-- SJ OS — first owner profile (template only; NO real ids/emails/passwords)
-- Prerequisite: create the owner in Supabase Dashboard → Authentication → Users,
-- then copy that user's UUID (auth.users.id) and paste it below.

-- Replace this UUID with the auth.users.id of the owner account:
insert into public.profiles (id, name, role, status)
values ('00000000-0000-0000-0000-000000000000', '김세종 대표', 'owner', 'active');

-- ---------------------------------------------------------------------------
-- Team setup example (comments only — adjust as needed):
--
-- 1) create a team:
-- insert into public.teams (name, leader_id)
-- values ('1팀', '00000000-0000-0000-0000-000000000000');
--
-- 2) create a team-leader profile (auth user must exist first):
-- insert into public.profiles (id, name, role, team_id, status)
-- values ('<leader-auth-uuid>', '오창연 팀장', 'team-leader', '<team-uuid>', 'active');
--
-- 3) create an FC profile (auth user must exist first):
-- insert into public.profiles (id, name, role, team_id, status)
-- values ('<fc-auth-uuid>', '일반 FC', 'fc', '<team-uuid>', 'active');
-- ---------------------------------------------------------------------------
-- Never commit real UUIDs, emails, or passwords into the repo.
