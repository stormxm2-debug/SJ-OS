# CEO Mode / Staff Mode (대표 모드 / 직원 모드)

SJ OS has two UI modes so it works for both the CEO and insurance-company staff.
This is a **UI/UX foundation only** — it changes which menus and Jarvis
suggestions are shown. It is **not** a permission/auth boundary: no command or
route is hard-blocked by mode yet.

## Modes

- **대표 모드 (CEO)** — the default. Shows the full advanced menu.
- **직원 모드 (Staff)** — a simplified, daily-work menu for FCs / team leaders.

The choice is stored in `localStorage` (`sj-os:app-mode:v1`) via
`src/renderer/src/navigation/AppModeContext.tsx` and persists across restarts.
Default is `ceo`.

## Switching

A segmented **대표 모드 / 직원 모드** switch sits at the top of the sidebar. Switching
to staff, if the current view is not in the staff menu, lands the user on the
staff home (`홈`) so the sidebar stays coherent. Switching never blocks a route.

## Menus

**CEO menu** (full): 경영 비서, 라이브 컴퍼니, CEO 대시보드, FC OS, 고객 워크스페이스,
영업활동, 일정, 실적, 팀장, 상담, 보험분석, 앱 빌더, 개발 프롬프트 센터, CTO 룸, 승인 센터,
QA 센터, 릴리즈 센터, DevOps 센터, 오토파일럿, 개발 OS, PM 플래너, 제품 백로그, AI 워커,
프로젝트, 활동 로그, 설정.

**Staff menu** (simple, mapped to the same existing routes with friendly labels):
홈, 오늘 일정, 고객, 영업활동, 실적, 상담, 보험분석, 내 업무. The 자비스 button is
available in both modes.

## Mode-aware Jarvis

Jarvis adjusts **visible suggestions and wording** by mode (Part H) — it does not
hard-block commands:

- **CEO** quick commands: 조직 브리핑, 쇼핑몰 시스템/업무 자동화, AI 영상 광고 시스템,
  FC OS 개발 명령, 오토파일럿, 실적 등.
- **Staff** quick commands: 오늘 일정, FC 출근 현황, 클로징 예정 고객, 미완료 활동, 실적,
  상담/보험분석/고객 워크스페이스 열기.

The Jarvis header shows the active mode badge (대표 모드 / 직원 모드) and a mode-aware
subtitle.

## Not included yet

- Real authentication / permissions.
- Per-command access control.

These are intentionally deferred; this sprint delivers the mode foundation only.
