# SJ OS — phone login Edge Function plan

Account claiming (first password) and password reset require **admin privileges**
(creating auth users, setting passwords). These MUST run server-side where the
`service_role` key lives — **never in the renderer**. This document specifies the
functions; they are not implemented in this sprint.

## Where service_role lives

- Only inside a **Supabase Edge Function** secret (or a Render/Node server env).
- The frontend (Electron renderer + mobile PWA) uses **only** `VITE_SUPABASE_URL` +
  `VITE_SUPABASE_ANON_KEY`. It calls the function over HTTPS and never sees
  `service_role`.

The renderer reads the function base URL from `VITE_SJ_EDGE_FUNCTION_URL` (optional).
If unset, first-password/reset show "서버 함수가 아직 연결되지 않았습니다."

## Function: `claim-phone-account`

Sets the first password for a registered phone.

Request (from the anon frontend):
```json
{ "normalizedPhone": "+8210XXXXXXXX", "password": "<user-chosen>" }
```

Server-side behavior (service_role):
1. Look up `staff_login_accounts` by `normalized_phone`.
2. Require `status in ('invited','active')` AND `password_status in ('not-set','reset-approved')`.
3. Create the Supabase Auth user with `{ phone, password, phone_confirm: true }`
   (company chose no SMS confirmation) — or reuse an existing auth user.
4. Upsert `public.profiles` (id = auth user id, name, role, team_id, status='active').
5. Set `staff_login_accounts.profile_id`, `password_status='set'`, `status='active'`.

Response:
```json
{ "ok": true }
```
Never return tokens/passwords. On failure return a generic `{ "ok": false }`.

## Function: `reset-phone-password`

Applies an owner/admin-approved reset.

Request:
```json
{ "normalizedPhone": "+8210XXXXXXXX", "password": "<new>" }
```

Server-side behavior (service_role):
1. Require an **approved** `password_reset_requests` row for the phone.
2. Update the auth user's password (admin API).
3. Set `password_status='set'`, mark the reset request consumed.

## Login-gate RPC (optional but recommended)

To check "is this phone registered / password set?" without leaking the list, use a
`SECURITY DEFINER` RPC returning only `{ registered, active, passwordStatus }` for a
single phone — never the full table. Call it with the anon client.

## Security notes

- Validate the password server-side too (8–72 chars, letter+number).
- Rate-limit claim/reset per phone to prevent abuse.
- Never log phone numbers, passwords, tokens, or full sessions.
- Keep all tables under RLS; the functions use service_role deliberately and are the
  only admin path.
