/**
 * 일정 목록 상태 갱신 (순수 함수).
 *
 * 저장(등록·수정) 응답으로 받은 일정을 화면 목록에 즉시 반영한다. 재조회 한 번에만
 * 기대하면 응답이 늦거나 실패할 때 방금 등록한 일정이 달력에 나타나지 않는다.
 */

export interface HasIdAndStart {
  id: string
  startsAt: string
}

/** id 기준으로 넣거나 교체하고, 시작 시각 순으로 정렬한 새 배열을 돌려준다. */
export function upsertScheduleEvent<T extends HasIdAndStart>(list: T[], ev: T): T[] {
  const idx = list.findIndex((x) => x.id === ev.id)
  const next = idx >= 0 ? list.map((x, i) => (i === idx ? ev : x)) : [...list, ev]
  return next.sort((a, b) => {
    const at = Date.parse(a.startsAt)
    const bt = Date.parse(b.startsAt)
    return (Number.isNaN(at) ? 0 : at) - (Number.isNaN(bt) ? 0 : bt)
  })
}

/** 재조회 결과에 방금 저장한 일정(id)이 빠져 있는지 확인한다(반영 누락 감지). */
export function containsEvent<T extends HasIdAndStart>(list: T[], id: string): boolean {
  return list.some((x) => x.id === id)
}
