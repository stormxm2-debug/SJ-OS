-- ============================================================================
-- 긴급 수정: 지각 보고 크론(sj-late-report)이 매일 실패하는 버그
--
-- 원인: 크론이 announcements.priority='high'를 삽입하지만 체크 제약은
--       'normal' | 'important' | 'urgent'만 허용 → 매 평일 09:05 KST 실패.
--       (cron.job_run_details에 7/9, 7/10 연속 failed 기록)
-- 수정: 'high' → 'important' 한 단어. cron.schedule은 같은 이름이면 교체됨.
--
-- 실행 위치: Supabase Dashboard > SQL Editor (총괄 세션 또는 대표님)
-- ============================================================================

select cron.schedule(
  'sj-late-report',
  '5 0 * * 1-5',
  $CMD$
  insert into public.announcements (title, body, priority, target_type, status, pinned, published_at)
  select
    to_char(now() at time zone 'Asia/Seoul', 'MM월 DD일') || ' 지각 보고 (9시 기준)',
    case when count(p.id) = 0
      then '전원 9시 이전 출근 완료! 👏'
      else '9시까지 미출근: ' || string_agg(p.name, ', ' order by p.name)
        || E'\n(이후 출근 시각 기준 벌금: 9시 초과 5만 · 11시 초과 10만 · 12시 초과 20만)'
    end,
    'important', 'all', 'published', false, now()
  from public.profiles p
  where p.status = 'active'
    and p.role in ('fc','team-leader')
    and not exists (
      select 1 from public.attendance_records a
      where a.staff_id = p.id
        and a.type = 'check-in'
        and a.timestamp >= date_trunc('day', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul'
    );
  $CMD$
);

-- 확인: select jobname, schedule, active from cron.job where jobname='sj-late-report';
-- 다음 평일 09:05(KST) 실행 후: select status from cron.job_run_details order by start_time desc limit 1;
