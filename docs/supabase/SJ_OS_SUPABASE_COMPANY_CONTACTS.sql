-- SJ OS — 보험사 매니저 연락처부 (company_contacts). APPLIED 2026-07-09 via MCP
-- (migrations: company_contacts_directory, company_contacts_realtime).
-- 목적: 각 보험사 담당 매니저 연락처를 서버에서 중앙 관리하고, 직원은 앱에서
-- 통화/문자하거나 vCard(.vcf)로 내 폰 주소록에 저장한다.
-- RLS: 조회=로그인한 전 직원, 등록/수정/삭제=owner·admin만 (공지사항과 동일 패턴).
-- Requires base helper public.is_owner_or_admin().

create table public.company_contacts (
  id uuid primary key default gen_random_uuid(),
  insurer text not null,            -- 보험사명 (INSURERS 12개사 + 기타 텍스트)
  manager_name text not null,
  title text not null default '매니저',
  phone text not null,              -- 휴대폰 (vCard CELL)
  office_phone text,                -- 유선 (vCard WORK)
  email text,
  memo text,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),  -- '변경됨' 뱃지 기준 시각
  updated_by uuid references public.profiles(id) on delete set null
);

create index company_contacts_insurer_idx on public.company_contacts (insurer, sort_order);

-- 수정 시 updated_at 자동 갱신
create or replace function public.company_contacts_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger company_contacts_touch
before update on public.company_contacts
for each row execute function public.company_contacts_touch();

alter table public.company_contacts enable row level security;

create policy company_contacts_select on public.company_contacts
for select to authenticated using (true);

create policy company_contacts_insert_admin on public.company_contacts
for insert to authenticated with check (public.is_owner_or_admin());
create policy company_contacts_update_admin on public.company_contacts
for update to authenticated using (public.is_owner_or_admin()) with check (public.is_owner_or_admin());
create policy company_contacts_delete_admin on public.company_contacts
for delete to authenticated using (public.is_owner_or_admin());

-- 실시간 갱신 (열려 있는 직원 화면 즉시 반영)
alter publication supabase_realtime add table public.company_contacts;

-- Do NOT add a public/anon select policy — 연락처는 개인정보이므로 로그인 사용자 전용.
