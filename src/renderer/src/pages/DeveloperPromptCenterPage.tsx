import { useState, type ReactNode } from 'react'
import {
  Terminal,
  Copy,
  Check,
  Send,
  CheckCircle2,
  Ban,
  Download,
  RotateCcw,
  Clock,
  ListChecks,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Settings2,
  ShieldAlert,
  MonitorSmartphone
} from 'lucide-react'
import Card from '@renderer/components/ui/Card'
import ClaudeCodeBridgePanel from '@renderer/components/claude-code/ClaudeCodeBridgePanel'
import ClaudeCodeRunnerPanel from '@renderer/components/claude-code/ClaudeCodeRunnerPanel'
import ClaudeAutoBuildPanel from '@renderer/components/claude-auto-build/ClaudeAutoBuildPanel'
import ClaudeParallelPanel from '@renderer/components/claude-auto-build/ClaudeParallelPanel'
import ClaudeRepairPanel from '@renderer/components/claude-auto-build/ClaudeRepairPanel'
import ClaudeCommitPushPanel from '@renderer/components/claude-auto-build/ClaudeCommitPushPanel'
import ClaudeCompletionReportPanel from '@renderer/components/claude-auto-build/ClaudeCompletionReportPanel'
import WorktreeReviewPanel from '@renderer/components/claude-auto-build/WorktreeReviewPanel'
import RunnerSmokeTestPanel from '@renderer/components/claude-auto-build/RunnerSmokeTestPanel'
import { useSession } from '@renderer/navigation/SessionContext'
import { isAdminRole, ROLE_LABEL } from '@renderer/navigation/roleAccess'
import { isElectronRuntime, useIsMobile } from '@renderer/navigation/appTarget'
import { useDeveloperPrompt } from '@renderer/services/developer-prompt/useDeveloperPrompt'
import { developerPromptRepository } from '@renderer/services/developer-prompt/DeveloperPromptRepository'
import type {
  DeveloperPromptPacket,
  DeveloperPromptRiskLevel,
  DeveloperPromptStatus
} from '@renderer/services/developer-prompt/types'

// --- styling / labels ------------------------------------------------------

const STATUS_LABEL: Record<DeveloperPromptStatus, string> = {
  draft: '초안',
  generated: '생성됨',
  copied: '복사됨',
  'sent-to-claude': 'Claude 전달됨',
  'in-development': '개발 중',
  verified: '검증됨',
  completed: '완료',
  blocked: '차단됨',
  rejected: '반려됨'
}

const STATUS_TONE: Record<DeveloperPromptStatus, string> = {
  draft: 'border-slate-700 bg-slate-800/60 text-slate-300',
  generated: 'border-indigo-500/30 bg-indigo-500/10 text-indigo-300',
  copied: 'border-sky-500/30 bg-sky-500/10 text-sky-300',
  'sent-to-claude': 'border-violet-500/30 bg-violet-500/10 text-violet-300',
  'in-development': 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  verified: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  completed: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  blocked: 'border-rose-500/30 bg-rose-500/10 text-rose-300',
  rejected: 'border-rose-500/30 bg-rose-500/10 text-rose-300'
}

const RISK_TONE: Record<DeveloperPromptRiskLevel, string> = {
  low: 'text-emerald-300',
  medium: 'text-amber-300',
  high: 'text-rose-300',
  critical: 'text-rose-400'
}

/** The five columns the CEO tracks, mapped to their member statuses. */
const COLUMNS: { key: string; title: string; icon: ReactNode; statuses: DeveloperPromptStatus[] }[] = [
  { key: 'pending', title: '대기 중인 개발 프롬프트', icon: <Clock className="h-4 w-4" />, statuses: ['draft', 'generated'] },
  { key: 'waiting', title: 'Claude 전달 대기', icon: <Send className="h-4 w-4" />, statuses: ['copied'] },
  { key: 'in-dev', title: '개발 중', icon: <ListChecks className="h-4 w-4" />, statuses: ['sent-to-claude', 'in-development'] },
  { key: 'done', title: '완료', icon: <CheckCircle2 className="h-4 w-4" />, statuses: ['verified', 'completed'] },
  { key: 'blocked', title: '차단됨', icon: <Ban className="h-4 w-4" />, statuses: ['blocked', 'rejected'] }
]

function formatTimestamp(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString()
}

