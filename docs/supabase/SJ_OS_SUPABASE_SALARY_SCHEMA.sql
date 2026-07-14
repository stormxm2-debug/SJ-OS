-- SJ OS — 급여 계산기 스키마. ⚠ 총괄 세션이 Supabase SQL Editor에서 실행 필요.
-- Run AFTER the base schema (profiles) + admin phone login schema (is_owner_or_admin).
--
-- 수당 4종(모집자·상생시상·원수사시상·13개월시상)은 모두 "월납보험료 기준 %".
-- 요율은 보험사 × 상품군별로 관리자가 관리(전 직원 열람) — commission_rates.
-- effective_month: '' = 기본 요율(평소), 'YYYY-MM' = 그 달 시책(해당 월 계산에 우선 적용,
--   시책이 없는 달은 기본 요율로 계산 — 직전 시책이 이월되지 않는 명시적 덮어쓰기 모델).
-- FC가 저장한 계산은 salary_calculations — 요율을 스냅샷으로 저장해
-- 요율표가 나중에 바뀌어도 과거 계산이 변하지 않는다.

create extension if not exists "pgcrypto";

-- === 수당 요율표 (보험사 × 상품군 × 적용월) ===
create table if not exists public.commission_rates (
  id uuid primary key default gen_random_uuid(),
  insurer text not null,
  product_group text not null default '공통',
  effective_month text not null default '',   -- '' = 기본, 'YYYY-MM' = 월 시책
  recruiter_pct numeric not null default 0,   -- 모집자 수당 %
  sangsaeng_pct numeric not null default 0,   -- 상생시상 %
  carrier_pct numeric not null default 0,     -- 원수사시상 %
  month13_pct numeric not null default 0,     -- 13개월시상 % (13회차 유지 시 지급)
  note text,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

-- 초기 버전(적용월 없던 스키마)을 이미 적용한 경우에도 안전 (새로 적용하면 no-op)
alter table public.commission_rates add column if not exists effective_month text not null default '';
alter table public.commission_rates drop constraint if exists commission_rates_insurer_product_group_key;
do $$ begin
  alter table public.commission_rates
    add constraint commission_rates_ins_grp_month_key unique (insurer, product_group, effective_month);
exception when duplicate_table then null; when duplicate_object then null; end $$;

-- === 저장된 급여 계산 (직원별 예상 수당) ===
create table if not exists public.salary_calculations (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  calc_month text not null,                   -- YYYY-MM (귀속월)
  insurer text not null,
  product_group text not null default '공통',
  customer_name text,
  monthly_premium numeric not null,           -- 월납보험료(원)
  recruiter_pct numeric not null default 0,   -- 요율 스냅샷(저장 시점 값 보존)
  sangsaeng_pct numeric not null default 0,
  carrier_pct numeric not null default 0,
  month13_pct numeric not null default 0,
  memo text,
  created_at timestamptz not null default now()
);

create index if not exists salary_calcs_staff_month_idx
  on public.salary_calculations(staff_id, calc_month);

-- === RLS ===
alter table public.commission_rates    enable row level security;
alter table public.salary_calculations enable row level security;

-- 요율표: 전 직원 읽기 / owner·admin만 쓰기
create policy commission_rates_select on public.commission_rates for select to authenticated
using ( true );
create policy commission_rates_insert on public.commission_rates for insert to authenticated
with check ( public.is_owner_or_admin() );
create policy commission_rates_update on public.commission_rates for update to authenticated
using ( public.is_owner_or_admin() ) with check ( public.is_owner_or_admin() );
create policy commission_rates_delete on public.commission_rates for delete to authenticated
using ( public.is_owner_or_admin() );

-- 계산: 본인 것만 rw, owner·admin은 전체 조회·삭제 (직원 급여 확인용)
create policy salary_calcs_select on public.salary_calculations for select to authenticated
using ( staff_id = auth.uid() or public.is_owner_or_admin() );
create policy salary_calcs_insert on public.salary_calculations for insert to authenticated
with check ( staff_id = auth.uid() );
create policy salary_calcs_delete on public.salary_calculations for delete to authenticated
using ( staff_id = auth.uid() or public.is_owner_or_admin() );

-- Do NOT add public/anon policies — authenticated only.

-- === 시드: 12개사 '공통' 상품군 기본 요율 행 (요율 0 — 관리자가 앱에서 입력) ===
insert into public.commission_rates (insurer, product_group, effective_month, note)
select unnest(array[
  '삼성화재','삼성생명','한화생명','교보생명','메리츠화재','현대해상',
  'DB손해보험','KB손해보험','흥국화재','롯데손해보험','NH농협손해보험','라이나생명'
]), '공통', '', '요율 입력 필요'
on conflict (insurer, product_group, effective_month) do nothing;
