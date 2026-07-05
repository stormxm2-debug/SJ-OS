import { useEffect, useState } from 'react'
import type { StaffDistributionPackage } from '@shared/distributionPackage'

/**
 * Staff installation / update guide center (renderer, localStorage). Generates
 * install/update guide text from a registered distribution package and tracks each
 * staff member's install status. Guide + tracking ONLY — no remote install, no
 * sending/upload, no shell, no running installer files.
 */

export type InstallGuideStatus =
  | 'draft'
  | 'ready'
  | 'copied'
  | 'distributed-manually'
  | 'completed'
  | 'blocked'
  | 'failed'

export type StaffInstallStatus =
  | 'not-started'
  | 'guide-sent'
  | 'installing'
  | 'installed'
  | 'failed'
  | 'skipped'

export const STAFF_INSTALL_STATUS_LABEL: Record<StaffInstallStatus, string> = {
  'not-started': '시작 전',
  'guide-sent': '안내 발송',
  installing: '설치 중',
  installed: '설치 완료',
  failed: '실패',
  skipped: '제외'
}

export interface StaffInstallStatusRecord {
  id: string
  staffName: string
  staffRole?: string
  version: string
  status: StaffInstallStatus
  checkedBy?: string
  updatedAt: string
  notes?: string
}

export interface StaffInstallationGuide {
  id: string
  packageId?: string
  version: string
  title: string
  installerFileName: string
  installerRelativePath?: string
  sha256?: string
  releaseNote: string
  installSteps: string[]
  updateSteps: string[]
  preInstallChecklist: string[]
  postInstallChecklist: string[]
  troubleshootingItems: string[]
  targetStaffRecords: StaffInstallStatusRecord[]
  status: InstallGuideStatus
  createdAt: string
  updatedAt: string
  copiedAt?: string
  errorMessage?: string
}

const INSTALL_STEPS = [
  '기존 SJ OS를 종료합니다.',
  '전달받은 설치파일을 실행합니다.',
  'Windows 보안 경고가 뜨면 파일명을 확인한 뒤 계속 진행합니다.',
  '설치 완료 후 SJ OS를 실행합니다.',
  '로그인/메인 화면/자비스 열기·닫기 동작을 확인합니다.',
  '이상이 있으면 담당자에게 화면 캡처와 함께 보고합니다.'
]
const UPDATE_STEPS = [
  '현재 버전을 확인합니다.',
  '기존 앱을 종료합니다.',
  '새 설치파일을 실행합니다.',
  '설치 후 버전 표시를 확인합니다.',
  '주요 메뉴 클릭이 정상인지 확인합니다.'
]
const PRE_INSTALL = [
  '현재 사용 중인 SJ OS 버전을 확인합니다.',
  '진행 중인 작업을 저장하고 앱을 종료합니다.',
  '전달받은 설치파일명이 안내와 일치하는지 확인합니다.',
  '(선택) SHA-256 체크섬이 안내와 일치하는지 확인합니다.'
]
const POST_INSTALL = [
  '앱이 정상적으로 실행되는지 확인합니다.',
  '버전 표시가 새 버전인지 확인합니다.',
  '로그인/메인 화면이 정상인지 확인합니다.',
  '자비스 열기/닫기가 정상인지 확인합니다.',
  '사이드바 메뉴 이동이 정상인지 확인합니다.'
]
// Safe troubleshooting — no system-file edits, no antivirus-disable, no risky commands.
const TROUBLESHOOTING = [
  '설치파일 실행이 안 될 때: 파일명이 안내와 같은지 확인하고, 파일이 손상되지 않았는지 담당자에게 재전달을 요청하세요.',
  'Windows 보안 경고가 뜰 때: 파일명을 확인한 뒤 “추가 정보 → 실행”을 선택하세요. 보안 경고가 반복되면 관리자에게 문의하세요.',
  '앱 실행 후 흰 화면일 때: 앱을 완전히 종료 후 다시 실행하세요. 반복되면 화면 캡처와 함께 담당자에게 보고하세요.',
  '자비스가 안 열릴 때: Ctrl+Space로 다시 시도하거나 앱을 재시작하세요. 반복되면 담당자에게 보고하세요.',
  '클릭이 안 될 때: 앱을 재시작하고 다시 확인하세요. 반복되면 담당자에게 보고하세요.',
  '버전이 이전 버전으로 보일 때: 기존 앱이 완전히 종료됐는지 확인 후 다시 설치하세요. 반복되면 담당자에게 보고하세요.'
]

