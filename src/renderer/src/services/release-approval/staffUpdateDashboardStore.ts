import { useEffect, useState } from 'react'
import type { StaffInstallationGuide } from './installGuideStore'

/**
 * Staff update status dashboard (renderer, localStorage). Aggregates per-staff
 * install status into rollout counts + completion rate, with a failed-staff focus.
 * Tracking + reporting ONLY — no remote install, no sending/upload, no shell.
 */

export type DashboardStaffStatus =
  | 'not-started'
  | 'guide-sent'
  | 'installing'
  | 'installed'
  | 'failed'
  | 'skipped'

export const DASH_STATUS_LABEL: Record<DashboardStaffStatus, string> = {
  'not-started': '시작 전',
  'guide-sent': '안내 발송',
  installing: '설치 중',
  installed: '설치 완료',
  failed: '실패',
  skipped: '제외'
}

export interface StaffUpdateDashboardRecord {
  id: string
  staffName: string
  staffRole?: string
  teamName?: string
  targetVersion: string
  currentVersion?: string
  status: DashboardStaffStatus
  lastUpdatedAt: string
  issueSummary?: string
  notes?: string
}

export type DashboardStatus = 'draft' | 'active' | 'mostly-complete' | 'completed' | 'needs-attention' | 'blocked'

export interface DashboardSummary {
  version: string
  totalStaff: number
  guideSentCount: number
  installingCount: number
  installedCount: number
  failedCount: number
  skippedCount: number
  pendingCount: number
  eligible: number
  completionRate: number
  status: DashboardStatus
  failedStaffNames: string[]
  pendingStaffNames: string[]
  summaryText: string
}

/** Safe next actions for a failed install (no risky system commands). */
export const FAILED_NEXT_ACTIONS = [
  '화면 캡처 요청',
  '오류 문구 확인',
  '기존 SJ OS 종료 여부 확인',
  '설치파일 버전 확인',
  '관리자에게 전달'
]

/** Compute rollout counts + completion rate + status + summary text. */
export function computeDashboard(records: StaffUpdateDashboardRecord[]): DashboardSummary {
  const version = records.find((r) => r.targetVersion)?.targetVersion ?? 'N/A'
  const by = (s: DashboardStaffStatus): StaffUpdateDashboardRecord[] => records.filter((r) => r.status === s)
  const installed = by('installed')
  const installing = by('installing')
  const failed = by('failed')
  const skipped = by('skipped')
  const guideSent = by('guide-sent')
  const pending = by('not-started')
  const total = records.length
  const eligible = total - skipped.length // all except skipped
  const completionRate = eligible > 0 ? Math.round((installed.length / eligible) * 100) : 0

  let status: DashboardStatus
  if (total === 0) status = 'blocked'
  else if (failed.length > 0) status = 'needs-attention'
  else if (eligible > 0 && installed.length === eligible) status = 'completed'
  else if (completionRate >= 80) status = 'mostly-complete'
  else status = 'active'

  const summaryText =
    total === 0
      ? '아직 등록된 직원 업데이트 기록이 없습니다.'
      : `SJ OS v${version} 업데이트 대상 ${total}명 중 ${installed.length}명 설치 완료, ${installing.length}명 설치 중, ${failed.length}명 실패, ${pending.length + guideSent.length}명 대기입니다. 완료율은 ${completionRate}%입니다.`

  return {
    version,
    totalStaff: total,
    guideSentCount: guideSent.length,
    installingCount: installing.length,
    installedCount: installed.length,
    failedCount: failed.length,
    skippedCount: skipped.length,
    pendingCount: pending.length,
    eligible,
    completionRate,
    status,
    failedStaffNames: failed.map((r) => r.staffName),
    pendingStaffNames: [...pending, ...guideSent].map((r) => r.staffName),
    summaryText
  }
}

