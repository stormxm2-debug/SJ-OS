# SJ OS — admin-managed phone/password login

Simple login: the owner/admin registers allowed staff phone numbers; only registered
+ active phones can enter. On first entry the staff member sets their own password;
after that they log in with phone + password. **No Kakao. No SMS OTP as the normal
login.**

## Flow

1. Owner/admin opens **직원 로그인 관리** and registers a staff member (name, phone,
   role, team, status).
2. Staff opens SJ OS (desktop or mobile) → login screen shows only **휴대폰 번호 /
   비밀번호 / 로그인 / 비밀번호 찾기**.
3. Staff enters their phone number:
   - **Not registered** → blocked: "등록된 직원만 이용할 수 있습니다."
   - **Registered, password not set** → inline **최초 비밀번호 설정** card.
   - **Registered, password set** → phone + password sign-in.
4. After login, the app loads the `profiles` row and applies role-based menus.
5. **비밀번호 찾기** records a reset request; the owner/admin approves it, then the
   staff member sets a new password via the same first-password card.

## Security model

- The registered-phone list is an **entry gate** only. Actual business-data access is
  still enforced by `profiles.role` + **RLS**.
- The renderer/mobile PWA uses **only the anon public key**. The **service_role key is
  NEVER in the browser**.
- Creating Supabase Auth users and setting/resetting passwords requires admin
  privileges → this happens in a **server-side Edge Function** (see
  `SUPABASE_PHONE_LOGIN_EDGE_FUNCTION_PLAN.md`). The frontend only calls a configured
  endpoint and shows the result.
- The login-time "is this phone registered?" check must go through a **SECURITY
  DEFINER RPC / Edge Function** that returns a minimal gate result — never a public
  SELECT that would leak the phone list.

## Login sign-in

`supabase.auth.signInWithPassword({ phone: normalizedPhone, password })`. On failure
the UI shows a generic "휴대폰 번호 또는 비밀번호를 확인해주세요." (no account
enumeration). Missing profile → "직원 프로필이 없습니다…"; inactive → "비활성 직원
계정입니다…".

## Phone normalization

`normalizeKoreanPhoneNumber` → E.164 `+8210XXXXXXXX` (accepts `01012345678`,
`010-1234-5678`, `+821012345678`). Invalid → "휴대폰 번호 형식을 확인해주세요."

## Fallbacks (hidden from normal staff)

- **이메일 로그인**: owner/admin fallback, only under the 개발자/관리자 로그인 toggle when
  Supabase is configured.
- **로컬 MVP 로그인**: dev/testing only, under the same toggle when Supabase is not
  configured. Not shown as a normal staff option.

## This sprint vs. next

Implemented: phone normalization, admin registry (local/draft + SQL drafts), simple
login UI, first-password/reset **frontend boundaries**, RLS drafts. **Not** implemented
(server work): the `claim-phone-account` / `reset-phone-password` Edge Functions and
the login-gate RPC. Until they exist, first-password setup shows "서버 함수가 아직
연결되지 않았습니다." and does not fake success.
