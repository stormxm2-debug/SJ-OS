-- SJ INVEST — 출퇴근: 직출 보고서(승인제) + 잠시 멈춤(토글)
--
-- 적용: 2026-11-17, 사용자 설계 확정 후 Supabase `kmjnluubjgyxkppxxjel` 에 적용(additive 전용).
-- additive: 기존 테이블/정책/함수/데이터를 변경·삭제하지 않음.
-- 역할 판별: is_owner_or_admin() = current_user_role() in ('owner','admin') (기존 helper 재사용).
--
-- 요지:
--  1) 직출 보고서: FC 가 제출(pending) → 관리자(owner/admin)가 승인/반려.
--     승인된 for_date 에는 해당 FC 를 "직출"로 처리(미출근 아님). 프론트 로스터가 반영.
--  2) 잠시 멈춤: attendance_pauses 에 행이 있으면 = 멈춤. 관리자가 토글(insert/delete).
--     멈춤 중인 직원은 출근 현황 명단에서 제외, 재개(delete)하면 복귀.

-- ── 1) 직출 보고서 ─────────────────────────────────────────────
create table if not exists public.jikchul_reports (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  staff_name text,                         -- 표시용 스냅샷
  team_id uuid,
  for_date date not null,                  -- 직출 날짜(보통 다음날)
  destination text,                        -- 행선지
  reason text,                             -- 사유
  status text not null default 'pending'
    check (status in ('pending','approved','rejected')),
  reviewed_by uuid references auth.users (id),
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now()
);
create index if not exists jikchul_reports_date_idx on public.jikchul_reports (for_date, status);
create index if not exists jikchul_reports_staff_idx on public.jikchul_reports (staff_id, for_date desc);
alter table public.jikchul_reports enable row level security;

-- 조회: 관리자 전체 / FC 본인
create policy jikchul_reports_select on public.jikchul_reports
  for select to authenticated
  using (is_owner_or_admin() or staff_id = auth.uid());
-- 제출: 본인 것만, pending 으로만 (자기 승인 불가)
create policy jikchul_reports_insert on public.jikchul_reports
  for insert to authenticated
  with check (staff_id = auth.uid() and status = 'pending');
-- 승인/반려: 관리자만
create policy jikchul_reports_update on public.jikchul_reports
  for update to authenticated
  using (is_owner_or_admin())
  with check (is_owner_or_admin());
-- 삭제: 관리자 / FC 본인의 미처리(pending) 건
create policy jikchul_reports_delete on public.jikchul_reports
  for delete to authenticated
  using (is_owner_or_admin() or (staff_id = auth.uid() and status = 'pending'));

-- ── 2) 잠시 멈춤 ───────────────────────────────────────────────
create table if not exists public.attendance_pauses (
  staff_id uuid primary key references auth.users (id) on delete cascade,
  staff_name text,
  paused_by uuid default auth.uid() references auth.users (id),
  paused_at timestamptz not null default now()
);
alter table public.attendance_pauses enable row level security;

-- 조회: 로스터 반영을 위해 로그인 직원 모두 (멈춤 여부는 민감정보 아님)
create policy attendance_pauses_select on public.attendance_pauses
  for select to authenticated
  using (auth.uid() is not null);
-- 멈춤/재개(insert/delete): 관리자만
create policy attendance_pauses_insert on public.attendance_pauses
  for insert to authenticated
  with check (is_owner_or_admin());
create policy attendance_pauses_delete on public.attendance_pauses
  for delete to authenticated
  using (is_owner_or_admin());
