import type { CommercialBackendConfig } from '@shared/commercial/apiContract'
import { getSupabaseConfigStatus } from './supabaseClient'

/**
 * Commercial backend configuration + status (renderer).
 *
 * Default is local-mock. Supabase mode activates ONLY when both VITE_SUPABASE_URL
 * and VITE_SUPABASE_ANON_KEY are configured (public anon key only — never the
 * service_role key). No secret is stored here; the config carries only booleans and
 * the (public) URL. This module never contacts a server.
 */

/** Live config resolved from Supabase env status. */
export function getBackendConfig(): CommercialBackendConfig {
  const sb = getSupabaseConfigStatus()
  return {
    mode: sb.isConfigured ? 'supabase' : 'local-mock',
    supabaseUrl: sb.url,
    supabaseAnonKeyConfigured: sb.anonKeyConfigured,
    isConfigured: sb.isConfigured,
    authMode: sb.isConfigured ? 'supabase-auth' : 'local-demo',
    connectionStatus: sb.isConfigured ? 'unknown' : 'not-configured'
  }
}

/** Back-compat accessor used by the local-mock repositories. */
export const backendConfig: CommercialBackendConfig = getBackendConfig()

export interface ServerDbStatus {
  mode: string
  supabaseUrlConfigured: string
  anonKeyConfigured: string
  serviceRoleUsage: string
  connectionStatus: string
  rlsStatus: string
  lastCheckedAt: string
}

/** A safe, local-only status snapshot (never contacts a server). */
export function getServerDbStatus(): ServerDbStatus {
  const cfg = getBackendConfig()
  const sb = getSupabaseConfigStatus()
  return {
    mode: cfg.mode,
    supabaseUrlConfigured: sb.urlConfigured ? '설정됨' : '미설정',
    anonKeyConfigured: sb.anonKeyConfigured ? '설정됨' : '미설정',
    serviceRoleUsage: '사용 금지 (렌더러에서 절대 사용하지 않음)',
    connectionStatus: cfg.isConfigured ? '설정 감지됨 (검증 대기)' : '미설정 · local-mock',
    rlsStatus: 'SQL 파일 준비됨 (docs/supabase)',
    lastCheckedAt: new Date().toLocaleString()
  }
}

export type ReadinessStatus = '완료' | '로컬 MVP' | '준비됨' | '미설정' | '수동 작업 필요' | '다음 단계'

export interface ReadinessItem {
  label: string
  status: ReadinessStatus
}

