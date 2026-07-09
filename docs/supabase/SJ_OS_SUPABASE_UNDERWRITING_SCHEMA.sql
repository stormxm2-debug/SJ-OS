-- SJ OS — 예외질병 인수 가이드 schema DRAFT. REVIEW before production.
-- 질병 × 보험사 인수 기준 분류표. 전 직원 읽기 / owner·admin만 쓰기 (RLS).
-- Run AFTER the base schema (profiles) + admin phone login schema (is_owner_or_admin).
--
-- ⚠ 시드 데이터는 AI 일반 지식 기반 "참고용(verified=false)"이다. 실제 인수 지침은
--   보험사별·시기별로 다르므로 관리자가 앱에서 수정/검수해야 한다 (검수 시 verified=true).

create extension if not exists "pgcrypto";

-- === 질병 목록 ===
create table if not exists public.underwriting_diseases (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  category text not null default '기타',
  aliases text[] not null default '{}',
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

-- === 질병 × 보험사 인수 기준 ===
-- status: standard(표준인수) / simplified(유병자플랜) / exclusion(부담보) /
--         loading(할증) / decline(거절) / unknown(미입력)
create table if not exists public.underwriting_rules (
  id uuid primary key default gen_random_uuid(),
  disease_id uuid not null references public.underwriting_diseases(id) on delete cascade,
  insurer text not null,
  status text not null default 'unknown'
    check (status in ('standard','simplified','exclusion','loading','decline','unknown')),
  note text,
  verified boolean not null default false,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (disease_id, insurer)
);

create index if not exists underwriting_rules_disease_id_idx on public.underwriting_rules(disease_id);

-- === RLS: 전 직원 읽기, owner/admin만 쓰기 ===
alter table public.underwriting_diseases enable row level security;
alter table public.underwriting_rules    enable row level security;

create policy uw_diseases_select on public.underwriting_diseases for select to authenticated
using ( true );
create policy uw_diseases_insert on public.underwriting_diseases for insert to authenticated
with check ( public.is_owner_or_admin() );
create policy uw_diseases_update on public.underwriting_diseases for update to authenticated
using ( public.is_owner_or_admin() ) with check ( public.is_owner_or_admin() );
create policy uw_diseases_delete on public.underwriting_diseases for delete to authenticated
using ( public.is_owner_or_admin() );

create policy uw_rules_select on public.underwriting_rules for select to authenticated
using ( true );
create policy uw_rules_insert on public.underwriting_rules for insert to authenticated
with check ( public.is_owner_or_admin() );
create policy uw_rules_update on public.underwriting_rules for update to authenticated
using ( public.is_owner_or_admin() ) with check ( public.is_owner_or_admin() );
create policy uw_rules_delete on public.underwriting_rules for delete to authenticated
using ( public.is_owner_or_admin() );

-- Do NOT add a public/anon "for select using (true)" policy — authenticated only.

-- === 시드: 자주 나오는 예외질병 26종 (idempotent — 재실행 안전) ===
insert into public.underwriting_diseases (name, category, aliases, sort_order) values
  ('고혈압',            '만성질환', array['혈압','혈압약']::text[],            10),
  ('당뇨병',            '만성질환', array['당뇨','혈당']::text[],              20),
  ('고지혈증',          '만성질환', array['이상지질혈증','콜레스테롤']::text[], 30),
  ('통풍',              '만성질환', array[]::text[],                           40),
  ('갑상선 결절',       '내분비',   array['갑상선혹']::text[],                 50),
  ('갑상선 기능이상',   '내분비',   array['기능저하증','기능항진증']::text[],  60),
  ('위염·위궤양',       '소화기',   array['위장질환']::text[],                 70),
  ('위 용종(제거)',     '소화기',   array['위폴립']::text[],                   80),
  ('대장 용종(제거)',   '소화기',   array['대장폴립','용종']::text[],          90),
  ('지방간',            '소화기',   array['간수치']::text[],                  100),
  ('B형간염 보유',      '소화기',   array['간염','보균자']::text[],           110),
  ('간경화',            '소화기',   array['간경변']::text[],                  120),
  ('디스크',            '근골격',   array['추간판탈출','허리디스크','목디스크']::text[], 130),
  ('관절염·무릎 질환',  '근골격',   array['반월상연골','퇴행성관절염']::text[], 140),
  ('골절 이력',         '근골격',   array[]::text[],                          150),
  ('부정맥',            '심뇌혈관', array[]::text[],                          160),
  ('협심증·심근경색 이력', '심뇌혈관', array['스텐트','심장']::text[],        170),
  ('뇌졸중 이력',       '심뇌혈관', array['뇌경색','뇌출혈']::text[],         180),
  ('암 완치(5년 경과)', '암 병력',  array['암','암병력','위암','대장암','유방암','폐암','간암']::text[], 190),
  ('갑상선암 이력',     '암 병력',  array[]::text[],                          200),
  ('우울증·공황장애',   '정신건강', array['정신과','불안장애']::text[],       210),
  ('천식',              '호흡기',   array[]::text[],                          220),
  ('결핵(완치)',        '호흡기',   array[]::text[],                          230),
  ('비염·축농증',       '호흡기',   array['부비동염']::text[],                240),
  ('백내장',            '기타',     array[]::text[],                          250),
  ('신부전·투석',       '기타',     array['만성신장질환']::text[],            260)
on conflict (name) do nothing;

-- 질병별 일반 경향(전사 동일값)으로 12개사 셀을 채운다. verified=false = "검수 전".
with def(name, status, note) as (
  values
    ('고혈압',            'simplified', '투약으로 조절 양호 시 유병자(간편심사) 대부분 가능 · 일부사 표준 심사 가능'),
    ('당뇨병',            'simplified', '인슐린 미사용·합병증 없으면 유병자플랜 가능 · 인슐린 사용 시 제한적'),
    ('고지혈증',          'standard',   '투약 중이어도 수치 안정 시 표준 심사 가능한 곳 다수'),
    ('통풍',              'loading',    '발작 빈도·신장 합병증에 따라 할증 또는 조건부'),
    ('갑상선 결절',       'exclusion',  '갑상선 부담보 조건 인수 일반적 · 세침검사 양성 확인 시 완화'),
    ('갑상선 기능이상',   'standard',   '투약으로 안정 시 표준 가능'),
    ('위염·위궤양',       'standard',   '완치·경미하면 대부분 표준 · 최근 치료력은 고지 필요'),
    ('위 용종(제거)',     'exclusion',  '조직검사 양성이면 일정 기간 위 부담보 후 완화 일반적'),
    ('대장 용종(제거)',   'exclusion',  '제거 후 1~5년 대장 부담보 또는 경과 후 표준'),
    ('지방간',            'loading',    '간수치에 따라 표준~할증 · 중증은 조건부'),
    ('B형간염 보유',      'exclusion',  '간 부담보 또는 할증 일반적 · 수치 안정 시 완화'),
    ('간경화',            'decline',    '거절 일반적'),
    ('디스크',            'exclusion',  '해당 부위 부담보 조건 인수 일반적'),
    ('관절염·무릎 질환',  'exclusion',  '해당 관절 부담보 일반적'),
    ('골절 이력',         'standard',   '완치 후 후유장해 없으면 대부분 표준'),
    ('부정맥',            'loading',    '경미(무증상)면 할증·조건부 · 시술력은 제한적'),
    ('협심증·심근경색 이력', 'simplified', '표준 거절이 일반적 · 유병자플랜 위주로 설계'),
    ('뇌졸중 이력',       'simplified', '경과 연수·후유증에 따라 유병자플랜 가능'),
    ('암 완치(5년 경과)', 'simplified', '완치 5~10년 경과 시 유병자 가능 · 부위·병기별 차이 큼'),
    ('갑상선암 이력',     'simplified', '완치 후 경과 기간에 따라 유병자·조건부 가능'),
    ('우울증·공황장애',   'decline',    '치료 중 거절·연기 일반적 · 완치 후 3~5년 경과 시 심사 가능'),
    ('천식',              'loading',    '경증은 할증 · 최근 발작·입원력은 제한'),
    ('결핵(완치)',        'standard',   '완치 확인 시 대부분 표준'),
    ('비염·축농증',       'standard',   '대부분 표준'),
    ('백내장',            'exclusion',  '눈 부담보 조건 일반적 · 수술 완료 시 완화되는 곳 있음'),
    ('신부전·투석',       'decline',    '거의 전사 거절 · 일부 유병자 상품 검토')
),
ins(insurer) as (
  select unnest(array[
    '삼성화재','삼성생명','한화생명','교보생명','메리츠화재','현대해상',
    'DB손해보험','KB손해보험','흥국화재','롯데손해보험','NH농협손해보험','라이나생명'
  ])
)
insert into public.underwriting_rules (disease_id, insurer, status, note, verified)
select d.id, ins.insurer, def.status, def.note, false
from def
join public.underwriting_diseases d on d.name = def.name
cross join ins
on conflict (disease_id, insurer) do nothing;
