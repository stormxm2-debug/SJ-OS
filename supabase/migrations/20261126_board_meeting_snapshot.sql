-- 경영 회의실 주간 자동 소집 — 서버용 데이터 스냅샷 함수.
-- board-meeting-weekly 엣지함수가 service_role로 호출한다(security definer로 전사 집계).
--
-- ※ 호출 비밀값은 Vault에 저장하고(비밀은 저장소에 남기지 않음) check_cron_secret()으로 대조한다.
--   예약(pg_cron)과 Vault 비밀은 운영 DB에 직접 생성한다(Supabase MCP):
--     select vault.create_secret('<secret>','board_cron_secret');
--     select cron.schedule('board-meeting-weekly','0 23 * * 0', $$  -- 일 23:00 UTC = 월 08:00 KST
--       select net.http_post(
--         url := 'https://<project>.supabase.co/functions/v1/board-meeting-weekly',
--         headers := jsonb_build_object('Content-Type','application/json','x-cron-secret','<secret>'),
--         body := '{}'::jsonb);
--     $$);

create or replace function public.board_meeting_snapshot()
returns text
language sql
security definer
set search_path = public
as $$
  with m as (
    select to_char(now(),'YYYY-MM') cur, to_char(now() - interval '1 month','YYYY-MM') prev
  )
  select concat_ws(E'\n',
    '[직원] 총 ' || (select count(*) from profiles) || '명',
    '[이번달 매출입력] ' || (select count(*) from performance_entries pe, m where pe.month = m.cur) ||
      '건 / 합계 ' || (select coalesce(sum(amount),0) from performance_entries pe, m where pe.month = m.cur),
    '[지난달 매출입력] ' || (select count(*) from performance_entries pe, m where pe.month = m.prev) ||
      '건 / 합계 ' || (select coalesce(sum(amount),0) from performance_entries pe, m where pe.month = m.prev),
    '[이번달 실적 올린 직원] ' || (select count(distinct staff_id) from performance_entries pe, m where pe.month = m.cur) || '명',
    '[고객] 총 ' || (select count(*) from customers) ||
      '명 (이번달 실유입(경로 있음) ' || (select count(*) from customers where created_at >= date_trunc('month',now()) and source is not null) || '명)',
    '[최근 7일 출퇴근 활동 직원] ' || (select count(distinct staff_id) from attendance_records where timestamp >= now() - interval '7 days') || '명',
    '[이번달 지각(벌금) 건] ' || (select count(*) from attendance_records where coalesce(late_fee,0) > 0 and timestamp >= date_trunc('month',now())),
    '[영업리스트] 고객 ' || (select count(*) from sales_customer_rows) || '행 / 리쿠르팅 ' || (select count(*) from sales_recruit_rows) || '행',
    '[소개영업] ' || (select count(*) from referrals) || '건 / [DB배정] ' || (select count(*) from leads) || '건 / [접촉로그] ' || (select count(*) from contact_logs) || '건',
    '[건강기록 조회] ' || (select count(*) from health_record_requests) || '건',
    '조회시각 ' || to_char(now() at time zone 'Asia/Seoul','YYYY-MM-DD HH24:MI') || ' KST'
  );
$$;

grant execute on function public.board_meeting_snapshot() to service_role;

-- cron 호출 인증 — Vault의 'board_cron_secret'과 대조. 엣지함수가 service_role로 호출한다.
create or replace function public.check_cron_secret(s text)
returns boolean
language sql
security definer
set search_path = public, vault
as $$
  select exists (
    select 1 from vault.decrypted_secrets
    where name = 'board_cron_secret' and decrypted_secret = s
  );
$$;
grant execute on function public.check_cron_secret(text) to service_role;
