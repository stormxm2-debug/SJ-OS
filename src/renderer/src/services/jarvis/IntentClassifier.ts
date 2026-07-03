import type { JarvisClassification } from './types'
import { matchesAny, normalizeCommand, type NormalizedCommand } from './normalize'

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

/**
 * Universal App Builder markers — CEO commands that ask SJ OS to build a whole
 * business system/app/platform ("쇼핑몰 시스템 만들어", "학원 관리 프로그램 만들어",
 * "병원 예약 시스템 만들어", "상세페이지 자동 제작 시스템 만들어", "제안서 자동 생성").
 *
 * These are checked FIRST (before GPT + implementation markers), because "만들어"
 * is also a plain implementation verb — a bare "FC OS에 팀별 필터 만들어" must NOT
 * be captured here. Each marker therefore requires a whole-system noun
 * (시스템/프로그램/앱/플랫폼/쇼핑몰/예약 시스템/관리 프로그램) or a concrete
 * production/automation phrase, so only true "build me a system" commands match.
 */
const UNIVERSAL_BUILD_MARKERS = [
  '시스템 만들',
  '시스템만들',
  '프로그램 만들',
  '프로그램만들',
  '앱 만들',
  '앱만들',
  '플랫폼 만들',
  '플랫폼만들',
  '쇼핑몰',
  '커머스',
  '이커머스',
  '온라인몰',
  '예약 시스템',
  '예약시스템',
  '관리 프로그램',
  '관리프로그램',
  '관리 시스템',
  '관리시스템',
  '자동 제작',
  '자동제작',
  '자동화 시스템',
  '자동화시스템',
  '랜딩페이지',
  '랜딩 페이지',
  '상세페이지',
  '상세 페이지',
  '영상 광고',
  '영상광고',
  '광고 제작',
  '제안서 자동 생성',
  '제안서 자동생성',
  '제안서 생성',
  '제안서 자동'
]

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
 * GPT-needed markers — reasoning/analysis/strategy/planning language that a
 * deterministic local lookup cannot satisfy. These are checked BEFORE the
 * concrete "do it" implementation markers, but are chosen so they never steal a
 * concrete build command: e.g. "필터 추가해" has no reasoning marker, while
 * "다음 기능 추천해줘" does. Note '분석해' (not bare '분석', to avoid colliding
 * with the '보험분석' workspace) and '개선점' (not '개선해').
 */
const GPT_REASONING_MARKERS = [
  '왜',
  '분석해',
  '분석 해',
  '전략',
  '추천',
  '문제점',
  '개선점',
  '개선 방안',
  '개선안',
  '제안해',
  '조언',
  '인사이트',
  '브리핑',
  'briefing',
  '조직 상황',
  '전체 현황',
  '로드맵'
]

/** Planning context — feature/product/roadmap language. */
const PLANNING_CONTEXT = ['스프린트', 'sprint', '로드맵', '다음 기능', '기능 추천', '만들려면', '똑똑하게']

/** Question-form suffixes that turn a planning phrase into a GPT question. */
const QUESTION_SUFFIX = ['뭐야', '뭐고', '뭐죠', '뭘까', '일까', '할까', '좋을까', '어때', '어떨까', '?']

/**
 * Resolve the GPT sub-mode for a command already known to need GPT. Ordered so
 * more specific intents win: briefing → planning → strategy → data-question →
 * general.
 */
function inferGptMode(command: NormalizedCommand): string {
  if (matchesAny(command, ['브리핑', 'briefing', '조직 상황', '전체 현황', '전체 상황'])) {
    return 'business-briefing'
  }
  if (matchesAny(command, ['스프린트', 'sprint', '로드맵', '다음 기능', '기능 추천', '추천', '만들려면'])) {
    return 'implementation-planning'
  }
  if (matchesAny(command, ['전략', '관리 전략', '방안', '개선점', '개선 방안', '개선안', '어떻게 해야'])) {
    return 'strategy'
  }
  if (matchesAny(command, ['분석해', '분석 해', '문제점', '왜'])) {
    return 'data-question'
  }
  return 'general'
}

/** True when a command needs the GPT brain (reasoning) rather than a lookup. */
function needsGpt(command: NormalizedCommand): boolean {
  if (matchesAny(command, GPT_REASONING_MARKERS)) return true
  return matchesAny(command, QUESTION_SUFFIX) && matchesAny(command, PLANNING_CONTEXT)
}

/**
 * Approved external-link aliases. Detection yields only a KEY — never a URL.
 * The main process maps the key to a whitelisted URL (see main/externalLinks).
 */
