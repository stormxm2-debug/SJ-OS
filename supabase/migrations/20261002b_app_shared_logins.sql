-- 공유 로그인 보관 — 외부 사이트(더헬퍼 가족간병 접수 등) 팀 공유 계정.
--
-- 비밀번호를 앱 소스/깃/번들에 넣지 않으려고 DB에 둔다. 로그인한 직원만 조회(select),
-- 값 변경은 owner/admin 만. 실제 로그인 값(비밀번호 포함)은 이 마이그레이션에 넣지 않고
-- 관리자가 직접 insert/update 한다(깃에 비밀번호가 남지 않게).

create table if not exists public.app_shared_logins (
  key        text primary key,          -- 예: 'thehelper'
  label      text,
  url        text,
  login_id   text,
  password   text,
  note       text,
  updated_at timestamptz not null default now()
);

alter table public.app_shared_logins enable row level security;

drop policy if exists app_shared_logins_select on public.app_shared_logins;
create policy app_shared_logins_select
  on public.app_shared_logins for select to authenticated using (true);

drop policy if exists app_shared_logins_write on public.app_shared_logins;
create policy app_shared_logins_write
  on public.app_shared_logins for all to authenticated
  using (is_owner_or_admin()) with check (is_owner_or_admin());
