-- SJ OS — 매니저 설계 요청서 schema. (병렬 작업창 ②, 2026-07-15)
-- 고객 정보로 설계요청 문자를 자동 생성해 매니저에게 보내고, 요청 이력을
-- 고객별로 추적한다 (요청 → 설계받음 → 제안 → 계약/중단).
-- Run AFTER base schema (profiles, customers) + admin phone login schema (is_owner_or_admin).

create extension if not exists "pgcrypto";

create table if not exists public.plan_requests (
  id uuid primary key default gen_random_uuid(),
  fc_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  fc_name text,
  customer_id uuid references public.customers(id) on delete set null,
  customer_name text not null,
  insurance_kind text not null,                -- 종합건강/암/운전자/간편심사 등
  coverages jsonb not null default '[]',       -- [{"name":"일반암 진단비","amount":"5,000만원"}]
  driving text,                                -- 자가용 운전/영업용 운전/비운전/미확인
  extra_request text,
  message_text text not null,                  -- 생성된 문자 전문 스냅샷 (다시 복사용)
  manager_name text,                           -- 보낸 매니저 메모 (선택)
  status text not null default 'requested',    -- requested | received | proposed | contracted | dropped
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists plan_requests_fc_idx on public.plan_requests (fc_id, created_at desc);
create index if not exists plan_requests_customer_idx on public.plan_requests (customer_id, created_at desc);

alter table public.plan_requests enable row level security;

-- 직원은 본인 것만, 관리자(owner/admin)는 전체 (내것↔직원것 분리 원칙).
create policy plan_requests_select on public.plan_requests for select to authenticated
using ( fc_id = auth.uid() or public.is_owner_or_admin() );
create policy plan_requests_insert on public.plan_requests for insert to authenticated
with check ( fc_id = auth.uid() );
create policy plan_requests_update on public.plan_requests for update to authenticated
using ( fc_id = auth.uid() or public.is_owner_or_admin() )
with check ( fc_id = auth.uid() or public.is_owner_or_admin() );
create policy plan_requests_delete on public.plan_requests for delete to authenticated
using ( fc_id = auth.uid() or public.is_owner_or_admin() );

-- Do NOT add public/anon policies — authenticated only.
