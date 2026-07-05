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

### 첫 대표 계정 생성 절차

1. Supabase Dashboard → **Authentication → Users**.
2. **Add user** with the representative's email + password (a strong password; do
   **not** put it in the app or repo).
3. Copy the created user's **auth user id** (UUID).
4. In **SQL Editor**, insert the matching profile row (see
   `SJ_OS_SUPABASE_FIRST_OWNER_PROFILE.sql`):
   ```sql
   insert into public.profiles (id, name, role, status)
   values ('<auth-user-uuid>', '김세종 대표', 'owner', 'active');
   ```
5. Run the app with `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` configured.
6. Log in from SJ OS with the owner email/password.
7. Confirm the role-based **owner** menu appears (full sidebar + admin tools).

Repeat for staff (role `team-leader` / `fc`, with `team_id` as needed) — see
`SJ_OS_SUPABASE_STAFF_ACCOUNT_GUIDE.md`.

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

## 9. 고객관리 연결 테스트

1. Supabase Auth로 대표 계정 로그인.
2. profiles role이 `owner`로 인식되는지 확인 (전체 메뉴 표시).
3. 사이드바에서 **고객관리** 진입.
4. **고객 등록**으로 테스트 고객 1명 등록.
5. Supabase → Table Editor → `customers` 테이블에 행이 저장됐는지 확인.
6. FC 계정으로 로그인 → 고객관리에서 **자기 고객만** 보이는지 확인.
7. 팀장 계정으로 로그인 → **팀 고객** 조회 확인 (team_id/RLS 적용 시).
8. 대표 계정으로 로그인 → **전체 고객** 조회 확인.
9. 고객 상태/메모 수정 후 `updated_at`이 갱신되는지 확인.

> 데이터 모드 배지가 **Supabase 공용 DB**로 표시되면 실제 DB를 사용 중입니다. **로컬 MVP
> 데이터**로 표시되면 아직 Supabase가 연결되지 않은 것입니다. 실제 접근 제한은 항상 RLS가
> 적용합니다(클라이언트 필터는 UX 보조용).

## 10. 상담기록 연결 테스트

1. Supabase Auth로 대표 계정 로그인.
2. 고객관리에서 테스트 고객 1명 등록.
3. 사이드바에서 **상담기록** 진입.
4. 테스트 고객 선택.
5. **첫 상담** 기록 작성 후 저장.
6. Supabase → Table Editor → `consultations` 테이블에 행 저장 확인.
7. FC 계정으로 로그인 → **자기 상담기록만** 보이는지 확인 (staff_id = auth.uid()).
8. 팀장 계정으로 로그인 → **팀 상담기록** 조회 확인 (고객 team_id/RLS 적용 시).
9. 대표 계정으로 로그인 → **전체 상담기록** 조회 확인.
10. 상태를 완료로 변경 → `completed_at`/`updated_at` 갱신 확인.
