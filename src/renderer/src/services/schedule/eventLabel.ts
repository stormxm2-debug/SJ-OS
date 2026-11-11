/**
 * 월간 칸에 표시할 일정 라벨 (순수 함수).
 * 형식: "유형 · 장소 · 고객명". 장소가 없으면 생략한다.
 * 고객명은 연결 고객 이름을 우선, 없으면 직접 입력한 고객명을 쓴다.
 */
export function buildEventChipLabel(input: {
  typeLabel: string
  location?: string | null
  customerName?: string | null
}): string {
  const parts = [input.typeLabel, input.location?.trim(), input.customerName?.trim()].filter((p): p is string => !!p && p.length > 0)
  return parts.join(' · ')
}
