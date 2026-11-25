-- 경영 회의실 — 주간 경영 자문 리포트 (관리자/대표 전용)
-- 4개 팀 관점의 리포트를 주차별로 저장한다. 관리자(owner/admin)만 조회·생성.
create table if not exists public.board_meeting_reports (
  id          uuid primary key default gen_random_uuid(),
  created_by  uuid not null default auth.uid(),
  week        text not null,                 -- 예: '2026-11 4주차' 또는 'YYYY-Wnn'
  title       text,
  report      jsonb not null default '{}'::jsonb,  -- { overview, teams:[{key,name,insights,proposals}], decisions }
  created_at  timestamptz not null default now()
);
create index if not exists board_meeting_reports_created_idx
  on public.board_meeting_reports (created_at desc);

alter table public.board_meeting_reports enable row level security;

do $$ begin
  drop policy if exists board_meeting_reports_select on public.board_meeting_reports;
  create policy board_meeting_reports_select on public.board_meeting_reports
    for select to authenticated using (is_owner_or_admin());
  drop policy if exists board_meeting_reports_insert on public.board_meeting_reports;
  create policy board_meeting_reports_insert on public.board_meeting_reports
    for insert to authenticated with check (is_owner_or_admin() and created_by = auth.uid());
  drop policy if exists board_meeting_reports_update on public.board_meeting_reports;
  create policy board_meeting_reports_update on public.board_meeting_reports
    for update to authenticated using (is_owner_or_admin()) with check (is_owner_or_admin());
  drop policy if exists board_meeting_reports_delete on public.board_meeting_reports;
  create policy board_meeting_reports_delete on public.board_meeting_reports
    for delete to authenticated using (is_owner_or_admin());
end $$;
