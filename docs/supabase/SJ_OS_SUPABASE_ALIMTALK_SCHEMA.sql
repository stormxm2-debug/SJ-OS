-- ============================================================================
-- SJ OS — 알림톡 발송 로그 (alimtalk_logs) + 전날 리마인더 pg_cron
--
-- 실행 위치: Supabase Dashboard > SQL Editor
-- 실행 시점: send-alimtalk edge function 배포와 함께 (총괄 세션/대표님)
--
-- 쓰기(INSERT)는 edge function(service_role)만 한다 — authenticated에게는
-- INSERT 정책을 만들지 않는다. 읽기는 본인 발송분 + 관리자 전체.
-- 전화번호 원본은 저장하지 않는다(마스킹만).
-- ============================================================================

create table if not exists public.alimtalk_logs (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid references public.schedule_events(id) on delete set null,
  customer_id uuid references public.customers(id) on delete set null,
  staff_id uuid references public.profiles(id) on delete set null,
  -- 버튼을 누른 사람 (배치 리마인더는 null)
  sent_by uuid references public.profiles(id) on delete set null,
  kind text not null check (kind in ('confirm','reminder','change')),
  phone_masked text not null default '***',
  status text not null check (status in ('success','failed')),
  provider_message_id text,
  error text,
  created_at timestamptz not null default now()
);

create index if not exists alimtalk_logs_schedule_idx on public.alimtalk_logs(schedule_id, kind, status, created_at desc);
create index if not exists alimtalk_logs_staff_idx on public.alimtalk_logs(staff_id, created_at desc);

alter table public.alimtalk_logs enable row level security;

create policy alimtalk_logs_select on public.alimtalk_logs for select to authenticated
using ( staff_id = auth.uid() or public.is_owner_or_admin() );

-- ============================================================================
-- (선택) 전날 오전 9시 자동 리마인더 — 솔라피 키/템플릿 등록이 끝난 뒤에 활성화
--
-- 아래 두 값을 실제 값으로 바꾼 뒤 주석을 해제해 실행:
--   <PROJECT_REF>  = kmjnluubjgyxkppxxjel
--   <SERVICE_ROLE> = Dashboard > Settings > API > service_role key
-- pg_cron 스케줄은 UTC 기준 — KST 09:00 = UTC 00:00.
-- ============================================================================

-- create extension if not exists pg_cron;
-- create extension if not exists pg_net;
--
-- select cron.schedule(
--   'alimtalk-remind-tomorrow',
--   '0 0 * * *',
--   $$
--   select net.http_post(
--     url := 'https://<PROJECT_REF>.supabase.co/functions/v1/send-alimtalk',
--     headers := jsonb_build_object(
--       'Content-Type', 'application/json',
--       'Authorization', 'Bearer <SERVICE_ROLE>'
--     ),
--     body := '{"mode":"remind-tomorrow"}'::jsonb
--   );
--   $$
-- );
--
-- 해제하려면: select cron.unschedule('alimtalk-remind-tomorrow');
