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

/**
 * AI 패널의 "AI 반영 기준" 안내(표시 전용, 순수 함수).
 * 실제 askHealthRecordAi는 검수된(verified) 인수·예외 기준만 전송하므로, 안내 건수도 같은 기준으로 센다.
 * 보험사별 카드의 전체 등록/검수됨/검수 전 건수와는 별개다. 서비스 필터·payload는 여기서 바꾸지 않는다.
 */
export interface AiGuideContext {
  insurers: readonly unknown[]
  guides: readonly { verified?: boolean }[]
  exceptions: readonly { verified?: boolean }[]
}
export interface AiGuideNote { verifiedGuides: number; verifiedExceptions: number; excluded: number; warn: boolean; text: string }

export function aiGuideNote(status: GuideLoadStatus, ctx: AiGuideContext): AiGuideNote {
  const vg = ctx.guides.filter(g => g.verified).length
  const ve = ctx.exceptions.filter(e => e.verified).length
  const v = vg + ve
  const excluded = ctx.guides.length + ctx.exceptions.length - v
  const counts = { verifiedGuides: vg, verifiedExceptions: ve, excluded }
  const tail = excluded ? ` 검수 전 ${excluded}건은 AI 반영에서 제외됩니다.` : ''
  const applied = v ? `AI 반영 기준 ${v}건(검수됨 · 인수 ${vg} · 예외 ${ve})` : 'AI 반영 기준 0건 · 건강기록만 요약'
  const note = (text: string, warn = false): AiGuideNote => ({ ...counts, warn, text })
  if (status === 'loading') return note('기준 조회 중입니다. 조회가 끝난 뒤 실행하세요.')
  if (ctx.insurers.length === 0) return note('선택한 보험사가 없어 건강기록만 요약합니다(기준 미반영).')
  if (status === 'idle') return note('기준을 아직 확인하지 않아 건강기록만 요약합니다(기준 미확인).')
  if (status === 'failed') return note('기준 조회에 실패해 건강기록만 요약합니다(기준 미확인).', true)
  if (status === 'partial') return note(`일부 기준 조회 실패 — 성공한 자료 중 검수된 기준만 반영: ${applied}.${tail}`, true)
  if (v + excluded === 0) return note('일치한 등록 기준이 없어 건강기록만 요약합니다(미매칭 — 가입 가능을 뜻하지 않음).')
  return note(`${applied}${v ? '을 참고로 반영합니다' : ''}.${tail}`)
}
