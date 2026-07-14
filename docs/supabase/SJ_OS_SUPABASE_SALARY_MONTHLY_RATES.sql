-- SJ OS — 급여 계산기 v2: 적용월(월 시책) 요율. ⚠ 총괄 세션 실행 필요.
-- 대상: salary_calculator_schema(v1)를 이미 적용한 운영 DB (2026-07-15 병렬창② 적용분).
--   (신규 설치는 SJ_OS_SUPABASE_SALARY_SCHEMA.sql 하나로 충분 — 같은 가드가 들어있음)
-- ⚠ 반드시 웹 빌드/배포보다 먼저 실행 — v2 클라이언트가 effective_month 컬럼에 쓴다.
--
-- effective_month: '' = 기본 요율(평소), 'YYYY-MM' = 그 달 시책.
-- 그 달 계산에는 시책이 기본보다 우선하고, 시책 없는 달은 기본 요율로 계산
-- (직전 시책이 다음 달로 이월되지 않는 명시적 덮어쓰기 모델).

alter table public.commission_rates
  add column if not exists effective_month text not null default '';

-- v1의 unique(insurer, product_group) → v2 unique(insurer, product_group, effective_month)
alter table public.commission_rates
  drop constraint if exists commission_rates_insurer_product_group_key;

do $$ begin
  alter table public.commission_rates
    add constraint commission_rates_ins_grp_month_key unique (insurer, product_group, effective_month);
exception when duplicate_table then null; when duplicate_object then null; end $$;

-- 기존 v1 행들은 effective_month '' (기본 요율)로 자동 유지 — 데이터 이동 없음.
-- RLS 정책 변경 없음 (v1 정책 그대로 유효).