/** Plain-text status report for the clipboard. */
export function formatDashboardReport(records: StaffUpdateDashboardRecord[]): string {
  const s = computeDashboard(records)
  const failed = records.filter((r) => r.status === 'failed')
  const installed = records.filter((r) => r.status === 'installed')
  return [
    '[SJ OS 직원 업데이트 현황]',
    '',
    `버전: ${s.version}`,
    `전체 대상: ${s.totalStaff}`,
    `설치 완료: ${s.installedCount}`,
    `설치 중: ${s.installingCount}`,
    `실패: ${s.failedCount}`,
    `대기: ${s.pendingCount + s.guideSentCount}`,
    `완료율: ${s.completionRate}%`,
    '',
    '조치 필요:',
    ...(failed.length
      ? failed.map((r) => `- ${r.staffName} / ${r.issueSummary ?? '원인 미상'} / 다음 조치: 화면 캡처·오류 문구 확인 후 관리자 전달`)
      : ['- (없음)']),
    '',
    '설치 완료 직원:',
    ...(installed.length ? installed.map((r) => `- ${r.staffName}${r.teamName ? ` (${r.teamName})` : ''}`) : ['- (없음)'])
  ].join('\n')
}

// --- store ------------------------------------------------------------------

const KEY = 'sj.dashboard.records'
let records: StaffUpdateDashboardRecord[] = load()
const listeners = new Set<() => void>()

function load(): StaffUpdateDashboardRecord[] {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as StaffUpdateDashboardRecord[]) : []
  } catch {
    return []
  }
}
function persist(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(records.slice(0, 500)))
  } catch {
    /* best effort */
  }
  listeners.forEach((l) => l())
}
function nowIso(): string {
  return new Date().toISOString()
}
function rid(): string {
  return `dr-${records.length}-${Math.floor(performance.now())}`
}

export function listDashboardRecords(): StaffUpdateDashboardRecord[] {
  return records
}
export function addDashboardRecord(input: {
  staffName: string
  staffRole?: string
  teamName?: string
  targetVersion: string
  currentVersion?: string
}): void {
  if (!input.staffName.trim()) return
  records = [
    ...records,
    {
      id: rid(),
      staffName: input.staffName.trim(),
      staffRole: input.staffRole?.trim() || undefined,
      teamName: input.teamName?.trim() || undefined,
      targetVersion: input.targetVersion,
      currentVersion: input.currentVersion?.trim() || undefined,
      status: 'not-started',
      lastUpdatedAt: nowIso()
    }
  ]
  persist()
}
function patch(id: string, fn: (r: StaffUpdateDashboardRecord) => StaffUpdateDashboardRecord): void {
  records = records.map((r) => (r.id === id ? { ...fn(r), lastUpdatedAt: nowIso() } : r))
  persist()
}
export function setDashboardStatus(id: string, status: DashboardStaffStatus): void {
  patch(id, (r) => ({ ...r, status }))
}
export function setDashboardIssue(id: string, issueSummary: string): void {
  patch(id, (r) => ({ ...r, issueSummary: issueSummary || undefined }))
}
export function removeDashboardRecord(id: string): void {
  records = records.filter((r) => r.id !== id)
  persist()
}

/** Mirror a guide's staff records into the dashboard (dedupe by name+version). */
export function seedFromGuide(guide: StaffInstallationGuide): number {
  let added = 0
  const next = [...records]
  for (const r of guide.targetStaffRecords) {
    const dup = next.some((x) => x.staffName === r.staffName && x.targetVersion === guide.version)
    if (dup) continue
    next.push({
      id: `dr-seed-${r.id}`,
      staffName: r.staffName,
      staffRole: r.staffRole,
      targetVersion: guide.version,
      status: (r.status as DashboardStaffStatus) ?? 'not-started',
      lastUpdatedAt: nowIso()
    })
    added++
  }
  records = next
  persist()
  return added
}

export function useDashboardRecords(): StaffUpdateDashboardRecord[] {
  const [state, setState] = useState<StaffUpdateDashboardRecord[]>(records)
  useEffect(() => {
    const l = (): void => setState([...records])
    listeners.add(l)
    return () => {
      listeners.delete(l)
    }
  }, [])
  return state
}