const EXTERNAL_KEYWORDS: Array<{ key: string; aliases: string[] }> = [
  { key: 'youtube', aliases: ['유튜브', 'youtube'] },
  { key: 'naver', aliases: ['네이버', 'naver'] },
  { key: 'google', aliases: ['구글', 'google'] },
  { key: 'github', aliases: ['깃허브', 'github', 'sj os 깃허브'] }
]

function inferExternalKey(command: NormalizedCommand): string | null {
  for (const entry of EXTERNAL_KEYWORDS) {
    if (matchesAny(command, entry.aliases)) return entry.key
  }
  return null
}

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

function inferWorkspace(command: NormalizedCommand): { workspace: string; nav: string | null } {
  for (const entry of WORKSPACE_KEYWORDS) {
    if (matchesAny(command, entry.keys)) return { workspace: entry.workspace, nav: entry.nav }
  }
  return { workspace: 'unknown', nav: null }
}

export default class IntentClassifier {
  classify(raw: string): JarvisClassification {
    const command = normalizeCommand(raw)
    const { workspace, nav } = inferWorkspace(command)
    const externalKey = inferExternalKey(command)

    // 0a) Universal App Builder — "쇼핑몰 시스템 만들어", "학원 관리 프로그램
    //     만들어", "병원 예약 시스템 만들어". Checked before GPT + implementation
    //     so a whole-system build command becomes a structured app-build project.
    if (matchesAny(command, UNIVERSAL_BUILD_MARKERS)) {
      return {
        mode: 'universal-build',
        intent: 'universal-build-command',
        confidence: 0.92,
        targetWorkspace: 'app-builder',
        navigationTarget: 'app-builder',
        externalKey: null
      }
    }

    // 0b) GPT-needed reasoning/analysis/strategy/planning questions route to the
    //    GPT brain. Checked before implementation so "다음 기능 추천해줘" is a
    //    planning question, while concrete "... 추가해/구현해" stays a request.
    if (needsGpt(command)) {
      return {
        mode: 'gpt',
        intent: 'gpt',
        confidence: 0.8,
        targetWorkspace: workspace,
        navigationTarget: nav,
        externalKey: null,
        gptMode: inferGptMode(command)
      }
    }

    // 1) Implementation commands take precedence over everything else, so that
    //    "유튜브 임베드 기능 추가해" is a request, not an external open.
    if (matchesAny(command, IMPLEMENTATION_MARKERS)) {
      return {
        mode: 'implementation-request',
        intent: 'implementation-request',
        confidence: 0.9,
        targetWorkspace: workspace,
        navigationTarget: nav,
        externalKey: null
      }
    }

    // 2) Approved external action ("유튜브 켜줘", "SJ OS 깃허브 열어줘").
    if (externalKey) {
      return {
        mode: 'external-action',
        intent: 'external-open',
        confidence: 0.9,
        targetWorkspace: 'external',
        navigationTarget: null,
        externalKey
      }
    }

    // 3) Briefing.
    if (matchesAny(command, BRIEFING_MARKERS)) {
      return { mode: 'briefing', intent: 'daily-briefing', confidence: 0.95, targetWorkspace: 'company', navigationTarget: 'company', externalKey: null }
    }

    // 4) Control phrases — start / operate the AI Company loop (→ Autopilot).
    if (matchesAny(command, CONTROL_MARKERS)) {
      return { mode: 'navigation', intent: 'autopilot-control', confidence: 0.9, targetWorkspace: 'autopilot', navigationTarget: 'autopilot', externalKey: null }
    }

    // 5) Explicit navigation ("... 열어/이동/보여줘").
    if (matchesAny(command, NAVIGATION_MARKERS) && nav) {
      return { mode: 'navigation', intent: 'navigate', confidence: 0.85, targetWorkspace: workspace, navigationTarget: nav, externalKey: null }
    }

    // 6) Answerable business question.
    for (const entry of ANSWER_INTENTS) {
      if (matchesAny(command, entry.keys)) {
        return { mode: 'answer', intent: entry.intent, confidence: 0.85, targetWorkspace: workspace, navigationTarget: nav, externalKey: null }
      }
    }

    // 7) Bare workspace name ("FC OS", "라이브 컴퍼니", "승인센터") → navigation.
    if (nav) {
      return { mode: 'navigation', intent: 'navigate', confidence: 0.7, targetWorkspace: workspace, navigationTarget: nav, externalKey: null }
    }

    // 8) Fallback.
    return { mode: 'unknown', intent: 'unknown', confidence: 0.3, targetWorkspace: workspace, navigationTarget: nav, externalKey: null }
  }
}
