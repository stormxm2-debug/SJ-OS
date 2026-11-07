/**
 * 가입 검토 탭의 "기준 조회 상태" 파생(표시 전용, 순수 함수).
 *
 * 인수 가이드(listUnderwriting)와 예외질환(listExceptions) 두 소스의 응답 ok 값을 각각 기록해
 * 실패 종류를 추측하지 않고 표시한다. 조회 중이면 이전 결과가 있어도 'loading'이 우선한다.
 * 'ok'는 두 소스 모두 응답 성공(일치 0건 포함)이라는 뜻일 뿐, 가입 가능 여부를 뜻하지 않는다.
 */
export type GuideLoadStatus = 'idle' | 'loading' | 'ok' | 'partial' | 'failed'

export interface GuideLoadMeta {
  busy: boolean
  /** null = 아직 조회하지 않음. catch(예외)는 두 소스 모두 false로 기록한다. */
  underwritingOk: boolean | null
  exceptionOk: boolean | null
}

export function guideLoadStatus(meta: GuideLoadMeta): GuideLoadStatus {
  if (meta.busy) return 'loading'
  const { underwritingOk: g, exceptionOk: e } = meta
  if (g === null && e === null) return 'idle'
  if (g === true && e === true) return 'ok'
  if (g === true || e === true) return 'partial'
  return 'failed'
}