/** Build an install/update guide from a registered distribution package. */
export function generateInstallGuide(pkg: StaffDistributionPackage): StaffInstallationGuide {
  const existing = items.find((g) => g.packageId === pkg.id)
  const now = new Date().toISOString()
  return {
    id: existing?.id ?? `guide-${pkg.id}`,
    packageId: pkg.id,
    version: pkg.version,
    title: `SJ OS ${pkg.version} 설치/업데이트 안내`,
    installerFileName: pkg.packageFileName,
    installerRelativePath: pkg.packageRelativePath,
    sha256: pkg.sha256,
    releaseNote: pkg.releaseNote,
    installSteps: INSTALL_STEPS,
    updateSteps: UPDATE_STEPS,
    preInstallChecklist: PRE_INSTALL,
    postInstallChecklist: POST_INSTALL,
    troubleshootingItems: TROUBLESHOOTING,
    targetStaffRecords: existing?.targetStaffRecords ?? [],
    status: 'ready',
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  }
}

/** Plain-text guide for the clipboard. */
export function formatGuideText(g: StaffInstallationGuide): string {
  const num = (arr: string[]): string[] => arr.map((s, i) => `${i + 1}. ${s}`)
  return [
    '[SJ OS 설치/업데이트 안내]',
    '',
    `버전: ${g.version}`,
    `설치파일: ${g.installerFileName}`,
    `SHA-256: ${g.sha256 ?? '(없음)'}`,
    `릴리즈 노트: ${g.releaseNote}`,
    '',
    '설치 전 확인:',
    ...num(g.preInstallChecklist),
    '',
    '설치 순서:',
    ...num(g.installSteps),
    '',
    '설치 후 확인:',
    ...num(g.postInstallChecklist),
    '',
    '문제 발생 시:',
    '- 화면 캡처',
    '- 오류 문구',
    '- 사용 중인 PC 정보',
    '- 담당자에게 전달',
    '',
    '문제 해결 가이드:',
    ...g.troubleshootingItems.map((t) => `- ${t}`)
  ].join('\n')
}

// --- store ------------------------------------------------------------------

const KEY = 'sj.install.guides'
let items: StaffInstallationGuide[] = load()
const listeners = new Set<() => void>()

function load(): StaffInstallationGuide[] {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as StaffInstallationGuide[]) : []
  } catch {
    return []
  }
}
function persist(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(items.slice(0, 100)))
  } catch {
    /* best effort */
  }
  listeners.forEach((l) => l())
}
function nowIso(): string {
  return new Date().toISOString()
}
function rid(prefix: string): string {
  return `${prefix}-${items.length}-${Math.floor(performance.now())}`
}

export function upsertGuide(guide: StaffInstallationGuide): void {
  items = [guide, ...items.filter((g) => g.id !== guide.id)]
  persist()
}
export function listGuides(): StaffInstallationGuide[] {
  return items
}
function patch(id: string, fn: (g: StaffInstallationGuide) => StaffInstallationGuide): void {
  items = items.map((g) => (g.id === id ? { ...fn(g), updatedAt: nowIso() } : g))
  persist()
}
export function markGuideCopied(id: string): void {
  patch(id, (g) => ({ ...g, status: 'copied', copiedAt: nowIso() }))
}
export function addStaffInstallRecord(id: string, staffName: string, staffRole: string | undefined, version: string): void {
  if (!staffName.trim()) return
  const rec: StaffInstallStatusRecord = { id: rid('sir'), staffName: staffName.trim(), staffRole: staffRole?.trim() || undefined, version, status: 'not-started', updatedAt: nowIso() }
  patch(id, (g) => ({ ...g, targetStaffRecords: [...g.targetStaffRecords, rec] }))
}
export function setStaffInstallStatus(id: string, recId: string, status: StaffInstallStatus): void {
  patch(id, (g) => ({
    ...g,
    targetStaffRecords: g.targetStaffRecords.map((r) => (r.id === recId ? { ...r, status, updatedAt: nowIso() } : r))
  }))
}

export function useInstallGuides(): StaffInstallationGuide[] {
  const [state, setState] = useState<StaffInstallationGuide[]>(items)
  useEffect(() => {
    const l = (): void => setState([...items])
    listeners.add(l)
    return () => {
      listeners.delete(l)
    }
  }, [])
  return state
}
