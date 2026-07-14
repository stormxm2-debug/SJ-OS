-- ============================================================================
-- SJ-OS 유병자 인수예외질환 검색 schema DRAFT. REVIEW before production.
-- 2026-07-15 · 병렬 작업창 ①
--
-- 목적: FC가 유병자(간편심사) 상담 중 질환명으로 검색하면 보험사별
--       예외질환 인수기준(최소경과·치료기간·수술여부)과 가능상품구분
--       (325/335/355/3N5/간편공통 등)을 표로 보여준다.
--       (참고 UX: GA 업계의 '유병자 인수예외질환 검색' 도구)
--
-- 권한: 전 직원 읽기 / owner·admin만 쓰기 (인수 가이드와 동일 패턴).
-- Run AFTER base schema(profiles) + admin phone login schema(is_owner_or_admin).
--
-- ⚠ 시드 데이터는 AI 일반 지식 기반 "참고용(verified=false, 화면에 검수전 배지)"이다.
--   실제 인수 지침은 보험사별·시기별로 다르므로 관리자가 앱에서 수정/검수해야
--   한다 (관리자 저장 시 verified=true).
-- ============================================================================

create extension if not exists "pgcrypto";

-- === 보험사 × 예외질환 × 인수기준 (행 단위) ===
create table if not exists public.underwriting_exceptions (
  id uuid primary key default gen_random_uuid(),
  insurer text not null,                       -- 보험사명 (예: 삼성화재, 흥국생명)
  disease text not null,                       -- 예외질환(질병/상해) 표기
  search_terms text[] not null default '{}',   -- 검색 별칭 (예: {'혈압','혈압약'})
  min_elapsed text,                            -- 최소경과 (예: '3개월', '치료종결 즉시')
  treatment_period text,                       -- 치료기간 조건 (예: '입원 14일 이하')
  surgery text,                                -- 수술여부 조건 (예: '무관', '수술 후 1년')
  product_class text not null default '',      -- 가능상품구분 (예: '355', '3N5', '간편 공통')
  note text,                                   -- 비고 (부가 조건)
  verified boolean not null default false,     -- false=AI 시드(검수전), true=관리자 검수
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists uw_exceptions_insurer_idx on public.underwriting_exceptions(insurer);
create index if not exists uw_exceptions_disease_idx on public.underwriting_exceptions(disease);

-- === RLS: 전 직원 읽기, owner/admin만 쓰기 ===
alter table public.underwriting_exceptions enable row level security;

create policy uw_exceptions_select on public.underwriting_exceptions for select to authenticated
using ( true );
create policy uw_exceptions_insert on public.underwriting_exceptions for insert to authenticated
with check ( public.is_owner_or_admin() );
create policy uw_exceptions_update on public.underwriting_exceptions for update to authenticated
using ( public.is_owner_or_admin() ) with check ( public.is_owner_or_admin() );
create policy uw_exceptions_delete on public.underwriting_exceptions for delete to authenticated
using ( public.is_owner_or_admin() );

-- Do NOT add a public/anon "for select using (true)" policy — authenticated only.

-- === 시드: 자주 검색되는 예외질환 × 대표 패턴 (AI 참고용, verified=false) ===
-- 재실행 안전: 테이블이 비어 있을 때만 삽입.
insert into public.underwriting_exceptions
  (insurer, disease, search_terms, min_elapsed, treatment_period, surgery, product_class, note)
select * from (values
  -- 고혈압 계열
  ('삼성화재',   '고혈압',                array['혈압','혈압약','본태성고혈압']::text[], '투약 중 가능',   null,             '무관', '355',     '고지 3개월/2년/5년 기준 충족 시'),
  ('현대해상',   '고혈압',                array['혈압','혈압약']::text[],                '투약 중 가능',   null,             '무관', '355',     null),
  ('흥국화재',   '고혈압(본태성)',        array['혈압']::text[],                         '3개월',          '입원 14일 이하', null,   '335',     null),
  ('하나손보',   '고혈압',                array['혈압']::text[],                         '치료종결 즉시',  '입원 30일 이내', '무관', '3N5',     '1회 입원 30일 초과 시 인수 불가'),
  ('한화생명',   '고혈압',                array['혈압']::text[],                         '투약 중 가능',   null,             null,   '간편 공통', null),
  -- 당뇨 계열
  ('삼성화재',   '당뇨병',                array['당뇨','혈당']::text[],                  '투약 중 가능',   null,             '무관', '355',     '인슐린 투여는 별도 심사'),
  ('KB손보',     '당뇨병',                array['당뇨']::text[],                         '투약 중 가능',   null,             null,   '355',     null),
  ('동양생명',   '당뇨병(합병증 없음)',   array['당뇨']::text[],                         '3개월',          null,             null,   '3N5',     '합병증 동반 시 인수 불가'),
  -- 고지혈증
  ('메리츠화재', '고지혈증',              array['이상지질혈증','콜레스테롤']::text[],    '투약 중 가능',   null,             '무관', '325',     null),
  ('신한라이프', '고지혈증',              array['콜레스테롤']::text[],                   '투약 중 가능',   null,             null,   '간편 공통', null),
  -- 소화기
  ('DB손보',     '위염·위궤양',           array['위장질환','위염']::text[],              '치료종결 3개월', null,             '무관', '335',     null),
  ('현대해상',   '위 용종(제거)',         array['위폴립']::text[],                       '제거 후 즉시',   null,             '조직검사 양성 확인', '355', '악성 소견 시 인수 불가'),
  ('삼성화재',   '대장 용종(제거)',       array['대장폴립','용종']::text[],              '제거 후 1년',    null,             '조직검사 양성 확인', '355', null),
  ('롯데손보',   '지방간',                array['간수치']::text[],                       '3개월',          '입원 이력 없음', null,   '325',     null),
  ('한화손보',   '충수염(수술)',          array['맹장염','맹장수술']::text[],            '수술 후 1년',    null,             '완치', '335',     '합병증 없는 단순 충수절제'),
  -- 근골격
  ('KB손보',     '디스크(추간판탈출증)',  array['허리디스크','목디스크']::text[],        '치료종결 1년',   null,             '무관', '335',     '수술 이력 시 부위 부담보 가능'),
  ('메리츠화재', '골절 이력',             array['골절']::text[],                         '치료종결 즉시',  null,             '무관', '325',     '후유장해 없을 것'),
  ('농협손보',   '관절염',                array['퇴행성관절염','무릎']::text[],          '6개월',          '입원 14일 이하', null,   '335',     null),
  -- 내분비·기타
  ('삼성생명',   '갑상선 결절',           array['갑상선혹']::text[],                     '진단 후 즉시',   null,             null,   '간편 공통', '악성 의심 소견 없을 것'),
  ('라이나생명', '갑상선 기능저하증',     array['갑상선']::text[],                       '투약 중 가능',   null,             null,   '간편 공통', null),
  ('흥국생명',   '백내장(수술)',          array['백내장수술']::text[],                   '수술 후 즉시',   null,             '완치', '355',     null),
  ('하나생명',   '치질(수술)',            array['치핵']::text[],                         '수술 후 3개월',  null,             '완치', '간편 공통', null),
  ('AIG손보',    '천식',                  array['기관지천식']::text[],                   '1년',            '입원 이력 없음', null,   '325',     '최근 1년 무증상'),
  ('iM라이프',   '통풍',                  array['요산']::text[],                         '투약 중 가능',   null,             null,   '간편 공통', null),
  ('메트라이프', 'B형간염 보유(비활동성)', array['간염','보균자']::text[],               '6개월',          null,             null,   '간편 공통', '간수치 정상 범위'),
  ('ABL생명',    '부정맥(경증)',          array['심장']::text[],                         '1년',            '입원 이력 없음', null,   '간편 공통', '기질적 심질환 동반 시 불가')
) as seed(insurer, disease, search_terms, min_elapsed, treatment_period, surgery, product_class, note)
where not exists (select 1 from public.underwriting_exceptions);
