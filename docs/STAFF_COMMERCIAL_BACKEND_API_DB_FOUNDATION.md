# Staff commercial backend API + database foundation

Prepares SJ OS to move staff business data from local/mock to a **shared backend API
+ database**, so all staff eventually see the same company data. This sprint builds
the **architecture and contract only** — no real backend/DB is connected, no
secrets, no `.env` changes.

## Why a shared backend is needed

Today each app instance holds its own local/mock data. For real company use, staff
accounts, attendance, customers, consultations, schedules, performance, and notices
must live in one shared place with role-based access.

## Current mode: local-mock

`CommercialBackendConfig` defaults to `mode: 'local-mock'`, `isConfigured: false`,
`apiBaseUrl: undefined`. The app never contacts a server; all data comes from
in-memory seeds. The status panel shows: 데이터 모드 `local-mock`, API URL `미설정`, DB
`미연결`, 인증 `로컬 MVP 세션`, 동기화 `비활성`.

## Target data models

`src/shared/commercial/models.ts`: `StaffUser`, `AttendanceRecord`,
`CustomerRecord`, `ConsultationRecord`, `ScheduleEvent`, `PerformanceRecord`,
`NoticeRecord`. These are storage-agnostic and back both the mock repositories and
the future API.

## Planned API endpoints

Defined in `src/shared/commercial/apiContract.ts` (`API_ENDPOINTS`): auth, staff,
attendance, customers, consultations, schedules, performance, notices — see
[`COMMERCIAL_MVP_API_CONTRACT.md`](./COMMERCIAL_MVP_API_CONTRACT.md).

## Service / repository architecture

`src/renderer/src/services/commercial/services.ts` implements a repository/adapter
per entity (`Repository<T>` with list/get/create/update). The data source is chosen
by `backendConfig.mode`:

- **local-mock** → in-memory seeded data (current behavior).
- **future-api** → prepared but DISABLED; throws a clear error until configured. The
  documented next step wires this branch to `fetch(apiBaseUrl + endpoint)`.

Callers use the service methods, so swapping mock → API won't change the UI.

## How the future API will replace mock data

1. Implement the server API per the contract.
2. Supply `apiBaseUrl` + auth at runtime (never hardcoded, never `.env` here).
3. Flip `backendConfig.mode` to `api` and set `isConfigured`.
4. The repositories route to `fetch` instead of in-memory seeds — same interfaces.

## Backend not connected yet

No external DB/server is contacted. No secrets, no API keys, no `.env` edits, no new
dependencies, no `sj-ai-proxy`.

## Next step

Choose a backend platform, implement the real API + database per the contract, and
enable the `future-api` repository branch with runtime config.
