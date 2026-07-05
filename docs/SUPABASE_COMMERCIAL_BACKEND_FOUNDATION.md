# Supabase commercial backend foundation

Prepares SJ OS to move staff data from local/mock to **Supabase** (Postgres + auth +
RLS). This sprint adds the **structure, config, adapters, SQL drafts, and docs** —
no real project, no credentials, no live connection. Local-mock stays the default
and keeps working.

## Why Supabase

Managed Postgres with built-in auth and **row-level security** fits a role-based
staff app: owner/admin see everything, team leaders see their team, FCs see their own
data — enforced at the database, not just the UI.

## Current mode: local-mock

`getBackendConfig()` returns `mode: 'local-mock'` unless **both**
`VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are configured. With no env, the app
never contacts Supabase and all staff pages use local-mock data.

## How Supabase mode will work

When both env vars are present, `mode` resolves to `supabase` and `authMode` to
`supabase-auth`. The repositories/adapters (`supabase*Adapter`) will route to the
Supabase client (`client.from('<table>').select(...)`), with RLS enforcing per-row
access. Adapters are currently **safe skeletons** returning a clear not-configured
result, so nothing crashes before setup.

## anon key OK, service_role forbidden

The renderer reads **only** the public **anon** key (`VITE_SUPABASE_ANON_KEY`) and
the project URL. The **service_role** key bypasses RLS and must **never** be placed in
the renderer, env used by the renderer, or the repo. `supabaseClient.ts` never reads
it; the status panel explicitly shows service role = **사용 금지**.

## Why RLS is required

The anon key is public, so security cannot rely on hiding it. **RLS** on every
business table is what actually restricts each user to the rows they may see/change.
`SJ_OS_SUPABASE_RLS_POLICIES.sql` enables RLS everywhere and defines
owner/admin/team-leader/fc rules. It is a **draft to review before production**.

## Tables drafted

`docs/supabase/SJ_OS_SUPABASE_SCHEMA.sql`: profiles, teams, attendance_records,
customers, consultations, schedule_events, performance_records, notices (+ indexes).

## Policies drafted

`docs/supabase/SJ_OS_SUPABASE_RLS_POLICIES.sql`: helper functions
(`current_user_role`, `current_user_team_id`, `is_owner_or_admin`, `is_team_leader`,
`is_fc`) + per-table select/write policies scoped by role/team/owner; notices
readable by targeted role, managed by owner/admin.

## Files

- `src/shared/commercial/apiContract.ts` — `CommercialBackendConfig` (mode /
  supabaseUrl? / supabaseAnonKeyConfigured / isConfigured / authMode /
  connectionStatus).
- `src/renderer/src/services/commercial/supabaseClient.ts` — env reader +
  `getSupabaseConfigStatus` / `getSupabaseClientOrNull` / `testSupabaseConnection`.
- `src/renderer/src/services/commercial/supabaseAdapters.ts` — 8 adapter skeletons.
- `src/renderer/src/services/commercial/backendConfig.ts` — resolved config, status,
  readiness checklist.
- `src/renderer/src/components/admin/ServerDbStatusPanel.tsx` — owner/admin-only
  Supabase status + checklist + SQL/RLS guidance.

## Dependency

`@supabase/supabase-js` is **not installed** in this sprint (kept zero-dep so build
stays green). Enabling the live client requires `npm install @supabase/supabase-js`
and wiring the documented TODO in `supabaseClient.ts`.

## Next step

The user creates a Supabase project, runs the schema + RLS SQL, creates the first
owner account, and configures the anon env vars locally (never committed). Then
install `@supabase/supabase-js`, enable the client, and migrate services from
local-mock to the Supabase adapters.
