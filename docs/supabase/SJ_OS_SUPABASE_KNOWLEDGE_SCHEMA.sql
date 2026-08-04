-- SJ OS — 자료 브리핑 (knowledge_posts) schema. (병렬 작업창 ②, 2026-07-21)
-- 카톡·네이버 카페 등에서 받은 사내 자료(시책·상품개정·인수지침·교육·공지)를
-- 관리자가 올리면 AI(knowledge-digest)가 분류·요약·핵심 포인트·태그를 생성하고
-- 전 직원이 검색·열람한다. ⚠ 웹 빌드보다 먼저 적용.

create extension if not exists "pgcrypto";

create table if not exists public.knowledge_posts (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  creator_name text,
  source text not null default 'manual',        -- kakao | cafe | manual
  source_url text,                              -- 카페 글 링크 등 출처 URL
  title text not null,
  category text not null default '기타',        -- 시책 | 상품개정 | 인수지침 | 교육 | 공지 | 기타
  summary text,                                 -- AI 요약 (3~4문장)
  key_points jsonb not null default '[]',       -- ["핵심 포인트", ...]
  tags jsonb not null default '[]',             -- ["삼성화재","간편심사",...]
  action_for_fc text,                           -- FC가 당장 할 일 (AI, 선택)
  body_text text,                               -- 붙여넣은 글 원문 (텍스트 등록 시)
  file_path text,                               -- knowledge-files 스토리지 경로 (파일 등록 시)
  file_name text,
  file_mime text,
  ai_status text not null default 'pending',    -- pending | done | failed
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists knowledge_posts_created_idx on public.knowledge_posts (created_at desc);
create index if not exists knowledge_posts_category_idx on public.knowledge_posts (category, created_at desc);

alter table public.knowledge_posts enable row level security;

-- 열람 = 전 직원, 등록·수정·삭제 = 관리자(owner/admin)만 (대표 결정).
create policy knowledge_posts_select on public.knowledge_posts for select to authenticated
using ( true );
create policy knowledge_posts_insert on public.knowledge_posts for insert to authenticated
with check ( public.is_owner_or_admin() );
create policy knowledge_posts_update on public.knowledge_posts for update to authenticated
using ( public.is_owner_or_admin() ) with check ( public.is_owner_or_admin() );
create policy knowledge_posts_delete on public.knowledge_posts for delete to authenticated
using ( public.is_owner_or_admin() );

-- 원본 파일 버킷 (비공개 — 서명 URL 열람)
insert into storage.buckets (id, name, public)
values ('knowledge-files', 'knowledge-files', false)
on conflict (id) do nothing;

create policy knowledge_obj_select on storage.objects for select to authenticated
using ( bucket_id = 'knowledge-files' );
create policy knowledge_obj_insert on storage.objects for insert to authenticated
with check ( bucket_id = 'knowledge-files' and public.is_owner_or_admin() );
create policy knowledge_obj_delete on storage.objects for delete to authenticated
using ( bucket_id = 'knowledge-files' and public.is_owner_or_admin() );

-- Do NOT add public/anon policies — authenticated only.
