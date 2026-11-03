-- SJ CLAIM FINDER — 분석 실행/결과 + 사람 검토 이력 테이블
--
-- 적용: 2026-11-03, 사용자 배포 승인 후 Supabase `kmjnluubjgyxkppxxjel` 에 적용(additive 전용).
--   운영 스키마를 메타데이터로 확인함(실고객 데이터 미조회):
--     - health_record_requests.status enum = draft/awaiting_auth/consented/fetching/completed/failed/expired ✔
--     - health_record_requests.consent_at(timestamptz)·staff_id(default auth.uid())·customer_id ✔
--     - is_owner_or_admin() = current_user_role() in ('owner','admin') ✔ / auth.users ✔
--     - customers.owner_staff_id 존재(여기선 직접 참조하지 않고 health_record_requests 로 간접 검증).
--   additive: 기존 테이블/정책/함수/데이터를 변경·삭제하지 않음. 롤백은 docs/claim-finder/DB_SNAPSHOT.md §3.
--   ⚠️ 실제 고객/의료 데이터로의 정확도는 미검증(합성 fixture 로만 검증). DB 데이터 백업은 미수행(소유자 대시보드 확인 필요).
--
-- 서버 경계(요점):
--   * 순수 프런트 가드(access.ts)는 사전검증일 뿐 경계가 아니다.
--   * 실제 경계는 이 파일의 RLS 정책 + 쓰기시점 검증 함수(claim_finder_run_valid)다.
--   * 동일한 "소유 + 고객연결 + 유효 동의" 조건을 **SELECT/INSERT/UPDATE 와 reviews 참조 전체**에 적용한다.
--     → 동의 철회(health_record_requests.status 변경) 후에는 해당 run 을 **읽지도/수정하지도/리뷰하지도** 못한다.
--   * 불변 필드(staff_id/customer_id/health_record_request_id/is_demo)는 트리거로 변경을 금지한다
--     (RLS WITH CHECK 는 NEW 행만 보므로 OLD 대비 불변성 보장 불가 → BEFORE UPDATE 트리거로 강제).
--
-- 민감 결과(result)는 jsonb 로 저장하되 로깅하지 않으며 RLS 로만 접근한다.

