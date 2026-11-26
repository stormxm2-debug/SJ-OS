-- 개발 요청함 — 경영 회의실 '대표 결정 안건' 등을 개발 요청으로 모아 관리(대표/관리자 전용).
create table if not exists public.dev_requests (
  id          uuid primary key default gen_random_uuid(),
  created_by  uuid not null default auth.uid(),
  title       text not null,
  detail      text,
  source      text,                               -- 출처: 'board-meeting' 등
  source_ref  text,                               -- 리포트 주차 등 참조
  status      text not null default 'new' check (status in ('new','doing','done')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists dev_requests_created_idx on public.dev_requests (created_at desc);

alter table public.dev_requests enable row level security;

do $$ begin
  drop policy if exists dev_requests_select on public.dev_requests;
  create policy dev_requests_select on public.dev_requests
    for select to authenticated using (is_owner_or_admin());
  drop policy if exists dev_requests_insert on public.dev_requests;
  create policy dev_requests_insert on public.dev_requests
    for insert to authenticated with check (is_owner_or_admin() and created_by = auth.uid());
  drop policy if exists dev_requests_update on public.dev_requests;
  create policy dev_requests_update on public.dev_requests
    for update to authenticated using (is_owner_or_admin()) with check (is_owner_or_admin());
  drop policy if exists dev_requests_delete on public.dev_requests;
  create policy dev_requests_delete on public.dev_requests
    for delete to authenticated using (is_owner_or_admin());
end $$;

-- updated_at 갱신 (기존 공용 트리거 함수 재사용)
drop trigger if exists dev_requests_touch on public.dev_requests;
create trigger dev_requests_touch before update on public.dev_requests
  for each row execute function public.sales_rows_touch();
