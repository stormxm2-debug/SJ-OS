/**
 * SJ CLAIM FINDER — 세대(generation) 가드.
 *
 * 고객 전환/동의 철회처럼 "컨텍스트가 바뀌면 이전 비동기 응답을 버려야" 하는 경쟁 상태를
 * 결정론적으로 처리한다. 늦게 도착한 이전 요청의 결과가 현재 화면에 반영되는 것을 막는다.
 *
 *   const guard = createGenerationGuard()
 *   // 컨텍스트 시작/전환:
 *   const gen = guard.next()
 *   const data = await fetch(...)
 *   if (!guard.isCurrent(gen)) return  // 그 사이 컨텍스트가 바뀜 → 폐기
 *   apply(data)
 *   // 언마운트/스코프 무효화: guard.invalidate()
 */
export interface GenerationGuard {
  /** 새 세대 시작. 반환된 토큰을 완료 시 isCurrent 로 검사한다. */
  next(): number
  /** 주어진 세대가 아직 최신인가. */
  isCurrent(gen: number): boolean
  /** 진행 중인 모든 세대를 무효화(새 세대를 시작하지 않음). */
  invalidate(): void
  /** 현재 세대 값(디버그/테스트용). */
  current(): number
}

export function createGenerationGuard(): GenerationGuard {
  let current = 0
  return {
    next() {
      current += 1
      return current
    },
    isCurrent(gen: number) {
      return gen === current
    },
    invalidate() {
      current += 1
    },
    current() {
      return current
    }
  }
}
