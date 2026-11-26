-- ============================================================================
-- OTP 전달 시스템 (인증번호 전달함) — 대표 지시, 2026-11-25
--
-- 보험사 전산 로그인 OTP를 폰 포워더 앱이 자동 수신 → otp-ingest 함수 → otp_codes.
-- 총무/관리자/대표는 실시간 보드로 즉시 확인. 내부 전용.
--
-- 실행 위치: Supabase Dashboard > SQL Editor (총괄 세션 또는 대표님)
--            ※ 이미 이 세션에서 적용 완료됨(참고/재현용).
-- ============================================================================

create table if not exists public.otp_devices (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.profiles(id) on delete cascade,
  token text not null unique,
  label text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);

create table if not exists public.otp_codes (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.profiles(id) on delete cascade,
  insurer text,
  code text not null,
  sender text,
  raw text,
  status text not null default 'received',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '3 minutes')
);
create index if not exists otp_codes_created_idx on public.otp_codes (created_at desc);
create index if not exists otp_codes_staff_idx on public.otp_codes (staff_id);

alter table public.otp_devices enable row level security;
alter table public.otp_codes enable row level security;

-- otp_devices: 본인(FC)만 관리, 대표/관리자/총무는 읽기
drop policy if exists otp_devices_self on public.otp_devices;
create policy otp_devices_self on public.otp_devices for all to authenticated
  using (staff_id = auth.uid()) with check (staff_id = auth.uid());
drop policy if exists otp_devices_admin_read on public.otp_devices;
create policy otp_devices_admin_read on public.otp_devices for select to authenticated
  using (public.is_owner_or_admin() or public.is_backoffice());

-- otp_codes: 본인 FC + 대표/관리자/총무 읽기, 상태 업데이트는 관리자/총무
drop policy if exists otp_codes_read on public.otp_codes;
create policy otp_codes_read on public.otp_codes for select to authenticated
  using (staff_id = auth.uid() or public.is_owner_or_admin() or public.is_backoffice());
drop policy if exists otp_codes_update on public.otp_codes;
create policy otp_codes_update on public.otp_codes for update to authenticated
  using (public.is_owner_or_admin() or public.is_backoffice())
  with check (public.is_owner_or_admin() or public.is_backoffice());

-- 실시간 구독(총무 보드)
-- 이미 추가돼 있으면 에러 → 무시 가능:
alter publication supabase_realtime add table public.otp_codes;

-- 참고: 코드 저장(INSERT)은 서버(otp-ingest, service_role)만 수행하므로 INSERT 정책 없음.
