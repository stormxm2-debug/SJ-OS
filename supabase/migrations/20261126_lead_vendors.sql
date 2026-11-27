-- DB 업체(회사) 구분: 여러 회사에서 들어오는 DB를 업체별로 나눠 본다.
--  - leads.vendor : DB를 보내 준 업체 이름 (배정할 때 함께 저장)
--  - lead_vendors : 업체 목록. 활성 직원은 조회, 대표·관리자만 추가/삭제
-- 추가만 하는 변경(기존 데이터·정책에 영향 없음).

alter table public.leads add column if not exists vendor text;
create index if not exists leads_vendor_idx on public.leads (vendor);

create table if not exists public.lead_vendors (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  sort_order integer not null default 0,
  created_by uuid,
  created_at timestamptz not null default now()
);

alter table public.lead_vendors enable row level security;

drop policy if exists lead_vendors_select on public.lead_vendors;
create policy lead_vendors_select on public.lead_vendors
  for select to authenticated using (public.is_active_staff());

drop policy if exists lead_vendors_write on public.lead_vendors;
create policy lead_vendors_write on public.lead_vendors
  for all to authenticated
  using (public.is_owner_or_admin())
  with check (public.is_owner_or_admin());
