-- ============================================================================
-- SJ OS — 자료실 (shared_files): 공유 자료(전직원 열람) + 내 파일(본인만)
--
-- 대표 지시(2026-07-10): "공유 파일 하나 + 각자 올리면 자기만 볼 수 있게"
-- - 공유(company): 전 직원 열람, 대표·관리자만 업로드/삭제
-- - 개인(personal): 올린 본인만 열람/삭제 (관리자도 열람 불가 — "자기만" 원칙)
-- 실행 위치: Supabase Dashboard > SQL Editor
-- ============================================================================

create extension if not exists "pgcrypto";

create table if not exists public.shared_files (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope in ('company','personal')),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  owner_name text not null default '',
  name text not null,
  path text not null unique,
  mime text,
  size_bytes bigint not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists shared_files_scope_idx on public.shared_files(scope, created_at desc);
create index if not exists shared_files_owner_idx on public.shared_files(owner_id, created_at desc);

alter table public.shared_files enable row level security;

create policy shared_files_select on public.shared_files for select to authenticated
using ( scope = 'company' or owner_id = auth.uid() );

create policy shared_files_insert on public.shared_files for insert to authenticated
with check (
  owner_id = auth.uid()
  and ( scope = 'personal' or (scope = 'company' and public.is_owner_or_admin()) )
);

create policy shared_files_delete on public.shared_files for delete to authenticated
using (
  (scope = 'personal' and owner_id = auth.uid())
  or (scope = 'company' and public.is_owner_or_admin())
);

-- ---------- Storage 버킷 + 정책 ----------
-- 경로 규칙: 공유 = company/<id>-<파일명> · 개인 = <auth-uid>/<id>-<파일명>

insert into storage.buckets (id, name, public)
values ('shared-files', 'shared-files', false)
on conflict (id) do nothing;

create policy shared_files_obj_insert_personal on storage.objects for insert to authenticated
with check (
  bucket_id = 'shared-files'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy shared_files_obj_insert_company on storage.objects for insert to authenticated
with check (
  bucket_id = 'shared-files'
  and (storage.foldername(name))[1] = 'company'
  and public.is_owner_or_admin()
);

create policy shared_files_obj_select_personal on storage.objects for select to authenticated
using (
  bucket_id = 'shared-files'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy shared_files_obj_select_company on storage.objects for select to authenticated
using (
  bucket_id = 'shared-files'
  and (storage.foldername(name))[1] = 'company'
);

create policy shared_files_obj_delete_personal on storage.objects for delete to authenticated
using (
  bucket_id = 'shared-files'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy shared_files_obj_delete_company on storage.objects for delete to authenticated
using (
  bucket_id = 'shared-files'
  and (storage.foldername(name))[1] = 'company'
  and public.is_owner_or_admin()
);
