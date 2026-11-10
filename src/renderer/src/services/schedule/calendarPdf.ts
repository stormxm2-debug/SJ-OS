/**
 * 월간 캘린더 PDF (A4 가로). 화면(MonthView)과 같은 규칙으로 칸을 계산한다.
 *
 * 화면↔PDF 일치: 칸 배치(어느 날짜 칸에 무엇이 몇 건 들어가는지)는 planMonthCells 한 곳에서만
 * 계산하고, 화면/PDF 모두 그 결과를 쓴다. PDF 는 그 계획을 그리기만 한다.
 *
 * 권한: PDF 생성은 호출 측이 '화면에 보이는 데이터'만 넘긴다(권한 = 화면 조회 권한과 동일).
 * 한글 폰트: 기존 pdfFill 과 같은 NanumGothic 을 subset 임베드한다.
 */

import { PDFDocument, rgb, StandardFonts, type PDFFont } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import { monthMatrix, groupByDay, kstHm, type MonthCell } from './calendarMonth'
import { noticesByDayKey, sortNoticesForDay, type CalendarNotice } from './calendarNotices'

export interface PdfEvent {
  id: string
  startsAt: string
  title: string
}

export interface CellPlan {
  cell: MonthCell
  /** 칸 최상단 공지(최대 1건 표시, 나머지는 공지 +N) */
  notice?: CalendarNotice
  noticeMore: number
  /** 표시할 일정(공지 슬롯을 뺀 나머지 자리만큼) */
  events: PdfEvent[]
  /** 표시하지 못한 일정 수(+N건) */
  moreEvents: number
}

/** 화면/PDF 공통 칸 계획. maxPerCell 은 칸당 총 자리(공지 1칸 포함). */
export function planMonthCells(
  year: number,
  monthIndex0: number,
  events: PdfEvent[],
  notices: CalendarNotice[],
  includeNotices: boolean,
  maxPerCell = 3
): CellPlan[] {
  const cells = monthMatrix(year, monthIndex0)
  const byDay = groupByDay(events, (e) => e.startsAt)
  const noticeMap = includeNotices ? noticesByDayKey(notices, cells.map((c) => c.key)) : new Map<string, CalendarNotice[]>()
  return cells.map((cell) => {
    const dayNotices = sortNoticesForDay(noticeMap.get(cell.key) ?? [])
    const notice = dayNotices[0]
    const noticeSlots = notice ? 1 : 0
    const evAll = (byDay.get(cell.key) ?? []).slice().sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))
    const room = Math.max(0, maxPerCell - noticeSlots)
    return {
      cell,
      notice,
      noticeMore: Math.max(0, dayNotices.length - 1),
      events: evAll.slice(0, room),
      moreEvents: Math.max(0, evAll.length - room)
    }
  })
}

export interface MonthPdfInput {
  year: number
  monthIndex0: number
  title: string
  events: PdfEvent[]
  notices: CalendarNotice[]
  includeNotices: boolean
  /** 출력에 표시할 조직 범위 라벨 (예: '개인 · 김민준', '팀 · 1팀', '전체') */
  scopeLabel: string
}

/** 한글 폰트 바이트 로드(웹: ?url 로 받은 파일). 테스트에선 파일 바이트를 직접 넘긴다. */
export async function loadKoreanFontBytes(url: string): Promise<Uint8Array> {
  const res = await fetch(url)
  if (!res.ok) throw new Error('폰트를 불러오지 못했습니다.')
  return new Uint8Array(await res.arrayBuffer())
}

const NAVY = rgb(14 / 255, 30 / 255, 58 / 255)
const GRID = rgb(0.82, 0.85, 0.89)
const MUTED = rgb(0.6, 0.64, 0.7)
const TEXT = rgb(0.12, 0.16, 0.24)

