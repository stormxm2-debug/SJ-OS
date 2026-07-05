# Supabase setup guide (SJ OS commercial MVP)

Follow these steps to move SJ OS from local-mock to a shared Supabase backend. The
app stays fully usable in local-mock mode until this is done. **The renderer uses
only the public anon key — never the service_role key.**

## 1. Create a Supabase project

1. Go to https://supabase.com → create a new project.
2. Choose a strong database password (store it in your own password manager — **do
   not put it in the app**).

## 2. Copy the public config (anon key only)

In **Project Settings → API**, copy:

- **Project URL** → `VITE_SUPABASE_URL`
- **anon public** key → `VITE_SUPABASE_ANON_KEY`

> ⚠️ Do **NOT** copy the **service_role** key into the app. It bypasses RLS and must
> never reach the renderer or the repo.

## 3. Apply the database schema

Open **SQL Editor** and run `docs/supabase/SJ_OS_SUPABASE_SCHEMA.sql`.
This creates: profiles, teams, attendance_records, customers, consultations,
schedule_events, performance_records, notices.

## 4. Apply the RLS policies

Run `docs/supabase/SJ_OS_SUPABASE_RLS_POLICIES.sql`. This **enables RLS** on every
business table and creates the helper functions + policies (owner/admin = all,
team-leader = team, fc = own). **Review the policies before production.**

## 5. Create the first owner account

1. **Authentication → Users → Add user** (email + password) for the 대표.
2. In **SQL Editor**, add the matching profile row:
   ```sql
   insert into public.profiles (id, name, role, status)
   values ('<auth-user-uuid>', '김세종', 'owner', 'active');
   ```
3. Repeat for staff (role `team-leader` / `fc`, with `team_id` as needed).

## 6. Configure the app locally (do not commit)

Set these in your local environment (e.g. a local `.env` file that is **git-ignored**
— this repo/sprint does not create or edit it for you):

```
VITE_SUPABASE_URL=https://<your-project>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon public key>
```

**Never commit these values.** Only the anon key belongs here — never service_role.

## 7. Restart the app

Restart `npm run dev` so Vite picks up the env variables.

## 8. Verify

Log in as 대표/관리자 → home → **Supabase 연결 상태** panel. Confirm 현재 모드 shows
`supabase`, URL/anon key `설정됨`, service role `사용 금지`, and run **연결 테스트**.

> Enabling the live client also requires `npm install @supabase/supabase-js` and
> wiring `getSupabaseClientOrNull()` (see the TODO in `supabaseClient.ts`). Until
> then the app reports config status but stays in local-mock for data.
