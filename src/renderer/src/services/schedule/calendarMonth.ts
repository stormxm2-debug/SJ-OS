/**
 * 월간 캘린더용 순수 날짜 유틸 — 한국시간(Asia/Seoul) 고정.
 *
 * 왜 KST 고정인가: 일정 시각은 DB에 timestamptz(UTC)로 저장되고, 화면 표시는 기기
 * 로컬 타임존에 의존해 왔다(기기가 KST면 정상). 그러나 PDF 생성(헤드리스/UTC 환경),
 * 서버, 해외/시간대 변경 기기에서는 '하루 밀림'이 생길 수 있다. 이 유틸은 이벤트가
 * 어느 '날짜 칸'에 들어갈지(kstDayKey)와 오늘(todayKey)을 항상 Asia/Seoul 기준으로
 * 계산해 화면·PDF 어디서나 동일한 날짜에 놓이도록 한다.
 *
 * 그리드 자체(월 6주 x 7열, 일요일 시작)는 달력 산술이라 타임존과 무관하며, 로컬 DST
 * 흔들림을 피하려고 UTC 자정 기준으로 날짜 사다리를 만든다.
 */

const KST = 'Asia/Seoul'

// en-CA 로캘은 'YYYY-MM-DD' 형식을 준다.
const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: KST, year: 'numeric', month: '2-digit', day: '2-digit' })
const timeFmt = new Intl.DateTimeFormat('en-GB', { timeZone: KST, hour: '2-digit', minute: '2-digit', hour12: false })

function toDate(d: Date | string): Date {
  return typeof d === 'string' ? new Date(d) : d
}

/** Asia/Seoul 기준 'YYYY-MM-DD' 날짜 키. 잘못된 입력은 빈 문자열. */
export function kstDayKey(d: Date | string): string {
  const date = toDate(d)
  if (Number.isNaN(date.getTime())) return ''
  return dayFmt.format(date)
}

/** Asia/Seoul 기준 'HH:MM'(24시간). 잘못된 입력은 빈 문자열. */
export function kstHm(d: Date | string): string {
  const date = toDate(d)
  if (Number.isNaN(date.getTime())) return ''
  return timeFmt.format(date)
}

/** Asia/Seoul 기준 연/월(0-based)/일. */
export function kstYmd(d: Date | string): { y: number; m: number; d: number } {
  const key = kstDayKey(d)
  if (!key) return { y: NaN, m: NaN, d: NaN }
  const [y, m, day] = key.split('-').map(Number)
  return { y, m: m - 1, d: day }
}

/** 오늘(Asia/Seoul)의 날짜 키. */
export function kstTodayKey(now: Date = new Date()): string {
  return kstDayKey(now)
}

export interface MonthCell {
  /** 'YYYY-MM-DD' */
  key: string
  y: number
  /** 0-based month */
  m: number
  d: number
  /** 해당 칸이 보고 있는 달(monthIndex0)에 속하는가 */
  inMonth: boolean
  /** 0=일 … 6=토 */
  dow: number
}

/**
 * 월 그리드(6주 x 7열 = 42칸), **일요일 시작**. year/monthIndex0 의 1일이 포함된 주의
 * 일요일부터 42칸. UTC 자정 사다리로 생성(로컬 타임존·DST 무관).
 */
export function monthMatrix(year: number, monthIndex0: number): MonthCell[] {
  const first = new Date(Date.UTC(year, monthIndex0, 1))
  const firstDow = first.getUTCDay() // 0=일
  const start = first.getTime() - firstDow * 86400000 // 그 주의 일요일
  const cells: MonthCell[] = []
  for (let i = 0; i < 42; i++) {
    const dt = new Date(start + i * 86400000)
    const y = dt.getUTCFullYear()
    const m = dt.getUTCMonth()
    const d = dt.getUTCDate()
    const key = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    cells.push({ key, y, m, d, inMonth: m === monthIndex0 && y === year, dow: dt.getUTCDay() })
  }
  return cells
}

/** 항목을 KST 날짜 키로 묶는다(캘린더 칸 채우기용). */
export function groupByDay<T>(items: T[], getIso: (t: T) => string | undefined): Map<string, T[]> {
  const map = new Map<string, T[]>()
  for (const it of items) {
    const iso = getIso(it)
    if (!iso) continue
    const key = kstDayKey(iso)
    if (!key) continue
    const arr = map.get(key)
    if (arr) arr.push(it)
    else map.set(key, [it])
  }
  return map
}

/** 이전/다음 달 앵커(1일) 계산. monthIndex0 기준. */
export function shiftMonth(year: number, monthIndex0: number, delta: number): { year: number; monthIndex0: number } {
  const total = year * 12 + monthIndex0 + delta
  return { year: Math.floor(total / 12), monthIndex0: ((total % 12) + 12) % 12 }
}
