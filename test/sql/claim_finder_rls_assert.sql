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
\set runDemo 'd0000000-0000-0000-0000-0000000000d1'

-- 시드(슈퍼유저 = RLS 우회, 셋업 전용)
insert into auth.users (id) values (:'staffA'), (:'staffB');

insert into public.health_record_requests (id, staff_id, customer_id, status, consent_at) values
  (:'hrA',        :'staffA', :'custA', 'completed', now()),
  (:'hrA_revoked',:'staffA', :'custA', 'expired',   now()),  -- 동의 철회(만료)
  (:'hrB',        :'staffB', :'custB', 'completed', now());

create temporary table test_results (name text, passed boolean, detail text);

-- 쓰기(INSERT/UPDATE/DELETE): 예외 없이 **실제 영향 행이 1건 이상**이면 성공으로 본다
-- (RLS USING 차단 시 예외 없이 0행 no-op 이 되는 함정을 ROW_COUNT 로 잡는다).
create or replace procedure pg_temp.try_write(
  p_label text, p_uid uuid, p_is_admin boolean, p_sql text, p_should boolean
) language plpgsql as $$
declare n bigint := 0; ok boolean;
begin
  perform set_config('test.uid', coalesce(p_uid::text, ''), true);
  perform set_config('test.is_admin', case when p_is_admin then 'true' else 'false' end, true);
  begin
    set local role authenticated;
    execute p_sql;
    get diagnostics n = row_count;
    reset role;
    ok := (n > 0);
  exception when others then
    reset role;
    insert into test_results values (p_label, (p_should = false), 'blocked: ' || sqlerrm);
    return;
  end;
  insert into test_results values (p_label, (ok = p_should), 'rows=' || n::text || ' expected=' || p_should::text);
end $$;

-- 집계(차단되면 0행): 지정 uid 로 조회 개수.
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
  insert into test_results values (p_label, (n = p_expected), 'count=' || n::text || ' expected=' || p_expected::text);
end $$;

-- ── 시나리오 (분석/동의 유효 상태) ──────────────────────────────────────────
-- 1) A: 본인 소유·동의된 hrA/custA 연결 실데이터 run → 허용
call pg_temp.try_write('01_A_valid_real_run', :'staffA'::uuid, false,
  format($q$insert into public.claim_finder_runs (id, staff_id, customer_id, health_record_request_id, rules_version, is_demo)
            values (%L, %L, %L, %L, 'v0.2', false)$q$, :'runA', :'staffA', :'custA', :'hrA'), true);

-- 2) B: staff_id=B 지만 A의 hrA/custA 를 위조 연결 → 차단
call pg_temp.try_write('02_B_forge_As_data', :'staffB'::uuid, false,
  format($q$insert into public.claim_finder_runs (staff_id, customer_id, health_record_request_id, rules_version, is_demo)
            values (%L, %L, %L, 'v0.2', false)$q$, :'staffB', :'custA', :'hrA'), false);

-- 3) A: staff_id 를 B 로 위장 → 차단
call pg_temp.try_write('03_A_impersonate_B', :'staffA'::uuid, false,
  format($q$insert into public.claim_finder_runs (staff_id, customer_id, health_record_request_id, rules_version, is_demo)
            values (%L, %L, %L, 'v0.2', false)$q$, :'staffB', :'custA', :'hrA'), false);

-- 4) A: hrA 연결하되 customer_id 를 custB 로 불일치 → 차단
call pg_temp.try_write('04_A_customer_mismatch', :'staffA'::uuid, false,
  format($q$insert into public.claim_finder_runs (staff_id, customer_id, health_record_request_id, rules_version, is_demo)
            values (%L, %L, %L, 'v0.2', false)$q$, :'staffA', :'custB', :'hrA'), false);

-- 5) A: 동의 철회(expired)된 hrA_revoked 연결 → 차단
call pg_temp.try_write('05_A_revoked_consent_insert', :'staffA'::uuid, false,
  format($q$insert into public.claim_finder_runs (staff_id, customer_id, health_record_request_id, rules_version, is_demo)
            values (%L, %L, %L, 'v0.2', false)$q$, :'staffA', :'custA', :'hrA_revoked'), false);

-- 6) A: DEMO run → 허용
call pg_temp.try_write('06_A_demo_run', :'staffA'::uuid, false,
  format($q$insert into public.claim_finder_runs (id, staff_id, customer_id, health_record_request_id, rules_version, is_demo)
            values (%L, %L, null, null, 'v0.2', true)$q$, :'runDemo', :'staffA'), true);

-- 7) A: DEMO 인데 실고객 연결 → 차단
call pg_temp.try_write('07_A_demo_with_customer', :'staffA'::uuid, false,
  format($q$insert into public.claim_finder_runs (staff_id, customer_id, health_record_request_id, rules_version, is_demo)
            values (%L, %L, null, 'v0.2', true)$q$, :'staffA', :'custA'), false);

