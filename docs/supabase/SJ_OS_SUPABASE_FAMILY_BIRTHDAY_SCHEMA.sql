-- SJ OS — 직원 복지: 본인·가족 생일 챙기기. ⚠ NOT YET APPLIED — 총괄이 실행 + pg_cron 스케줄.
-- 직원이 본인/가족의 이름·관계·주민번호 '앞자리'(생년월일)를 등록 → 관리자가 전 직원분을
-- 모아보고, 생일 3일 전~당일이면 관리자에게만 알림.
-- 🔒 개인정보 최소화: 주민번호는 **앞 6~7자리(생년월일+세기)만** 저장한다(뒷 6자리 금지).
-- Requires public.profiles, public.is_owner_or_admin().

create extension if not exists "pgcrypto";

-- ── 본인·가족 생일 ────────────────────────────────────────────────────────────
create table if not exists public.staff_family_birthdays (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.profiles(id) on delete cascade,  -- 등록한 직원(소유자)
  name text not null,                    -- 본인/가족 이름
  relation text not null default '본인'
    check (relation in ('본인','배우자','자녀','부모','형제자매','기타')),
  rrn_front text not null                 -- 주민번호 앞자리(생년월일+세기 6~7자리 숫자만)
    check (rrn_front ~ '^[0-9]{6,7}$'),
  last_alerted_year int,                  -- 올해 알림 발송 여부(중복 알림 방지)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists staff_family_birthdays_staff_idx on public.staff_family_birthdays (staff_id);

create or replace function public.staff_family_birthdays_touch()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end; $$;
drop trigger if exists staff_family_birthdays_touch on public.staff_family_birthdays;
create trigger staff_family_birthdays_touch before update on public.staff_family_birthdays
for each row execute function public.staff_family_birthdays_touch();

alter table public.staff_family_birthdays enable row level security;
-- 조회/수정/삭제 = 본인 등록분 + 관리자. 생성 = 본인(staff_id=auth.uid()) 또는 관리자.
create policy sfb_select on public.staff_family_birthdays for select to authenticated
  using ( staff_id = auth.uid() or public.is_owner_or_admin() );
create policy sfb_insert on public.staff_family_birthdays for insert to authenticated
  with check ( staff_id = auth.uid() or public.is_owner_or_admin() );
create policy sfb_update on public.staff_family_birthdays for update to authenticated
  using ( staff_id = auth.uid() or public.is_owner_or_admin() )
  with check ( staff_id = auth.uid() or public.is_owner_or_admin() );
create policy sfb_delete on public.staff_family_birthdays for delete to authenticated
  using ( staff_id = auth.uid() or public.is_owner_or_admin() );

-- ── 생일 알림(관리자에게만) — cron이 생성 ─────────────────────────────────────
create table if not exists public.birthday_alerts (
  id uuid primary key default gen_random_uuid(),
  family_id uuid references public.staff_family_birthdays(id) on delete cascade,
  staff_name text,                        -- 등록한 직원
  person_name text,                       -- 생일 당사자
  relation text,
  birth_md text,                          -- 'MM-DD'
  days_until int,                         -- 0~3
  created_at timestamptz not null default now()
);
create index if not exists birthday_alerts_recent_idx on public.birthday_alerts (created_at desc);

alter table public.birthday_alerts enable row level security;
-- 조회 = 관리자만("관리자에게만"). INSERT는 service_role(cron)만.
create policy birthday_alerts_select_admin on public.birthday_alerts for select to authenticated
  using ( public.is_owner_or_admin() );

alter publication supabase_realtime add table public.birthday_alerts;

-- ── 매일 점검 함수 (pg_cron 이 호출) ──────────────────────────────────────────
-- 각 행의 생년월일(MMDD)로 올해/내년 생일 중 다가오는 날을 구해, 0~3일 남았고 올해 아직
-- 알림 안 보낸 건이면 birthday_alerts 를 만들고 last_alerted_year 를 올해로 표시.
create or replace function public.run_birthday_alerts()
returns void language plpgsql security definer set search_path = public as $$
declare
  r record;
  mm int; dd int;
  y int := extract(year from current_date)::int;
  bday date;
  du int;
begin
  for r in
    select f.*, p.name as staff_nm
    from public.staff_family_birthdays f
    join public.profiles p on p.id = f.staff_id
    where f.rrn_front ~ '^[0-9]{6,7}$'
      and coalesce(f.last_alerted_year, 0) <> y
  loop
    begin
      mm := substring(r.rrn_front from 3 for 2)::int;
      dd := substring(r.rrn_front from 5 for 2)::int;
      if mm < 1 or mm > 12 or dd < 1 or dd > 31 then continue; end if;
      -- 2/29 등 올해에 없는 날짜는 예외 → 건너뜀(내년 계산도 동일하게 실패 시 skip)
      bday := make_date(y, mm, dd);
      if bday < current_date then bday := make_date(y + 1, mm, dd); end if;
    exception when others then
      continue;  -- 잘못된 날짜(윤일 등)는 조용히 건너뜀
    end;
    du := bday - current_date;
    if du between 0 and 3 then
      insert into public.birthday_alerts (family_id, staff_name, person_name, relation, birth_md, days_until)
      values (r.id, r.staff_nm, r.name, r.relation,
              lpad(mm::text,2,'0') || '-' || lpad(dd::text,2,'0'), du);
      update public.staff_family_birthdays set last_alerted_year = y where id = r.id;
    end if;
  end loop;
end;
$$;

-- 스케줄 (총괄): 매일 KST 09:00 = UTC 00:00
-- select cron.schedule('sj-birthday-alerts', '0 0 * * *', $$ select public.run_birthday_alerts(); $$);
