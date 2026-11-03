-- SJ CLAIM FINDER — 검증 함수 RPC 노출 축소(보안 하드닝, additive, 2026-11-03)
--
-- 배경: advisor(0028/0029) — claim_finder_run_link_ok/_accessible 가 SECURITY DEFINER 라
--   PostgREST `/rest/v1/rpc/...` 로 anon 까지 호출 가능(불필요한 공격면).
--   anon 은 auth.uid()=null·역할 없음이라 함수가 항상 false 를 돌려주지만, RPC 노출 자체를 줄인다.
-- 조치: PUBLIC/anon 에서 EXECUTE 회수 → RLS 정책이 실제로 쓰는 authenticated 에만 부여.
--   (권한 '완화'가 아니라 '축소'. 회수 후에도 RLS 정책이 동작함을 합성 격리 테스트 23/23 로 확인.)
-- 주의: 기존 공용 함수(is_owner_or_admin 등)는 앱 전반이 의존하므로 건드리지 않는다(이 세션 범위 밖).

revoke execute on function public.claim_finder_run_link_ok(uuid, uuid) from public, anon;
revoke execute on function public.claim_finder_run_valid(boolean, uuid, uuid) from public, anon;
revoke execute on function public.claim_finder_run_accessible(uuid) from public, anon;

grant execute on function public.claim_finder_run_link_ok(uuid, uuid) to authenticated;
grant execute on function public.claim_finder_run_valid(boolean, uuid, uuid) to authenticated;
grant execute on function public.claim_finder_run_accessible(uuid) to authenticated;
