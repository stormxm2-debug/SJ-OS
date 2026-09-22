/**
 * 담보 정리 화면 — 보는 방식을 FC 기기에 저장한다.
 *
 * 두 가지 상황이 완전히 다르다.
 *  - 설계사용: 담보를 켜고 끄고, 값을 확인하며 만든다.
 *  - 고객용: 만든 결과만 크게 보여준다. 체크박스·설정 같은 건 없어야 한다.
 *
 * 고객용은 다시 두 가지다. 대결(회사 맞대결)과 견적서(한 장짜리 종이). FC마다
 * 고객 앞에서 쓰는 방식이 달라, 고른 값을 기기에 저장해 다음에도 그대로 연다.
 *
 * coveragePlanPrefs 와 같은 원칙: 기기별 localStorage, 저장이 막힌 환경(시크릿 모드 등)
 * 에서도 기본값으로 그대로 동작한다.
 */

const KEY = 'sj-coverage-view-v1'

/** 화면을 누가 보는가 */
export type ViewMode = 'fc' | 'customer'
/** 고객에게 보여주는 방식 */
export type CustomerStyle = 'versus' | 'receipt'

export interface ViewPrefs {
  mode: ViewMode
  customerStyle: CustomerStyle
}

/** 처음 켜면 설계사용 · 고객용은 대결 방식 */
export const DEFAULT_VIEW: ViewPrefs = { mode: 'fc', customerStyle: 'versus' }

const isMode = (v: unknown): v is ViewMode => v === 'fc' || v === 'customer'
const isStyle = (v: unknown): v is CustomerStyle => v === 'versus' || v === 'receipt'

export function loadViewPrefs(): ViewPrefs {
  try {
    const raw = window.localStorage.getItem(KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : null
    if (!parsed || typeof parsed !== 'object') return DEFAULT_VIEW
    const saved = parsed as Record<string, unknown>
    return {
      mode: isMode(saved.mode) ? saved.mode : DEFAULT_VIEW.mode,
      customerStyle: isStyle(saved.customerStyle) ? saved.customerStyle : DEFAULT_VIEW.customerStyle
    }
  } catch {
    return DEFAULT_VIEW
  }
}

export function saveViewPrefs(prefs: ViewPrefs): ViewPrefs {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(prefs))
  } catch {
    // 저장이 막혀 있어도 화면은 그대로 동작한다.
  }
  return prefs
}

export function setMode(prefs: ViewPrefs, mode: ViewMode): ViewPrefs {
  return saveViewPrefs({ ...prefs, mode })
}

export function setCustomerStyle(prefs: ViewPrefs, customerStyle: CustomerStyle): ViewPrefs {
  // 방식을 고르는 건 곧 고객에게 보여주겠다는 뜻이라, 고객용 화면으로 함께 넘어간다.
  return saveViewPrefs({ ...prefs, customerStyle, mode: 'customer' })
}
