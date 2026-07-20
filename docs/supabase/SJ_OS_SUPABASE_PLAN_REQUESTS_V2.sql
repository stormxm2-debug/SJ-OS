-- SJ OS — 설계 요청서 v2 증분 (병렬 작업창 ②, 2026-07-21)
-- v1(SJ_OS_SUPABASE_PLAN_REQUESTS_SCHEMA.sql) 적용 후 실행.
-- ⚠ 배포 순서: 이 SQL을 웹 빌드 배포보다 먼저 적용할 것.
--   (클라이언트는 신규 컬럼 insert 실패 시 v1 형식으로 재시도하는 폴백이 있어
--    순서가 바뀌어도 깨지지는 않지만, 그동안 새 필드가 저장되지 않는다.)
--
-- v2 내용:
--  ① plan_requests 확장 — 요청 보험사(복수), 계약자(피보험자와 다를 때), 설계 조건
--  ② plan_request_templates — FC 개인별 "자주 쓰는 특약 세트" 저장

-- ① plan_requests 컬럼 추가
alter table public.plan_requests
  add column if not exists insurers jsonb not null default '[]',      -- ["삼성화재","현대해상"] 비교견적용 복수
  add column if not exists policyholder_name text,                    -- 계약자명 (null = 피보험자 본인)
  add column if not exists conditions jsonb not null default '{}';    -- {"budget":"월 10만원 내","paymentTerm":"20년납","maturity":"100세","renewal":"비갱신 위주","medicalNotes":"..."}

-- ② 자주 쓰는 특약 세트 (개인 템플릿 — 본인만 접근)
create table if not exists public.plan_request_templates (
  id uuid primary key default gen_random_uuid(),
  fc_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  name text not null,                          -- 세트 이름 (예: "40대 남성 표준 종합")
  insurance_kind text not null,
  coverages jsonb not null default '[]',       -- [{"name","amount","category"}]
  driving text,
  conditions jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists plan_request_templates_fc_idx
  on public.plan_request_templates (fc_id, created_at desc);

alter table public.plan_request_templates enable row level security;

-- 개인 도구 — 관리자 포함 누구도 남의 템플릿을 보지 않는다.
create policy plan_request_templates_select on public.plan_request_templates
  for select to authenticated using ( fc_id = auth.uid() );
create policy plan_request_templates_insert on public.plan_request_templates
  for insert to authenticated with check ( fc_id = auth.uid() );
create policy plan_request_templates_update on public.plan_request_templates
  for update to authenticated using ( fc_id = auth.uid() ) with check ( fc_id = auth.uid() );
create policy plan_request_templates_delete on public.plan_request_templates
  for delete to authenticated using ( fc_id = auth.uid() );

-- Do NOT add public/anon policies — authenticated only.
