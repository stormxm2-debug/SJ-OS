import * as XLSX from 'xlsx'
import { LEAD_STATUS_LABEL, type Lead } from './leadService'
import { sheetName, vendorOf, vendorTabs, NO_FC } from './leadSheets'

/**
 * 업체별 시트 엑셀 — 업체마다 시트 한 장. 첫 장은 업체별 요약.
 * ⚠ 고객 이름·전화가 들어 있으므로 외부에 공유하지 않는다(화면에도 안내).
 */

function fmt(iso: string | null): string {
  if (!iso) return ''
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return ''
  const d = new Date(t)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function rowOf(l: Lead): Record<string, string> {
  return {
    이름: l.name,
    전화: l.phone ?? '',
    업체: vendorOf(l),
    DB종류: l.dbType ?? '',
    담당FC: l.assignedFcName ?? NO_FC,
    상태: LEAD_STATUS_LABEL[l.status] ?? l.status,
    배정일시: fmt(l.assignedAt),
    첫통화: fmt(l.firstCallAt),
    메모: l.memo ?? ''
  }
}

export function buildVendorWorkbook(leads: Lead[], registered: string[]): XLSX.WorkBook {
  const wb = XLSX.utils.book_new()
  const used = new Set<string>()
  const tabs = vendorTabs(leads, registered)
  const summary = tabs.map((t) => {
    const mine = leads.filter((l) => vendorOf(l) === t.name)
    return {
      업체: t.name,
      전체: mine.length,
      배정: mine.filter((l) => l.assignedFcId).length,
      미배정: mine.filter((l) => !l.assignedFcId).length,
      미콜: mine.filter((l) => l.status === 'new').length,
      계약: mine.filter((l) => l.status === 'contracted').length
    }
  })
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summary.length > 0 ? summary : [{ 업체: '(데이터 없음)' }]), sheetName('요약', used))
  for (const t of tabs) {
    const mine = leads.filter((l) => vendorOf(l) === t.name).map(rowOf)
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(mine.length > 0 ? mine : [{ 이름: '(데이터 없음)' }]), sheetName(t.name, used))
  }
  return wb
}

export function downloadVendorWorkbook(leads: Lead[], registered: string[]): void {
  const day = new Date().toISOString().slice(0, 10)
  XLSX.writeFile(buildVendorWorkbook(leads, registered), `DB업체별시트_${day}.xlsx`)
}

/** 현재 보고 있는 목록(필터 적용) 한 장짜리 엑셀. */
export function downloadLeadList(leads: Lead[], label: string): void {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(leads.length > 0 ? leads.map(rowOf) : [{ 이름: '(데이터 없음)' }]), sheetName(label || 'DB', new Set()))
  const day = new Date().toISOString().slice(0, 10)
  XLSX.writeFile(wb, `DB_${(label || '목록').replace(/[\\/?*[\]:]/g, ' ')}_${day}.xlsx`)
}
