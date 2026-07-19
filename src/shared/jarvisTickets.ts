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

/** 반려 주체 — 자동 재시도는 리뷰어 반려에만 적용한다 (사람 반려 = 사람 판단). */
export type TicketRejectSource = 'reviewer' | 'human' | 'dev-fail'

/** 티켓당 최대 개발 실행 횟수 (최초 1회 + 리뷰어 반려 자동 재시도 2회). */
export const MAX_TICKET_DEV_ATTEMPTS = 3

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

/** 리뷰어 AI의 기준별 판정. */
export interface JarvisReviewCriterion {
  criterion: string
  met: boolean
  note?: string
}

/** 리뷰어 AI 판정 결과 (티켓에 저장). */
export interface JarvisTicketReview {
  verdict: 'approved' | 'rejected'
  summary: string
  criteria: JarvisReviewCriterion[]
  reviewedAt: string
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
  /** 리뷰어 AI 최신 판정 (재검토 시 덮어씀; 이력은 history에 남음). */
  review?: JarvisTicketReview
  /** 개발 실행 누적 횟수 (자동 재시도 한도 판단). */
  attempts?: number
  /** 마지막 반려 주체 — 상태가 developing으로 돌아가면 저장소가 자동으로 지운다. */
  rejectSource?: TicketRejectSource
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
  review?: JarvisTicketReview
  attempts?: number
  rejectSource?: TicketRejectSource
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

/** 리뷰어에게 전달하는 변경 증거 — main이 고정 명령으로 수집한다. */
export interface JarvisReviewEvidence {
  /** 개발 잡의 typecheck 검증 결과 (passed/failed/…). */
  typecheck: string
  /** 개발 잡의 build 검증 결과. */
  build: string
  gitStatusShort: string
  diffStat: string
  /** git diff 본문 (길면 잘림). */
  diff: string
  diffTruncated: boolean
}

export const REVIEW_JSON_OPEN = '<REVIEW_JSON>'
export const REVIEW_JSON_CLOSE = '</REVIEW_JSON>'

/**
 * 티켓 + 증거 → 리뷰어(검증자) 프롬프트.
 * 리뷰어는 기본 권한 모드로 실행된다: Read/Grep 등 읽기 도구만 자동 허용되고
 * 파일 수정·Bash는 승인자가 없어 실행될 수 없다 (생성자·검증자 분리).
 */
export function buildReviewerPromptFromTicket(ticket: JarvisTicket, ev: JarvisReviewEvidence): string {
  return [
    `너는 SJ-OS 리뷰어 AI다 — 개발자와 분리된 독립 검증자. 아래 작업 티켓의 완료 기준을 실제 변경 증거와 대조해 판정하라.`,
    '',
    '## 판정 규칙',
    '- AI의 주장이 아니라 증거(diff·검증 결과·실제 파일)로만 판단한다.',
    '- 필요하면 Read/Grep 도구로 실제 파일을 열어 확인해도 된다.',
    '- Bash·Edit·Write 등 실행/수정 도구는 절대 사용하지 말 것 — 승인자가 없어 멈추고, 너의 역할도 아니다.',
    '- diff에는 다른 작업의 변경이 섞여 있을 수 있다. 이 티켓의 목표와 관련된 변경만 평가하라.',
    '- 기준을 증거로 확인할 수 없으면 met=false로 두고 note에 "증거 부족"과 이유를 적어라.',
    '- verdict는 모든 기준이 충족될 때만 approved. 하나라도 미충족이면 rejected.',
    '',
    `## 작업 티켓 ${ticket.taskId}: ${ticket.title}`,
    `목표: ${ticket.objective}`,
    '',
    '완료 기준:',
    ...ticket.acceptanceCriteria.map((c, i) => `${i + 1}. ${c}`),
    '',
    '## 변경 증거',
    `- typecheck(개발 잡 검증): ${ev.typecheck}`,
    `- build(개발 잡 검증): ${ev.build}`,
    '- git status --short:',
    '```',
    ev.gitStatusShort || '(변경 없음)',
    '```',
    '- git diff --stat:',
    '```',
    ev.diffStat || '(없음)',
    '```',
    `- git diff${ev.diffTruncated ? ' (길어서 일부만 — 나머지는 Read로 파일을 직접 확인하라)' : ''}:`,
    '```diff',
    ev.diff || '(없음)',
    '```',
    '',
    '## 출력 형식 (다른 말 없이 반드시 아래 형식만)',
    REVIEW_JSON_OPEN,
    '{"verdict":"approved 또는 rejected","summary":"한두 문장 총평","criteria":[{"criterion":"기준 원문","met":true,"note":"근거 한 줄"}]}',
    REVIEW_JSON_CLOSE
  ].join('\n')
}

/** 리뷰어 출력에서 판정 JSON을 추출·검증. 실패 시 null. */
export function parseReviewOutput(output: string): JarvisTicketReview | null {
  try {
    const start = output.lastIndexOf(REVIEW_JSON_OPEN)
    const end = output.lastIndexOf(REVIEW_JSON_CLOSE)
    if (start === -1 || end === -1 || end <= start) return null
    const raw = JSON.parse(output.slice(start + REVIEW_JSON_OPEN.length, end).trim()) as {
      verdict?: unknown
      summary?: unknown
      criteria?: unknown
    }
    if (raw.verdict !== 'approved' && raw.verdict !== 'rejected') return null
    const criteria: JarvisReviewCriterion[] = Array.isArray(raw.criteria)
      ? raw.criteria
          .filter((c): c is { criterion?: unknown; met?: unknown; note?: unknown } => !!c && typeof c === 'object')
          .map((c) => ({
            criterion: String(c.criterion ?? '').slice(0, 500),
            met: c.met === true,
            note: c.note ? String(c.note).slice(0, 500) : undefined
          }))
          .filter((c) => c.criterion)
      : []
    return {
      verdict: raw.verdict,
      summary: String(raw.summary ?? '').slice(0, 1000),
      criteria,
      reviewedAt: new Date().toISOString()
    }
  } catch {
    return null
  }
}

/** 티켓 → 개발자(claudeAutoBuild) 프롬프트. 완료 기준을 명시적으로 주입한다. */
/**
 * 리뷰어 반려 → 재개발(재시도) 프롬프트. 개발자 프롬프트에 반려 사유
 * (미충족 기준 + 근거)를 주입해 "실패 분석 → 수정" 루프를 닫는다.
 */
export function buildRetryPromptFromTicket(ticket: JarvisTicket): string {
  const base = buildDeveloperPromptFromTicket(ticket)
  if (!ticket.review || ticket.review.verdict !== 'rejected') return base
  const unmet = ticket.review.criteria.filter((c) => !c.met)
  return [
    base,
    '',
    '## ⚠ 이전 시도 반려 (리뷰어 AI 판정) — 이번에는 아래 미충족 기준을 반드시 해결하라',
    ticket.review.summary ? `총평: ${ticket.review.summary}` : '',
    ...unmet.map((c) => `- [미충족] ${c.criterion}${c.note ? ` — ${c.note}` : ''}`),
    '',
    '- 이미 충족된 부분은 불필요하게 다시 고치지 말 것.',
    '- 미충족 기준을 해결한 뒤 관련 파일을 다시 확인해 근거를 남길 것.'
  ]
    .filter((l) => l !== '')
    .join('\n')
}

// ---------- 디렉터 AI (명령 → 티켓 설계) ----------

export const TICKET_JSON_OPEN = '<TICKET_JSON>'
export const TICKET_JSON_CLOSE = '</TICKET_JSON>'

/** 디렉터 AI가 설계한 티켓 초안 (대표가 수정 후 저장 = 사람 승인). */
export interface DirectorDraft {
  title: string
  objective: string
  inputFiles: string[]
  acceptanceCriteria: string[]
}

/**
 * 디렉터 프롬프트 — 읽기 전용(기본 권한 모드)으로 실행되어 코드 구조를
 * 확인하며 티켓을 설계할 수 있지만 수정은 구조적으로 불가능하다.
 */
export function buildDirectorPrompt(command: string): string {
  return [
    '너는 SJ-OS 디렉터 AI다. 대표의 명령을 분석해 개발자 에이전트에게 줄 작업 티켓 1건을 설계하라.',
    '',
    '## 규칙',
    '- 필요하면 Read/Grep 도구로 프로젝트 구조를 확인해도 된다 (수정 도구는 절대 사용 금지 — 승인자가 없어 멈춘다).',
    '- objective는 개발자가 바로 구현할 수 있게 구체적으로 (관련 파일·서비스가 보이면 언급).',
    '- acceptanceCriteria는 검증 가능한 문장으로 3~7개. 다음 사내 규칙이 해당되면 반드시 포함:',
    '  · "npm run typecheck 통과 (오류 0건)" (항상 포함)',
    '  · 새 화면이면 "등록 6곳 완료 (types·roleAccess·Router·MobileShell·mobileMenu·Sidebar 3배열)"',
    '  · DB 변경이면 "SQL은 docs/supabase/에 파일로만 작성 (DB 직접 적용 금지)"',
    '  · 직원 데이터 화면이면 "내 것 기본 + 직원 것 별도 (FC는 본인 것만)"',
    '  · 어두운 카드 UI면 "slate 토큰 반전 주의 — 명시적 hex 사용"',
    '- inputFiles에는 개발자가 먼저 읽어야 할 파일 경로 0~5개.',
    '',
    '## 대표 명령',
    command,
    '',
    '## 출력 형식 (다른 말 없이 반드시 아래 형식만)',
    TICKET_JSON_OPEN,
    '{"title":"짧은 제목","objective":"구현 목표 상세","inputFiles":["경로"],"acceptanceCriteria":["기준"]}',
    TICKET_JSON_CLOSE
  ].join('\n')
}

/** 디렉터 출력에서 티켓 초안 JSON 추출·검증. 실패 시 null (규칙 기반 폴백). */
export function parseDirectorOutput(output: string): DirectorDraft | null {
  try {
    const start = output.lastIndexOf(TICKET_JSON_OPEN)
    const end = output.lastIndexOf(TICKET_JSON_CLOSE)
    if (start === -1 || end === -1 || end <= start) return null
    const raw = JSON.parse(output.slice(start + TICKET_JSON_OPEN.length, end).trim()) as Partial<DirectorDraft>
    const list = (v: unknown, itemMax: number, listMax: number): string[] =>
      Array.isArray(v) ? v.map((x) => String(x ?? '').slice(0, itemMax).trim()).filter(Boolean).slice(0, listMax) : []
    const draft: DirectorDraft = {
      title: String(raw.title ?? '').slice(0, 200).trim(),
      objective: String(raw.objective ?? '').slice(0, 4000).trim(),
      inputFiles: list(raw.inputFiles, 300, 5),
      acceptanceCriteria: list(raw.acceptanceCriteria, 500, 10)
    }
    if (!draft.objective || draft.acceptanceCriteria.length === 0) return null
    return draft
  } catch {
    return null
  }
}

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
