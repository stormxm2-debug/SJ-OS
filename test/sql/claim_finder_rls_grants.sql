-- 마이그레이션 적용 후: authenticated 역할에 claim_finder 테이블/함수 권한 부여(테스트 전용).
grant select, insert, update, delete on public.claim_finder_runs to authenticated;
grant select, insert, delete on public.claim_finder_reviews to authenticated;

-- 보안 하드닝(운영과 동일): 검증 함수의 RPC 노출 축소 — PUBLIC 에서 EXECUTE 회수하고
-- RLS 정책이 쓰는 authenticated 에만 부여(이 변경 후에도 정책이 동작해야 함을 아래 23 시나리오로 검증).
revoke execute on function public.claim_finder_run_link_ok(uuid, uuid) from public;
revoke execute on function public.claim_finder_run_valid(boolean, uuid, uuid) from public;
revoke execute on function public.claim_finder_run_accessible(uuid) from public;
grant execute on function public.claim_finder_run_link_ok(uuid, uuid) to authenticated;
grant execute on function public.claim_finder_run_valid(boolean, uuid, uuid) to authenticated;
grant execute on function public.claim_finder_run_accessible(uuid) to authenticated;
grant execute on function public.is_owner_or_admin() to authenticated;
grant execute on function auth.uid() to authenticated;
