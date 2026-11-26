-- DB 배분 2단계: 지역별 FC 배정.
--  - leads.region : 배정할 때 DB 지역(시·도 단위)을 함께 저장
--  - fc_regions   : FC별 담당 지역. 관리자만 관리, FC는 본인 것만 조회
-- 추가만 하는 변경(기존 데이터·정책에 영향 없음).

alter table public.leads add column if not exists region text;

create table if not exists public.fc_regions (
  id uuid primary key default gen_random_uuid(),
  fc_id uuid not null references public.profiles(id) on delete cascade,
  region text not null,
  created_at timestamptz not null default now(),
  unique (fc_id, region)
);

create index if not exists fc_regions_region_idx on public.fc_regions (region);

alter table public.fc_regions enable row level security;

drop policy if exists fc_regions_admin_all on public.fc_regions;
create policy fc_regions_admin_all on public.fc_regions
  for all to authenticated
  using (public.is_owner_or_admin())
  with check (public.is_owner_or_admin());

drop policy if exists fc_regions_own_select on public.fc_regions;
create policy fc_regions_own_select on public.fc_regions
  for select to authenticated
  using (fc_id = auth.uid());
