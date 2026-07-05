import type { CommercialBackendConfig } from '@shared/commercial/apiContract'

/**
 * Commercial backend configuration + status (renderer).
 *
 * Default is local-mock and NOT configured — no server is contacted. The config
 * carries NO secrets and NO hardcoded URL; a real apiBaseUrl/auth would be supplied
 * at runtime later (never from .env in this sprint). This module only reports
 * status and readiness; it never calls an external server.
 */

export const backendConfig: CommercialBackendConfig = {
  mode: 'local-mock',
  apiBaseUrl: undefined, // supplied at runtime later — never hardcoded
  authMode: 'local-demo',
  isConfigured: false
}

export interface ServerDbStatus {
  dataMode: string
  apiBaseUrl: string
  dbConnection: string
  authMode: string
  syncStatus: string
  lastCheckedAt: string
}

/** A safe, local-only status snapshot (never contacts a server). */
export function getServerDbStatus(): ServerDbStatus {
  return {
    dataMode: backendConfig.mode,
    apiBaseUrl: backendConfig.apiBaseUrl ?? '미설정',
    dbConnection: backendConfig.isConfigured ? '연결됨' : '미연결',
    authMode: backendConfig.authMode === 'local-demo' ? '로컬 MVP 세션' : backendConfig.authMode,
    syncStatus: backendConfig.mode === 'local-mock' ? '비활성' : '활성',
    lastCheckedAt: new Date().toLocaleString()
  }
}

export type ReadinessStatus = '완료' | '로컬 MVP' | '준비됨' | '미연결' | '다음 단계'

export interface ReadinessItem {
  label: string
  status: ReadinessStatus
}

/** 상용화 준비 체크리스트 (owner/admin dashboard). */
export function getCommercialReadiness(): ReadinessItem[] {
  return [
    { label: '직원 로그인/권한', status: '완료' },
    { label: '직원용 메뉴 분리', status: '완료' },
    { label: '고객 데이터 모델', status: '준비됨' },
    { label: '상담 데이터 모델', status: '준비됨' },
    { label: '출퇴근 데이터 모델', status: '준비됨' },
    { label: '실적 데이터 모델', status: '준비됨' },
    { label: '공지 데이터 모델', status: '준비됨' },
    { label: '서버 API 계약', status: '준비됨' },
    { label: '공용 DB 연결', status: '미연결' },
    { label: '데이터 백업', status: '다음 단계' },
    { label: '설치파일 배포', status: '로컬 MVP' },
    { label: '직원 교육', status: '다음 단계' }
  ]
}

/** Steps to safely connect a real backend later (shown as a checklist). */
export const SERVER_CONNECT_CHECKLIST = [
  '백엔드 플랫폼 선택 (예: 자체 서버 / 클라우드 관리형 DB)',
  '서버 API 구현 (본 계약서의 엔드포인트 기준)',
  'apiBaseUrl 런타임 주입 방식 결정 (.env 하드코딩 금지)',
  '인증 방식 확정 (토큰/세션) 및 보안 검토',
  'local-mock → api 모드 전환 및 데이터 마이그레이션',
  '동기화/오프라인 처리 정책 수립',
  '백업/복구 정책 수립'
]