/** A4 가로 월간 PDF 생성. fontBytes 는 NanumGothic(.ttf). */
export async function buildMonthPdf(input: MonthPdfInput, fontBytes: Uint8Array): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.registerFontkit(fontkit)
  const font: PDFFont = await doc.embedFont(fontBytes, { subset: true })
  const latin = await doc.embedFont(StandardFonts.Helvetica)
  const page = doc.addPage([841.89, 595.28]) // A4 landscape (pt)
  const { width, height } = page.getSize()

  const margin = 28
  const headerH = 46
  const dowH = 20
  const gridTop = height - margin - headerH
  const gridBottom = margin
  const cellW = (width - margin * 2) / 7
  const cellH = (gridTop - dowH - gridBottom) / 6

  // 제목 · 범위
  page.drawText(input.title, { x: margin, y: height - margin - 18, size: 18, font, color: NAVY })
  page.drawText(`${input.year}년 ${input.monthIndex0 + 1}월 · ${input.scopeLabel}`, {
    x: margin,
    y: height - margin - 36,
    size: 10,
    font,
    color: MUTED
  })

  // 요일 헤더 (일→토)
  const DOW = ['일', '월', '화', '수', '목', '금', '토']
  DOW.forEach((n, i) => {
    const color = i === 0 ? rgb(0.86, 0.2, 0.27) : i === 6 ? rgb(0.02, 0.52, 0.78) : TEXT
    page.drawText(n, { x: margin + i * cellW + cellW / 2 - 6, y: gridTop - dowH + 6, size: 10, font, color })
  })

  const plan = planMonthCells(input.year, input.monthIndex0, input.events, input.notices, input.includeNotices)
  plan.forEach((p, idx) => {
    const row = Math.floor(idx / 7)
    const col = idx % 7
    const x = margin + col * cellW
    const yTop = gridTop - dowH - row * cellH
    const y = yTop - cellH
    page.drawRectangle({ x, y, width: cellW, height: cellH, borderColor: GRID, borderWidth: 0.6, color: p.cell.inMonth ? rgb(1, 1, 1) : rgb(0.97, 0.98, 0.99) })

    // 날짜 숫자
    const dateColor = !p.cell.inMonth ? MUTED : col === 0 ? rgb(0.86, 0.2, 0.27) : col === 6 ? rgb(0.02, 0.52, 0.78) : TEXT
    page.drawText(String(p.cell.d), { x: x + 4, y: yTop - 13, size: 10, font: latin, color: dateColor })

    let cy = yTop - 20
    // 공지 슬롯(최상단, 네이비 블록)
    if (p.notice) {
      page.drawRectangle({ x: x + 3, y: cy - 11, width: cellW - 6, height: 11, color: NAVY })
      page.drawText(clip(p.notice.title, 9), { x: x + 6, y: cy - 8, size: 7, font, color: rgb(1, 1, 1) })
      cy -= 13
      if (p.noticeMore > 0) {
        page.drawText(`공지 +${p.noticeMore}`, { x: x + 4, y: cy - 7, size: 6.5, font: latin, color: NAVY })
        cy -= 8
      }
    }
    // 일정 블록
    for (const ev of p.events) {
      page.drawRectangle({ x: x + 3, y: cy - 11, width: cellW - 6, height: 11, color: rgb(0.95, 0.96, 0.97), borderColor: GRID, borderWidth: 0.4 })
      page.drawText(`${kstHm(ev.startsAt)} ${clip(ev.title, 10)}`, { x: x + 5, y: cy - 8, size: 6.8, font, color: TEXT })
      cy -= 13
    }
    if (p.moreEvents > 0) {
      page.drawText(`+${p.moreEvents}건`, { x: x + 4, y: cy - 7, size: 6.8, font: latin, color: rgb(0.31, 0.27, 0.9) })
    }
  })

  // 하단 안내(공지 포함 여부)
  page.drawText(input.includeNotices ? '회사 공지 포함' : '회사 공지 제외', {
    x: width - margin - 90,
    y: 12,
    size: 7,
    font,
    color: MUTED
  })

  return doc.save()
}

/** 글자 수 기준 말줄임(폰트 폭 정밀 계산 대신 보수적으로). */
function clip(s: string, max: number): string {
  const t = (s ?? '').trim()
  return t.length > max ? `${t.slice(0, max)}…` : t
}
