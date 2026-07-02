import type { JarvisClassification } from './types'

/**
 * Local, rule-based Jarvis intent classifier. No AI/API call — pure keyword
 * matching over Korean + simple English/technical command phrases. Classifies a
 * raw command into one of five modes (answer / implementation-request /
 * navigation / briefing / unknown) and infers the target workspace + navigation
 * view.
 *
 * Precedence matters:
 *  1) implementation verbs win first ("보험분석 기능 다음 스프린트로 올려",
 *     "자비스가 오토파일럿 실행하게 해")
 *  2) briefing
 *  3) control phrases (autopilot / company operation) → navigate to Autopilot
 *  4) explicit navigation ("... 열어/이동/보여줘")
 *  5) answerable business question ("오늘 일정", "이번 달 실적")
 *  6) bare workspace name ("FC OS", "autopilot", "라이브 컴퍼니") → navigation
 *  7) unknown
 */

/** Verbs/phrases that signal a product/development (implementation) command. */
const IMPLEMENTATION_MARKERS = [
  '만들어',
  '만들어줘',
  '추가해',
  '추가하',
  '기능 추가',
  '수정해',
  '수정하',
  '구현해',
  '구현하',
  '개발해',
  '개발하',
  '붙여',
  '연동해',
  '연동하',
  '자동화해',
  '자동화하',
  '화면 만들',
  '다음 스프린트',
  '스프린트로 올려',
  '올려',
  '진행해',
  '개선해',
  '개선하',
  '바꿔',
  '고쳐',
  '하게 해',
  '되게 해',
  '하도록',
  '실행하게'
]

/** Phrases that signal an explicit navigation request. */
const NAVIGATION_MARKERS = ['열어', '열어줘', '이동', '화면으로', '로 가', '바로가기', '보여줘', '띄워', '가줘', 'open ', 'go to']

/** Phrases that signal a daily briefing. */
const BRIEFING_MARKERS = ['브리핑', 'briefing', '오늘 요약', '전체 요약']

/**
 * Control phrases that start/operate the AI Company loop. These route to the
 * Autopilot workspace (Answer/Nav card explains Start Company / Run one loop
 * step). Implementation markers are checked first, so "자비스가 오토파일럿
 * 실행하게 해" is a request, while "회사 시작" / "autopilot" are control.
 */
const CONTROL_MARKERS = [
  '오토파일럿',
  'autopilot',
  '운영 루프',
  '운영루프',
  'start company',
  'company start',
  '회사 시작',
  '회사 운영',
  '자동 운영',
  '자동운영',
  '자동 개발',
  '자동개발',
  '운영 시작'
]

/** Workspace inference: ordered so more specific phrases win. */
const WORKSPACE_KEYWORDS: Array<{ workspace: string; nav: string | null; keys: string[] }> = [
  { workspace: 'insurance-analysis', nav: 'insurance-analysis', keys: ['보험분석', '보험 분석', '증권분석', '증권 분석', '보장분석', '보장 분석'] },
  { workspace: 'consultation', nav: 'consultation', keys: ['상담'] },
  { workspace: 'team-leader', nav: 'team-leader', keys: ['팀장', '팀 리더', '팀리더'] },
  { workspace: 'performance', nav: 'performance', keys: ['실적', '성과', '달성률'] },
  { workspace: 'schedule', nav: 'schedule', keys: ['일정', '캘린더', '스케줄'] },
  { workspace: 'sales-activity', nav: 'sales-activity', keys: ['영업활동', '영업 활동', '활동', 'ap', '클로징'] },
  { workspace: 'customer', nav: 'customer', keys: ['고객'] },
  { workspace: 'fc-os', nav: 'fcos', keys: ['fc os', 'fcos', 'fc', '출근', '설계사'] },
  { workspace: 'company', nav: 'company', keys: ['라이브 컴퍼니', '라이브컴퍼니', 'live company', '회사 현황', '컴퍼니'] },
  { workspace: 'approvals', nav: 'approvals', keys: ['승인센터', '승인 센터', '승인', 'approval'] },
  { workspace: 'qa', nav: 'qa', keys: ['qa 센터', 'qa센터', 'qa'] },
  { workspace: 'release', nav: 'release', keys: ['릴리즈센터', '릴리즈 센터', '릴리스센터', '릴리스', '릴리즈', 'release'] },
  { workspace: 'devops', nav: 'devops', keys: ['devops', '데브옵스'] },
  { workspace: 'autopilot', nav: 'autopilot', keys: ['오토파일럿', 'autopilot', '운영 루프', '운영루프', '자동 운영', '자동운영', '자동 개발', '자동개발', '회사 시작', 'start company'] },
  { workspace: 'jarvis', nav: null, keys: ['자비스', 'jarvis'] }
]

