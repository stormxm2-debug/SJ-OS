import type { CustomerRecord } from '@shared/commercial/models'
import { parseRrn } from './customerValidation'

/**
 * 고객 생일 서비스 — 이미 저장된 주민번호(rrn)/생년월일(birthDate)에서 생일을
 * 계산한다. DB 조회·스키마 변경 없음: 고객 목록(RLS 적용)을 받아 클라이언트에서만
 * 계산하는 순수 함수 모음. 주민번호 원문은 절대 로깅/전달하지 않는다.
 */

export interface CustomerBirthday {
  customer: CustomerRecord
  /** 생일 월(1~12). */
  month: number
  /** 생일 일(1~31). */
  day: number
  /** 태어난 해 — 알 수 없으면 undefined (나이 표시 생략). */
  birthYear?: number
  /** 다음 생일까지 남은 일수 (오늘 생일 = 0). */
  dDay: number
  /** 다음 생일에 되는 만 나이 — birthYear 없으면 undefined. */
  turningAge?: number
}

/** rrn 우선, 없으면 birthDate 문자열에서 생일(월·일·연도)을 뽑는다. 둘 다 없으면 null. */
export function getBirthInfo(c: CustomerRecord): { month: number; day: number; birthYear?: number } | null {
  const rrnInfo = parseRrn(c.rrn)
  const source = rrnInfo?.birthDate ?? c.birthDate
  if (!source) return null
  const m = source.match(/(\d{4})[-./년\s]*(\d{1,2})[-./월\s]*(\d{1,2})/)
  if (!m) return null
  const birthYear = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  return { month, day, birthYear: birthYear >= 1800 && birthYear <= 2100 ? birthYear : undefined }
}

function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0
}

/** 다음 생일까지 남은 일수 (오늘이면 0). 2/29 생일은 평년엔 2/28로 챙긴다. */
export function daysUntilBirthday(month: number, day: number, from: Date = new Date()): number {
  const today = new Date(from.getFullYear(), from.getMonth(), from.getDate())
  for (const year of [today.getFullYear(), today.getFullYear() + 1]) {
    const d = month === 2 && day === 29 && !isLeapYear(year) ? 28 : day
    const target = new Date(year, month - 1, d)
    const diff = Math.round((target.getTime() - today.getTime()) / 86400000)
    if (diff >= 0) return diff
  }
  return 365 // 도달 불가 — 방어값
}

/** 고객 목록 → 생일 정보가 있는 고객만 CustomerBirthday로 변환. */
export function toBirthdays(customers: CustomerRecord[], from: Date = new Date()): CustomerBirthday[] {
  const out: CustomerBirthday[] = []
  for (const c of customers) {
    const info = getBirthInfo(c)
    if (!info) continue
    const dDay = daysUntilBirthday(info.month, info.day, from)
    const nextYear = new Date(from.getFullYear(), from.getMonth(), from.getDate() + dDay).getFullYear()
    out.push({
      customer: c,
      month: info.month,
      day: info.day,
      birthYear: info.birthYear,
      dDay,
      turningAge: info.birthYear ? nextYear - info.birthYear : undefined
    })
  }
  return out
}

/** withinDays일 이내(오늘 포함) 생일 — 임박순 정렬. */
export function upcomingBirthdays(birthdays: CustomerBirthday[], withinDays: number): CustomerBirthday[] {
  return birthdays.filter((b) => b.dDay <= withinDays).sort((a, b) => a.dDay - b.dDay || a.customer.name.localeCompare(b.customer.name, 'ko'))
}

/** 해당 월(1~12)이 생일인 고객 — 일자순 정렬. */
export function birthdaysInMonth(birthdays: CustomerBirthday[], month: number): CustomerBirthday[] {
  return birthdays.filter((b) => b.month === month).sort((a, b) => a.day - b.day || a.customer.name.localeCompare(b.customer.name, 'ko'))
}

/** 고객에게 보내도 되는 정중한 생일 축하 문안 (카톡 공유/복사용). */
export function buildBirthdayMessage(customerName: string, staffName?: string): string {
  return [
    `${customerName}님, 생일 진심으로 축하드립니다! 🎂`,
    '',
    `안녕하세요, SJ INVEST${staffName ? ` ${staffName}` : ''}입니다.`,
    '소중한 하루, 좋은 사람들과 행복하게 보내시길 바랍니다.',
    '늘 건강과 행운이 함께하시길 기원합니다.',
    '',
    '보험 관련해 궁금한 점이 있으시면 언제든 편하게 연락 주세요. 감사합니다.'
  ].join('\n')
}
