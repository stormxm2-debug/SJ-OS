-- ============================================================================
-- SJ-OS 계약 출처(채널) 컬럼 — performance_entries
-- 2026-07-14 · 병렬 작업창 ①
--
-- 목적: 회원이 계약(건별 실적)을 입력할 때 지인/소개/DB 중 출처를 필수로
--       체크하게 하여, 자체생산 DB 전략(소개 엔진·DB 분배·셀프 퍼널)의
--       계약 전환 성과를 채널별로 집계할 수 있게 한다.
--
-- 값: 'acquaintance'(지인) | 'referral'(소개) | 'db'(DB)
--     기존 행은 NULL 유지 → 화면에서 '미분류'로 표시. 수정 시 선택을 강제해
--     자연스럽게 백필된다.
--
-- ⚠ 배포 순서 주의: 이 SQL을 먼저 적용한 뒤 웹/앱을 배포해야 한다.
--    (새 클라이언트는 select/insert에 channel 컬럼을 사용 — 컬럼이 없으면
--     실적 목록 조회와 계약 추가가 실패한다.)
-- ============================================================================

alter table public.performance_entries
  add column if not exists channel text
  check (channel is null or channel in ('acquaintance', 'referral', 'db'));

comment on column public.performance_entries.channel is
  '계약 출처: acquaintance=지인, referral=소개, db=DB. NULL=미분류(컬럼 추가 이전 입력분).';

-- RLS 변경 없음 — 기존 performance_entries 정책(본인 쓰기, 범위 조회) 그대로.
