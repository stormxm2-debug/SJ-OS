import { CLAIM_LABELS, type CareRecord, type ClaimState } from './careWorkspace'
export const escapePrint = (value: unknown): string => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
export function carePrintHtml(records: CareRecord[], stateOf: (row: CareRecord) => ClaimState, caption: string): string {
  const e = escapePrint
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>건강기록 · 청구 검토</title><style>@page{size:A4 landscape;margin:12mm}body{font:11px/1.5 sans-serif;color:#172b34}h1{font-size:20px}table{border-collapse:collapse;width:100%}td,th{padding:7px;border:1px solid #bbb;text-align:left;vertical-align:top}tr{break-inside:avoid}thead{display:table-header-group}small{color:#555}footer{margin-top:15px}</style></head><body><h1>건강기록 · 청구 검토</h1><p>${e(caption)} · ${records.length}건</p><p>수동 확인 상태입니다. 미확인은 미청구가 아니며 실제 보험사 청구·지급 내역과 다를 수 있습니다. 진료별 담보 지급 여부는 약관·증빙 확인이 필요합니다.</p><table><thead><tr><th>진료일</th><th>병원</th><th>상병·코드·좌우</th><th>유형·입원일수</th><th>약물·투약일수</th><th>청구 상태</th></tr></thead><tbody>${records.map(r => `<tr><td>${e(r.date || '날짜 미확인')}</td><td>${e(r.hospital || '기관 미확인')}</td><td>${e(r.disease)}<br>${e(r.code || '코드 미제공')} · ${e(r.side)}</td><td>${e(r.kind)}${r.surgery ? ' · 수술(추정)' : ''}<br>입원 ${r.kind === '입원' ? r.admissionDays == null ? '일수 미확인' : e(r.admissionDays) + '일' : '해당 없음'}</td><td>${r.medications.map(m => `${e(m.name)} · ${e(m.days || '일수 미확인')}${m.days ? '일분' : ''}${m.flu ? ' (독감 담보 확인 대상)' : ''}`).join('<br>') || '정보 없음'}</td><td>${e(CLAIM_LABELS[stateOf(r)])}</td></tr>`).join('')}</tbody></table><footer>개인 의료정보가 포함되어 있습니다. 출력·PDF 파일의 보관과 공유 범위를 확인하세요. 독감 약물 표시는 지급 확정이 아닙니다.</footer></body></html>`
}
export function printCareRecords(records: CareRecord[], stateOf: (row: CareRecord) => ClaimState, caption: string): boolean {
  if (!records.length) return false
  const target = window.open('', '_blank')
  if (!target) return false
  target.opener = null
  target.document.write(carePrintHtml(records, stateOf, caption))
  target.document.close()
  target.focus()
  target.print()
  return true
}
