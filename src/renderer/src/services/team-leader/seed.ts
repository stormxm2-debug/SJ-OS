import type { Blocker, CoachingNote, LeaderNextAction, TeamLeaderSnapshot } from './types'

/**
 * Realistic — but entirely fictional — seed data for the SJ Invest team-leader
 * cockpit. Teams, leaders and FC names reuse the FC OS roster; all data is mock
 * only, with no real personal or sensitive information. Seeds a handful of
 * coaching notes, blockers and next actions across the 강남 1팀 / 강남 2팀 /
 * 분당 1팀 teams so the workspace reads coherently against the derived FC OS
 * team views.
 */

const coachingNotes: CoachingNote[] = [
  {
    id: 'tlc-4001',
    team: '강남 1팀',
    fcId: 'fc-gn1-03',
    fcName: '오서현',
    author: '박민서',
    text: 'AP 콜 목표 대비 부족. 오전 콜 루틴 재정비 및 스크립트 코칭 필요.',
    createdAt: '2026-07-01T00:00:00.000Z'
  },
  {
    id: 'tlc-4002',
    team: '강남 1팀',
    fcId: null,
    fcName: null,
    author: '박민서',
    text: '팀 전체 클로징 전환율 개선을 위해 2차 미팅 롤플레잉 주 2회 진행.',
    createdAt: '2026-06-30T01:00:00.000Z'
  },
  {
    id: 'tlc-4003',
    team: '강남 2팀',
    fcId: 'fc-gn2-03',
    fcName: '윤시우',
    author: '정우진',
    text: '신입 온보딩 4주차. 증권 분석 실습 동행 필요.',
    createdAt: '2026-07-01T02:00:00.000Z'
  }
]

const blockers: Blocker[] = [
  {
    id: 'tlb-4101',
    team: '강남 1팀',
    fcId: 'fc-gn1-03',
    fcName: '오서현',
    title: 'DB 소진',
    detail: '신규 상담 DB 부족으로 오전 AP 콜 진행 어려움.',
    severity: 'high',
    status: 'open',
    createdAt: '2026-07-01T00:30:00.000Z',
    updatedAt: '2026-07-01T00:30:00.000Z'
  },
  {
    id: 'tlb-4102',
    team: '강남 2팀',
    fcId: null,
    fcName: null,
    title: '상담실 부족',
    detail: '오후 시간대 대면 상담실 예약 경쟁. 추가 공간 협의 필요.',
    severity: 'medium',
    status: 'in-progress',
    createdAt: '2026-06-29T05:00:00.000Z',
    updatedAt: '2026-07-01T01:00:00.000Z'
  },
  {
    id: 'tlb-4103',
    team: '분당 1팀',
    fcId: null,
    fcName: null,
    title: '설계 시스템 지연',
    detail: '증권 분석 설계 툴 응답 지연. IT 지원 요청 접수됨.',
    severity: 'low',
    status: 'resolved',
    createdAt: '2026-06-25T02:00:00.000Z',
    updatedAt: '2026-06-28T02:00:00.000Z'
  }
]

const nextActions: LeaderNextAction[] = [
  {
    id: 'tla-4201',
    team: '강남 1팀',
    fcId: 'fc-gn1-01',
    fcName: '최지아',
    label: '윤서연 클로징 동행 지원',
    due: '2026-07-02T02:00:00.000Z',
    done: false,
    createdAt: '2026-07-01T00:00:00.000Z'
  },
  {
    id: 'tla-4202',
    team: '강남 1팀',
    fcId: null,
    fcName: null,
    label: '주간 팀 미팅 코칭 안건 정리',
    due: '2026-07-03T01:00:00.000Z',
    done: false,
    createdAt: '2026-07-01T00:10:00.000Z'
  },
  {
    id: 'tla-4203',
    team: '강남 2팀',
    fcId: 'fc-gn2-03',
    fcName: '윤시우',
    label: '증권 분석 실습 동행',
    due: '2026-07-02T06:00:00.000Z',
    done: false,
    createdAt: '2026-07-01T02:10:00.000Z'
  },
  {
    id: 'tla-4204',
    team: '강남 2팀',
    fcId: null,
    fcName: null,
    label: '상담실 추가 배정 지점장 협의',
    due: null,
    done: true,
    createdAt: '2026-06-30T03:00:00.000Z'
  }
]

export const teamLeaderSeed: TeamLeaderSnapshot = {
  selectedTeam: '강남 1팀',
  coachingNotes,
  blockers,
  nextActions,
  eventLog: []
}
