import { validCareDate, type CareRecord } from './careWorkspace'

/**
 * 한눈에 요약 목록 전용 시각적 묶음 — 같은 날짜·같은 병원 원기록을 한 카드에 쌓아 보여줄 뿐이다.
 * 원기록을 합치거나 지우지 않으며(동일 병명도 각각 유지), 실제 방문 횟수를 확정하지 않는다.
 * 날짜 미확인/무효 또는 병원명이 비어 있으면 원래 key별로 독립 묶음(미확인끼리 합치지 않음).
 */
export interface SummaryCareGroup {
  key: string
  date: string
  hospital: string
  records: CareRecord[]
}

export function groupSummaryRecords(rows: readonly CareRecord[]): SummaryCareGroup[] {
  const groups: SummaryCareGroup[] = []
  const byVisit = new Map<string, SummaryCareGroup>()
  for (const r of rows) {
    const groupable = validCareDate(r.date) && r.hospital.trim() !== ''
    const visitKey = groupable ? JSON.stringify(['visit', r.date, r.hospital]) : null
    const existing = visitKey ? byVisit.get(visitKey) : undefined
    if (existing) { existing.records.push(r); continue }
    const g: SummaryCareGroup = { key: visitKey ?? JSON.stringify(['record', r.key]), date: r.date, hospital: r.hospital, records: [r] }
    groups.push(g)
    if (visitKey) byVisit.set(visitKey, g)
  }
  return groups
}
