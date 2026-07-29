-- =============================================================================
-- SJ-OS — 총무비서(back-office) 등급 RLS 마이그레이션
-- =============================================================================
-- 목적: '총무비서' 등급이 대표 지정 화면의 데이터를 볼/다룰 수 있게 하되,
--       직원 등급 변경(승격)은 계속 관리자(owner/admin) 전용으로 막는다.
--
-- 설계 원칙 (fail-safe, 최소권한):
--  * 기존 정책은 건드리지 않고, 총무비서 전용 정책을 "추가"만 한다(permissive OR).
--    → 어떤 화면을 빠뜨려도 총무비서에게 '빈 데이터'가 될 뿐, 과다 노출이 아니다.
--  * 등급/팀/상태 변경은 기존 profiles_guard_privileged 트리거가
--    is_owner_or_admin() 로 막고 있고, 총무비서는 거기 포함되지 않으므로
--    자동으로 차단된다(자기 자신을 대표/관리자로 승격 불가). → 이 파일은 profiles
--    UPDATE 를 총무비서에게 절대 열지 않는다.
--
-- 총무비서에게 열어주는 화면(대표 확정):
--   직원 현황 / 전직원 정리표(실적·고객정보 열람) · 직원 생일 복지 · 직원 추가·로그인
--   고객등록 승인 · 공지사항 관리 · 공유 일정(전직원) · 승인 센터(로컬, DB무관) · 경영 비서
-- 제외: CEO 대시보드, 직원/팀 관리(등급변경 화면), 개발·자동화 도구.
--
-- 적용: Supabase SQL 에디터에서 실행. 재실행 안전(idempotent).
-- 실행 전제: current_user_role() / is_owner_or_admin() 헬퍼가 이미 존재
--            (SJ_OS_SUPABASE_RLS_POLICIES.sql).
-- =============================================================================

-- 1) 헬퍼: 현재 사용자가 총무비서인가
create or replace function public.is_backoffice()
returns boolean language sql stable security definer set search_path = public as $$
  select public.current_user_role() = 'back-office'
$$;

-- =============================================================================
-- 2) 조회(SELECT) — 총무비서는 전 직원 데이터를 "읽기"만 (직원 현황/정리표/공유일정)
-- =============================================================================

-- 직원 명부 (staff-overview / staff-table / staff-login 목록)
drop policy if exists profiles_backoffice_read on public.profiles;
create policy profiles_backoffice_read on public.profiles
  for select using (public.is_backoffice());

-- 고객 (직원 현황의 고객정보 열람)
drop policy if exists customers_backoffice_read on public.customers;
create policy customers_backoffice_read on public.customers
  for select using (public.is_backoffice());

-- 일정 (직원 현황 + 공유 일정)
drop policy if exists schedule_backoffice_read on public.schedule_events;
create policy schedule_backoffice_read on public.schedule_events
  for select using (public.is_backoffice());

-- 실적 (직원 현황의 실적 열람)
drop policy if exists performance_backoffice_read on public.performance_records;
create policy performance_backoffice_read on public.performance_records
  for select using (public.is_backoffice());

-- 출퇴근 (직원 현황의 근태 열람)
drop policy if exists attendance_backoffice_read on public.attendance_records;
create policy attendance_backoffice_read on public.attendance_records
  for select using (public.is_backoffice());

-- 상담 (직원 현황 상세)
drop policy if exists consultations_backoffice_read on public.consultations;
create policy consultations_backoffice_read on public.consultations
  for select using (public.is_backoffice());

-- 실적 상세(performance_entries) — 존재할 때만
do $$
begin
  if to_regclass('public.performance_entries') is not null then
    execute 'drop policy if exists performance_entries_backoffice_read on public.performance_entries';
    execute 'create policy performance_entries_backoffice_read on public.performance_entries
             for select using (public.is_backoffice())';
  end if;
end $$;

