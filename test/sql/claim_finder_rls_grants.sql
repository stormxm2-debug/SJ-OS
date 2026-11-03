-- 마이그레이션 적용 후: authenticated 역할에 claim_finder 테이블/함수 권한 부여(테스트 전용).
grant select, insert, update, delete on public.claim_finder_runs to authenticated;
grant select, insert, delete on public.claim_finder_reviews to authenticated;
grant execute on function public.claim_finder_run_link_ok(uuid, uuid) to authenticated;
grant execute on function public.claim_finder_run_valid(boolean, uuid, uuid) to authenticated;
grant execute on function public.claim_finder_run_accessible(uuid) to authenticated;
grant execute on function public.is_owner_or_admin() to authenticated;
grant execute on function auth.uid() to authenticated;
