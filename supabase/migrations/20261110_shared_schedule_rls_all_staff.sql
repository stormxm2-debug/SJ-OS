-- 2026-11-10 · 공유 일정 권한 정합 — "전 직원 공유" (대표 확정 의도)
--
-- 적용 상태: ★ 작성만 됨. ★ 권한을 넓히는 변경이므로 운영 적용 전 대표/관리자의 명시 승인 필수.
--
-- 배경: 서비스 주석과 대표 의도는 "전 직원이 공유 보드를 본다, 본인 글을 올린다"인데,
-- 현재 RLS 는 조회·등록이 owner/admin 한정이라 일반 FC 가 보지도 올리지도 못한다(불일치 버그).
--
-- 변경 범위(최소):
--   SELECT : 로그인 직원 전체 (전 직원 공유 보드)
--   INSERT : 본인 명의(staff_id = auth.uid())만. admin 전용 제약 제거.
--   UPDATE/DELETE : 기존 유지 (본인 글 또는 owner/admin)
-- 기존 backoffice 읽기 정책은 그대로 둔다.

DROP POLICY IF EXISTS shared_sched_select ON public.shared_schedules;
CREATE POLICY shared_sched_select ON public.shared_schedules
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS shared_sched_insert ON public.shared_schedules;
CREATE POLICY shared_sched_insert ON public.shared_schedules
  FOR INSERT TO authenticated
  WITH CHECK (staff_id = auth.uid());

-- 검증 쿼리(적용 후 read-only 확인용):
--   일반 FC 세션에서 SELECT count(*) FROM shared_schedules  → 전체 보임
--   일반 FC 세션에서 INSERT (staff_id=본인) → 성공, (staff_id=타인) → 실패
--   일반 FC 세션에서 UPDATE/DELETE 타인 글 → 0행(기존 정책 유지)
