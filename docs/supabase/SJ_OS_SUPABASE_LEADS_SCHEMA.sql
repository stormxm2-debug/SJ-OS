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
