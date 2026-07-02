import type { FcMember, FcSnapshot } from './types'

/**
 * Realistic — but entirely fictional — seed data for the SJ Invest field
 * organization. Names, phone numbers and figures are mock only; no real
 * personal or sensitive data is used. Used the first time the app runs (or when
 * persisted state is missing/invalid, or after a demo reset).
 *
 * The org models a 총괄대표 (CEO), a 지점장 (Branch Manager), 팀장 (Team
 * Leaders) and FCs across a few teams, with mixed attendance, activity and
 * monthly production so the FC OS home has a lifelike shape.
 */

const SEED_TIMESTAMP = '2026-07-02T00:00:00.000Z'

/** Achievement rate from premium vs target, 0–100 (0 when no target). */
function rate(premium: number, target: number): number {
  if (target <= 0) return 0
  return Math.round((premium / target) * 100)
}

interface SeedSpec {
  fcId: string
  name: string
  role: FcMember['role']
  team: string
  rank: string
  status: FcMember['status']
  attendanceStatus: FcMember['attendanceStatus']
  todayScheduleCount: number
  todayActivityCount: number
  monthlyPremium: number
  monthlyContractCount: number
  targetPremium: number
  phone: string
  joinedAt: string
}

const SPECS: SeedSpec[] = [
  {
    fcId: 'fc-ceo',
    name: '김성호',
    role: 'CEO',
    team: '본사',
    rank: '총괄대표',
    status: 'active',
    attendanceStatus: 'checked-in',
    todayScheduleCount: 3,
    todayActivityCount: 5,
    monthlyPremium: 0,
    monthlyContractCount: 0,
    targetPremium: 0,
    phone: '010-1234-0001',
    joinedAt: '2019-03-02T00:00:00.000Z'
  },
  {
    fcId: 'fc-bm-gn',
    name: '이재훈',
    role: 'Branch Manager',
    team: '강남지점',
    rank: '지점장',
    status: 'active',
    attendanceStatus: 'checked-in',
    todayScheduleCount: 2,
    todayActivityCount: 4,
    monthlyPremium: 8_400_000,
    monthlyContractCount: 6,
    targetPremium: 10_000_000,
    phone: '010-1234-0002',
    joinedAt: '2020-01-06T00:00:00.000Z'
  },
  {
    fcId: 'fc-tl-gn1',
    name: '박민서',
    role: 'Team Leader',
    team: '강남 1팀',
    rank: '팀장',
    status: 'active',
    attendanceStatus: 'checked-in',
    todayScheduleCount: 4,
    todayActivityCount: 6,
    monthlyPremium: 12_600_000,
    monthlyContractCount: 9,
    targetPremium: 12_000_000,
    phone: '010-1234-0003',
    joinedAt: '2020-07-01T00:00:00.000Z'
  },
  {
    fcId: 'fc-tl-gn2',
    name: '정우진',
    role: 'Team Leader',
    team: '강남 2팀',
    rank: '팀장',
    status: 'active',
    attendanceStatus: 'late',
    todayScheduleCount: 3,
    todayActivityCount: 2,
    monthlyPremium: 9_800_000,
    monthlyContractCount: 7,
    targetPremium: 12_000_000,
    phone: '010-1234-0004',
    joinedAt: '2021-02-15T00:00:00.000Z'
  },
  {
    fcId: 'fc-gn1-01',
    name: '최지아',
    role: 'FC',
    team: '강남 1팀',
    rank: '수석플래너',
    status: 'active',
    attendanceStatus: 'checked-in',
    todayScheduleCount: 5,
    todayActivityCount: 8,
    monthlyPremium: 7_200_000,
    monthlyContractCount: 5,
    targetPremium: 6_000_000,
    phone: '010-1234-0005',
    joinedAt: '2021-09-01T00:00:00.000Z'
  },
  {
    fcId: 'fc-gn1-02',
    name: '한도윤',
    role: 'FC',
    team: '강남 1팀',
    rank: '플래너',
    status: 'active',
    attendanceStatus: 'outside',
    todayScheduleCount: 3,
    todayActivityCount: 4,
    monthlyPremium: 4_100_000,
    monthlyContractCount: 3,
    targetPremium: 5_000_000,
    phone: '010-1234-0006',
    joinedAt: '2022-04-11T00:00:00.000Z'
  },
  {
    fcId: 'fc-gn1-03',
    name: '오서현',
    role: 'FC',
    team: '강남 1팀',
    rank: '플래너',
    status: 'active',
    attendanceStatus: 'checked-in',
    todayScheduleCount: 2,
    todayActivityCount: 0,
    monthlyPremium: 2_600_000,
    monthlyContractCount: 2,
    targetPremium: 5_000_000,
    phone: '010-1234-0007',
    joinedAt: '2023-01-09T00:00:00.000Z'
  },
  {
    fcId: 'fc-gn2-01',
    name: '임하준',
    role: 'FC',
    team: '강남 2팀',
    rank: '수석플래너',
    status: 'active',
    attendanceStatus: 'checked-in',
    todayScheduleCount: 4,
    todayActivityCount: 5,
    monthlyPremium: 6_800_000,
    monthlyContractCount: 5,
    targetPremium: 6_000_000,
    phone: '010-1234-0008',
    joinedAt: '2021-11-02T00:00:00.000Z'
  },
  {
    fcId: 'fc-gn2-02',
    name: '강예은',
    role: 'FC',
    team: '강남 2팀',
    rank: '플래너',
    status: 'active',
    attendanceStatus: 'absent',
    todayScheduleCount: 1,
    todayActivityCount: 0,
    monthlyPremium: 1_500_000,
    monthlyContractCount: 1,
    targetPremium: 5_000_000,
    phone: '010-1234-0009',
    joinedAt: '2023-06-19T00:00:00.000Z'
  },
  {
    fcId: 'fc-gn2-03',
    name: '윤시우',
    role: 'FC',
    team: '강남 2팀',
    rank: '플래너',
    status: 'training',
    attendanceStatus: 'checked-in',
    todayScheduleCount: 1,
    todayActivityCount: 3,
    monthlyPremium: 900_000,
    monthlyContractCount: 1,
    targetPremium: 3_000_000,
    phone: '010-1234-0010',
    joinedAt: '2026-05-04T00:00:00.000Z'
  },
  {
    fcId: 'fc-bd-tl',
    name: '서지호',
    role: 'Team Leader',
    team: '분당 1팀',
    rank: '팀장',
    status: 'active',
    attendanceStatus: 'checked-out',
    todayScheduleCount: 3,
    todayActivityCount: 4,
    monthlyPremium: 10_200_000,
    monthlyContractCount: 8,
    targetPremium: 12_000_000,
    phone: '010-1234-0011',
    joinedAt: '2020-10-05T00:00:00.000Z'
  },
  {
    fcId: 'fc-bd-01',
    name: '노아윤',
    role: 'FC',
    team: '분당 1팀',
    rank: '플래너',
    status: 'onboarding',
    attendanceStatus: 'not-checked-in',
    todayScheduleCount: 0,
    todayActivityCount: 0,
    monthlyPremium: 0,
    monthlyContractCount: 0,
    targetPremium: 3_000_000,
    phone: '010-1234-0012',
    joinedAt: '2026-06-23T00:00:00.000Z'
  }
]

export const fcSeed: FcSnapshot = {
  members: SPECS.map<FcMember>((spec) => ({
    ...spec,
    achievementRate: rate(spec.monthlyPremium, spec.targetPremium),
    updatedAt: SEED_TIMESTAMP
  })),
  eventLog: []
}
