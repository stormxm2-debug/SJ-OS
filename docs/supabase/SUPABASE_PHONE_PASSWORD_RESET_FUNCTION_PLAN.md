# SJ OS — phone password reset flow plan

Password reset is **admin-approved**, never a direct self-service reset. This keeps a
human gate on account recovery and avoids account enumeration.

## Flow

1. **Staff requests reset** — login screen → 비밀번호 찾기 → phone number → the frontend
   calls `request-phone-password-reset`. The response is ALWAYS generic:
   *"등록된 직원이면 관리자에게 비밀번호 재설정 요청이 전달됩니다."* (no enumeration).
   - Server records a `password_reset_requests` row (status `pending`) and sets the
     account's `password_status = 'reset-requested'`.

2. **Owner/admin approves** — in 직원 로그인 관리, the owner/admin sees pending requests
   and clicks **재설정 승인**. Approval sets `password_status = 'reset-approved'`.

3. **Staff sets a new password** — because `password_status` is `reset-approved`, the
   login screen shows the **최초 비밀번호 설정** card again. Submitting calls
   `claim-phone-account`, which (since the account is now in a claimable state) sets
   the new password and returns `password_status = 'set'`.

## Why service_role stays server-side

Setting/overwriting a Supabase Auth user's password requires admin privileges. That
only happens inside the Edge Functions where `SUPABASE_SERVICE_ROLE_KEY` lives. The
renderer/mobile PWA never sees it and only calls the functions with the anon key.

## Not done here (future secure reset function)

A dedicated `reset-phone-password` function (separate from claim) can be added later
to update the password of an EXISTING auth user only when the request is
`reset-approved`. For now, the approved account re-enters the claim path. Add
rate-limiting and server-side password validation when implementing.

## Safety

- Generic responses only — never reveal whether a phone exists.
- Never log phone/password/token/session/service_role.
- Never reset without an approved request.
