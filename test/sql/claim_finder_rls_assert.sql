-- SJ CLAIM FINDER — RLS 정책 실검증(합성 격리 DB). 하나라도 실패하면 트랜잭션을 실패시킨다.
\set ON_ERROR_STOP on

begin;

-- 고정 식별자
\set staffA '11111111-1111-1111-1111-111111111111'
\set staffB '22222222-2222-2222-2222-222222222222'
\set custA  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
\set custB  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
\set hrA        'a0000000-0000-0000-0000-0000000000a1'
\set hrA_revoked 'a0000000-0000-0000-0000-0000000000a2'
\set hrB        'b0000000-0000-0000-0000-0000000000b1'
\set runA   'c0000000-0000-0000-0000-0000000000c1'

-- 시드(슈퍼유저 = RLS 우회, 셋업 전용)
insert into auth.users (id) values (:'staffA'), (:'staffB');

insert into public.health_record_requests (id, staff_id, customer_id, status, consent_at) values
  (:'hrA',        :'staffA', :'custA', 'completed', now()),
  (:'hrA_revoked',:'staffA', :'custA', 'expired',   now()),  -- 동의 철회(만료)
  (:'hrB',        :'staffB', :'custB', 'completed', now());

create temporary table test_results (name text, passed boolean, detail text);

create or replace procedure pg_temp.try_insert(
  p_label text, p_uid uuid, p_is_admin boolean, p_sql text, p_should boolean
) language plpgsql as $$
declare ok boolean := true;
begin
  perform set_config('test.uid', coalesce(p_uid::text, ''), true);
  perform set_config('test.is_admin', case when p_is_admin then 'true' else 'false' end, true);
  begin
    set local role authenticated;
    execute p_sql;
    reset role;
  exception
    when insufficient_privilege then reset role; ok := false;  -- RLS 차단
    when check_violation then reset role; ok := false;         -- CHECK 제약 차단
    when others then
      reset role;
      insert into test_results values (p_label, (p_should = false), 'unexpected: ' || sqlerrm);
      return;
  end;
  insert into test_results values (p_label, (ok = p_should),
    'inserted=' || ok::text || ' expected=' || p_should::text);
end $$;

-- 집계 테스트(차단되면 0행): 지정 uid 로 run 조회 개수.
create or replace procedure pg_temp.try_count(
  p_label text, p_uid uuid, p_is_admin boolean, p_sql text, p_expected bigint
) language plpgsql as $$
declare n bigint;
begin
  perform set_config('test.uid', coalesce(p_uid::text, ''), true);
  perform set_config('test.is_admin', case when p_is_admin then 'true' else 'false' end, true);
  set local role authenticated;
  execute p_sql into n;
  reset role;
  insert into test_results values (p_label, (n = p_expected),
    'count=' || n::text || ' expected=' || p_expected::text);
end $$;

-- ── 시나리오 ──────────────────────────────────────────────────────────────
-- 1) A: 본인 소유·동의된 hrA/custA 연결 실데이터 run → 허용
call pg_temp.try_insert('1_A_valid_real_run', :'staffA'::uuid, false,
  format($q$insert into public.claim_finder_runs (id, staff_id, customer_id, health_record_request_id, rules_version, is_demo)
            values (%L, %L, %L, %L, 'v0.2', false)$q$, :'runA', :'staffA', :'custA', :'hrA'), true);

-- 2) B: staff_id=B 지만 A의 hrA/custA 를 위조 연결 → 차단(소유/열람 불가)
call pg_temp.try_insert('2_B_forge_As_data', :'staffB'::uuid, false,
  format($q$insert into public.claim_finder_runs (staff_id, customer_id, health_record_request_id, rules_version, is_demo)
            values (%L, %L, %L, 'v0.2', false)$q$, :'staffB', :'custA', :'hrA'), false);

-- 3) A: staff_id 를 B 로 위장 → 차단(staff_id<>auth.uid())
call pg_temp.try_insert('3_A_impersonate_B', :'staffA'::uuid, false,
  format($q$insert into public.claim_finder_runs (staff_id, customer_id, health_record_request_id, rules_version, is_demo)
            values (%L, %L, %L, 'v0.2', false)$q$, :'staffB', :'custA', :'hrA'), false);