-- 8) A: 실데이터인데 건강기록 미연결 → 차단
call pg_temp.try_write('08_A_real_no_link', :'staffA'::uuid, false,
  format($q$insert into public.claim_finder_runs (staff_id, customer_id, health_record_request_id, rules_version, is_demo)
            values (%L, %L, null, 'v0.2', false)$q$, :'staffA', :'custA'), false);

-- 9) A: 본인 run 에 검토 추가 → 허용
call pg_temp.try_write('09_A_review_own_run', :'staffA'::uuid, false,
  format($q$insert into public.claim_finder_reviews (run_id, staff_id, candidate_id, note)
            values (%L, %L, 'cand-1', 'ok')$q$, :'runA', :'staffA'), true);

-- 10) B: A의 run 에 검토 추가 → 차단
call pg_temp.try_write('10_B_review_As_run', :'staffB'::uuid, false,
  format($q$insert into public.claim_finder_reviews (run_id, staff_id, candidate_id, note)
            values (%L, %L, 'cand-x', 'bad')$q$, :'runA', :'staffB'), false);

-- 11) B: run 목록 조회 → 0건
call pg_temp.try_count('11_B_cannot_see_As_runs', :'staffB'::uuid, false,
  'select count(*) from public.claim_finder_runs', 0::bigint);

-- 12) 관리자: A의 run 조회 가능
call pg_temp.try_count('12_admin_sees_runs', :'staffB'::uuid, true,
  format('select count(*) from public.claim_finder_runs where id = %L', :'runA'), 1::bigint);

-- 13) A: 본인 유효 run 의 result 수정 → 허용(불변 필드 아님)
call pg_temp.try_write('13_A_update_result_ok', :'staffA'::uuid, false,
  format($q$update public.claim_finder_runs set result = '[{"id":"x"}]'::jsonb where id = %L$q$, :'runA'), true);

-- 14) A: customer_id 를 custB 로 변경 시도 → 차단(불변 필드 트리거)
call pg_temp.try_write('14_A_mutate_customer_blocked', :'staffA'::uuid, false,
  format($q$update public.claim_finder_runs set customer_id = %L where id = %L$q$, :'custB', :'runA'), false);

-- 15) A: health_record_request_id 를 hrB 로 변경 시도 → 차단
call pg_temp.try_write('15_A_mutate_hr_blocked', :'staffA'::uuid, false,
  format($q$update public.claim_finder_runs set health_record_request_id = %L where id = %L$q$, :'hrB', :'runA'), false);

-- 16) A: is_demo 를 true 로 변경(DEMO 우회) 시도 → 차단
call pg_temp.try_write('16_A_mutate_demo_blocked', :'staffA'::uuid, false,
  format($q$update public.claim_finder_runs set is_demo = true where id = %L$q$, :'runA'), false);

-- ── 동의 철회(운영에선 health_record_requests.status 변경) ──────────────────
update public.health_record_requests set status = 'expired' where id = :'hrA';

-- 17) 철회 후 A: runA 조회 불가(0건)
call pg_temp.try_count('17_revoked_read_blocked', :'staffA'::uuid, false,
  format('select count(*) from public.claim_finder_runs where id = %L', :'runA'), 0::bigint);

-- 18) 철회 무관: DEMO run 은 계속 조회 가능(1건)
call pg_temp.try_count('18_demo_unaffected_by_revoke', :'staffA'::uuid, false,
  'select count(*) from public.claim_finder_runs where is_demo', 1::bigint);

-- 19) 철회 후 A: runA 수정 불가(USING 차단 → 0행)
call pg_temp.try_write('19_revoked_update_blocked', :'staffA'::uuid, false,
  format($q$update public.claim_finder_runs set result = '[]'::jsonb where id = %L$q$, :'runA'), false);

-- 20) 철회 후 A: runA 에 검토 추가 불가
call pg_temp.try_write('20_revoked_review_insert_blocked', :'staffA'::uuid, false,
  format($q$insert into public.claim_finder_reviews (run_id, staff_id, candidate_id, note)
            values (%L, %L, 'cand-2', 'late')$q$, :'runA', :'staffA'), false);

-- 21) 철회 후 A: runA 의 기존 검토 조회 불가(0건)
call pg_temp.try_count('21_revoked_review_read_blocked', :'staffA'::uuid, false,
  format('select count(*) from public.claim_finder_reviews where run_id = %L', :'runA'), 0::bigint);

-- ── 판정 ────────────────────────────────────────────────────────────────
\echo '--- CLAIM FINDER RLS RESULTS ---'
select name, case when passed then 'PASS' else 'FAIL' end as status, detail
from test_results order by name;

do $$
declare failed int; total int;
begin
  select count(*) into failed from test_results where not passed;
  select count(*) into total from test_results;
  if failed > 0 then
    raise exception 'RLS test failures: % of %', failed, total;
  end if;
  raise notice 'ALL % RLS SCENARIOS PASSED', total;
end $$;

rollback;  -- 합성 데이터는 남기지 않는다(테스트 전용).
