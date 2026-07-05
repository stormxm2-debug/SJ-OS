# Staff commercial MVP foundation

Turns SJ OS into something insurance-company staff can use immediately, with a
simple role-based interface — **without removing any existing developer/automation
feature**. Those tools are simply protected behind owner/admin access.

## Purpose

Give staff (FC / 팀장) a clean, company-app experience (home / attendance /
customers / consultations / schedule / performance / notices / 자비스), while the
business owner and admins keep full access to everything built so far (Claude auto
build, release, deploy, packaging, distribution, etc.).

## Roles

`UserRole` = `owner` (대표) · `admin` (관리자) · `team-leader` (팀장) · `fc` (FC).
Defined in `navigation/roleAccess.ts`; the current user lives in
`navigation/SessionContext.tsx` (`UserSession`).

## Menu visibility

`roleAccess.ts` classifies every route as **staff**, **team**, or **admin**:

- **FC** sees only staff routes: 홈 · 출퇴근 · 고객관리 · 상담기록 · 일정관리 · 실적관리 ·
  공지사항 · 자비스.
- **팀장** sees the staff routes **plus** 팀 현황.
- **대표/관리자** see everything — the full existing sidebar (업무 홈, 고객·상담,
  영업활동, AI 업무지원, 관리자·개발) and the CEO/직원 mode toggle, unchanged.

The sidebar renders the staff MVP menu for FC/팀장 and the full grouped menu for
owner/admin. Nothing was deleted; developer/release/deployment menus are just not
listed for non-admin roles.

## Route guard (no crash)

`Router` calls `canAccessRoute(role, routeName)`. If a non-admin role reaches an
admin/team-only route (e.g. a persisted `release` route from a prior owner
session), it renders an **AccessDenied** card ("접근 권한이 없습니다 … 대표/관리자
권한에서만 사용할 수 있습니다") with a 홈으로 이동 button — never a blank screen.

## Local login / session shell

`SessionContext` holds the signed-in user in `localStorage`. The default is 김세종
대표 (pre-logged-in), so existing full-access behavior is preserved. **로그아웃** shows
the `LoginScreen`, a local demo picker (김세종 대표 / 오창연 팀장 / 박상원 팀장 / 일반 FC /
관리자). Owner/admin also get a compact **역할 전환 (개발용)** switcher in the sidebar
footer. **This is not production authentication** — it's a local shell for testing
staff UI.

## Staff home dashboard

`StaffMvpDashboard` (shown atop 홈) is role-aware:

- **FC**: 오늘 출근 상태 · 오늘 상담 일정 · 미처리 고객 · 이번 달 실적 · 공지사항 · 자비스 빠른 실행.
- **팀장**: 내 출근 상태 · 팀 출근 현황 · 미처리 고객 · 팀 실적 달성률 · 팀원 현황 · 공지 · 자비스.
- **대표**: 전체 출근 현황 · 전체 실적 · 고객 진행률 · 개발/릴리즈 요약 · 팀별 현황 · 자비스.

자비스 stays available to all roles; the quick-launch examples adapt to the role.

## What is still mock / local

Everything staff-facing uses `services/mvp/` (authService, staffService,
customerService, attendanceService, performanceService, noticeService) which return
**local mock data**, clearly labelled **"상용 MVP 로컬 데이터"**. Each function carries a
`Future: replace with server API` TODO.

## Backend not connected

No backend server or database is connected in this sprint, and no external auth
provider was added. The service boundaries are the clean seam for that next step.

## Existing features preserved

All Claude/Jarvis automation, Release Center, DevOps Center, QA, Approvals, Claude
auto-build, deployment/packaging/distribution centers, and the microphone recorder
are untouched — only gated behind owner/admin.

## Next step

Connect `services/mvp/` to a real server API + database, and replace the local login
shell with real authentication/sessions.