-- 직원 생일 복지 (family-birthdays) — 존재할 때만
do $$
begin
  if to_regclass('public.staff_family_birthdays') is not null then
    execute 'drop policy if exists sfb_backoffice_read on public.staff_family_birthdays';
    execute 'create policy sfb_backoffice_read on public.staff_family_birthdays
             for select using (public.is_backoffice())';
  end if;
  if to_regclass('public.birthday_alerts') is not null then
    execute 'drop policy if exists birthday_alerts_backoffice_read on public.birthday_alerts';
    execute 'create policy birthday_alerts_backoffice_read on public.birthday_alerts
             for select using (public.is_backoffice())';
  end if;
end $$;

-- =============================================================================
-- 3) 관리 쓰기 — 총무비서가 실제로 "처리"해야 하는 화면만 선별 허용
-- =============================================================================

-- 공지사항 관리(announcements): 작성/수정/삭제
drop policy if exists notices_backoffice_manage on public.notices;
create policy notices_backoffice_manage on public.notices
  for all using (public.is_backoffice()) with check (public.is_backoffice());

-- 고객등록 승인(registration-admin): 목록 조회 + 상태 변경(승인/반려)
do $$
begin
  if to_regclass('public.customer_registrations') is not null then
    execute 'drop policy if exists cust_reg_backoffice_read on public.customer_registrations';
    execute 'create policy cust_reg_backoffice_read on public.customer_registrations
             for select using (public.is_backoffice())';
    execute 'drop policy if exists cust_reg_backoffice_update on public.customer_registrations';
    execute 'create policy cust_reg_backoffice_update on public.customer_registrations
             for update using (public.is_backoffice()) with check (public.is_backoffice())';
  end if;
end $$;

-- 고객등록 승인 시 customers.registered_insurers 병합 업데이트가 필요하므로
-- 총무비서에게 customers UPDATE 를 함께 연다(고객 관리 화면과 동일 권한 수준).
drop policy if exists customers_backoffice_update on public.customers;
create policy customers_backoffice_update on public.customers
  for update using (public.is_backoffice()) with check (public.is_backoffice());

-- 직원 추가·로그인(staff-login): 허용번호부(staff_login_accounts) 조회 + 온보딩
--  ⚠ '계정 추가만, 승격 차단' — 총무비서는 role 이 owner/admin 인 행을 만들거나
--     바꿀 수 없다(WITH CHECK). 기존 직원의 실제 등급은 profiles 이고, 그 변경은
--     profiles_guard_privileged 트리거가 관리자 전용으로 막는다(이 파일은 profiles
--     UPDATE 를 총무비서에게 열지 않음).
do $$
begin
  if to_regclass('public.staff_login_accounts') is not null then
    execute 'drop policy if exists sla_backoffice_read on public.staff_login_accounts';
    execute 'create policy sla_backoffice_read on public.staff_login_accounts
             for select using (public.is_backoffice())';

    execute 'drop policy if exists sla_backoffice_insert on public.staff_login_accounts';
    execute 'create policy sla_backoffice_insert on public.staff_login_accounts
             for insert with check (public.is_backoffice()
               and coalesce(role, ''fc'') not in (''owner'', ''admin''))';

    execute 'drop policy if exists sla_backoffice_update on public.staff_login_accounts';
    execute 'create policy sla_backoffice_update on public.staff_login_accounts
             for update using (public.is_backoffice())
             with check (public.is_backoffice()
               and coalesce(role, ''fc'') not in (''owner'', ''admin''))';
  end if;
end $$;

-- =============================================================================
-- 4) 검증(수동) — 적용 후 확인용 (주석 해제해서 실행)
-- =============================================================================
-- 총무비서 계정으로 로그인한 세션에서:
--   select public.is_backoffice();                 -- true
--   select public.is_owner_or_admin();             -- false  ← 승격/관리자 데이터 차단 확인
--   select count(*) from public.customers;         -- 전체 조회 가능(열람)
--   update public.profiles set role='owner' where id = auth.uid();  -- 42501 로 차단돼야 함
--
-- 정책 목록 확인:
--   select tablename, policyname from pg_policies
--   where policyname like '%backoffice%' order by tablename;
-- =============================================================================
