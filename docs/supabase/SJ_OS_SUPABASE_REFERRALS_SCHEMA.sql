-- SJ OS — 소개 리퍼럴 엔진 schema. REVIEW before production.
-- DB 구매 대신 자체생산 영업: 기존 고객의 소개를 체계적으로 요청·추적한다.
-- 파이프라인: asked(요청함) → received(소개받음) → called(콜) → consulted(상담) → contracted(계약) | failed(무산)
-- Run AFTER base schema (profiles, customers) + admin phone login schema (is_owner_or_admin).

create table if not exists public.referrals (
  id uuid primary key default gen_random_uuid(),
  -- 소개를 받는(요청한) 담당 FC — 본인 소유. RLS 경계.
  fc_id uuid not null references public.profiles(id) on delete cascade,
  fc_name text,                    -- 표시용 비정규화 (직원 이름)
  -- 소개자(기존 고객). 고객관리 미연결 소개자도 이름만으로 기록 가능.
  referrer_customer_id uuid references public.customers(id) on delete set null,
  referrer_name text not null,
  -- 소개받은 사람 (status='asked' 단계에서는 아직 없을 수 있음).
  referred_name text,
  referred_phone text,
  relation text,                   -- 소개자와의 관계 (지인/가족/직장동료 등)
  status text not null default 'asked',  -- asked | received | called | consulted | contracted | failed
  memo text,
  asked_at timestamptz,            -- 소개 요청 시각 (골든타임 중복 요청 방지 기준)
  received_at timestamptz,         -- 소개받은 시각
  contracted_at timestamptz,       -- 계약 전환 시각 (월별 성과 집계 기준)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists referrals_fc_idx on public.referrals (fc_id, status, created_at desc);
create index if not exists referrals_referrer_idx on public.referrals (referrer_customer_id, created_at desc);
create index if not exists referrals_created_idx on public.referrals (created_at desc);

alter table public.referrals enable row level security;

-- 직원은 본인 것만, 관리자(owner/admin)는 전체 (내것↔직원것 분리 원칙).
drop policy if exists referrals_select on public.referrals;
create policy referrals_select on public.referrals
  for select using (is_owner_or_admin() or fc_id = auth.uid());

-- 소개 기록은 본인 명의로만 생성 (관리자는 전체 허용).
drop policy if exists referrals_insert on public.referrals;
create policy referrals_insert on public.referrals
  for insert with check (is_owner_or_admin() or fc_id = auth.uid());

drop policy if exists referrals_update on public.referrals;
create policy referrals_update on public.referrals
  for update using (is_owner_or_admin() or fc_id = auth.uid())
  with check (is_owner_or_admin() or fc_id = auth.uid());

drop policy if exists referrals_delete on public.referrals;
create policy referrals_delete on public.referrals
  for delete using (is_owner_or_admin() or fc_id = auth.uid());
