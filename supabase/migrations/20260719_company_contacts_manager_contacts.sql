-- 매니저 연락처(팀 공유) — public.company_contacts 확장
--
-- 이 앱의 '매니저 연락처' 화면이 사용하는 팀 공유 테이블. 기존 company_contacts
-- (전 직원 읽기 / owner·admin 쓰기, RLS + supabase_realtime 등록됨)에 손보/생보
-- 구분 컬럼과, 업로드 시 목록 전체를 원자적으로 교체하는 함수를 추가한다.
--
-- 저장 모델(플랫): 한 사람 = 한 행. title = 설계매니저/부지점장/지점장,
-- category = sonbo(손보)/saengbo(생보). 화면의 보험사 단위 그룹 뷰는 조회 시 재구성.

alter table public.company_contacts
  add column if not exists category text not null default 'sonbo';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.company_contacts'::regclass
      and conname = 'company_contacts_category_chk'
  ) then
    alter table public.company_contacts
      add constraint company_contacts_category_chk
      check (category in ('sonbo','saengbo'));
  end if;
end $$;

create index if not exists company_contacts_category_sort_idx
  on public.company_contacts (category, sort_order);

-- 매니저 연락처 전체를 원자적으로 교체(업로드 반영)한다.
-- SECURITY INVOKER: 내부 delete/insert 는 호출자 권한으로 실행되므로
-- 기존 RLS(전 직원 읽기 / owner·admin 쓰기)가 그대로 적용된다.
create or replace function public.replace_company_contacts(p_rows jsonb)
returns void
language plpgsql
security invoker
set search_path = public
as $fn$
begin
  delete from public.company_contacts;
  insert into public.company_contacts
    (category, insurer, manager_name, title, phone, office_phone, email, memo, sort_order, updated_by, updated_at)
  select
    coalesce(nullif(r->>'category',''), 'sonbo'),
    coalesce(r->>'insurer', ''),
    coalesce(r->>'manager_name', ''),
    coalesce(nullif(r->>'title',''), '매니저'),
    coalesce(r->>'phone', ''),
    nullif(r->>'office_phone',''),
    nullif(r->>'email',''),
    nullif(r->>'memo',''),
    coalesce((r->>'sort_order')::int, 0),
    auth.uid(),
    now()
  from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) as r;
end;
$fn$;

grant execute on function public.replace_company_contacts(jsonb) to authenticated;