/** Answer intents: fine-grained business questions Jarvis can answer locally. */
const ANSWER_INTENTS: Array<{ intent: string; keys: string[] }> = [
  { intent: 'fc-attendance', keys: ['출근', 'fc 현황', '설계사 현황'] },
  { intent: 'performance', keys: ['이번 달 실적', '이번달 실적', '실적', '성과', '달성률'] },
  { intent: 'team-performance', keys: ['팀별 실적', '팀 실적', '팀별'] },
  { intent: 'today-schedule', keys: ['오늘 일정', '일정', '캘린더'] },
  { intent: 'pending-activities', keys: ['미완료 활동', '미완료', '미처리'] },
  { intent: 'closing-customers', keys: ['클로징 예정', '클로징'] },
  { intent: 'today-contacts', keys: ['오늘 연락', '연락할 고객'] },
  { intent: 'customer-search', keys: ['고객 검색', '고객 조회', '고객'] },
  { intent: 'consultation-status', keys: ['상담 진행', '상담 현황', '상담'] },
  { intent: 'insurance-needed', keys: ['보험분석 필요', '보험 분석 필요', '보험분석', '보험 분석'] }
]

function includesAny(haystack: string, needles: string[]): boolean {
  return needles.some((n) => haystack.includes(n))
}

function inferWorkspace(lowered: string): { workspace: string; nav: string | null } {
  for (const entry of WORKSPACE_KEYWORDS) {
    if (includesAny(lowered, entry.keys)) return { workspace: entry.workspace, nav: entry.nav }
  }
  return { workspace: 'unknown', nav: null }
}

export default class IntentClassifier {
  classify(raw: string): JarvisClassification {
    const compact = raw.trim().replace(/\s+/g, ' ')
    const lowered = compact.toLowerCase()
    const { workspace, nav } = inferWorkspace(lowered)

    // 1) Implementation commands take precedence over everything else.
    if (includesAny(lowered, IMPLEMENTATION_MARKERS)) {
      return {
        mode: 'implementation-request',
        intent: 'implementation-request',
        confidence: 0.9,
        targetWorkspace: workspace,
        navigationTarget: nav
      }
    }

    // 2) Briefing.
    if (includesAny(lowered, BRIEFING_MARKERS)) {
      return { mode: 'briefing', intent: 'daily-briefing', confidence: 0.95, targetWorkspace: 'company', navigationTarget: 'company' }
    }

    // 3) Control phrases — start / operate the AI Company loop (→ Autopilot).
    if (includesAny(lowered, CONTROL_MARKERS)) {
      return { mode: 'navigation', intent: 'autopilot-control', confidence: 0.9, targetWorkspace: 'autopilot', navigationTarget: 'autopilot' }
    }

    // 4) Explicit navigation ("... 열어/이동/보여줘").
    if (includesAny(lowered, NAVIGATION_MARKERS) && nav) {
      return { mode: 'navigation', intent: 'navigate', confidence: 0.85, targetWorkspace: workspace, navigationTarget: nav }
    }

    // 5) Answerable business question.
    for (const entry of ANSWER_INTENTS) {
      if (includesAny(lowered, entry.keys)) {
        return { mode: 'answer', intent: entry.intent, confidence: 0.85, targetWorkspace: workspace, navigationTarget: nav }
      }
    }

    // 6) Bare workspace name ("FC OS", "라이브 컴퍼니", "승인센터") → navigation.
    if (nav) {
      return { mode: 'navigation', intent: 'navigate', confidence: 0.7, targetWorkspace: workspace, navigationTarget: nav }
    }

    // 7) Fallback.
    return { mode: 'unknown', intent: 'unknown', confidence: 0.3, targetWorkspace: workspace, navigationTarget: nav }
  }
}
