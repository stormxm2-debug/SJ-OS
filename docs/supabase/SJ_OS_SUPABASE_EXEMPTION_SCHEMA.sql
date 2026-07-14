-- SJ OS — 면책기간 알람 1단계 (뼈대). ⚠ NOT YET APPLIED — 총괄이 실행 + pg_cron 스케줄.
-- 각 고객 보험 가입 건의 '보장개시일 + 면책기간'을 기록 → 매일 자동 점검 → 면책 종료가
-- 임박(D-7)/도래(당일)하면 담당 FC 에게 알림. (증권 AI 자동판독은 3단계에서 이 테이블을 채움)
-- 알람은 담당 FC 에게만(고객 자동발송 아님 — AI 오판 대비, 대표님 승인 설계).
-- Requires public.profiles, public.customers, public.is_owner_or_admin().

create extension if not exists "pgcrypto";

-- ── 면책 기록 ─────────────────────────────────────────────────────────────────
create table if not exists public.policy_exemptions (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  staff_id uuid not null references public.profiles(id) on delete cascade,  -- 담당 FC(알람 수신)
  insurer text not null,                 -- 보험사
  product_name text,                     -- 상품명
  coverage text,                         -- 담보 (예: 암진단비)
  start_date date not null,              -- 보장개시일/가입일
  waiting_days int not null default 90 check (waiting_days >= 0 and waiting_days <= 3650),  -- 면책일수
  -- 면책 종료일 = 개시일 + 면책일수 (자동 계산)
  waiting_end date generated always as (start_date + waiting_days) stored,
  memo text,
  source text not null default 'manual' check (source in ('manual','ai')),  -- 3단계 AI 시드 구분
  alerted_approaching boolean not null default false,  -- D-7 알림 발송됨
  alerted_due boolean not null default false,          -- 도래 알림 발송됨
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists policy_exemptions_staff_idx on public.policy_exemptions (staff_id, waiting_end);
create index if not exists policy_exemptions_customer_idx on public.policy_exemptions (customer_id);

create or replace function public.policy_exemptions_touch()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end; $$;
drop trigger if exists policy_exemptions_touch on public.policy_exemptions;
create trigger policy_exemptions_touch before update on public.policy_exemptions
for each row execute function public.policy_exemptions_touch();

alter table public.policy_exemptions enable row level security;
-- 조회/수정/삭제 = 본인 담당 + 관리자. 생성 = 본인 담당(staff_id=auth.uid()) 또는 관리자.
create policy exemptions_select on public.policy_exemptions for select to authenticated
  using ( staff_id = auth.uid() or public.is_owner_or_admin() );
create policy exemptions_insert on public.policy_exemptions for insert to authenticated
  with check ( staff_id = auth.uid() or public.is_owner_or_admin() );
create policy exemptions_update on public.policy_exemptions for update to authenticated
  using ( staff_id = auth.uid() or public.is_owner_or_admin() )
  with check ( staff_id = auth.uid() or public.is_owner_or_admin() );
create policy exemptions_delete on public.policy_exemptions for delete to authenticated
  using ( staff_id = auth.uid() or public.is_owner_or_admin() );

-- ── 알림(면책 임박/도래) — cron 이 생성, 담당 FC 가 조회 ───────────────────────
create table if not exists public.exemption_alerts (
  id uuid primary key default gen_random_uuid(),
  exemption_id uuid not null references public.policy_exemptions(id) on delete cascade,
  customer_id uuid,
  customer_name text,
  staff_id uuid not null references public.profiles(id) on delete cascade,  -- 수신 FC
  insurer text,
  coverage text,
  kind text not null check (kind in ('approaching','due')),
  due_date date not null,
  created_at timestamptz not null default now()
);
create index if not exists exemption_alerts_staff_idx on public.exemption_alerts (staff_id, created_at desc);

alter table public.exemption_alerts enable row level security;
-- 조회 = 수신 FC 본인 + 관리자. INSERT 는 service_role(cron)만 — authenticated insert 정책 없음.
create policy exemption_alerts_select on public.exemption_alerts for select to authenticated
  using ( staff_id = auth.uid() or public.is_owner_or_admin() );

-- 실시간(알림 즉시 수신)
alter publication supabase_realtime add table public.exemption_alerts;

-- ── 매일 점검 함수 (pg_cron 이 호출) ──────────────────────────────────────────
-- 임박(오늘~+7일, 아직 임박알림 안 감) + 도래(오늘 이하, 아직 도래알림 안 감)를 alert 로 생성.
create or replace function public.run_exemption_alerts()
returns void language plpgsql security definer set search_path = public as $$
begin
  -- 임박 (D-7 ~ D-0)
  insert into public.exemption_alerts (exemption_id, customer_id, customer_name, staff_id, insurer, coverage, kind, due_date)
  select e.id, e.customer_id, c.name, e.staff_id, e.insurer, e.coverage, 'approaching', e.waiting_end
  from public.policy_exemptions e
  join public.customers c on c.id = e.customer_id
  where e.alerted_approaching = false
    and e.waiting_end >= current_date
    and e.waiting_end <= current_date + 7;
  update public.policy_exemptions set alerted_approaching = true
  where alerted_approaching = false and waiting_end >= current_date and waiting_end <= current_date + 7;

  -- 도래 (면책 종료일 <= 오늘)
  insert into public.exemption_alerts (exemption_id, customer_id, customer_name, staff_id, insurer, coverage, kind, due_date)
  select e.id, e.customer_id, c.name, e.staff_id, e.insurer, e.coverage, 'due', e.waiting_end
  from public.policy_exemptions e
  join public.customers c on c.id = e.customer_id
  where e.alerted_due = false and e.waiting_end <= current_date;
  update public.policy_exemptions set alerted_due = true
  where alerted_due = false and waiting_end <= current_date;
end;
$$;

-- 스케줄 (총괄): 매일 KST 09:00 = UTC 00:00
-- select cron.schedule('sj-exemption-alerts', '0 0 * * *', $$ select public.run_exemption_alerts(); $$);
