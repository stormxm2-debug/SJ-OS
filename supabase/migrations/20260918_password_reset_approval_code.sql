-- 직원 비밀번호 설정 보강 (2026-09-18 점검 조치)
--
-- 문제: claim-phone-account 는 로그인 없이 호출되는데, 전화번호만 알면
--   ① 아직 비밀번호가 없는 직원 계정의 첫 비밀번호를,
--   ② 관리자가 재설정을 승인한 뒤 7일 동안은 새 비밀번호를
--   제3자가 먼저 정할 수 있었다.
-- 조치: 관리자(또는 총무)가 발급해 직원 본인에게 직접 전달한 6자리 코드가 있어야 한다.
--   ① 첫 비밀번호: 초대 코드 (issue-staff-invite 가 발급, staff_invite_codes 에 해시만 저장, 7일 유효)
--   ② 재설정: 승인 확인 코드 (관리자 화면에서 승인 시 발급, password_reset_requests 에 해시만 저장, 24시간 유효)
--   두 코드 모두 5번 틀리면 무효. 코드 원문은 어디에도 저장하지 않는다.

alter table public.password_reset_requests
  add column if not exists approval_code_hash text,
  add column if not exists failed_attempts integer not null default 0;

create table if not exists public.staff_invite_codes (
  normalized_phone text primary key,
  code_hash text not null,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  failed_attempts integer not null default 0
);

-- 정책 없이 RLS만 켠다 → 앱(anon/authenticated)에서는 읽기·쓰기 불가, 서버 함수(service_role)만 사용.
alter table public.staff_invite_codes enable row level security;
revoke all on public.staff_invite_codes from anon, authenticated;
