# SJ OS Mobile PWA staff app foundation

Adds a mobile-first staff experience alongside the existing Windows Electron desktop
app, sharing the same React renderer + Supabase/local-mock data. **Foundation only** —
no native apps, no app-store publish, no hosting, no new services.

## Desktop stays the main app

The Electron desktop app is unchanged. At a normal (non-mobile) width it renders the
full `AppShell` (sidebar + topbar + all owner/admin/developer tools). Nothing was
removed.

## How the shell is chosen

`App.tsx` uses `useIsMobile()` (viewport ≤ 767px): mobile-width → `MobileShell`,
otherwise `AppShell`. This works in Electron devtools' mobile view too, so it can be
tested without a browser. `navigation/appTarget.ts` exposes `detectAppTarget()`
(`desktop-electron` / `mobile-pwa` / `web-staff`), `isMobileViewport()`,
`isElectronRuntime()`.

## Mobile visible menus (staff only)

Bottom tab bar: **홈 · 출퇴근 · 고객 · 일정 · 더보기**. The 더보기 sheet adds **상담기록 ·
실적관리 · 공지사항 · 자비스 · 로그아웃**.

## Hidden on mobile (every role)

개발 프롬프트 센터 · 오토파일럿 · 개발 OS · PM 플래너 · CTO 룸 · 승인 센터 · QA 센터 ·
릴리즈 센터 · DevOps 센터 · 배포/버전/설치파일 관리 · Claude 자동개발 · 패키징/롤백/배포.
`MobileShell` treats any `admin`-category route as blocked and shows *"모바일에서는
사용할 수 없는 관리자 기능입니다"* with a home button — even for owner/admin. Owners use
the desktop app for admin tooling.

## Data behavior (Supabase / local-mock)

Mobile reuses the **same shared managers** (customer/consultation/schedule/attendance)
so it follows the same Supabase-when-configured, else local-mock path, with the same
data-mode badge and RLS enforcement. The mobile home + performance use local mock
summaries (labelled "로컬 MVP 데이터").

## PWA install

`manifest.webmanifest` (name/short_name SJ OS, `display: standalone`, theme/background
colors, a self-contained SVG icon) is linked from `index.html`, so the app can be
"Add to Home Screen"-installed. **No service worker** is added in this sprint (avoids
offline-caching risk) — see next step.

## Sensitive data is NOT offline-cached

There is no service worker and no offline cache. Customer/consultation/attendance
data is never cached to disk by the app; it is fetched live (RLS-scoped) each session.

## Next step: hosting + service worker

Host the built renderer as a static web app (a dedicated web build/config), then add a
minimal **app-shell-only** service worker (never caching business API responses) for
installability/offline shell. `build:web` was intentionally deferred because the
project builds via `electron-vite`; a separate Vite web config is the clean next step.
