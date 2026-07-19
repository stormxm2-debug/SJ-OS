/**
 * 자비스 티켓 파이프라인 v1 — 디렉터 → 개발자 → 리뷰어 (3인 PoC).
 *
 * 멀티에이전트 자동개발의 1단계: 모든 작업을 "작업 티켓(JSON)"으로 표준화한다.
 *  - 티켓 = 누가(from) → 누구에게(to), 무엇을(objective), 입력자료(inputFiles),
 *    완료 기준(acceptanceCriteria), 현재 상태(status). 파일(.sj-os/tickets/)로 저장.
 *  - 상태 머신: requested(요청) → developing(개발 중) → reviewing(검토 대기)
 *    → done(완료). 반려는 rejected를 거쳐 requested로 되돌아간다.
 *  - 1단계에서 검토는 사람이 승인/반려 (2단계에서 리뷰어 AI로 대체).
 *  - 개발 실행은 기존 claudeAutoBuild 잡에 티켓을 주입 — 커밋/배포 게이트 등
 *    기존 안전장치를 그대로 상속한다.
 */

export type JarvisTicketStatus = 'requested' | 'developing' | 'reviewing' | 'approved' | 'rejected' | 'done'

export const TICKET_STATUS_LABEL: Record<JarvisTicketStatus, string> = {
  requested: '요청',
  developing: '개발 중',
  reviewing: '검토 대기',
  approved: '승인',
  rejected: '반려',
  done: '완료'
}

export interface JarvisTicketHistoryEntry {
  at: string
  event: string
}

export interface JarvisTicket {
  /** TASK-001 형식. */
  taskId: string
  from: 'director'
  to: 'developer'
  title: string
  /** 무엇을 만들어야 하는가 — 개발자 프롬프트의 핵심. */
  objective: string
  /** 대표가 입력한 원문 명령 (감사 추적용). */
  originalCommand: string
  /** 참고할 파일/문서 경로 (선택). */
  inputFiles: string[]
  /** 완료 기준 — 검토 단계에서 이 목록으로 판정한다. */
  acceptanceCriteria: string[]
  status: JarvisTicketStatus
  /** 연결된 claudeAutoBuild 잡 id (개발 실행 후). */
  jobId?: string
  history: JarvisTicketHistoryEntry[]
  createdAt: string
  updatedAt: string
}

export interface CreateJarvisTicketInput {
  title: string
  objective: string
  originalCommand: string
  inputFiles: string[]
  acceptanceCriteria: string[]
}

export interface UpdateJarvisTicketInput {
  status?: JarvisTicketStatus
  jobId?: string
  /** history에 남길 한 줄 (필수 — 모든 변경은 기록을 남긴다). */
  event: string
}

/** 명령 문구에서 완료 기준 초안을 제안 (대표가 티켓에서 수정 가능). */
export function suggestAcceptanceCriteria(command: string): string[] {
  const t = (command ?? '').toLowerCase()
  const has = (words: string[]): boolean => words.some((w) => t.includes(w.toLowerCase()))
  const out: string[] = ['npm run typecheck 통과 (오류 0건)', '요청 범위 밖 파일 수정 없음']
  if (has(['화면', '페이지', '메뉴', '라우트', '탭'])) {
    out.push('새 화면은 등록 6곳 완료 (types·roleAccess·Router·MobileShell·mobileMenu·Sidebar 3배열)')
  }
  if (has(['모바일', '폰', '반응형'])) out.push('모바일 화면 깨짐 없음 (375px 기준)')
  if (has(['db', '테이블', '스키마', 'sql', 'supabase'])) {
    out.push('SQL은 docs/supabase/에 파일로만 작성 (DB 직접 적용 금지)')
  }
  if (has(['직원', 'fc', '관리자', '권한'])) out.push('내 것 기본 + 직원 것 별도 원칙 적용 (FC는 본인 것만)')
  if (has(['색', '디자인', '테마', '카드'])) out.push('slate 토큰 반전 규칙 준수 (어두운 카드는 명시적 hex)')
  return out
}

/** 티켓 → 개발자(claudeAutoBuild) 프롬프트. 완료 기준을 명시적으로 주입한다. */
export function buildDeveloperPromptFromTicket(ticket: JarvisTicket): string {
  const lines: string[] = [
    `[자비스 작업 티켓 ${ticket.taskId}] ${ticket.title}`,
    '',
    '너는 SJ-OS 개발자 에이전트다. 아래 티켓의 목표를 구현하라.',
    '',
    `## 목표 (objective)`,
    ticket.objective,
    ''
  ]
  if (ticket.inputFiles.length > 0) {
    lines.push('## 입력 자료 (먼저 읽을 것)', ...ticket.inputFiles.map((f) => `- ${f}`), '')
  }
  lines.push(
    '## 완료 기준 (acceptanceCriteria) — 전부 충족해야 완료다',
    ...ticket.acceptanceCriteria.map((c, i) => `${i + 1}. ${c}`),
    '',
    '## 규칙',
    '- 완료 기준에 없는 기능을 임의로 추가하지 말 것.',
    '- git commit / push / 배포 명령은 절대 실행하지 말 것 (커밋은 사람이 승인 후 별도 진행).',
    '- 파괴적 명령(삭제·초기화)과 시크릿 값 출력 금지.',
    '- 작업 후 npm run typecheck 를 실행해 오류 0건을 확인할 것.'
  )
  return lines.join('\n')
}