/** Trigger a client-side download of the full prompt queue as JSON. */
function exportQueue(): void {
  const json = developerPromptRepository.serializeSnapshot()
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = 'developer-prompt-center.json'
  anchor.click()
  URL.revokeObjectURL(url)
}

/**
 * 자비스 자동개발 (Developer Prompt Center) — the CEO/admin command center for the
 * in-app Claude Code automation engine. The normal screen shows only the simple
 * flow — ① 명령 입력 → ② 프롬프트 미리보기 → ③ 승인하고 실행 → ④ 실행 로그 → ⑤ 결과 확인 —
 * driven by <ClaudeAutoBuildPanel>. Every extra tool (실행 승인 러너, 스모크 테스트,
 * 자동 복구, 커밋/푸시, 완료 리포트, 병렬/워크트리, 개발 프롬프트 큐) is tucked behind
 * 고급 설정 열기 so 대표/관리자 are not overwhelmed.
 *
 * Access: 대표/관리자 전용 (FC/팀장 차단) · PC앱(데스크톱 Electron) 전용 (Web/PWA 차단).
 */
export default function DeveloperPromptCenterPage(): JSX.Element {
  const { session } = useSession()
  const isMobile = useIsMobile()
  const snapshot = useDeveloperPrompt()
  const summary = developerPromptRepository.getSummary()
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [showAdvanced, setShowAdvanced] = useState(false)

  const isAdmin = isAdminRole(session.role)
  const isDesktopApp = isElectronRuntime() && !isMobile

  const copy = (packet: DeveloperPromptPacket): void => {
    const done = (): void => {
      setCopiedId(packet.id)
      window.setTimeout(() => setCopiedId((id) => (id === packet.id ? null : id)), 2000)
    }
    developerPromptRepository.markCopied(packet.id)
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(packet.promptText).then(done).catch(done)
    } else {
      done()
    }
  }

  // FC/팀장 차단 — 자비스 자동개발은 대표/관리자 전용.
  if (!isAdmin) {
    return (
      <Card title="자비스 자동개발" icon={<ShieldAlert className="h-4 w-4 text-amber-300" />}>
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-4 py-6 text-center">
          <p className="text-sm font-semibold text-amber-200">자비스 자동개발은 대표/관리자 전용입니다.</p>
          <p className="mt-1 text-xs text-amber-300/80">
            현재 로그인: {ROLE_LABEL[session.role]} · FC/팀장은 이 화면에 접근할 수 없습니다.
          </p>
        </div>
      </Card>
    )
  }

  // Web/PWA 차단 — 실제 파일 생성/실행은 데스크톱 앱에서만 가능.
  if (!isDesktopApp) {
    return (
      <Card title="자비스 자동개발" icon={<MonitorSmartphone className="h-4 w-4 text-indigo-300" />}>
        <div className="rounded-lg border border-indigo-500/20 bg-indigo-500/10 px-4 py-6 text-center">
          <p className="text-sm font-semibold text-indigo-200">자비스 자동개발은 PC앱 전용입니다.</p>
          <p className="mt-1 text-xs text-indigo-300/80">
            Web/PWA(모바일)에서는 실행할 수 없습니다. SJ OS 데스크톱 앱에서 열어주세요.
          </p>
        </div>
      </Card>
    )
  }

  return (
    <div className="space-y-5">
      {/* Simple 5-step flow guide */}
      <Card title="자비스 자동개발 — 사용 순서" icon={<Terminal className="h-4 w-4 text-indigo-300" />}>
        <div className="flex flex-wrap gap-2">
          {['명령 입력', '프롬프트 미리보기', '승인하고 실행', '실행 로그', '결과 확인'].map((step, i) => (
            <span
              key={step}
              className="inline-flex items-center gap-1.5 rounded-full border border-slate-700 bg-slate-800/50 px-3 py-1 text-[11px] font-medium text-slate-300"
            >
              <span className="flex h-4 w-4 items-center justify-center rounded-full bg-indigo-500/20 text-[10px] font-bold text-indigo-300">
                {i + 1}
              </span>
              {step}
            </span>
          ))}
        </div>
      </Card>

      {/* Primary flow (Jarvis → Claude Code Auto Builder) */}
      <ClaudeAutoBuildPanel advanced={showAdvanced} />

      {/* Advanced settings toggle */}
      <button
        type="button"
        onClick={() => setShowAdvanced((v) => !v)}
        className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-2 text-xs font-semibold text-slate-200 transition hover:bg-slate-700/60"
      >
        <Settings2 className="h-4 w-4" />
        {showAdvanced ? '고급 설정 닫기' : '고급 설정 열기'}
        {showAdvanced ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
      </button>

      {/* Advanced tools — hidden by default so the normal screen stays simple */}
      {showAdvanced ? (
        <div className="space-y-5">
          <p className="rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2 text-[11px] text-slate-500">
            고급 설정: 실행 승인 러너 · 스모크 테스트 · Claude Code CLI 확인 · 자동 복구 · 커밋/푸시 · 완료 리포트 ·
            병렬/워크트리 · 개발 프롬프트 큐. 일반 사용에는 필요하지 않습니다.
          </p>

          {/* Approval runner (packet approval → command → run + logs) */}
          <ClaudeCodeRunnerPanel />

          {/* Safe runner smoke tests + Claude Code CLI 확인 + manual fallback */}
          <RunnerSmokeTestPanel />

          {/* Auto-repair: generated repair jobs for failed verification (approval required) */}
          <ClaudeRepairPanel />

          {/* Approved commit / push for succeeded main-workspace jobs (two-step) */}
          <ClaudeCommitPushPanel />

          {/* Completion report + release note for finished jobs */}
          <ClaudeCompletionReportPanel />

          {/* Worktree-based parallel builder (foundation) */}
          <ClaudeParallelPanel />

          {/* Worktree result review (read-only; no merge) */}
          <WorktreeReviewPanel />

          {/* Claude Code Bridge — prepare prompts for delivery to Claude Code */}
          <ClaudeCodeBridgePanel />

          {/* Developer prompt queue summary */}
          <Card
            title="개발 프롬프트 센터"
            icon={<Terminal className="h-4 w-4" />}
            action={
              <div className="flex items-center gap-2">
                <HeaderButton icon={<Download className="h-3.5 w-3.5" />} label="내보내기" onClick={exportQueue} />
                <HeaderButton
                  icon={<RotateCcw className="h-3.5 w-3.5" />}
                  label="초기화"
                  onClick={() => developerPromptRepository.resetDemoState()}
                />
              </div>
            }
          >
            <p className="mb-3 text-xs text-slate-500">
              Jarvis가 CEO의 개발 지시를 구조화된 Claude Code 프롬프트로 변환합니다. 프롬프트를 복사해 Claude
              Code에 붙여넣고, 이곳에서 상태를 추적하세요. 이 화면은 코드를 직접 수정하지 않습니다.
            </p>
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
              <StatTile icon={<Clock className="h-4 w-4" />} label="대기 중" value={summary.pending} />
              <StatTile icon={<Send className="h-4 w-4" />} label="Claude 전달 대기" value={summary.waitingForClaude} />
              <StatTile icon={<ListChecks className="h-4 w-4" />} label="개발 중" value={summary.inDevelopment} />
              <StatTile icon={<CheckCircle2 className="h-4 w-4" />} label="완료" value={summary.completed} />
              <StatTile icon={<AlertTriangle className="h-4 w-4" />} label="차단됨" value={summary.blocked} tone={summary.blocked > 0 ? 'text-rose-300' : undefined} />
            </div>
          </Card>

          {/* Columns */}
          {COLUMNS.map((col) => {
            const packets = snapshot.packets.filter((p) => col.statuses.includes(p.status))
            return (
              <Card
                key={col.key}
                title={col.title}
                icon={col.icon}
                action={<span className="text-xs text-slate-500">{packets.length}개</span>}
              >
                {packets.length === 0 ? (
                  <p className="py-4 text-center text-xs text-slate-600">항목이 없습니다.</p>
                ) : (
                  <div className="space-y-3">
                    {packets.map((packet) => (
                      <PacketCard
                        key={packet.id}
                        packet={packet}
                        copied={copiedId === packet.id}
                        expanded={expandedId === packet.id}
                        onCopy={() => copy(packet)}
                        onToggle={() => setExpandedId((id) => (id === packet.id ? null : packet.id))}
                      />
                    ))}
                  </div>
                )}
              </Card>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

// --- packet card -----------------------------------------------------------

function PacketCard({
  packet,
  copied,
  expanded,
  onCopy,
  onToggle
}: {
  packet: DeveloperPromptPacket
  copied: boolean
  expanded: boolean
  onCopy: () => void
  onToggle: () => void
}): JSX.Element {
  const isDone = packet.status === 'completed' || packet.status === 'verified'
  const isBlocked = packet.status === 'blocked' || packet.status === 'rejected'
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-slate-100">{packet.title}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
            <span className="rounded-full border border-slate-700 bg-slate-800/60 px-2 py-0.5">{packet.targetWorkspace}</span>
            <span>· 위험도 <span className={RISK_TONE[packet.riskLevel]}>{packet.riskLevel}</span></span>
            <span>· 우선순위 {packet.priority}</span>
            {packet.approvalRequired ? <span className="text-amber-300">· 승인 필요</span> : null}
            <span>· {formatTimestamp(packet.createdAt)}</span>
          </div>
        </div>
        <span className={['shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium', STATUS_TONE[packet.status]].join(' ')}>
          {STATUS_LABEL[packet.status]}
        </span>
      </div>

      <div className="mt-2 text-xs text-slate-400">
        <span className="text-slate-500">해석된 목표: </span>{packet.interpretedGoal}
      </div>

      {/* Actions */}
      <div className="mt-3 flex flex-wrap gap-2">
        <MiniButton icon={copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />} label={copied ? '복사됨' : '프롬프트 복사'} tone="sky" onClick={onCopy} />
        {!isDone && !isBlocked ? (
          <MiniButton
            icon={<Send className="h-3 w-3" />}
            label="Claude 전달됨으로 표시"
            tone="violet"
            onClick={() => developerPromptRepository.markSentToClaude(packet.id)}
          />
        ) : null}
        {!isDone && !isBlocked ? (
          <MiniButton
            icon={<CheckCircle2 className="h-3 w-3" />}
            label="완료로 표시"
            tone="emerald"
            onClick={() => developerPromptRepository.markCompleted(packet.id)}
          />
        ) : null}
        {!isBlocked && !isDone ? (
          <MiniButton
            icon={<Ban className="h-3 w-3" />}
            label="차단"
            tone="rose"
            onClick={() => developerPromptRepository.markBlocked(packet.id)}
          />
        ) : null}
        <MiniButton
          icon={expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          label={expanded ? '프롬프트 접기' : '프롬프트 미리보기'}
          tone="slate"
          onClick={onToggle}
        />
      </div>

      {/* Prompt preview */}
      {expanded ? (
        <div className="mt-3 space-y-2">
          <textarea
            readOnly
            value={packet.promptText}
            onFocus={(e) => e.currentTarget.select()}
            className="h-56 w-full resize-y rounded-lg border border-slate-800 bg-slate-950/70 p-3 font-mono text-[11px] leading-5 text-slate-300 outline-none"
          />
          <div className="text-[11px] text-slate-500">
            <span className="text-slate-400">검증 체크리스트: </span>
            {packet.verificationChecklist.join(' · ')}
          </div>
          <div className="text-[11px] text-slate-500">
            <span className="text-slate-400">커밋 메시지: </span>
            <span className="font-mono text-slate-300">{packet.commitMessage}</span>
          </div>
        </div>
      ) : null}
    </div>
  )
}

// --- presentational helpers ------------------------------------------------

function StatTile({
  icon,
  label,
  value,
  tone
}: {
  icon: ReactNode
  label: string
  value: number
  tone?: string
}): JSX.Element {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-xs text-slate-500">
        <span className="text-slate-400">{icon}</span>
        {label}
      </div>
      <div className={['mt-1 text-lg font-semibold', tone ?? 'text-slate-200'].join(' ')}>{value}</div>
    </div>
  )
}

function HeaderButton({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-1.5 text-xs font-medium text-slate-200 transition hover:bg-slate-700/60"
    >
      {icon}
      {label}
    </button>
  )
}

type MiniTone = 'sky' | 'violet' | 'emerald' | 'rose' | 'slate'

const MINI_TONES: Record<MiniTone, string> = {
  sky: 'border-sky-500/30 bg-sky-500/10 text-sky-300 hover:bg-sky-500/20',
  violet: 'border-violet-500/30 bg-violet-500/10 text-violet-300 hover:bg-violet-500/20',
  emerald: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20',
  rose: 'border-rose-500/30 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20',
  slate: 'border-slate-700 bg-slate-800/60 text-slate-300 hover:bg-slate-700/60'
}

function MiniButton({
  icon,
  label,
  tone,
  onClick
}: {
  icon: ReactNode
  label: string
  tone: MiniTone
  onClick: () => void
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={['inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-medium transition', MINI_TONES[tone]].join(' ')}
    >
      {icon}
      {label}
    </button>
  )
}
