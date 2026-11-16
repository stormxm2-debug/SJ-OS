/**
 * 운영 데스크 — 역할별 현재 부하 계산 (순수 함수).
 * 콘텐츠 상태만 읽는다. 새 데이터·DB 변경 없음.
 * 역할 순서: 리서처 → 훅 라이터 → 대본 라이터 → 디자이너 → 분석가 → 매니저 → 퍼블리셔
 */
import type { ContentItem } from './contentModel'

export interface DeskStage {
  key: string
  label: string
  /** 이 역할이 지금 맡고 있는 콘텐츠 수 */
  count: number
  /** 할 일이 있으면 true (깜빡임) */
  active: boolean
  /** 한 줄 설명 */
  hint: string
}

export function buildDeskStages(items: ContentItem[], now: Date = new Date()): DeskStage[] {
  const idea = items.filter((c) => c.status === 'idea')
  const drafting = items.filter((c) => c.status === 'drafting')
  const scheduled = items.filter((c) => c.status === 'scheduled')
  const published = items.filter((c) => c.status === 'published')
  const todayKey = now.toISOString().slice(0, 10)
  const dueToday = scheduled.filter((c) => c.scheduledAt && c.scheduledAt.slice(0, 10) === todayKey)
  const undated = scheduled.filter((c) => !c.scheduledAt)

  const stage = (key: string, label: string, count: number, hint: string): DeskStage => ({ key, label, count, active: count > 0, hint })
  return [
    stage('researcher', '리서처', idea.length, idea.length ? `아이디어 ${idea.length}건 조사 중` : '새 주제를 찾는 중'),
    stage('hook', '훅 라이터', idea.length, idea.length ? '첫 문장 후보 작성' : '대기'),
    stage('script', '대본 라이터', drafting.length, drafting.length ? `대본 ${drafting.length}건 작성` : '대기'),
    stage('designer', '디자이너', drafting.length, drafting.length ? `썸네일·캡션 이미지 ${drafting.length}건` : '대기'),
    stage('analyst', '분석가', published.length, published.length ? `게시물 ${published.length}건 성과 확인` : '성과 데이터 대기'),
    stage('manager', '매니저', scheduled.length, undated.length ? `날짜 미정 ${undated.length}건 배정 필요` : scheduled.length ? `예약 ${scheduled.length}건 관리` : '일정 대기'),
    stage('publisher', '퍼블리셔', dueToday.length || scheduled.length, dueToday.length ? `오늘 게시 ${dueToday.length}건` : scheduled.length ? '예약분 게시 준비' : '게시 대기')
  ]
}

/** 파이프라인 흐름(왼쪽→오른쪽) 단계별 개수. */
export function pipelineCounts(items: ContentItem[]): { idea: number; drafting: number; scheduled: number; published: number } {
  return {
    idea: items.filter((c) => c.status === 'idea').length,
    drafting: items.filter((c) => c.status === 'drafting').length,
    scheduled: items.filter((c) => c.status === 'scheduled').length,
    published: items.filter((c) => c.status === 'published').length
  }
}
