# SJ OS — Commercialization Master Plan

The execution order to take SJ OS from "feature-complete local-mock" to a staff-usable
commercial product. Companion to
[`SJ_OS_EXISTING_FEATURE_COMMERCIALIZATION_AUDIT.md`](./SJ_OS_EXISTING_FEATURE_COMMERCIALIZATION_AUDIT.md).
**No feature work in this sprint — this is the plan.**

## Principle

Everything staff-facing already exists and is role-gated + local-mock-safe. The job
now is **enable + connect + de-duplicate**, not build. Ship the smallest safe path to
real shared data first.

## What ships first (MVP go-live set)

Staff-facing, already built + Supabase-ready:
1. **로그인** (phone/password, admin-managed allowlist) — the gate.
2. **공지사항** — lowest-risk shared data; great first "it's real" signal.
3. **고객관리 · 상담기록 · 일정관리 · 출퇴근** — the daily FC workflow (all
   Supabase-connected with RLS).
4. **홈** + **자비스** — always available.

Ship these together once Supabase is live; they already share the same adapter/RLS
pattern.

## What must be hidden from staff (already enforced — keep enforced)

FC/team-leader must never see (ADMIN category → hidden + `AccessDenied` + mobile-hidden):
- 개발 자동화 / Claude 자동개발 / 개발 OS / PM 플래너 / CTO 룸
- QA 센터 / 승인 센터 / 릴리즈 센터 / DevOps 센터
- 설치파일·버전·배포 도구 / 범용 앱 빌더 / 오토파일럿
- 백로그 / AI 워커 / 프로젝트 / 활동 로그 / 시스템 설정
- Supabase/서버 상태, 직원 로그인 관리, 직원/팀 관리, 공지사항 관리

**Do not add these to the staff sidebar or mobile.** They are correctly owner/admin-only
today; the risk is regression, so guard it in review.

## What stays owner/admin only

Organization + platform control: 직원 로그인 관리, 직원 / 팀 관리, 공지사항 관리,
Supabase/서버 상태, and all developer/release/deploy centers. Owners manage on
desktop; none of it belongs on the staff mobile app.

## What needs Supabase connection (in order)

1. Already connected: auth, customers, consultations, schedules, attendance,
   announcements, staff-login, staff/team ops. → **just needs a live project + deploy.**
2. **Performance (실적)** — the one core staff feature still mock-only. Build the
   `performance_records` adapter/service + wire the pages.
3. **Home summary cards** — move from `services/mvp` mock to `services/commercial/*`.
4. Later: team-leader dashboard, fcos, sales-activity, insurance-analysis (postpone).

## What must NOT be touched yet

- The main **login flow** (works; changing it risks lockout).
- The **microphone recorder / Jarvis voice pipeline** (stable; out of scope).
- **Legacy composed pages** — do not delete; hide them only after parity verification.
- The **developer automation suite** (Claude/DevOps/Release) — it's the owner's build
  toolchain, not a staff feature; leave as-is behind admin gating.
- `.env` / secrets / service_role — never in the renderer or repo.

## Exact recommended order

1. **Sprint A — Go-live enablement (infra):** create Supabase project → run
   `SJ_OS_SUPABASE_SCHEMA.sql`, admin-phone schema/RLS, announcements schema/RLS,
   base RLS, storage policies → create first owner (`SJ_OS_SUPABASE_FIRST_OWNER_PROFILE.sql`)
   → deploy `claim-phone-account` + `request-phone-password-reset` with the
   service_role secret → `npm install @supabase/supabase-js` + switch `supabaseClient`
   to a static import → set `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` (frontend anon only).
2. **Sprint B — E2E verification:** run `STAFF_PHONE_LOGIN_E2E_TEST_GUIDE.md`; verify
   per-role RLS on customers/consultations/schedules/attendance/announcements/staff;
   confirm FC/team-leader see no admin tools on desktop + mobile.
3. **Sprint C — Performance to Supabase:** `performance_records` adapter/service +
   wire `PerformancePage`/`MobilePerformance` (mirror customer sprint), + schema/RLS.
4. **Sprint D — Home + de-dupe:** wire home summary cards to commercial services;
   make Supabase managers the sole per-route view (hide legacy workspace pages behind
   an admin/debug flag, do not delete).
5. **Sprint E — Distribution:** build the desktop installer (existing packaging
   center) + deploy the mobile PWA to Netlify (existing config) with anon env; run the
   install/update guide + rollout dashboard with real staff.
6. **Sprint F — Later features:** team-leader/owner analytics, sales-activity,
   insurance-analysis, attendance photo storage — only after the core is stable.

## Go/no-go for staff deployment

- ✅ Login works with real Supabase Auth + profile roles.
- ✅ Customers/consultations/schedules/attendance/announcements persist + RLS-scoped.
- ✅ FC/team-leader see zero developer/release/deploy tools (desktop + mobile).
- ✅ Performance connected (or explicitly labeled 준비중 for staff).
- ✅ `.env`/service_role never in renderer/repo; `npm run typecheck`, `build`,
  `build:web` all green.
