# Commercial MVP API contract

The future server API for SJ OS staff data. Source of truth:
`src/shared/commercial/models.ts` (models) and
`src/shared/commercial/apiContract.ts` (endpoints + config + permissions). **Not
implemented yet** — the app runs in `local-mock` mode.

All paths are relative to a runtime-supplied `apiBaseUrl` (never hardcoded, never in
`.env` in this sprint). Auth is carried per `CommercialBackendConfig.authMode`
(`token`/`session`); no secrets are stored client-side in plain text.

## Data models

| Model | Key fields |
|---|---|
| `StaffUser` | id, name, role(owner/admin/team-leader/fc), teamId?, status, timestamps |
| `AttendanceRecord` | id, staffId, type(check-in/out), status, timestamp, photoUrl?, watermarkText? |
| `CustomerRecord` | id, ownerStaffId, name, status(new…contracted/lost), tags[], timestamps |
| `ConsultationRecord` | id, customerId, staffId, consultationType, status, summary, nextAction? |
| `ScheduleEvent` | id, staffId, customerId?, title, type, startsAt, endsAt?, status |
| `PerformanceRecord` | id, staffId, month, totalPremium, contractCount, premiums… |
| `NoticeRecord` | id, title, content, targetRoles[], createdBy, pinned, timestamps |

## Endpoints

| Group | Method | Path |
|---|---|---|
| Auth | POST | `/auth/login` |
| Auth | POST | `/auth/logout` |
| Auth | GET | `/auth/me` |
| Staff | GET | `/staff` |
| Staff | GET | `/staff/:id` |
| Staff | POST | `/staff` |
| Staff | PATCH | `/staff/:id` |
| Attendance | GET | `/attendance` |
| Attendance | POST | `/attendance/check-in` |
| Attendance | POST | `/attendance/check-out` |
| Customers | GET | `/customers` |
| Customers | POST | `/customers` |
| Customers | GET | `/customers/:id` |
| Customers | PATCH | `/customers/:id` |
| Consultations | GET | `/consultations` |
| Consultations | POST | `/consultations` |
| Consultations | PATCH | `/consultations/:id` |
| Schedules | GET | `/schedules` |
| Schedules | POST | `/schedules` |
| Schedules | PATCH | `/schedules/:id` |
| Performance | GET | `/performance/monthly` |
| Performance | POST | `/performance` |
| Notices | GET | `/notices` |
| Notices | POST | `/notices` |
| Notices | PATCH | `/notices/:id` |

## Request / response examples

**POST /auth/login**
```json
// request
{ "userId": "u-fc" }
// response
{ "user": { "id": "u-fc", "name": "일반 FC", "role": "fc", "status": "active" }, "token": "<opaque>" }
```

**GET /customers** → `ListResponse<CustomerRecord>`
```json
{ "items": [ { "id": "c1", "ownerStaffId": "u-fc", "name": "김고객", "status": "consulting", "tags": ["소개"] } ], "total": 1 }
```

**POST /attendance/check-in**
```json
// request
{ "staffId": "u-fc" }
// response
{ "id": "a1", "staffId": "u-fc", "type": "check-in", "status": "normal", "timestamp": "2026-07-06T08:52:00.000Z" }
```

## Role permissions (`ROLE_PERMISSIONS`)

| Role | Read all teams | Manage staff | Post notice |
|---|---|---|---|
| owner | ✅ | ✅ | ✅ |
| admin | ✅ | ✅ | ✅ |
| team-leader | ❌ (own team) | ❌ | ✅ |
| fc | ❌ (own data) | ❌ | ❌ |

## Future DB table plan

`staff_users`, `attendance_records`, `customers`, `consultations`,
`schedule_events`, `performance_records`, `notices` — one table per model, with
`team_id` / `staff_id` foreign keys for team + owner scoping, and indexes on
`staff_id`, `customer_id`, and `month`. Backups + migration policy are a later step.
