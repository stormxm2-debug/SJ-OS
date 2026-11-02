-- SJ CLAIM FINDER — 분석 실행/결과 + 사람 검토 이력 테이블
--
-- ⚠️ 이 마이그레이션은 **아직 운영 DB에 적용하지 않았다(파일만 준비).**
--    (작업 지침: 운영 DB 변경 금지.) 적용은 리뷰 후 담당자가 수행.
--
-- RLS 패턴은 기존 health_record_requests 와 동일하게:
--   본인(staff_id = auth.uid()) 또는 관리자(is_owner_or_admin()) 만 접근.
--   ※ is_owner_or_admin() 은 라이브 DB에 이미 정의돼 있음(레포 외부).
-- 민감 결과(result)는 jsonb 로 저장하되 로깅하지 않으며 RLS 로만 접근한다.

create table if not exists public.claim_finder_runs (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  customer_id uuid,                       -- public.customers.id (소유 고객)
  customer_name text,                     -- 표시용 스냅샷
  health_record_request_id uuid,          -- 연결한 진료기록(health_record_requests.id)
  coverage_analysis_ref text,             -- 보장분석 참조(현재 localStorage id 등)
  rules_version text not null,            -- 적용된 규칙 엔진 버전
  status text not null default 'completed'
    check (status in ('draft','running','completed','failed')),
  consent_at timestamptz,                 -- 고객 동의 시각(동의 없이는 생성 금지 — 앱/서버 검증)
  is_demo boolean not null default false, -- 합성(DEMO) 데이터 여부
  result jsonb,                           -- 후보(candidates) 배열 등 — 민감, RLS 전용
  warnings jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists claim_finder_runs_staff_idx on public.claim_finder_runs (staff_id, created_at desc);
create index if not exists claim_finder_runs_customer_idx on public.claim_finder_runs (customer_id);

alter table public.claim_finder_runs enable row level security;

drop policy if exists claim_finder_runs_select on public.claim_finder_runs;
create policy claim_finder_runs_select on public.claim_finder_runs
  for select using (is_owner_or_admin() or staff_id = auth.uid());

drop policy if exists claim_finder_runs_insert on public.claim_finder_runs;
create policy claim_finder_runs_insert on public.claim_finder_runs
  for insert with check (staff_id = auth.uid());

drop policy if exists claim_finder_runs_update on public.claim_finder_runs;
create policy claim_finder_runs_update on public.claim_finder_runs
  for update using (is_owner_or_admin() or staff_id = auth.uid());

drop policy if exists claim_finder_runs_delete on public.claim_finder_runs;
create policy claim_finder_runs_delete on public.claim_finder_runs
  for delete using (is_owner_or_admin() or staff_id = auth.uid());

-- 사람 검토 이력(판정 수정/메모) — 후보 단위.
create table if not exists public.claim_finder_reviews (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.claim_finder_runs (id) on delete cascade,
  staff_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  candidate_id text not null,             -- claim_finder_runs.result 내 후보 id
  status_override text,                   -- 사람이 조정한 상태(CONFIRMED_CONDITIONS 등)
  note text,
  created_at timestamptz not null default now()
);

create index if not exists claim_finder_reviews_run_idx on public.claim_finder_reviews (run_id, created_at desc);

alter table public.claim_finder_reviews enable row level security;

drop policy if exists claim_finder_reviews_select on public.claim_finder_reviews;
create policy claim_finder_reviews_select on public.claim_finder_reviews
  for select using (is_owner_or_admin() or staff_id = auth.uid());

drop policy if exists claim_finder_reviews_insert on public.claim_finder_reviews;
create policy claim_finder_reviews_insert on public.claim_finder_reviews
  for insert with check (staff_id = auth.uid());

drop policy if exists claim_finder_reviews_delete on public.claim_finder_reviews;
create policy claim_finder_reviews_delete on public.claim_finder_reviews
  for delete using (is_owner_or_admin() or staff_id = auth.uid());

-- updated_at 자동 갱신(기존 패턴과 동일).
create or replace function public.claim_finder_runs_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists claim_finder_runs_touch on public.claim_finder_runs;
create trigger claim_finder_runs_touch before update on public.claim_finder_runs
  for each row execute function public.claim_finder_runs_touch();
