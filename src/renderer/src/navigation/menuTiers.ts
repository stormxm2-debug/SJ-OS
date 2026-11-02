/**
 * 메뉴 '등급' — 자주 쓰는(상단 고정) 메뉴 vs 베타 메뉴.
 *
 * CEO 지시(2026-11): 자주 쓰는 메뉴를 메뉴 상단으로 고정하고, 나머지 기능은
 * 아직 다듬는 중이라는 뜻으로 BETA 뱃지를 단다. 모바일 전체 메뉴(MobileMenuPage)와
 * 데스크톱 사이드바(Sidebar)가 같은 기준(메뉴 key)을 공유하도록 여기 한 곳에만 둔다.
 *
 * - 메뉴를 추가·이동할 때 상단 고정으로 올리려면 TOP_MENU_KEYS에 key를 넣는다.
 * - '홈'처럼 기능이 아닌 화면 틀 항목은 NON_BETA_KEYS에 넣어 BETA 뱃지에서 제외한다.
 */

/** 상단에 고정으로 올리는 '자주 쓰는 메뉴' — 이 순서대로 노출한다. */
export const TOP_MENU_KEYS = [
  'attendance',
  'schedule',
  'customer',
  'family-caregiver',
  'bojang114',
  'performance',
  'notice',
  'health-record'
] as const

const TOP_SET = new Set<string>(TOP_MENU_KEYS)

/** BETA 뱃지 대상에서 빼는 '화면 틀' 항목(홈 등) — 기능이 아니므로 베타가 아니다. */
const NON_BETA_KEYS = new Set<string>(['home', 'staff-home'])

/** 상단 고정(자주 쓰는) 메뉴인가. */
export function isTopMenu(key: string): boolean {
  return TOP_SET.has(key)
}

/** 상단 고정도, 홈 같은 틀도 아니면 베타 — 이름 옆에 BETA 뱃지를 단다. */
export function isBetaMenu(key: string): boolean {
  return !TOP_SET.has(key) && !NON_BETA_KEYS.has(key)
}
