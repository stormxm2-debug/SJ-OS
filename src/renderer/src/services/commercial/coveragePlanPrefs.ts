/**
 * 가입제안서 담보 정리 — 플랜별 담보 그룹 켜짐/꺼짐을 FC 기기에 저장한다.
 *
 * 사이드바 회원별 커스터마이즈(layout/sidebarPrefs.ts)와 같은 원칙: 기기별 localStorage,
 * 저장에 없는 그룹(새로 추가된 담보 그룹)은 기본값(defaultOn)을 따라가 NEW 기능 추가에 안전.
 * 저장이 막힌 환경(시크릿 모드 등)에서도 앱은 기본값으로 그대로 동작한다.
 */

import { PLANS, defaultOnKeys, findPlanGroup, groupsOfPlan, type PlanKey } from './coveragePlans'

const KEY = 'sj-coverage-plan-prefs-v1'

/** 플랜별로 FC가 직접 정한 값만 담는다. 없는 그룹은 기본값을 쓴다. */
export type PlanPrefs = Partial<Record<PlanKey, Record<string, boolean>>>

type Listener = () => void
const listeners = new Set<Listener>()

export function loadPlanPrefs(): PlanPrefs {
  try {
    const raw = window.localStorage.getItem(KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : null
    const prefs: PlanPrefs = {}
    if (parsed && typeof parsed === 'object') {
      for (const plan of PLANS) {
        const saved = (parsed as Record<string, unknown>)[plan.key]
        if (!saved || typeof saved !== 'object') continue
        const picked: Record<string, boolean> = {}
        for (const [groupKey, on] of Object.entries(saved as Record<string, unknown>)) {
          // 없어진 그룹 키는 버린다(담보 그룹이 개편돼도 깨지지 않게).
          if (typeof on === 'boolean' && findPlanGroup(groupKey)) picked[groupKey] = on
        }
        if (Object.keys(picked).length) prefs[plan.key] = picked
      }
    }
    return prefs
  } catch {
    return {}
  }
}

function save(prefs: PlanPrefs): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(prefs))
  } catch {
    /* 저장 실패여도 앱은 계속 동작 */
  }
  listeners.forEach((fn) => fn())
}

export function subscribePlanPrefs(fn: Listener): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

/** 그룹이 켜져 있는지. 저장값이 없으면 기본값(defaultOn). */
export function isGroupOn(plan: PlanKey, groupKey: string, prefs: PlanPrefs): boolean {
  const saved = prefs[plan]?.[groupKey]
  if (typeof saved === 'boolean') return saved
  return findPlanGroup(groupKey)?.defaultOn ?? false
}

/** 플랜에서 켜져 있는 그룹 키 전부. */
export function onGroupKeys(plan: PlanKey, prefs: PlanPrefs): string[] {
  return groupsOfPlan(plan)
    .filter((g) => isGroupOn(plan, g.key, prefs))
    .map((g) => g.key)
}

/** 그룹 하나를 켜고 끈다(저장까지). */
export function toggleGroup(plan: PlanKey, groupKey: string): void {
  const prefs = loadPlanPrefs()
  const current = prefs[plan] ?? {}
  prefs[plan] = { ...current, [groupKey]: !isGroupOn(plan, groupKey, prefs) }
  save(prefs)
}

/** 플랜의 그룹을 한꺼번에 켜거나 끈다. */
export function setAllGroups(plan: PlanKey, on: boolean): void {
  const prefs = loadPlanPrefs()
  const next: Record<string, boolean> = {}
  for (const group of groupsOfPlan(plan)) next[group.key] = on
  prefs[plan] = next
  save(prefs)
}

/** 플랜을 기본 셋팅으로 되돌린다(저장값 삭제). */
export function resetPlan(plan: PlanKey): void {
  const prefs = loadPlanPrefs()
  delete prefs[plan]
  save(prefs)
}

/** 플랜이 기본 셋팅 그대로인지(화면에 '기본 셋팅' 배지를 띄울지 판단). */
export function isPlanDefault(plan: PlanKey, prefs: PlanPrefs): boolean {
  const on = onGroupKeys(plan, prefs).slice().sort()
  const base = defaultOnKeys(plan).slice().sort()
  return on.length === base.length && on.every((k, i) => k === base[i])
}
