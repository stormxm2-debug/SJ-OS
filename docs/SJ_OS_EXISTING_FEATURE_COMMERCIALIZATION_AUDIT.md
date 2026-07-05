# SJ OS — Existing Feature Commercialization Audit

Snapshot of what already exists in SJ OS, its data source, role visibility,
mobile/desktop readiness, Supabase status, duplicates, and the keep/hide/connect
decision. **Audit only — no features were added, removed, or rewritten.**

Baseline commit at audit time: `d4b11f9`. Routes are defined in
`src/renderer/src/components/Router.tsx`; role visibility in
`src/renderer/src/navigation/roleAccess.ts` (STAFF / TEAM / admin categories);
mobile routing in `src/renderer/src/components/layout/MobileShell.tsx`.

## Route categories (source of truth)

- **STAFF (all roles):** `staff-home, attendance, customer, consultation, schedule,
  performance, sales-activity, insurance-analysis, notice, fcos, assistant`
- **TEAM (team-leader + admin):** `team-leader`
- **ADMIN (owner/admin only; hidden on mobile):** everything else — `company,
  dashboard, app-builder, devprompt, cto, qa, release, devops, autopilot, devos, pm,
  backlog, workers, worker, projects, approvals, activity, settings, staff-login,
  staff-team, announcements`

`Router` calls `canAccessRoute(role, route)`; a non-permitted route renders
`AccessDenied` (no crash). `MobileShell` treats any ADMIN-category route as blocked
for **every** role.

## Business feature inventory

| Feature | Route | Main component(s) | Roles | Mobile | Data source | Status | Decision |
|---|---|---|---|---|---|---|---|
| 로그인 (phone/password) | (login gate) | `LoginScreen`, `SessionContext`, `phoneAuthService`, `supabaseAuth` | all | ✅ | Supabase Auth + local registry / local-demo | working | keep |
| 홈 (staff) | `staff-home` | `StaffMvpDashboard` + `StaffHomePage` (composed) | all | ✅ | mock (services/mvp) + announcements widget | working | keep; connect summaries later |
| 출퇴근 | `attendance` | `SupabaseAttendanceManager` + `AttendancePage` | all | ✅ | **Supabase** `attendance_records` / local-mock | working | keep (Supabase) |
| 고객관리 | `customer` | `SupabaseCustomerManager` + `CustomerWorkspacePage` | all | ✅ | **Supabase** `customers` / local-mock | working | keep (Supabase); dedupe workspace |
| 상담기록 | `consultation` | `SupabaseConsultationManager` + `ConsultationPage` | all | ✅ | **Supabase** `consultations` / local-mock | working | keep (Supabase); dedupe |
| 일정관리 | `schedule` | `SupabaseScheduleManager` + `SchedulePage` | all | ✅ | **Supabase** `schedule_events` / local-mock | working | keep (Supabase); dedupe |
| 실적관리 | `performance` | `PerformancePage` (desktop) / `MobilePerformance` | all | ✅ | **mock only** (services/mvp) | partial | **connect to Supabase** |
| 공지사항 (staff) | `notice` | `NoticePage` | all | ✅ | **Supabase** `announcements`/`_reads` / local-mock | working | keep (Supabase) |
| 공지사항 관리 | `announcements` | `AnnouncementAdminPage` | owner/admin | ❌ | **Supabase** / local-mock | working | owner/admin only |
| 직원 로그인 관리 | `staff-login` | `StaffLoginAdminPage` | owner/admin | ❌ | **Supabase** `staff_login_accounts` / local | working | owner/admin only |
| 직원 / 팀 관리 | `staff-team` | `StaffTeamManagementPage` | owner/admin | ❌ | **Supabase** `teams`/`profiles`/`staff_login_accounts` / local | working | owner/admin only |
| Supabase/서버 상태 | (home panel) | `ServerDbStatusPanel` | owner/admin | ❌ | env/config status | working | owner/admin only |
| 자비스 | `assistant` + panel | `CommandCenterPage`, `JarvisPanel` | all | ✅ | main-process AI gateway | working | keep |
| 팀 현황 | `team-leader` | `TeamLeaderPage` | team-leader/admin | ❌ | mock | partial | keep; connect later |
| 내 업무 | `fcos` | `FcOsPage` | all | ❌ (mobile) | mock | partial | postpone/keep |
| 영업활동 | `sales-activity` | `SalesActivityWorkspacePage` | all | ❌ | mock/local | partial | postpone |
| 보험분석 | `insurance-analysis` | `InsuranceAnalysisPage` | all | ❌ | mock/local | partial | postpone |

## Owner/admin + developer tools (ADMIN category — FC/team-leader blocked)

