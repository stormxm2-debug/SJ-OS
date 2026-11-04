-- SJ INVEST — 건강기록 '고객이 주민번호 직접 입력'(링크) 지원 (추가형)
--
-- 직원이 고객에게 일회용 링크를 보내면, 고객이 본인 폰에서 주민번호를 입력하고
-- 간편인증을 승인한다. 링크 토큰은 해시로만 저장하고, 공개(anon) 엣지함수는
-- service_role 로 해당 요청 row 만 갱신한다. 주민번호는 어디에도 저장하지 않는다.
--
-- 모두 추가형: 컬럼 add + status CHECK 에 'awaiting_customer' 추가. 기존 데이터 불변.

alter table public.health_record_requests
  add column if not exists link_token_hash text,
  add column if not exists link_expires_at timestamptz,
  add column if not exists link_used_at   timestamptz,
  add column if not exists link_sent_to   text;

-- status CHECK 재작성(기존 값 + awaiting_customer).
alter table public.health_record_requests
  drop constraint if exists health_record_requests_status_check;
alter table public.health_record_requests
  add constraint health_record_requests_status_check
  check (status in ('draft','awaiting_customer','awaiting_auth','consented','fetching','completed','failed','expired'));

-- 토큰 조회용 인덱스(공개 엣지가 id 로 찾고 해시 비교하므로 보조).
create index if not exists health_record_requests_link_idx
  on public.health_record_requests (link_expires_at)
  where link_token_hash is not null;
