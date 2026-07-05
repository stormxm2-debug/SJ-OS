# SJ OS — Supabase Edge Function 배포 가이드

전화번호 계정 클레임/재설정 요청 함수를 배포하는 방법입니다. **service_role 키는 오직
Edge Function 환경에만** 저장하며, 프론트엔드/Netlify/저장소에는 절대 넣지 않습니다. 이
문서에는 실제 키를 포함하지 않습니다. (이 스프린트에서 자동 배포/CLI 로그인은 하지 않습니다.)

## 함수

- `supabase/functions/claim-phone-account` — 최초 비밀번호 설정 (Auth 사용자 생성 +
  profiles 연결).
- `supabase/functions/request-phone-password-reset` — 재설정 요청 기록 (직접 재설정 아님).

## 배포 절차 (대표님이 직접 진행)

1. **Supabase CLI 설치 확인**
   ```
   supabase --version
   ```
2. **Supabase 로그인**
   ```
   supabase login
   ```
3. **프로젝트 연결**
   ```
   supabase link --project-ref <your-project-ref>
   ```
4. **함수 secrets 설정** (서버 환경변수 — 프론트엔드와 무관)
   ```
   supabase secrets set SUPABASE_URL=https://<your-project>.supabase.co
   supabase secrets set SUPABASE_SERVICE_ROLE_KEY=<service_role_key>
   ```
   > ⚠️ `SUPABASE_SERVICE_ROLE_KEY`는 Edge Function에만 저장합니다. **Netlify 환경변수나
   > SJ OS 프론트엔드에는 절대 넣지 마세요.**
5. **배포**
   ```
   supabase functions deploy claim-phone-account
   supabase functions deploy request-phone-password-reset
   ```
6. **프론트엔드 설정**
   - SJ OS/Netlify에는 `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`(anon)만 설정.
   - 함수 URL은 자동으로 `<VITE_SUPABASE_URL>/functions/v1/…`로 계산됩니다. (필요 시
     `VITE_SJ_EDGE_FUNCTION_URL`로 재정의 가능)

## 배포 후 테스트

1. 관리자 계정으로 **직원 로그인 관리**에서 직원 번호 등록.
2. 직원이 SJ OS 로그인 화면에서 번호 입력 → **최초 비밀번호 설정** 카드 → 설정.
3. `claim-phone-account`가 Auth 사용자 + profiles 행을 생성/연결.
4. 번호 + 비밀번호로 로그인 → 역할 메뉴 확인.

## CORS

- 함수의 `Access-Control-Allow-Origin`은 초기 테스트용 `*`입니다. **운영 전** SJ OS 앱
  주소(예: Netlify URL)로 제한하세요.

## 사전 조건

- `claim-phone-account`가 성공하려면 해당 번호가 **먼저 `staff_login_accounts`에
  등록**되어 있어야 합니다. (직원 로그인 관리에서 등록)
- **미등록 번호**는 서버에서 차단됩니다("등록된 직원만 이용할 수 있습니다.").
- 비활성/차단/이미 설정된 번호도 차단됩니다.

## 보안 체크

- service_role은 Edge Function에만. 프론트엔드/Netlify/저장소 금지.
- 함수는 phone/password/token/service_role을 로그로 남기지 않습니다.
- 미등록/비활성/이미 설정된 번호는 클레임이 거부됩니다.
