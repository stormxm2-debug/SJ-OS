-- SJ OS — 범용 앱 설정 저장소 (app_settings, key-value).
-- ⚠ NOT YET APPLIED — 총괄이 실행. 첫 사용처: 앱 설치 화면의 PC 설치파일
-- 다운로드 링크(desktop_download_url — 관리자가 구글드라이브 등 외부 링크 등록).
-- 이후 다른 관리자 설정도 이 테이블을 재사용한다 (테이블 추가 없이 key만 추가).
-- Requires public.profiles, public.is_owner_or_admin().

create table if not exists public.app_settings (
  key text primary key,
  value text,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.app_settings enable row level security;

-- 읽기 = 로그인 직원 전체 (설치 링크 등은 전 직원이 봐야 함)
drop policy if exists app_settings_select on public.app_settings;
create policy app_settings_select on public.app_settings for select to authenticated
  using ( true );

-- 쓰기 = 관리자만
drop policy if exists app_settings_write on public.app_settings;
create policy app_settings_write on public.app_settings for all to authenticated
  using ( public.is_owner_or_admin() )
  with check ( public.is_owner_or_admin() );
