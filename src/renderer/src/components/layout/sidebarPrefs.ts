/**
 * 데스크톱 사이드바 회원별 순서·숨김 (기기별 localStorage).
 *
 * 모바일 전체 메뉴 커스터마이즈(mobileMenu.ts의 MenuPrefs)와 같은 원칙의
 * 데스크톱판. 사이드바는 세 변형(FC용 MVP·직원 모드·대표 모드 그룹)이 있어
 * 섹션 키('mvp' | 'staff' | 'group:<그룹명>')별로 순서·숨김을 따로 저장한다.
 * 저장에 없는 항목(신규 메뉴)은 기본 순서로 뒤에 이어붙어 NEW 기능 추가에 안전.
 * 숨김은 표시만 가리며 접근권한과 무관하다.
 */

const KEY = 'sj-desktop-nav-prefs-v1'

export interface SidebarPrefs {
  order: Record<string, string[]>
  hidden: Record<string, string[]>
}

type Listener = () => void
const listeners = new Set<Listener>()

export function loadSidebarPrefs(): SidebarPrefs {
  try {
    const raw = window.localStorage.getItem(KEY)
    const p: unknown = raw ? JSON.parse(raw) : null
    const order: Record<string, string[]> = {}
    const hidden: Record<string, string[]> = {}
    if (p && typeof p === 'object') {
      const po = (p as { order?: unknown }).order
      if (po && typeof po === 'object') {
        for (const [sec, keys] of Object.entries(po as Record<string, unknown>)) {
          if (Array.isArray(keys)) order[sec] = keys.filter((k): k is string => typeof k === 'string')
        }
      }
      const ph = (p as { hidden?: unknown }).hidden
      if (ph && typeof ph === 'object') {
        for (const [sec, keys] of Object.entries(ph as Record<string, unknown>)) {
          if (Array.isArray(keys)) hidden[sec] = keys.filter((k): k is string => typeof k === 'string')
        }
      }
    }
    return { order, hidden }
  } catch {
    return { order: {}, hidden: {} }
  }
}

function save(p: SidebarPrefs): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(p))
  } catch {
    /* 저장 실패여도 앱은 계속 동작 */
  }
  listeners.forEach((fn) => fn())
}

export function subscribeSidebarPrefs(fn: Listener): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

/** 섹션 항목을 저장된 순서로 정렬 (미저장·신규 항목은 기본 순서로 뒤에). */
export function orderSidebarItems<T extends { key: string }>(section: string, items: T[], prefs: SidebarPrefs): T[] {
  const saved = prefs.order[section] ?? []
  if (saved.length === 0) return items
  const inSaved = items.filter((i) => saved.includes(i.key)).sort((a, b) => saved.indexOf(a.key) - saved.indexOf(b.key))
  const rest = items.filter((i) => !saved.includes(i.key))
  return [...inSaved, ...rest]
}

export function isSidebarItemHidden(section: string, key: string, prefs: SidebarPrefs): boolean {
  return (prefs.hidden[section] ?? []).includes(key)
}

/** 항목을 섹션 안에서 위/아래로 이동. orderedKeys = 화면에 그려진 현재 순서 전체. */
export function moveSidebarItem(section: string, orderedKeys: string[], key: string, dir: -1 | 1): void {
  const idx = orderedKeys.indexOf(key)
  const to = idx + dir
  if (idx < 0 || to < 0 || to >= orderedKeys.length) return
  const next = [...orderedKeys]
  next.splice(idx, 1)
  next.splice(to, 0, key)
  const prefs = loadSidebarPrefs()
  prefs.order[section] = next
  save(prefs)
}

export function toggleSidebarItemHidden(section: string, key: string): void {
  const prefs = loadSidebarPrefs()
  const cur = prefs.hidden[section] ?? []
  prefs.hidden[section] = cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key]
  save(prefs)
}

/** 순서·숨김을 기본값으로 복원. */
export function resetSidebarPrefs(): void {
  try {
    window.localStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
  listeners.forEach((fn) => fn())
}
