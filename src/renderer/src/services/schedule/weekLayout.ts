/**
 * 주간 시간표 배치 계산 (순수 함수, 한국시간 기준).
 *
 * - 세로: 시작·종료 시각에 비례한 top/height (분 단위 → px).
 * - 겹침: 같은 날 겹치는 일정은 '레인(열)'을 나눠 나란히 배치한다(지시서 2절).
 * - 종료시각이 없거나 시작보다 이르면 60분 블록으로 간주한다.
 * - 보기 범위(startHour~endHour) 밖은 잘라서 표시한다.
 */

import { kstHm } from './calendarMonth'

export interface TimedEvent {
  id: string
  startsAt: string
  endsAt?: string | null
  title: string
  /** 일정 유형(색상 결정용) */
  type?: string
}

export interface PlacedBlock {
  id: string
  title: string
  type?: string
  /** 'HH:MM' (KST) */
  startHm: string
  endHm: string
  /** 그리드 기준 상단 px (보기 시작 시각 기준) */
  top: number
  /** px 높이 (최소 높이 보장) */
  height: number
  /** 0-based 레인 인덱스 */
  lane: number
  /** 같은 겹침 묶음의 총 레인 수 — 폭 = 1/lanes */
  lanes: number
}

export interface LayoutOptions {
  startHour?: number // 기본 7
  endHour?: number // 기본 22
  pxPerMinute?: number // 기본 1.1
  minHeight?: number // 기본 22px (짧은 일정도 제목이 보이도록)
}

/** KST 기준 자정부터의 분. 잘못된 입력은 NaN. */
export function kstMinutes(iso: string): number {
  const hm = kstHm(iso)
  if (!hm) return NaN
  const [h, m] = hm.split(':').map(Number)
  return h * 60 + m
}

function resolveRange(startMin: number, endIso: string | null | undefined): { s: number; e: number } {
  const s = startMin
  let e = endIso ? kstMinutes(endIso) : NaN
  // 종료가 없거나 시작보다 이르면 60분 블록. 자정을 넘기면 같은 날 끝(24:00)으로 자른다.
  if (Number.isNaN(e) || e <= s) e = s + 60
  return { s, e: Math.min(e, 24 * 60) }
}

/**
 * 하루치 일정을 시간표 블록으로 배치한다. events 는 이미 같은 날짜로 걸러져 있어야 한다.
 */
export function layoutDay(events: TimedEvent[], opts: LayoutOptions = {}): PlacedBlock[] {
  const startHour = opts.startHour ?? 7
  const endHour = opts.endHour ?? 22
  const pxPerMin = opts.pxPerMinute ?? 1.1
  const minHeight = opts.minHeight ?? 22
  const viewStart = startHour * 60
  const viewEnd = endHour * 60

  const items = events
    .map((ev) => {
      const s0 = kstMinutes(ev.startsAt)
      if (Number.isNaN(s0)) return null
      const { s, e } = resolveRange(s0, ev.endsAt)
      // 보기 범위 밖 제외/잘라내기
      if (e <= viewStart || s >= viewEnd) return null
      const cs = Math.max(s, viewStart)
      const ce = Math.min(e, viewEnd)
      return { ev, cs, ce }
    })
    .filter((x): x is { ev: TimedEvent; cs: number; ce: number } => x !== null)
    .sort((a, b) => a.cs - b.cs || b.ce - a.ce)

  // 겹침 묶음(클러스터) 단위로 레인 할당
  const out: PlacedBlock[] = []
  let i = 0
  while (i < items.length) {
    // 현재 묶음의 끝 시각을 넓혀가며 묶는다
    let clusterEnd = items[i].ce
    let j = i + 1
    while (j < items.length && items[j].cs < clusterEnd) {
      clusterEnd = Math.max(clusterEnd, items[j].ce)
      j++
    }
    const cluster = items.slice(i, j)
    // 그리디 레인 배정
    const laneEnds: number[] = []
    const assigned: { idx: number; lane: number }[] = []
    cluster.forEach((it, idx) => {
      let lane = laneEnds.findIndex((end) => end <= it.cs)
      if (lane === -1) {
        lane = laneEnds.length
        laneEnds.push(it.ce)
      } else {
        laneEnds[lane] = it.ce
      }
      assigned.push({ idx, lane })
    })
    const lanes = laneEnds.length
    for (const { idx, lane } of assigned) {
      const it = cluster[idx]
      out.push({
        id: it.ev.id,
        title: it.ev.title,
        type: it.ev.type,
        startHm: kstHm(it.ev.startsAt),
        endHm: minutesToHm(it.ce),
        top: Math.round((it.cs - viewStart) * pxPerMin),
        height: Math.max(minHeight, Math.round((it.ce - it.cs) * pxPerMin)),
        lane,
        lanes
      })
    }
    i = j
  }
  return out
}

/** 분 → 'HH:MM' (24:00 은 '24:00'으로 표기). */
export function minutesToHm(total: number): string {
  const h = Math.floor(total / 60)
  const m = total % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** 보기 범위의 전체 높이(px). 그리드 컨테이너 높이 계산용. */
export function gridHeight(opts: LayoutOptions = {}): number {
  const startHour = opts.startHour ?? 7
  const endHour = opts.endHour ?? 22
  const pxPerMin = opts.pxPerMinute ?? 1.1
  return Math.round((endHour - startHour) * 60 * pxPerMin)
}