-- 4) A: hrA 연결하되 customer_id 를 custB 로 불일치 → 차단(고객 일치 강제)
call pg_temp.try_insert('4_A_customer_mismatch', :'staffA'::uuid, false,
  format($q$insert into public.claim_finder_runs (staff_id, customer_id, health_record_request_id, rules_version, is_demo)
            values (%L, %L, %L, 'v0.2', false)$q$, :'staffA', :'custB', :'hrA'), false);

-- 5) A: 동의 철회(expired)된 hrA_revoked 연결 → 차단(유효 동의 아님)
call pg_temp.try_insert('5_A_revoked_consent', :'staffA'::uuid, false,
  format($q$insert into public.claim_finder_runs (staff_id, customer_id, health_record_request_id, rules_version, is_demo)
            values (%L, %L, %L, 'v0.2', false)$q$, :'staffA', :'custA', :'hrA_revoked'), false);

-- 6) A: DEMO run(합성, 실고객/요청 미연결) → 허용
call pg_temp.try_insert('6_A_demo_run', :'staffA'::uuid, false,
  format($q$insert into public.claim_finder_runs (staff_id, customer_id, health_record_request_id, rules_version, is_demo)
            values (%L, null, null, 'v0.2', true)$q$, :'staffA'), true);

-- 7) A: DEMO 인데 실고객 연결 시도 → 차단(DEMO는 실데이터 금지)
call pg_temp.try_insert('7_A_demo_with_customer', :'staffA'::uuid, false,
  format($q$insert into public.claim_finder_runs (staff_id, customer_id, health_record_request_id, rules_version, is_demo)
            values (%L, %L, null, 'v0.2', true)$q$, :'staffA', :'custA'), false);

-- 8) A: 실데이터인데 건강기록 미연결 → 차단(연결 필수)
call pg_temp.try_insert('8_A_real_no_link', :'staffA'::uuid, false,
  format($q$insert into public.claim_finder_runs (staff_id, customer_id, health_record_request_id, rules_version, is_demo)
            values (%L, %L, null, 'v0.2', false)$q$, :'staffA', :'custA'), false);

-- 9) A: 본인 run 에 검토 추가 → 허용
call pg_temp.try_insert('9_A_review_own_run', :'staffA'::uuid, false,
  format($q$insert into public.claim_finder_reviews (run_id, staff_id, candidate_id, note)
            values (%L, %L, 'cand-1', 'ok')$q$, :'runA', :'staffA'), true);

-- 10) B: A의 run 에 검토 추가(staff_id=B) → 차단(run 접근 불가)
call pg_temp.try_insert('10_B_review_As_run', :'staffB'::uuid, false,
  format($q$insert into public.claim_finder_reviews (run_id, staff_id, candidate_id, note)
            values (%L, %L, 'cand-x', 'bad')$q$, :'runA', :'staffB'), false);

-- 11) B: run 목록 조회 → A의 run 보이지 않음(0건; B는 아직 run 없음)
call pg_temp.try_count('11_B_cannot_see_As_runs', :'staffB'::uuid, false,
  'select count(*) from public.claim_finder_runs', 0::bigint);

-- 12) 관리자(admin): A의 run 조회 가능(최소 1건)
call pg_temp.try_count('12_admin_sees_runs', :'staffB'::uuid, true,
  format('select count(*) from public.claim_finder_runs where id = %L', :'runA'), 1::bigint);

-- ── 판정 ────────────────────────────────────────────────────────────────
\echo '--- CLAIM FINDER RLS RESULTS ---'
select name, case when passed then 'PASS' else 'FAIL' end as status, detail
from test_results order by name;

do $$
declare failed int;
begin
  select count(*) into failed from test_results where not passed;
  if failed > 0 then
    raise exception 'RLS test failures: %', failed;
  end if;
  raise notice 'ALL % RLS SCENARIOS PASSED', (select count(*) from test_results);
end $$;

rollback;  -- 합성 데이터는 남기지 않는다(테스트 전용).
