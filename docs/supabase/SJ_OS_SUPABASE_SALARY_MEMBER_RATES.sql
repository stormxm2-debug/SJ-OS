-- =============================================================================
-- SJ-OS — 급여계산기 '심플' 개편: 회원(직원)별 매출 요율 + 저장
-- =============================================================================
-- 심플 계산기 = 생명/손해/단기납 '매출액 × 회원별 %' 로 수당 산출.
--  · 요율은 회원(직원)마다 다르며 관리자가 지정 (salary_member_rates).
--  · 매출은 실적(performance_records/entries)에서 자동 불러오고 수정 가능.
--  · 계산 결과는 회원·귀속월로 저장(요율 스냅샷 보존) (salary_member_calcs).
--
-- 기존 commission_rates / salary_calculations(보험료·보험사 기준, 디테일 모드)는
-- 그대로 두고 별도 테이블로 추가한다.
--
-- 적용: Supabase SQL Editor 에서 실행. 재실행 안전(idempotent).
-- 전제: is_owner_or_admin() 헬퍼 존재(SJ_OS_SUPABASE_RLS_POLICIES.sql).
-- =============================================================================

create extension if not exists "pgcrypto";

-- === 회원별 매출 요율 (직원 1인 = 1행) ===
create table if not exists public.salary_member_rates (
  staff_id uuid primary key references public.profiles(id) on delete cascade,
  life_pct numeric not null default 0,       -- 생명보험 매출 대비 %
  non_life_pct numeric not null default 0,   -- 손해보험 매출 대비 %
  short_pct numeric not null default 0,      -- 단기납종신 매출 대비 %
  memo text,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

-- === 저장된 심플 계산 (회원·귀속월별 스냅샷) ===
create table if not exists public.salary_member_calcs (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.profiles(id) on delete cascade,  -- 급여 대상 직원
  calc_month text not null,                  -- YYYY-MM
  life_sales numeric not null default 0,      -- 생명 매출(원)
  non_life_sales numeric not null default 0,  -- 손해 매출(원)
  short_sales numeric not null default 0,     -- 단기납 매출(원)
  life_pct numeric not null default 0,        -- 요율 스냅샷
  non_life_pct numeric not null default 0,
  short_pct numeric not null default 0,
  total numeric not null default 0,           -- 산출 수당 합계(원)
  memo text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists salary_member_calcs_staff_month_idx
  on public.salary_member_calcs(staff_id, calc_month);

-- === RLS ===
alter table public.salary_member_rates enable row level security;
alter table public.salary_member_calcs enable row level security;

-- 요율: 본인 것 조회 + owner/admin 전체 / 쓰기는 owner·admin 만 (급여는 민감정보)
drop policy if exists smr_select on public.salary_member_rates;
create policy smr_select on public.salary_member_rates for select to authenticated
  using ( staff_id = auth.uid() or public.is_owner_or_admin() );
drop policy if exists smr_write on public.salary_member_rates;
create policy smr_write on public.salary_member_rates for all to authenticated
  using ( public.is_owner_or_admin() ) with check ( public.is_owner_or_admin() );

-- 계산: 본인 대상 + owner/admin 조회 / 본인 또는 관리자가 저장·삭제
drop policy if exists smc_select on public.salary_member_calcs;
create policy smc_select on public.salary_member_calcs for select to authenticated
  using ( staff_id = auth.uid() or public.is_owner_or_admin() );
drop policy if exists smc_insert on public.salary_member_calcs;
create policy smc_insert on public.salary_member_calcs for insert to authenticated
  with check ( staff_id = auth.uid() or public.is_owner_or_admin() );
drop policy if exists smc_delete on public.salary_member_calcs;
create policy smc_delete on public.salary_member_calcs for delete to authenticated
  using ( staff_id = auth.uid() or public.is_owner_or_admin() );

-- Do NOT add public/anon policies — authenticated only.
