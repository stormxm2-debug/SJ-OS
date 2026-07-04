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
  ChevronRight
} from 'lucide-react'
import Card from '@renderer/components/ui/Card'
import ClaudeCodeBridgePanel from '@renderer/components/claude-code/ClaudeCodeBridgePanel'
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
 * Developer Prompt Center — the safe bridge between a CEO development command and
 * real Claude Code work. Jarvis turns each build/developer command into a
 * structured Claude Code prompt packet; the CEO copies it into Claude Code and
 * tracks its status here (생성됨 → 복사됨 → Claude 전달됨 → 개발 중 → 완료). No files are
 * edited from this screen and no external API is called.
 */
export default function DeveloperPromptCenterPage(): JSX.Element {
  const snapshot = useDeveloperPrompt()
  const summary = developerPromptRepository.getSummary()
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)

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

  return (
    <div className="space-y-5">
      {/* Summary */}
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

      {/* Claude Code Bridge — prepare prompts for delivery to Claude Code */}
      <ClaudeCodeBridgePanel />
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
