-- SJ OS — 면책 종료(보장 시작) 고객 자동 알림톡 (exemption-notify 배치용).
-- ⚠ NOT YET APPLIED — 총괄이 실행 + pg_cron 스케줄 + 솔라피 설정 필요.
--
-- 전제:
--  1) SJ_OS_SUPABASE_EXEMPTION_SCHEMA.sql 적용됨 (policy_exemptions / exemption_alerts / cron 09:00)
--  2) 엣지 함수 exemption-notify 배포됨 (v1 배포 완료 — 2026-07-14)
--  3) 솔라피 시크릿 등록: SOLAPI_API_KEY / SOLAPI_API_SECRET / SOLAPI_PF_ID /
--     SOLAPI_SENDER_PHONE + 신규 템플릿 SOLAPI_TPL_EXEMPTION_DUE (카카오 심사 필요)
--     ↳ 템플릿 변수: #{고객명} #{보험사} #{담보} #{개시일}
--     ↳ 문안 예시: "#{고객명}님, 가입하신 #{보험사} #{담보}의 면책기간이 끝나
--        #{개시일}부터 보장이 시작됩니다. 궁금하신 점은 담당 설계사에게 문의 주세요."
--
-- 동작: 매일 09:00 run_exemption_alerts()가 도래(due) 알림을 만들고(담당 FC 수신),
--       09:10 이 배치가 그 도래 건의 "고객"에게 알림톡을 자동 발송한다.
--       솔라피 미설정이면 배치는 503으로 조용히 실패 — 앱/FC 알림에는 영향 없음.

-- ── 1) 고객 발송 여부 플래그 ─────────────────────────────────────────────────
alter table public.exemption_alerts
  add column if not exists customer_notified boolean not null default false;

-- ── 2) pg_cron 스케줄 (매일 KST 09:10 = UTC 00:10) ───────────────────────────
-- <SERVICE_ROLE>을 실제 service_role 키로 바꿔 실행 (Dashboard > SQL Editor).
-- create extension if not exists pg_net;
--
-- select cron.schedule(
--   'sj-exemption-customer-notify',
--   '10 0 * * *',
--   $$
--   select net.http_post(
--     url := 'https://kmjnluubjgyxkppxxjel.supabase.co/functions/v1/exemption-notify',
--     headers := jsonb_build_object(
--       'Content-Type', 'application/json',
--       'Authorization', 'Bearer <SERVICE_ROLE>'
--     ),
--     body := '{"mode":"notify-due"}'::jsonb
--   );
--   $$
-- );
--
-- 해제하려면: select cron.unschedule('sj-exemption-customer-notify');
