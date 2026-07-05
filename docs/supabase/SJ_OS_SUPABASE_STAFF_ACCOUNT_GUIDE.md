# SJ OS — Supabase staff account guide

How staff accounts work with Supabase Auth + `public.profiles`. Every staff member
needs **two** linked things:

## 1. A Supabase Auth user

Create in **Authentication → Users** (email + password). This provides the login
credentials and an `auth.users.id` (UUID).

## 2. A `public.profiles` row

Insert a row whose **`id` equals the auth user's UUID**:

```sql
insert into public.profiles (id, name, role, team_id, status)
values ('<auth-user-uuid>', '이름', 'fc', '<team-uuid-or-null>', 'active');
```

- **`id` must match `auth.users.id`** — this is how SJ OS links a login to a profile.
- **`role`** controls the SJ OS menu: `owner`/`admin` (all tools), `team-leader`
  (staff + 팀 현황), `fc` (staff only). Developer/release/deployment tools stay
  owner/admin-only.
- **`status`** must be `active`. An `inactive` profile is blocked at login
  ("비활성 직원 계정입니다").

## Login behavior

1. Staff enters email/password in SJ OS (Supabase Auth mode).
2. On success, SJ OS loads the profile by auth user id.
3. The profile `role` drives role-based menu visibility.
4. If **no profile** exists → "직원 프로필이 없습니다" (login succeeds but access is
   blocked until a profile is created).
5. If the profile is **inactive** or has an **unknown role** → access is blocked with
   a clear message.

## Security

- SJ OS uses only the **anon public key**; never the service_role key.
- **RLS** restricts each user's data (owner/admin = all, team-leader = team, fc =
  own). Never disable RLS.
- Never commit real emails, passwords, UUIDs, or keys.

## Future

Owner/admin will be able to manage staff accounts from an in-app admin screen (create
profile rows, set role/team, activate/deactivate) once that screen is built. For now,
staff accounts are provisioned in the Supabase Dashboard + SQL.
