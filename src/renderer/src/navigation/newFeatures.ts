import type { ViewName } from './types'

/**
 * NEW 뱃지 레지스트리 — 새 기능을 출시하면 아래 목록에 한 줄 추가한다.
 * 데스크톱 사이드바(모든 모드)와 모바일 전체 메뉴에 골드 NEW 뱃지가 붙는다.
 *
 * 뱃지가 사라지는 조건(기기별 localStorage, 계정 공용 아님):
 *  - 해당 메뉴를 2번 누르면 (NavigationContext.navigate가 방문을 기록)
 *  - 또는 등록일(addedAt)로부터 14일이 지나면 자동 만료 — 안 눌러도 영원히 남지 않는다
 */

export interface NewFeatureEntry {
  view: ViewName
  /** 등록일 YYYY-MM-DD — 이 날짜 기준으로 14일 뒤 자동 만료 */
  addedAt: string
}

export const NEW_FEATURES: NewFeatureEntry[] = [
  { view: 'leads', addedAt: '2026-07-11' },
  { view: 'files', addedAt: '2026-07-12' },
  { view: 'birthdays', addedAt: '2026-07-14' },
  { view: 'stats-report', addedAt: '2026-07-14' },
  { view: 'referrals', addedAt: '2026-07-15' },
  { view: 'today-contacts', addedAt: '2026-07-16' },
  { view: 'exemptions', addedAt: '2026-07-17' },
  { view: 'salary', addedAt: '2026-07-18' },
  { view: 'disease-exceptions', addedAt: '2026-07-18' },
  { view: 'plan-request', addedAt: '2026-07-19' },
  { view: 'content-studio', addedAt: '2026-07-20' },
  { view: 'app-install', addedAt: '2026-07-21' },
  { view: 'family-birthdays', addedAt: '2026-07-21' }
]

const VISIT_KEY = 'sj-new-feature-visits-v1'
const DISMISS_VISITS = 2
const EXPIRE_DAYS = 14

// localStorage는 렌더마다 읽지 않도록 모듈 캐시를 둔다 (쓰기 시에만 갱신).
let visitCache: Record<string, number> | null = null

function readVisits(): Record<string, number> {
  if (visitCache) return visitCache
  try {
    const raw = window.localStorage.getItem(VISIT_KEY)
    const obj: unknown = raw ? JSON.parse(raw) : {}
    visitCache = obj && typeof obj === 'object' && !Array.isArray(obj) ? { ...(obj as Record<string, number>) } : {}
  } catch {
    visitCache = {}
  }
  return visitCache
}

type Listener = () => void
const listeners = new Set<Listener>()

/** 이 화면에 NEW 뱃지를 보여줘야 하는가 (등록됨 + 14일 이내 + 방문 2회 미만). */
export function isNewFeature(view: string): boolean {
  const entry = NEW_FEATURES.find((f) => f.view === view)
  if (!entry) return false
  const added = new Date(`${entry.addedAt}T00:00:00`).getTime()
  if (!Number.isFinite(added) || Date.now() - added > EXPIRE_DAYS * 86_400_000) return false
  return (readVisits()[view] ?? 0) < DISMISS_VISITS
}

/** 신기능 화면 방문 1회 기록 — 2회째에 뱃지가 사라지고 구독자에게 알린다. */
export function recordFeatureVisit(view: string): void {
  if (!NEW_FEATURES.some((f) => f.view === view)) return
  const visits = readVisits()
  const count = visits[view] ?? 0
  if (count >= DISMISS_VISITS) return
  visits[view] = count + 1
  try {
    window.localStorage.setItem(VISIT_KEY, JSON.stringify(visits))
  } catch {
    /* 저장 실패(사파리 프라이빗 등)여도 세션 내 캐시로는 동작 */
  }
  listeners.forEach((fn) => fn())
}

/** 뱃지 상태 변경 구독 — 메뉴 컴포넌트가 2번째 방문 즉시 뱃지를 지울 수 있게 한다. */
export function subscribeNewFeatures(fn: Listener): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}
