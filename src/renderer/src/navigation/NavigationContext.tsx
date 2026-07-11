import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { View } from './types'

interface NavigationValue {
  route: View
  navigate: (view: View) => void
}

const NavigationContext = createContext<NavigationValue | null>(null)

/**
 * Minimal in-renderer navigation — no router dependency, no backend. Holds the
 * active view in React state.
 *
 * 브라우저 히스토리 연동 (2026-07-11 대표 지시 "뒤로가기 누르면 전 화면"):
 * 화면 이동마다 pushState로 히스토리에 쌓고, 뒤로가기(popstate)면 그 화면으로
 * 복원한다 — 폰 PWA의 안드로이드 뒤로가기·브라우저 ← 버튼이 앱 내부에서 동작.
 * 첫 화면에서 한 번 더 누르면 브라우저 기본 동작(사이트 이탈)은 그대로 둔다.
 */
export function NavigationProvider({
  children
}: {
  children: ReactNode
}): JSX.Element {
  const [route, setRoute] = useState<View>({ name: 'assistant' })
  const routeRef = useRef(route)
  routeRef.current = route

  useEffect(() => {
    // 시작 화면을 히스토리 기준점으로 심는다 (뒤로가기 복원용 상태 포함).
    try {
      window.history.replaceState({ sjView: routeRef.current }, '')
    } catch {
      /* Electron file:// 등 히스토리 미지원 환경은 조용히 무시 */
    }
    const onPop = (e: PopStateEvent): void => {
      const v = (e.state as { sjView?: View } | null)?.sjView
      if (v && typeof v.name === 'string') setRoute(v)
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const navigate = (view: View): void => {
    // 같은 화면 재클릭은 히스토리를 쌓지 않는다 (뒤로가기가 무의미하게 늘어남 방지).
    if (JSON.stringify(routeRef.current) === JSON.stringify(view)) return
    try {
      window.history.pushState({ sjView: view }, '')
    } catch {
      /* ignore */
    }
    setRoute(view)
  }

  return (
    <NavigationContext.Provider value={{ route, navigate }}>
      {children}
    </NavigationContext.Provider>
  )
}

export function useNavigation(): NavigationValue {
  const ctx = useContext(NavigationContext)
  if (!ctx) {
    throw new Error('useNavigation must be used within a NavigationProvider')
  }
  return ctx
}
