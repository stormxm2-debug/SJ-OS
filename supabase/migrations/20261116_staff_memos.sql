-- 2026-11-16 · 개인 메모장 (계정별 동기화)
--
-- 적용 상태: ★ 작성만 됨. 운영 DB에는 아직 적용하지 않음(명시 승인 후 적용).
-- 원칙: 신규 테이블 추가형. 다른 테이블·정책 불변.
-- 접근: 본인 행만 조회·추가·수정·삭제(staff_id = auth.uid()). 관리자도 타인 메모는 못 본다.

CREATE TABLE IF NOT EXISTS public.staff_memos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT '',
  body text NOT NULL DEFAULT '',
  pinned boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT staff_memos_title_len CHECK (char_length(title) <= 100),
  CONSTRAINT staff_memos_body_len CHECK (char_length(body) <= 10000)
);

CREATE INDEX IF NOT EXISTS staff_memos_staff_updated_idx ON public.staff_memos (staff_id, updated_at DESC);

ALTER TABLE public.staff_memos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS staff_memos_own_select ON public.staff_memos;
CREATE POLICY staff_memos_own_select ON public.staff_memos FOR SELECT TO authenticated
  USING (staff_id = auth.uid());

DROP POLICY IF EXISTS staff_memos_own_insert ON public.staff_memos;
CREATE POLICY staff_memos_own_insert ON public.staff_memos FOR INSERT TO authenticated
  WITH CHECK (staff_id = auth.uid());

DROP POLICY IF EXISTS staff_memos_own_update ON public.staff_memos;
CREATE POLICY staff_memos_own_update ON public.staff_memos FOR UPDATE TO authenticated
  USING (staff_id = auth.uid()) WITH CHECK (staff_id = auth.uid());

DROP POLICY IF EXISTS staff_memos_own_delete ON public.staff_memos;
CREATE POLICY staff_memos_own_delete ON public.staff_memos FOR DELETE TO authenticated
  USING (staff_id = auth.uid());