create table if not exists public.claim_finder_runs (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  customer_id uuid,                       -- public.customers.id (소유 고객) — 요청 행 통해 간접 검증
  customer_name text,                     -- 표시용 스냅샷
  health_record_request_id uuid           -- 연결한 진료기록(health_record_requests.id)
    -- ⚠️ on delete CASCADE(의도): 원본 건강기록이 삭제되면 그로부터 파생된 분석 run(및 검토)도 삭제한다
    --    (동의 앵커가 사라진 민감 파생물을 남기지 않음 = 프라이버시 정책).
    --    set null 로 두면 FK 가 run 을 UPDATE(hr_id→null)하려다 아래 불변 트리거에 막혀
    --    원본 건강기록 삭제 자체가 실패한다(격리 DB 로 확인). → cascade 로 해결.
    references public.health_record_requests (id) on delete cascade,
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

-- ── 소유권·동의 검증 함수(위조·철회 우회 불가 핵심) ─────────────────────────
-- 주어진 건강기록 요청이 (1) 호출자 소유이거나 관리자이고, (2) 동의 시각이 있고,
-- (3) 상태가 유효(철회/만료/실패/초안 제외)하며, (4) 요청의 고객과 run 의 고객이 일치할 때만 true.
-- SECURITY DEFINER + 명시적 소유 검사: 중첩 RLS 에 의존하지 않고 결정론적으로 판정한다
-- (auth.uid()/is_owner_or_admin() 는 세션 기준이라 DEFINER 여도 호출자 신원을 그대로 반영).
create or replace function public.claim_finder_run_link_ok(p_hr_request_id uuid, p_customer_id uuid)
returns boolean
language sql
stable
security definer
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

-- run 한 건이 "지금 유효한가"(DEMO 규칙 포함)를 한 곳에서 정의해 모든 정책이 재사용한다.
--  - DEMO: 실고객/실요청 미연결(합성). 동의와 무관하게 유효.
--  - 실데이터: 반드시 유효 동의된 본인 요청과 고객 일치.
create or replace function public.claim_finder_run_valid(p_is_demo boolean, p_customer_id uuid, p_hr_request_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select
    case
      when p_is_demo then (p_customer_id is null and p_hr_request_id is null)
      else (p_hr_request_id is not null and public.claim_finder_run_link_ok(p_hr_request_id, p_customer_id))
    end;
$$;

-- reviews 참조용: 해당 run 이 호출자에게 접근 가능하고(소유/관리자) 지금 유효한가.
create or replace function public.claim_finder_run_accessible(p_run_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.claim_finder_runs r
    where r.id = p_run_id
      and (public.is_owner_or_admin() or r.staff_id = auth.uid())
      and public.claim_finder_run_valid(r.is_demo, r.customer_id, r.health_record_request_id)
  );
$$;

-- 공통 조건(소유 + 유효). SELECT/UPDATE using 에 동일 적용.
--  select: 동의 철회된 run 은 보이지 않는다(fail-closed read).
drop policy if exists claim_finder_runs_select on public.claim_finder_runs;
create policy claim_finder_runs_select on public.claim_finder_runs
  for select to authenticated
  using (
    (is_owner_or_admin() or staff_id = auth.uid())
    and claim_finder_run_valid(is_demo, customer_id, health_record_request_id)
  );

drop policy if exists claim_finder_runs_insert on public.claim_finder_runs;
create policy claim_finder_runs_insert on public.claim_finder_runs
  for insert to authenticated
  with check (
    staff_id = auth.uid()
    and claim_finder_run_valid(is_demo, customer_id, health_record_request_id)
  );

-- update: 대상(using)도 유효해야 하고, 결과(with check)도 유효해야 한다(철회 후 수정 불가).
drop policy if exists claim_finder_runs_update on public.claim_finder_runs;
create policy claim_finder_runs_update on public.claim_finder_runs
  for update to authenticated
  using (
    (is_owner_or_admin() or staff_id = auth.uid())
    and claim_finder_run_valid(is_demo, customer_id, health_record_request_id)
  )
  with check (
    (is_owner_or_admin() or staff_id = auth.uid())
    and claim_finder_run_valid(is_demo, customer_id, health_record_request_id)
  );

-- delete: 정리 목적이므로 소유자/관리자면 허용(동의 유효성 요구하지 않음 — 철회 후에도 삭제는 가능).
drop policy if exists claim_finder_runs_delete on public.claim_finder_runs;
create policy claim_finder_runs_delete on public.claim_finder_runs
  for delete to authenticated
  using (is_owner_or_admin() or staff_id = auth.uid());

-- 불변 필드 변경 금지(고객/요청/DEMO/소유자 교체로 검증 우회 차단).
create or replace function public.claim_finder_runs_guard()
returns trigger language plpgsql
set search_path = '' as $$
begin
  if new.staff_id is distinct from old.staff_id
     or new.customer_id is distinct from old.customer_id
     or new.health_record_request_id is distinct from old.health_record_request_id
     or new.is_demo is distinct from old.is_demo then
    raise exception 'claim_finder_runs: 불변 필드(staff_id/customer_id/health_record_request_id/is_demo)는 변경할 수 없습니다';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists claim_finder_runs_guard_trg on public.claim_finder_runs;
create trigger claim_finder_runs_guard_trg before update on public.claim_finder_runs
  for each row execute function public.claim_finder_runs_guard();

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

-- select/insert 모두 부모 run 이 호출자에게 접근 가능+유효해야 한다
-- (철회 후에는 리뷰를 읽지도 추가하지도 못함).
drop policy if exists claim_finder_reviews_select on public.claim_finder_reviews;
create policy claim_finder_reviews_select on public.claim_finder_reviews
  for select to authenticated
  using (
    (is_owner_or_admin() or staff_id = auth.uid())
    and claim_finder_run_accessible(run_id)
  );

drop policy if exists claim_finder_reviews_insert on public.claim_finder_reviews;
create policy claim_finder_reviews_insert on public.claim_finder_reviews
  for insert to authenticated
  with check (
    staff_id = auth.uid()
    and claim_finder_run_accessible(run_id)
  );

drop policy if exists claim_finder_reviews_delete on public.claim_finder_reviews;
create policy claim_finder_reviews_delete on public.claim_finder_reviews
  for delete to authenticated
  using (is_owner_or_admin() or staff_id = auth.uid());
