-- SJ OS — 보험서류 자동청구(팩스 접수) 스키마. ⚠ NOT YET APPLIED — 총괄이 실행.
-- 목적: FC가 청구 서류(PDF/이미지)를 올리고, 최대 3개 보험사에 동시에 팩스로
--       청구 접수한다. 회사별로 '필요한 서류만' 골라 보낼 수 있다(지능형 라우팅).
-- 전송은 엣지 함수 send-claim-fax(솔라피 팩스 API)가 담당한다.
-- Requires base helper public.is_owner_or_admin().
--
-- 개인정보 원칙(중요):
--  - 팩스 번호는 관리자만 등록/수정한다(오발송 = 민감 질병정보 유출이므로).
--  - 서버(엣지 함수)가 팩스 번호를 조회한다 — 클라이언트가 목적지 번호를 보내지 않는다.
--  - 서류 파일은 비공개 버킷(claim-fax)에 두고, 서명 URL로만 접근한다.

create extension if not exists "pgcrypto";

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) 보험사 청구접수 팩스번호 (관리자 관리) — 회사연락처(company_contacts)와 별개.
--    이 번호는 매니저 개인 팩스가 아니라 '보상서비스센터 청구접수' 대표 팩스다.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.insurer_fax (
  id uuid primary key default gen_random_uuid(),
  insurer text not null unique,     -- 보험사명 (INSURERS 12개사 + 기타 텍스트)
  fax text not null,                -- 청구접수 팩스번호 (숫자/하이픈)
  label text,                       -- '보상서비스센터' 등 표시용
  memo text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);

create or replace function public.insurer_fax_touch()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists insurer_fax_touch on public.insurer_fax;
create trigger insurer_fax_touch
before update on public.insurer_fax
for each row execute function public.insurer_fax_touch();

alter table public.insurer_fax enable row level security;

create policy insurer_fax_select on public.insurer_fax
for select to authenticated using (true);
create policy insurer_fax_insert_admin on public.insurer_fax
for insert to authenticated with check (public.is_owner_or_admin());
create policy insurer_fax_update_admin on public.insurer_fax
for update to authenticated using (public.is_owner_or_admin()) with check (public.is_owner_or_admin());
create policy insurer_fax_delete_admin on public.insurer_fax
for delete to authenticated using (public.is_owner_or_admin());

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) 청구 발송 이벤트 (한 번의 '자동청구' = 한 행). 업로드한 서류 전체를 documents에 기록.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.claim_fax_submissions (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.profiles(id) on delete cascade,  -- 발송한 FC
  customer_id uuid references public.customers(id) on delete set null,
  customer_name text,               -- 스냅샷(고객 삭제/미선택 대비)
  analysis_id uuid,                 -- 연결된 청구비서 분석(claim_analyses.id) — 있으면
  -- 업로드된 서류 전체: [{ path, name, docType }]
  documents jsonb not null default '[]'::jsonb,
  consent boolean not null default false,   -- 고객 청구 위임 확인
  note text,
  created_at timestamptz not null default now()
);

create index if not exists claim_fax_submissions_staff_idx on public.claim_fax_submissions (staff_id, created_at desc);

alter table public.claim_fax_submissions enable row level security;

-- 조회/삭제 = 본인 + 관리자, 생성 = 본인(로그인 사용자). 수정은 없음(불변 이벤트).
create policy claim_fax_sub_select on public.claim_fax_submissions
for select to authenticated using (staff_id = auth.uid() or public.is_owner_or_admin());
create policy claim_fax_sub_insert_own on public.claim_fax_submissions
for insert to authenticated with check (staff_id = auth.uid());
create policy claim_fax_sub_delete on public.claim_fax_submissions
for delete to authenticated using (staff_id = auth.uid() or public.is_owner_or_admin());

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) 회사별 발송 대상 (최대 3행/제출). 회사마다 어떤 서류를 보냈는지 + 발송 상태.
--    상태 갱신은 엣지 함수(service_role)만 한다.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.claim_fax_targets (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.claim_fax_submissions(id) on delete cascade,
  insurer text not null,
  fax text not null,                -- 발송 시점 번호 스냅샷(엣지 함수가 서버에서 채움)
  file_paths text[] not null default '{}',  -- 이 회사에 보낸 서류 경로(라우팅 결과)
  status text not null default 'queued' check (status in ('queued','sending','sent','failed')),
  provider_group_id text,           -- 솔라피 그룹/메시지 id
  error text,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists claim_fax_targets_sub_idx on public.claim_fax_targets (submission_id);

alter table public.claim_fax_targets enable row level security;

-- 조회 = 제출 소유자 + 관리자. 생성 = 제출 소유자(초기 큐잉).
-- 상태 UPDATE는 엣지 함수(service_role, RLS 우회)만 — authenticated UPDATE 정책 없음.
create policy claim_fax_tgt_select on public.claim_fax_targets
for select to authenticated using (
  exists (
    select 1 from public.claim_fax_submissions s
    where s.id = submission_id and (s.staff_id = auth.uid() or public.is_owner_or_admin())
  )
);
create policy claim_fax_tgt_insert_own on public.claim_fax_targets
for insert to authenticated with check (
  exists (
    select 1 from public.claim_fax_submissions s
    where s.id = submission_id and s.staff_id = auth.uid()
  )
);

-- 실시간(발송 상태 칩 즉시 반영)
alter publication supabase_realtime add table public.claim_fax_targets;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) 비공개 스토리지 버킷 claim-fax (Storage > New bucket, public = OFF)
--    정책: 로그인 직원은 자기 uid 하위 경로에만 쓰기, 본인+관리자 읽기.
--    경로 규약: <staffUid>/<submissionId>/<uuid>.<ext>
-- ─────────────────────────────────────────────────────────────────────────────
-- insert into storage.buckets (id, name, public) values ('claim-fax','claim-fax', false)
--   on conflict (id) do nothing;
--
-- create policy "claim_fax_read_own" on storage.objects for select to authenticated
--   using ( bucket_id = 'claim-fax' and ( (storage.foldername(name))[1] = auth.uid()::text or public.is_owner_or_admin() ) );
-- create policy "claim_fax_write_own" on storage.objects for insert to authenticated
--   with check ( bucket_id = 'claim-fax' and (storage.foldername(name))[1] = auth.uid()::text );
-- create policy "claim_fax_delete_own" on storage.objects for delete to authenticated
--   using ( bucket_id = 'claim-fax' and ( (storage.foldername(name))[1] = auth.uid()::text or public.is_owner_or_admin() ) );
--
-- 엣지 함수(service_role)는 RLS를 우회하므로 별도 read 정책 없이 파일을 내려받아 팩스로 보낸다.
