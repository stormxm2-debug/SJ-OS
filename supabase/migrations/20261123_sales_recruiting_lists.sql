-- FC 영업·리쿠르팅 리스트 (전산)
-- 사용자별(staff_id = auth.uid()) 월별 리스트 2종 + 미완료 다음 달 자동 이월 함수.
-- · 완료(done=true) 건은 이월하지 않고 '완료 보관함'으로 조회한다.
-- · 체크 안 한(done=false) 건만 다음 달 리스트로 복제 이월한다.

-- ───────────────────────── 고객 영업 리스트 ─────────────────────────
create table if not exists public.sales_customer_rows (
  id                uuid primary key default gen_random_uuid(),
  staff_id          uuid not null default auth.uid(),
  month             text not null,                       -- 'YYYY-MM'
  name              text,
  kakao_ap          text,
  ta_ap             text,
  ap_meet           text,
  consult1          text,
  consult2          text,
  contract_expected text,
  contract          text,
  policy_delivered  text,
  gift_delivered    text,
  referrals         text,
  done              boolean not null default false,
  done_at           timestamptz,
  order_index       integer not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists sales_customer_rows_staff_month_idx
  on public.sales_customer_rows (staff_id, month, order_index);

-- ───────────────────────── 리쿠르팅(CIS) 리스트 ─────────────────────────
create table if not exists public.sales_recruit_rows (
  id                uuid primary key default gen_random_uuid(),
  staff_id          uuid not null default auth.uid(),
  month             text not null,                       -- 'YYYY-MM'
  name              text,
  age               text,
  region_job        text,
  contact           text,
  ap_meet           text,
  meet1             text,
  meet2             text,
  meet3             text,
  consult_done      text,
  contract_done     text,
  bm_cis1           text,
  bm_cis2           text,
  enroll_expected   text,
  rep_buzz          text,
  done              boolean not null default false,
  done_at           timestamptz,
  order_index       integer not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists sales_recruit_rows_staff_month_idx
  on public.sales_recruit_rows (staff_id, month, order_index);

-- ───────────────────────── RLS ─────────────────────────
alter table public.sales_customer_rows enable row level security;
alter table public.sales_recruit_rows  enable row level security;

do $$ begin
  -- 고객
  drop policy if exists sales_customer_rows_select on public.sales_customer_rows;
  create policy sales_customer_rows_select on public.sales_customer_rows
    for select to authenticated using (is_owner_or_admin() or staff_id = auth.uid());
  drop policy if exists sales_customer_rows_insert on public.sales_customer_rows;
  create policy sales_customer_rows_insert on public.sales_customer_rows
    for insert to authenticated with check (staff_id = auth.uid());
  drop policy if exists sales_customer_rows_update on public.sales_customer_rows;
  create policy sales_customer_rows_update on public.sales_customer_rows
    for update to authenticated
    using (is_owner_or_admin() or staff_id = auth.uid())
    with check (is_owner_or_admin() or staff_id = auth.uid());
  drop policy if exists sales_customer_rows_delete on public.sales_customer_rows;
  create policy sales_customer_rows_delete on public.sales_customer_rows
    for delete to authenticated using (is_owner_or_admin() or staff_id = auth.uid());

  -- 리쿠르팅
  drop policy if exists sales_recruit_rows_select on public.sales_recruit_rows;
  create policy sales_recruit_rows_select on public.sales_recruit_rows
    for select to authenticated using (is_owner_or_admin() or staff_id = auth.uid());
  drop policy if exists sales_recruit_rows_insert on public.sales_recruit_rows;
  create policy sales_recruit_rows_insert on public.sales_recruit_rows
    for insert to authenticated with check (staff_id = auth.uid());
  drop policy if exists sales_recruit_rows_update on public.sales_recruit_rows;
  create policy sales_recruit_rows_update on public.sales_recruit_rows
    for update to authenticated
    using (is_owner_or_admin() or staff_id = auth.uid())
    with check (is_owner_or_admin() or staff_id = auth.uid());
  drop policy if exists sales_recruit_rows_delete on public.sales_recruit_rows;
  create policy sales_recruit_rows_delete on public.sales_recruit_rows
    for delete to authenticated using (is_owner_or_admin() or staff_id = auth.uid());
end $$;

-- ───────────────────────── updated_at 트리거 ─────────────────────────
create or replace function public.sales_rows_touch() returns trigger
  language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end; $$;

drop trigger if exists sales_customer_rows_touch on public.sales_customer_rows;
create trigger sales_customer_rows_touch before update on public.sales_customer_rows
  for each row execute function public.sales_rows_touch();
drop trigger if exists sales_recruit_rows_touch on public.sales_recruit_rows;
create trigger sales_recruit_rows_touch before update on public.sales_recruit_rows
  for each row execute function public.sales_rows_touch();

-- ───────────────────────── 미완료 다음 달 자동 이월 ─────────────────────────
-- 대상 월(p_month)에 내 행이 하나도 없으면, 직전 달의 '완료 안 한(done=false)'
-- 행을 그대로 복제해 온다(완료 건은 제외 → 완료 보관함에만 남는다).
-- 호출자(auth.uid())의 행에만 작동하고 RLS가 그대로 적용된다(security invoker).
create or replace function public.ensure_sales_month(p_month text)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare prev text;
begin
  if p_month is null or p_month !~ '^\d{4}-\d{2}$' then
    return;
  end if;
  prev := to_char((to_date(p_month || '-01', 'YYYY-MM-DD') - interval '1 month'), 'YYYY-MM');

  if not exists (
    select 1 from public.sales_customer_rows where staff_id = auth.uid() and month = p_month
  ) then
    insert into public.sales_customer_rows
      (staff_id, month, name, kakao_ap, ta_ap, ap_meet, consult1, consult2,
       contract_expected, contract, policy_delivered, gift_delivered, referrals, done, order_index)
    select auth.uid(), p_month, name, kakao_ap, ta_ap, ap_meet, consult1, consult2,
       contract_expected, contract, policy_delivered, gift_delivered, referrals, false, order_index
    from public.sales_customer_rows
    where staff_id = auth.uid() and month = prev and done = false;
  end if;

  if not exists (
    select 1 from public.sales_recruit_rows where staff_id = auth.uid() and month = p_month
  ) then
    insert into public.sales_recruit_rows
      (staff_id, month, name, age, region_job, contact, ap_meet, meet1, meet2, meet3,
       consult_done, contract_done, bm_cis1, bm_cis2, enroll_expected, rep_buzz, done, order_index)
    select auth.uid(), p_month, name, age, region_job, contact, ap_meet, meet1, meet2, meet3,
       consult_done, contract_done, bm_cis1, bm_cis2, enroll_expected, rep_buzz, false, order_index
    from public.sales_recruit_rows
    where staff_id = auth.uid() and month = prev and done = false;
  end if;
end $$;

grant execute on function public.ensure_sales_month(text) to authenticated;

-- ───────────────────────── Realtime 구독 대상 추가 ─────────────────────────
do $$ begin
  alter publication supabase_realtime add table public.sales_customer_rows;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.sales_recruit_rows;
exception when duplicate_object then null; end $$;
