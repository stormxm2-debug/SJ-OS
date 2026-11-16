-- 2026-11-16 · 콘텐츠 보드 (대표 전용)
--
-- 적용 상태: ★ 작성만 됨. 운영 DB에는 아직 적용하지 않음(명시 승인 후 적용).
-- 원칙: 신규 테이블 추가형. 접근은 '대표(owner)' 역할만 가능. 관리자·직원은 조회도 불가.

CREATE TABLE IF NOT EXISTS public.content_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  platforms text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'idea',
  scheduled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT content_items_status_chk CHECK (status IN ('idea','drafting','scheduled','published')),
  CONSTRAINT content_items_title_len CHECK (char_length(title) <= 100),
  CONSTRAINT content_items_body_len CHECK (char_length(body) <= 5000)
);

CREATE INDEX IF NOT EXISTS content_items_owner_sched_idx ON public.content_items (owner_id, scheduled_at);

ALTER TABLE public.content_items ENABLE ROW LEVEL SECURITY;

-- 대표 본인 + 역할이 owner 인 경우에만
DROP POLICY IF EXISTS content_items_owner_all ON public.content_items;
CREATE POLICY content_items_owner_all ON public.content_items
  FOR ALL TO authenticated
  USING (
    owner_id = auth.uid()
    AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'owner')
  )
  WITH CHECK (
    owner_id = auth.uid()
    AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'owner')
  );
