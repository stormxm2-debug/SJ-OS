-- SJ CLAIM FINDER — RLS 정책 검증용 **합성 격리 스키마** (운영 DB 아님).
--
-- 목적: 실제 마이그레이션(supabase/migrations/20261102_claim_finder.sql)의 RLS 정책을
--       운영과 완전히 분리된 일회용 Postgres 에 적용해 **교차 고객/교차 직원 접근 차단**을
--       DB 차원에서 실제로 검증한다(프런트 가드가 아니라 진짜 서버 경계 테스트).
--
-- ⚠️ 운영 미검증: 아래 auth.uid()/is_owner_or_admin()/health_record_requests 는
--    운영의 실제 정의가 아니라 **테스트용 최소 재현**이다. 운영 스키마(특히 status enum,
--    consent_at, customers)와의 호환성은 이 테스트로 보장되지 않는다(적용 전 재확인 필요).
--    테스트가 보장하는 것: "정책 로직이 의도대로(소유/동의/고객일치) 차단/허용하는가".

-- ── Supabase 런타임 대체물(테스트 전용) ──────────────────────────────────
create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key
);

-- 운영 Supabase: auth.uid() = request.jwt.claims->>'sub'. 테스트에선 GUC(test.uid)로 주입.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('test.uid', true), '')::uuid
$$;

-- 운영: is_owner_or_admin() 은 레포 외부(라이브). 테스트에선 GUC(test.is_admin)로 주입.
create or replace function public.is_owner_or_admin()
returns boolean
language sql
stable
as $$
  select coalesce(nullif(current_setting('test.is_admin', true), ''), 'false')::boolean
$$;

-- ── 테스트 역할(authenticated) ────────────────────────────────────────────
-- 운영 Supabase 의 'authenticated' 역할을 흉내: 비-슈퍼유저여야 RLS 가 적용된다.
-- (정책이 'to authenticated' 를 참조하므로 테이블/정책보다 먼저 만든다.)
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
end $$;

-- 동의·소유 앵커 테이블(레포 20261002_health_record_requests.sql 의 최소 재현).
create table if not exists public.health_record_requests (
  id            uuid primary key default gen_random_uuid(),
  staff_id      uuid not null default auth.uid(),
  customer_id   uuid,
  customer_name text,
  provider      text not null default 'codef',
  product       text not null default '',
  status        text not null default 'draft'
                check (status in ('draft','awaiting_auth','consented','fetching','completed','failed','expired')),
  consent_at    timestamptz,
  created_at    timestamptz not null default now()
);

alter table public.health_record_requests enable row level security;

drop policy if exists hr_select on public.health_record_requests;
create policy hr_select on public.health_record_requests for select to authenticated
  using (public.is_owner_or_admin() or staff_id = auth.uid());
drop policy if exists hr_insert on public.health_record_requests;
create policy hr_insert on public.health_record_requests for insert to authenticated
  with check (staff_id = auth.uid());

grant usage on schema public, auth to authenticated;
grant select, insert, update, delete on public.health_record_requests to authenticated;
grant select on auth.users to authenticated;
