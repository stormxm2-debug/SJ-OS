-- SJ CLAIM FINDER — 분석 실행/결과 + 사람 검토 이력 테이블
--
-- ⚠️ 이 마이그레이션은 **아직 운영 DB에 적용하지 않았다(파일만 준비).**
--    (작업 지침: 운영 DB 변경 금지.) 적용은 리뷰 후 담당자가 수행.
--    ⚠️ 운영 스키마(특히 public.customers)는 이 세션에서 **확인하지 않았다**.
--       아래 설계는 레포에 존재하는 health_record_requests(동의·소유 앵커)에만 의존하며,
--       customers 소유권은 그 요청 행을 통해 간접 검증한다(요청의 customer_id 일치 강제).
--       운영 적용 전, health_record_requests 의 status enum·consent_at 컬럼이 아래 가정과
--       일치하는지 반드시 재확인할 것(미확인 시 fail-closed: 연결 거부).
--
-- 서버 경계(요점):
--   * 순수 프런트 가드(access.ts)는 사전검증일 뿐 경계가 아니다.
--   * 실제 경계는 이 파일의 RLS 정책 + 쓰기시점 검증 함수(claim_finder_run_link_ok)다.
--     클라이언트가 staff_id 를 자기 것으로 넣어도, 본인 소유·유효 동의된 건강기록 요청과
--     고객이 일치하지 않으면 DB가 insert 를 거부한다(위조 불가).
--
-- RLS 패턴은 기존 health_record_requests 와 동일하게:
--   본인(staff_id = auth.uid()) 또는 관리자(is_owner_or_admin()) 만 접근.
--   ※ is_owner_or_admin() 은 라이브 DB에 이미 정의돼 있음(레포 외부).
-- 민감 결과(result)는 jsonb 로 저장하되 로깅하지 않으며 RLS 로만 접근한다.

create table if not exists public.claim_finder_runs (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  customer_id uuid,                       -- public.customers.id (소유 고객) — 요청 행 통해 간접 검증
  customer_name text,                     -- 표시용 스냅샷
  health_record_request_id uuid           -- 연결한 진료기록(health_record_requests.id)
    references public.health_record_requests (id) on delete set null,
  coverage_analysis_ref text,             -- 보장분석 참조(현재 localStorage id 등)
  rules_version text not null,            -- 적용된 규칙 엔진 버전
  status text not null default 'completed'
    check (status in ('draft','running','completed','failed')),
  consent_at timestamptz,                 -- 고객 동의 시각(동의 없이는 생성 금지 — RLS/함수 검증)
  is_demo boolean not null default false, -- 합성(DEMO) 데이터 여부
  result jsonb,                           -- 후보(candidates) 배열 등 — 민감, RLS 전용
  warnings jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists claim_finder_runs_staff_idx on public.claim_finder_runs (staff_id, created_at desc);
create index if not exists claim_finder_runs_customer_idx on public.claim_finder_runs (customer_id);
create index if not exists claim_finder_runs_hr_idx on public.claim_finder_runs (health_record_request_id);

alter table public.claim_finder_runs enable row level security;

-- ── 쓰기시점 소유권·동의 검증(위조 불가 핵심) ──────────────────────────────
-- 주어진 건강기록 요청이 (1) 호출자 소유이거나 관리자이고, (2) 동의 시각이 있고,
-- (3) 상태가 유효(철회/만료/실패/초안 제외)하며, (4) 요청의 고객과 run 의 고객이 일치할 때만 true.
-- SECURITY INVOKER(기본): health_record_requests 의 RLS 도 함께 적용돼 미열람 행이면 false(fail-closed).
create or replace function public.claim_finder_run_link_ok(p_hr_request_id uuid, p_customer_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.health_record_requests hr
    where hr.id = p_hr_request_id
      and (public.is_owner_or_admin() or hr.staff_id = auth.uid())  -- 소유권(본인/관리자)
      and hr.consent_at is not null                                  -- 동의 존재
      and hr.status in ('consented','fetching','completed')          -- 유효 동의(철회=expired/실패/초안 제외)
      and hr.customer_id is not distinct from p_customer_id          -- 고객 일치(위조 방지)
  );
$$;

drop policy if exists claim_finder_runs_select on public.claim_finder_runs;
create policy claim_finder_runs_select on public.claim_finder_runs
  for select to authenticated
  using (is_owner_or_admin() or staff_id = auth.uid());

-- insert: 본인 명의 + (DEMO는 실고객/요청 연결 금지) 또는 (실데이터는 유효 동의된 본인 요청과 고객 일치).
drop policy if exists claim_finder_runs_insert on public.claim_finder_runs;
create policy claim_finder_runs_insert on public.claim_finder_runs
  for insert to authenticated
  with check (
    staff_id = auth.uid()
    and (
      (is_demo = true and customer_id is null and health_record_request_id is null)
      or
      (is_demo = false and health_record_request_id is not null
         and public.claim_finder_run_link_ok(health_record_request_id, customer_id))
    )
  );

drop policy if exists claim_finder_runs_update on public.claim_finder_runs;
create policy claim_finder_runs_update on public.claim_finder_runs
  for update to authenticated
  using (is_owner_or_admin() or staff_id = auth.uid())
  with check (is_owner_or_admin() or staff_id = auth.uid());

drop policy if exists claim_finder_runs_delete on public.claim_finder_runs;
create policy claim_finder_runs_delete on public.claim_finder_runs
  for delete to authenticated
  using (is_owner_or_admin() or staff_id = auth.uid());

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
  for select to authenticated
  using (is_owner_or_admin() or staff_id = auth.uid());

-- insert: 본인 명의 + run_id 가 호출자가 접근 가능한 run 이어야 함(교차 run 리뷰 금지).
drop policy if exists claim_finder_reviews_insert on public.claim_finder_reviews;
create policy claim_finder_reviews_insert on public.claim_finder_reviews
  for insert to authenticated
  with check (
    staff_id = auth.uid()
    and exists (
      select 1 from public.claim_finder_runs r
      where r.id = run_id
        and (is_owner_or_admin() or r.staff_id = auth.uid())
    )
  );

drop policy if exists claim_finder_reviews_delete on public.claim_finder_reviews;
create policy claim_finder_reviews_delete on public.claim_finder_reviews
  for delete to authenticated
  using (is_owner_or_admin() or staff_id = auth.uid());

-- updated_at 자동 갱신(전용 트리거 함수 — 이름 충돌 방지).
create or replace function public.claim_finder_runs_touch()
returns trigger language plpgsql
set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists claim_finder_runs_touch on public.claim_finder_runs;
create trigger claim_finder_runs_touch before update on public.claim_finder_runs
  for each row execute function public.claim_finder_runs_touch();
