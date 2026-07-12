-- SJ OS — DB(리드) 자동분배 schema. REVIEW before production.
-- 관리자가 DB(잠재고객 리드)를 입력하면 활성 직원에게 최소부하 자동분배 → 배정된
-- 직원에게 실시간 알림 → 24시간 내 '콜 완료' 안 하면 미콜 경고.
-- Run AFTER base schema (profiles) + admin phone login schema (is_owner_or_admin).

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  source text,                 -- 유입경로 (예: 페북광고, DB구매, 소개)
  memo text,
  status text not null default 'new',   -- new | called | contracted | fail
  assigned_fc_id uuid references public.profiles(id) on delete set null,
  assigned_fc_name text,       -- 표시용 비정규화 (직원 이름)
  assigned_at timestamptz,
  first_call_at timestamptz,   -- 첫 '콜 완료' 시각 (24h SLA 판정)
  team_id uuid,
  created_by uuid,
  created_at timestamptz not null default now()
);

create index if not exists leads_assigned_idx on public.leads (assigned_fc_id, status, assigned_at desc);
create index if not exists leads_status_idx on public.leads (status, assigned_at desc);
create index if not exists leads_created_idx on public.leads (created_at desc);

alter table public.leads enable row level security;

-- 관리자(owner/admin)는 전체, 직원은 본인에게 배정된 리드만.
drop policy if exists leads_select on public.leads;
create policy leads_select on public.leads
  for select using (is_owner_or_admin() or assigned_fc_id = auth.uid());

-- 리드 생성/분배는 관리자만 (직원은 자기 리드를 만들 수 없음).
drop policy if exists leads_insert on public.leads;
create policy leads_insert on public.leads
  for insert with check (is_owner_or_admin());

-- 관리자는 전체 수정(재배정 등), 직원은 본인 리드만 수정('콜 완료'·상태변경).
drop policy if exists leads_update on public.leads;
create policy leads_update on public.leads
  for update using (is_owner_or_admin() or assigned_fc_id = auth.uid())
  with check (is_owner_or_admin() or assigned_fc_id = auth.uid());

drop policy if exists leads_delete on public.leads;
create policy leads_delete on public.leads
  for delete using (is_owner_or_admin());

-- 실시간 알림용: 배정(INSERT/UPDATE)을 구독할 수 있게 publication에 추가.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'leads'
  ) then
    alter publication supabase_realtime add table public.leads;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- DB 종류(태그) — migration add_lead_db_types (2026-07-13).
-- DB는 여러 종류로 들어온다(예: 소상공인DB · 여성일반DB · 실버DB). 관리자가 종류를
-- 등록/삭제하고, 배정할 때 각 DB에 종류 하나를 태깅한다. leads.db_type = 선택한 이름(text).
create table if not exists public.lead_db_types (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  sort_order int not null default 0,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
-- 대소문자 무시 중복 방지
create unique index if not exists lead_db_types_name_ci_key on public.lead_db_types (lower(name));

alter table public.lead_db_types enable row level security;

-- 조회 = 로그인한 전 직원 / 등록·삭제 = 관리자.
drop policy if exists lead_db_types_select on public.lead_db_types;
create policy lead_db_types_select on public.lead_db_types
  for select to authenticated using (true);

drop policy if exists lead_db_types_write on public.lead_db_types;
create policy lead_db_types_write on public.lead_db_types
  for all to authenticated using (public.is_owner_or_admin()) with check (public.is_owner_or_admin());

-- leads에 DB종류(태그) 컬럼 추가.
alter table public.leads add column if not exists db_type text;

-- 관리 목록이 여러 기기에서 즉시 갱신되도록 realtime publication에 추가.
do $$ begin
  alter publication supabase_realtime add table public.lead_db_types;
exception when duplicate_object then null; end $$;
