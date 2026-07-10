-- SJ OS — AI 보장분석 이력 schema. REVIEW before production.
-- claim_analyses / underwriting_analyses와 동일한 접근 경계: 본인 것 읽기/쓰기 +
-- owner/admin 전체 열람. input=증권 프로필 스냅샷, result=AI 보장분석 JSON.
-- Run AFTER the base schema (customers) + admin phone login schema (is_owner_or_admin).

create table if not exists public.insurance_analyses (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references public.customers(id) on delete cascade,
  staff_id uuid not null,
  result jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists insurance_analyses_customer_idx
  on public.insurance_analyses (customer_id, created_at desc);
create index if not exists insurance_analyses_staff_idx
  on public.insurance_analyses (staff_id, created_at desc);

alter table public.insurance_analyses enable row level security;

drop policy if exists insurance_analyses_select on public.insurance_analyses;
create policy insurance_analyses_select on public.insurance_analyses
  for select using (is_owner_or_admin() or staff_id = auth.uid());

drop policy if exists insurance_analyses_insert on public.insurance_analyses;
create policy insurance_analyses_insert on public.insurance_analyses
  for insert with check (staff_id = auth.uid());

drop policy if exists insurance_analyses_delete on public.insurance_analyses;
create policy insurance_analyses_delete on public.insurance_analyses
  for delete using (is_owner_or_admin() or staff_id = auth.uid());
