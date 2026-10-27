-- 고객 건강기록(공단·심평원) 확인 요청 — CODEF 간편인증 자동조회용 뼈대.
--
-- FC가 고객에게 간편인증을 요청하면 고객이 본인인증·동의하고, 공단/심평원 진료·검진 내역을
-- 받아 FC가 확인한다. 민감 의료정보(result)는 RLS로 보호한다.
--  - 작성 직원 본인(staff_id=auth.uid())과 owner/admin 만 조회·수정·삭제 (underwriting_analyses 와 동일 패턴)
--  - 생성은 staff_id=auth.uid() 로만
-- 실제 CODEF 상품 URL·파라미터는 엣지함수(health-record-fetch)에서 연결한다(이 표는 무관).

create table if not exists public.health_record_requests (
  id            uuid primary key default gen_random_uuid(),
  staff_id      uuid not null default auth.uid(),
  customer_id   uuid,
  customer_name text,                       -- 표시용 스냅샷(민감정보 아님)
  provider      text not null default 'codef',
  product       text not null default '',   -- '진료받은내용' / '건강검진결과' 등
  status        text not null default 'draft'
                check (status in ('draft','awaiting_auth','consented','fetching','completed','failed','expired')),
  auth_channel  text,                        -- kakao/pass/samsung 등 간편인증 채널
  consent_at    timestamptz,                 -- 고객 본인확인·동의 시각
  two_way       jsonb,                       -- CODEF 추가인증(twoWayInfo) — 1차→2차 호출 사이 임시 보관
  request_meta  jsonb not null default '{}'::jsonb,  -- 비민감 메타(조회기간·상품 등)
  result        jsonb,                       -- 받은 진료/검진 결과(민감 — RLS 보호, 로깅 금지)
  error         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists health_record_requests_staff_idx on public.health_record_requests (staff_id, created_at desc);
create index if not exists health_record_requests_customer_idx on public.health_record_requests (customer_id);

alter table public.health_record_requests enable row level security;

-- underwriting_analyses 와 동일: 본인 또는 owner/admin 만 접근.
drop policy if exists health_record_requests_select on public.health_record_requests;
create policy health_record_requests_select
  on public.health_record_requests for select to authenticated
  using (is_owner_or_admin() or staff_id = auth.uid());

drop policy if exists health_record_requests_insert on public.health_record_requests;
create policy health_record_requests_insert
  on public.health_record_requests for insert to authenticated
  with check (staff_id = auth.uid());

drop policy if exists health_record_requests_update on public.health_record_requests;
create policy health_record_requests_update
  on public.health_record_requests for update to authenticated
  using (is_owner_or_admin() or staff_id = auth.uid())
  with check (is_owner_or_admin() or staff_id = auth.uid());

drop policy if exists health_record_requests_delete on public.health_record_requests;
create policy health_record_requests_delete
  on public.health_record_requests for delete to authenticated
  using (is_owner_or_admin() or staff_id = auth.uid());

-- updated_at 자동 갱신(전용 트리거 함수 — 이름 충돌 방지).
create or replace function public.health_record_requests_touch()
returns trigger language plpgsql
set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists health_record_requests_touch_trg on public.health_record_requests;
create trigger health_record_requests_touch_trg
  before update on public.health_record_requests
  for each row execute function public.health_record_requests_touch();
