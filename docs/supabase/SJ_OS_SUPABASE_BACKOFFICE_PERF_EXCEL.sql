-- ============================================================================
-- 총무비서(back-office) 매출 엑셀 업로드 허용 (대표 지시, 2026-11-21)
--
-- 배경: performance_records 쓰기 정책은 owner/admin(is_owner_or_admin())과
--       본인 self 행만 허용 → 총무비서는 읽기만 가능해 엑셀 업로드가 실패했다.
-- 조치: 총무비서가 source='excel' 행에 한해 INSERT/UPDATE/DELETE 할 수 있도록
--       정책을 추가. (기존 owner/admin·self 정책은 그대로 유지)
--
-- 실행 위치: Supabase Dashboard > SQL Editor (총괄 세션 또는 대표님)
--            ※ 이미 이 세션에서 적용 완료됨(참고/재현용으로 보관).
-- ============================================================================

create policy performance_write_backoffice_excel
  on public.performance_records
  for all
  to authenticated
  using (public.is_backoffice() and source = 'excel')
  with check (public.is_backoffice() and source = 'excel');

-- 확인:
-- select policyname, cmd from pg_policies
--   where tablename='performance_records' and policyname='performance_write_backoffice_excel';
