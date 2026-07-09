/**
 * 지각 벌금 규칙 (대표 지시, 2026-07):
 *  - 출근 기준 09:00. 평일(월~금)만 적용, 주말은 벌금 없음.
 *  - 09:00 초과 → 50,000원 · 11:00 초과 → 100,000원 · 12:00 초과 → 200,000원
 * 출근 버튼을 누르는 순간의 시각으로 자동 판정한다.
 */

export const LATE_TIERS = [
  { afterHour: 12, fee: 200000, label: '12시 초과' },
  { afterHour: 11, fee: 100000, label: '11시 초과' },
  { afterHour: 9, fee: 50000, label: '9시 초과' }
] as const

/** 해당 시각의 지각 벌금(원). 평일 9시 이전·주말 = 0. */
export function lateFeeFor(d: Date): number {
  const day = d.getDay() // 0=일, 6=토
  if (day === 0 || day === 6) return 0
  const minutes = d.getHours() * 60 + d.getMinutes()
  if (minutes > 12 * 60) return 200000
  if (minutes > 11 * 60) return 100000
  if (minutes > 9 * 60) return 50000
  return 0
}

export function feeLabel(fee: number): string {
  return `${fee.toLocaleString('ko-KR')}원`
}

/** 지각 여부 (벌금 발생 기준). */
export function isLate(d: Date): boolean {
  return lateFeeFor(d) > 0
}
