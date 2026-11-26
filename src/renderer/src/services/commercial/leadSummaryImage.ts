import { SUMMARY_LAYOUT, SUMMARY_WIDTH, summaryHeight, type LeadSummary } from './leadSummary'

/**
 * DB 배분 요약 이미지(PNG) — 브라우저 캔버스로 그린다. 외부 서비스·서버 전송 없음.
 * 이름·전화번호는 들어가지 않는다(건수만).
 */

const NAVY = '#0e1e3a'
const GOLD = '#e6c877'
const INK = '#1e293b'
const MUTED = '#64748b'
const LINE = '#e2e8f0'
const BAR = '#1b3a6b'
const BAR_BG = '#eef2f7'
const FONT = "'Malgun Gothic','Apple SD Gothic Neo','Noto Sans KR',sans-serif"

export function renderSummaryCanvas(s: LeadSummary): HTMLCanvasElement {
  const W = SUMMARY_WIDTH
  const H = summaryHeight(s)
  const scale = 2
  const canvas = document.createElement('canvas')
  canvas.width = W * scale
  canvas.height = H * scale
  const ctx = canvas.getContext('2d')
  if (!ctx) return canvas
  ctx.scale(scale, scale)
  const L = SUMMARY_LAYOUT
  const PAD = 56

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, W, H)

  // 머리
  ctx.fillStyle = NAVY
  ctx.fillRect(0, 0, W, L.HEADER_H)
  ctx.fillStyle = GOLD
  ctx.font = `700 48px ${FONT}`
  ctx.textBaseline = 'alphabetic'
  ctx.fillText(s.title, PAD, 92)
  ctx.fillStyle = '#cbd5e1'
  ctx.font = `400 26px ${FONT}`
  ctx.fillText(s.subtitle, PAD, 140)

  // 합계
  let y = L.HEADER_H
  ctx.fillStyle = NAVY
  ctx.font = `800 64px ${FONT}`
  ctx.fillText(`총 ${s.total}건`, PAD, y + 90)
  ctx.fillStyle = MUTED
  ctx.font = `500 28px ${FONT}`
  ctx.fillText(`배정 ${s.assigned}건  ·  미배정 ${s.unassigned}건`, PAD, y + 138)
  y += L.TOTAL_H

  const section = (label: string): void => {
    ctx.fillStyle = INK
    ctx.font = `700 30px ${FONT}`
    ctx.fillText(label, PAD, y + 44)
    ctx.fillStyle = LINE
    ctx.fillRect(PAD, y + 58, W - PAD * 2, 2)
    y += L.SECTION_H
  }

  const bar = (label: string, value: number, max: number, right: string, rowH: number): void => {
    const labelW = 220
    const barX = PAD + labelW
    const barW = W - PAD * 2 - labelW - 150
    ctx.fillStyle = INK
    ctx.font = `600 28px ${FONT}`
    ctx.fillText(label, PAD, y + rowH / 2 + 10, labelW - 16)
    ctx.fillStyle = BAR_BG
    ctx.fillRect(barX, y + rowH / 2 - 11, barW, 22)
    ctx.fillStyle = BAR
    ctx.fillRect(barX, y + rowH / 2 - 11, Math.max(4, max > 0 ? (barW * value) / max : 0), 22)
    ctx.fillStyle = INK
    ctx.font = `700 28px ${FONT}`
    ctx.textAlign = 'right'
    ctx.fillText(right, W - PAD, y + rowH / 2 + 10)
    ctx.textAlign = 'left'
    y += rowH
  }

  if (s.groups.length > 0) {
    section('직원별 배정')
    const max = Math.max(...s.groups.map((g) => g.count))
    for (const g of s.groups) bar(g.name, g.count, max, `${g.count}건 (${g.pct}%)`, L.ROW_H)
  }

  if (s.regions.length > 0) {
    section('지역별 건수')
    const max = Math.max(...s.regions.map((r) => r.count))
    for (const r of s.regions) bar(r.region, r.count, max, `${r.count}건`, L.REGION_ROW_H)
    if (s.regionsRest > 0) bar('기타 지역', s.regionsRest, max, `${s.regionsRest}건`, L.REGION_ROW_H)
  }

  // 바닥
  ctx.fillStyle = MUTED
  ctx.font = `400 22px ${FONT}`
  ctx.fillText('SJ INVEST · 고객 개인정보는 포함되지 않습니다', PAD, H - 34)
  return canvas
}

function toBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'))
}

export async function downloadSummaryPng(s: LeadSummary): Promise<boolean> {
  try {
    const blob = await toBlob(renderSummaryCanvas(s))
    if (!blob) return false
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `db-배분-${new Date().toISOString().slice(0, 10)}.png`
    document.body.appendChild(a)
    a.click()
    a.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 2000)
    return true
  } catch {
    return false
  }
}

/** 이미지를 클립보드에 복사(카톡 PC에서 붙여넣기). 지원하지 않는 브라우저면 false. */
export async function copySummaryPng(s: LeadSummary): Promise<boolean> {
  try {
    const blob = await toBlob(renderSummaryCanvas(s))
    if (!blob || typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) return false
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
    return true
  } catch {
    return false
  }
}
