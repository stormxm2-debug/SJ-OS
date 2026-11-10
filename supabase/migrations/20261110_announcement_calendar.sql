-- 2026-11-10 · 캘린더 고도화 — 회사 공지 날짜/기간 · 개인(FC) 대상 · 확인필수
--
-- 적용 상태: ★ 작성만 됨. 운영 DB에는 아직 적용하지 않음(별도 승인 전 금지).
-- 원칙: 전부 추가형(ADD COLUMN IF NOT EXISTS / 신규 테이블 / 신규 정책). 기존 행·기존 정책 불변.
-- 기존 announcements_select 정책은 건드리지 않는다(정책은 OR 결합 — 신규 정책은 추가 허용만 더함).
-- 적용 전 점검: 현재 target_type 에 CHECK 제약이 있는지 확인 후 'user' 허용 여부를 맞출 것.

-- 1) 공지 날짜·기간·확인필수 컬럼 (한국시간 날짜 기준 DATE 로 보관)
ALTER TABLE public.announcements
  ADD COLUMN IF NOT EXISTS start_date date,
  ADD COLUMN IF NOT EXISTS end_date date,
  ADD COLUMN IF NOT EXISTS require_ack boolean NOT NULL DEFAULT false;

-- 날짜 없는 공지는 달력에 올리지 않는다(앱 로직). 기간 역전 방지.
ALTER TABLE public.announcements
  DROP CONSTRAINT IF EXISTS announcements_date_range_chk;
ALTER TABLE public.announcements
  ADD CONSTRAINT announcements_date_range_chk
  CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date);

-- 2) 개인(FC) 대상 목록 — target_type = 'user' 일 때 사용
CREATE TABLE IF NOT EXISTS public.announcement_targets (
  announcement_id uuid NOT NULL REFERENCES public.announcements(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (announcement_id, profile_id)
);
ALTER TABLE public.announcement_targets ENABLE ROW LEVEL SECURITY;

-- 관리 권한: 대표/관리자만 대상 지정·변경 (기존 is_owner_or_admin 재사용)
DROP POLICY IF EXISTS announcement_targets_admin_all ON public.announcement_targets;
CREATE POLICY announcement_targets_admin_all ON public.announcement_targets
  FOR ALL TO authenticated
  USING (public.is_owner_or_admin())
  WITH CHECK (public.is_owner_or_admin());

-- 본인은 자기에게 걸린 대상 행만 조회 (공지 가시성 판정용)
DROP POLICY IF EXISTS announcement_targets_select_self ON public.announcement_targets;
CREATE POLICY announcement_targets_select_self ON public.announcement_targets
  FOR SELECT TO authenticated
  USING (profile_id = auth.uid());

-- 3) 개인 대상 공지 조회 — 새 '허용' 정책 추가 (기존 정책과 OR).
--    본인이 대상에 포함된 published 공지만 추가로 보인다. 다른 공지 노출 확대 없음.
DROP POLICY IF EXISTS announcements_select_user_target ON public.announcements;
CREATE POLICY announcements_select_user_target ON public.announcements
  FOR SELECT TO authenticated
  USING (
    status = 'published'
    AND target_type = 'user'
    AND EXISTS (
      SELECT 1 FROM public.announcement_targets t
      WHERE t.announcement_id = announcements.id AND t.profile_id = auth.uid()
    )
  );

-- 4) 확인 필수 공지 — 미확인 인원 집계는 관리자만 (announcement_reads 기존 RLS 재사용)
-- (읽음 기록은 announcement_reads 가 이미 담당. 별도 테이블 불필요.)

COMMENT ON COLUMN public.announcements.start_date IS '공지 표시 시작일(KST 날짜). NULL 이면 달력 미표시';
COMMENT ON COLUMN public.announcements.end_date IS '공지 표시 종료일(KST 날짜). NULL 이면 start_date 하루';
COMMENT ON COLUMN public.announcements.require_ack IS '확인 필수 여부 — 읽음(announcement_reads) 집계 대상';
