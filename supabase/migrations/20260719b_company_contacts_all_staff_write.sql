-- 매니저 연락처: 전 직원(로그인 사용자) 수정 허용으로 변경.
-- 기존 owner·admin 전용 쓰기 정책을 authenticated 전체로 교체한다. 읽기는 그대로.
drop policy if exists company_contacts_insert_admin on public.company_contacts;
drop policy if exists company_contacts_update_admin on public.company_contacts;
drop policy if exists company_contacts_delete_admin on public.company_contacts;

create policy company_contacts_insert_staff
  on public.company_contacts for insert to authenticated
  with check (true);

create policy company_contacts_update_staff
  on public.company_contacts for update to authenticated
  using (true) with check (true);

create policy company_contacts_delete_staff
  on public.company_contacts for delete to authenticated
  using (true);