/** 상용화 준비 체크리스트 (owner/admin dashboard) — includes Supabase steps. */
export function getCommercialReadiness(): ReadinessItem[] {
  const cfg = getBackendConfig()
  const cfgd = cfg.isConfigured
  return [
    { label: '직원 로그인/권한', status: '완료' },
    { label: '직원용 메뉴 분리', status: '완료' },
    { label: '고객/상담/출퇴근/실적/공지 데이터 모델', status: '준비됨' },
    { label: '서버 API 계약', status: '준비됨' },
    { label: 'Supabase 프로젝트 생성', status: '수동 작업 필요' },
    { label: 'Supabase URL 설정', status: cfgd ? '완료' : '미설정' },
    { label: 'Supabase anon key 설정', status: cfgd ? '완료' : '미설정' },
    { label: 'DB schema 적용', status: '수동 작업 필요' },
    { label: 'RLS 정책 적용', status: '수동 작업 필요' },
    { label: 'Supabase Auth 로그인 UI', status: '준비됨' },
    { label: '프로필 role 연동', status: '준비됨' },
    { label: '대표 계정 프로필 생성', status: '수동 작업 필요' },
    { label: '직원 계정 프로필 생성', status: '수동 작업 필요' },
    { label: 'FC 권한 제한', status: '완료' },
    { label: '팀장 권한 제한', status: '완료' },
    { label: '관리자 전체 접근', status: '완료' },
    { label: '고객관리 Supabase 조회', status: cfgd ? '준비됨' : '다음 단계' },
    { label: '고객등록 Supabase 저장', status: cfgd ? '준비됨' : '다음 단계' },
    { label: '고객수정 Supabase 저장', status: cfgd ? '준비됨' : '다음 단계' },
    { label: 'FC 고객 권한 제한', status: '준비됨' },
    { label: '팀장 고객 권한 제한', status: '준비됨' },
    { label: '대표 전체 고객 조회', status: '준비됨' },
    { label: '고객 RLS 정책 준비', status: '준비됨' },
    { label: '상담기록 Supabase 조회', status: cfgd ? '준비됨' : '다음 단계' },
    { label: '상담기록 Supabase 저장', status: cfgd ? '준비됨' : '다음 단계' },
    { label: '상담기록 수정 저장', status: cfgd ? '준비됨' : '다음 단계' },
    { label: '고객 선택 연동', status: '완료' },
    { label: 'FC 상담 권한 제한', status: '준비됨' },
    { label: '팀장 상담 권한 제한', status: '준비됨' },
    { label: '대표 전체 상담 조회', status: '준비됨' },
    { label: '상담 RLS 정책 준비', status: '준비됨' },
    { label: '일정관리 Supabase 조회', status: cfgd ? '준비됨' : '다음 단계' },
    { label: '일정 생성 Supabase 저장', status: cfgd ? '준비됨' : '다음 단계' },
    { label: '일정 수정 Supabase 저장', status: cfgd ? '준비됨' : '다음 단계' },
    { label: '오늘/이번 주 일정 조회', status: '완료' },
    { label: 'FC 일정 권한 제한', status: '준비됨' },
    { label: '팀장 일정 권한 제한', status: '준비됨' },
    { label: '대표 전체 일정 조회', status: '준비됨' },
    { label: '일정 RLS 정책 준비', status: '준비됨' },
    { label: '출퇴근 Supabase 조회', status: cfgd ? '준비됨' : '다음 단계' },
    { label: '출근 Supabase 저장', status: cfgd ? '준비됨' : '다음 단계' },
    { label: '퇴근 Supabase 저장', status: cfgd ? '준비됨' : '다음 단계' },
    { label: '사진/워터마크 기록 준비', status: '준비됨' },
    { label: 'FC 출퇴근 권한 제한', status: '준비됨' },
    { label: '팀장 출퇴근 권한 제한', status: '준비됨' },
    { label: '대표 전체 출퇴근 조회', status: '준비됨' },
    { label: '출퇴근 RLS 정책 준비', status: '준비됨' },
    { label: 'Storage 정책 초안 준비', status: '준비됨' },
    { label: 'Web/PWA 빌드 준비 (build:web)', status: '준비됨' },
    { label: 'Netlify 설정 준비 (netlify.toml)', status: '준비됨' },
    { label: 'Netlify Supabase URL env 필요', status: cfgd ? '완료' : '수동 작업 필요' },
    { label: 'Netlify Supabase anon key env 필요', status: cfgd ? '완료' : '수동 작업 필요' },
    { label: 'service role key 금지 (프론트엔드)', status: '완료' },
    { label: '로컬 mock → Supabase 전환', status: cfgd ? '준비됨' : '다음 단계' },
    { label: '고객/상담/출퇴근/실적 저장 테스트', status: '다음 단계' }
  ]
}

/** Steps to safely connect Supabase later (shown as a checklist). */
export const SERVER_CONNECT_CHECKLIST = [
  'Supabase 프로젝트 생성 후 Project URL 복사',
  'anon public key만 복사 (service_role key는 절대 앱에 넣지 않음)',
  'docs/supabase/SJ_OS_SUPABASE_SCHEMA.sql 실행',
  'docs/supabase/SJ_OS_SUPABASE_RLS_POLICIES.sql 실행 (RLS 활성화)',
  '첫 대표 계정 생성 + profiles 행 추가',
  'VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY 로컬 설정 후 앱 재시작',
  '연결 상태 패널에서 상태 확인'
]