| Feature | Route | Component | Data | Status | Decision |
|---|---|---|---|---|---|
| CEO 대시보드 | `dashboard` | `Dashboard` | mock | working | owner/admin only |
| 라이브 컴퍼니 | `company` | `LiveCompanyPage` | kernel/mock | working | owner/admin only |
| 오토파일럿 | `autopilot` | `AutopilotPage` | local/file | working | owner/admin only |
| 범용 앱 빌더 | `app-builder` | `UniversalAppBuilderPage` | main/Claude | working | owner/admin only |
| 개발 프롬프트 센터 | `devprompt` | `DeveloperPromptCenterPage` | main/Claude | working | owner/admin only |
| 개발 OS | `devos` | `DevelopmentOsPage` | local | working | owner/admin only |
| PM 플래너 | `pm` | `PmPlannerPage` | local | working | owner/admin only |
| CTO 룸 | `cto` | `CtoRoomPage` | local | working | owner/admin only |
| 승인 센터 | `approvals` | `ApprovalCenterPage` | local | working | owner/admin only |
| QA 센터 | `qa` | `QaCenterPage` | local | working | owner/admin only |
| 릴리즈 센터 | `release` | `ReleaseCenterPage` (+ deploy/package/dist/install/snapshot panels) | main/git/fs | working | owner/admin only |
| DevOps 센터 | `devops` | `DevOpsCenterPage` | main | working | owner/admin only |
| 제품 백로그 | `backlog` | `ProductBacklogPage` | localStorage | working | owner/admin only |
| AI 워커 | `workers`/`worker` | `WorkersPage`/`WorkerDetailPage` | kernel | working | owner/admin only |
| 프로젝트 | `projects` | `ProjectManagerPage` | local | working | owner/admin only |
| 활동 로그 | `activity` | `CompanyActivityLogPage` | local | working | owner/admin only |
| 설정 | `settings` | `CompanySettingsPage` | local | working | owner/admin only |

All of the above are **already hidden** from FC/team-leader (ADMIN category → not in
the staff sidebar, `AccessDenied` on direct route, hidden on mobile).

## Data source summary

- **Supabase-connected (with local-mock fallback + schema/RLS docs):** login/auth,
  customers, consultations, schedules, attendance, announcements, staff-login
  accounts, staff/team operations.
- **Mock/local only (needs Supabase):** performance (실적), team-leader dashboard,
  fcos, sales-activity, insurance-analysis, staff-home summary cards.
- **Local/file/kernel (developer tools, owner/admin):** all Claude/DevOps/Release/
  backlog/worker/PM/CTO/QA centers — intentionally not staff-facing.

## Duplicate / composed-page warnings (do NOT delete now)

The Supabase business screens are **composed on top of the older mock workspace
pages** (the new manager renders first, the legacy page renders below):

| Route | Main (canonical) | Legacy composed below | Recommendation |
|---|---|---|---|
| `customer` | `SupabaseCustomerManager` | `CustomerWorkspacePage` | make manager the only view; retire legacy after parity check |
| `consultation` | `SupabaseConsultationManager` | `ConsultationPage` | same |
| `schedule` | `SupabaseScheduleManager` | `SchedulePage` | same |
| `attendance` | `SupabaseAttendanceManager` | `AttendancePage` | same |
| `staff-home` | `StaffMvpDashboard` | `StaffHomePage` | keep dashboard; trim legacy home |
| `performance` | `PerformancePage` (desktop) / `MobilePerformance` (mobile) | — | unify + connect Supabase |

Other duplication: **two notice data sources** historically — `services/mvp`
`noticeService` (static mock) vs the new `announcementService` (Supabase). Home
widgets now use `announcementService`; `services/mvp.noticeService` is effectively
legacy (still exported, low risk). **Two staff-service layers:** `services/mvp`
(sync summary mock used by home cards) and `services/commercial/*` (the real
Supabase-backed services) — the commercial layer is canonical for business data.

## Mobile / desktop readiness

- **Mobile PWA (staff):** home, 출퇴근, 고객, 상담, 일정, 실적, 공지, 자비스 render via
  `MobileShell` (bottom tabs + 더보기). Admin routes are hidden/blocked on mobile.
- **Desktop Electron:** full sidebar for owner/admin; staff-filtered sidebar for
  FC/team-leader. Both build green (electron `out/` + web `dist/`).

## Biggest blockers before staff deployment

1. **Live Supabase not connected** — everything runs local-mock until a project is
   created, SQL/RLS applied, Edge Functions deployed, and `@supabase/supabase-js`
   installed with a static import (currently a guarded dynamic import → null).
2. **Performance (실적) is mock-only** — no adapter/table; the only core staff feature
   not yet Supabase-connected.
3. **Composed legacy pages** under the Supabase managers may confuse staff (two
   customer/consultation/schedule/attendance surfaces on one route).
4. **Home summary cards use mock** (`services/mvp`) — numbers won't reflect real
   Supabase data even after go-live until wired.
5. **First-owner bootstrap + Edge Function deploy** are manual and untested against a
   real project (claim/reset functions, storage bucket for attendance photos).

## Recommended next 5 implementation steps

1. **Go-live enablement:** create the Supabase project, run all SQL/RLS, deploy the
   two Edge Functions, install `@supabase/supabase-js` + static import, set anon env.
2. **Connect performance (실적)** — Supabase `performance_records` adapter/service +
   wire `PerformancePage`/`MobilePerformance` (mirror the customer pattern).
3. **De-compose legacy pages** — make the Supabase managers the sole view per route
   (hide the legacy workspace pages behind an admin/debug flag; do not delete).
4. **Wire home summaries** to `services/commercial/*` so dashboard cards reflect real
   data (replace `services/mvp` reads).
5. **E2E hardening** — run `STAFF_PHONE_LOGIN_E2E_TEST_GUIDE.md` against the real
   project; verify RLS per role on every table.
