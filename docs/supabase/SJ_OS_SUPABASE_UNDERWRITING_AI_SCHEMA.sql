-- SJ OS — AI 사전심사(언더라이팅) 분석 이력 schema. REVIEW before production.
-- claim_analyses와 동일한 접근 경계: 본인 것 읽기/쓰기 + owner/admin 전체 열람.
-- input: 고지 문답 스냅샷(재검토용), result: AI 심사 예측 JSON — 병력 민감정보 포함.
-- Run AFTER the base schema (customers) + admin phone login schema (is_owner_or_admin).
-- ⚠️ 이 파일은 총괄 세션이 프로덕션에 적용해야 함 (개별 세션은 배포 금지).

create table if not exists public.underwriting_analyses (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references public.customers(id) on delete cascade,
  staff_id uuid not null,
  input jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists underwriting_analyses_customer_idx
  on public.underwriting_analyses (customer_id, created_at desc);
create index if not exists underwriting_analyses_staff_idx
  on public.underwriting_analyses (staff_id, created_at desc);

alter table public.underwriting_analyses enable row level security;

drop policy if exists underwriting_analyses_select on public.underwriting_analyses;
create policy underwriting_analyses_select on public.underwriting_analyses
  for select using (is_owner_or_admin() or staff_id = auth.uid());

drop policy if exists underwriting_analyses_insert on public.underwriting_analyses;
create policy underwriting_analyses_insert on public.underwriting_analyses
  for insert with check (staff_id = auth.uid());

drop policy if exists underwriting_analyses_delete on public.underwriting_analyses;
create policy underwriting_analyses_delete on public.underwriting_analyses
  for delete using (is_owner_or_admin() or staff_id = auth.uid());
