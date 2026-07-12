-- SJ OS — 오늘의 접촉 리스트: 접촉로그 schema. REVIEW before production.
-- FC가 고객에게 연락한 기록(전화/카톡/문자)을 원탭으로 남긴다.
-- '마지막 접촉일' 계산의 1차 근거가 되어 90일 무접촉 고객 추출 정확도를 높이고,
-- 월별 접촉 활동량 통계의 기반이 된다.
-- Run AFTER base schema (profiles, customers) + admin phone login schema (is_owner_or_admin).

create table if not exists public.contact_logs (
  id uuid primary key default gen_random_uuid(),
  -- 연락한 담당 FC — 본인 소유. RLS 경계.
  fc_id uuid not null references public.profiles(id) on delete cascade,
  fc_name text,                    -- 표시용 비정규화 (직원 이름)
  -- 연락 대상 고객. 고객관리 미연결 대상(소개 리마인드 등)은 이름만 기록.
  customer_id uuid references public.customers(id) on delete set null,
  customer_name text not null,
  channel text not null default 'call',   -- call | kakao | sms
  reason text,                     -- 접촉 사유 (birthday | dormant | referral-remind | manual …)
  note text,                       -- 한 줄 메모
  contacted_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists contact_logs_fc_idx on public.contact_logs (fc_id, contacted_at desc);
create index if not exists contact_logs_customer_idx on public.contact_logs (customer_id, contacted_at desc);

alter table public.contact_logs enable row level security;

-- 직원은 본인 것만, 관리자(owner/admin)는 전체 (내것↔직원것 분리 원칙).
drop policy if exists contact_logs_select on public.contact_logs;
create policy contact_logs_select on public.contact_logs
  for select using (is_owner_or_admin() or fc_id = auth.uid());

-- 접촉 기록은 본인 명의로만 생성 (관리자는 전체 허용).
drop policy if exists contact_logs_insert on public.contact_logs;
create policy contact_logs_insert on public.contact_logs
  for insert with check (is_owner_or_admin() or fc_id = auth.uid());

drop policy if exists contact_logs_update on public.contact_logs;
create policy contact_logs_update on public.contact_logs
  for update using (is_owner_or_admin() or fc_id = auth.uid())
  with check (is_owner_or_admin() or fc_id = auth.uid());

drop policy if exists contact_logs_delete on public.contact_logs;
create policy contact_logs_delete on public.contact_logs
  for delete using (is_owner_or_admin() or fc_id = auth.uid());
