import { useState, type ReactNode } from 'react'
import { Rocket, Check, X, Wrench, ShieldCheck, Copy, Lock, PackageCheck } from 'lucide-react'
import Card from '@renderer/components/ui/Card'
import { useClaudeAutoBuild } from '@renderer/services/claude-auto-build/useClaudeAutoBuild'
import { copyPromptToClipboard } from '@renderer/services/claude-code/claudeCodeBridge'
import {
  createReleaseApprovalFromJob,
  missingForReleaseReady,
  setReleaseStatus,
  toggleReadiness,
  toggleTestCheck,
  useReleaseApprovals,
  type ReleaseApprovalItem,
  type ReleaseReadiness
} from '@renderer/services/release-approval/releaseApprovalStore'

/**
 * 릴리즈 승인 센터 — review completed Claude-built work and mark it approved /
 * needs-fix / rejected / release-ready. Approval + readiness bookkeeping ONLY:
 * this NEVER deploys, runs git, or touches external services. Inline cards only.
 */
export default function ReleaseApprovalPanel(): JSX.Element {
  const items = useReleaseApprovals()
  const { jobs } = useClaudeAutoBuild()

  const candidates = jobs.filter(
    (j) => j.status === 'succeeded' && !items.some((i) => i.sourceJobId === j.id)
  )

  const groups: { key: string; label: string; match: (i: ReleaseApprovalItem) => boolean }[] = [
    { key: 'review', label: '승인 대기', match: (i) => i.status === 'review-ready' || i.status === 'draft' },
    { key: 'fix', label: '수정 필요', match: (i) => i.status === 'needs-fix' },
    { key: 'approved', label: '승인 완료', match: (i) => i.status === 'approved' },
    { key: 'ready', label: '릴리즈 준비 완료', match: (i) => i.status === 'release-ready' || i.status === 'released-manually' },
    { key: 'rejected', label: '반려', match: (i) => i.status === 'rejected' }
  ]

  return (
    <Card
      title="릴리즈 승인 센터"
      icon={<Rocket className="h-4 w-4 text-indigo-300" />}
      action={
        <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-600">
          릴리즈 승인 안전 빌드
        </span>
      }
    >
      <p className="mb-3 text-xs text-slate-500">
        완료된 Claude 개발 작업을 검토하고 승인/수정 필요/반려/릴리즈 준비 상태를 관리합니다. 이 화면은 배포를
        수행하지 않습니다.
      </p>

      {/* Create items from succeeded jobs */}
      {candidates.length > 0 ? (
        <div className="mb-4 rounded-xl border border-slate-800 bg-slate-950/40 p-3">
          <div className="mb-1.5 text-[11px] font-semibold text-slate-400">완료된 작업에서 릴리즈 항목 생성</div>
          <div className="flex flex-wrap gap-1.5">
            {candidates.slice(0, 8).map((j) => (
              <button
                key={j.id}
                type="button"
                onClick={() => createReleaseApprovalFromJob(j)}
                className="rounded-full border border-indigo-500/30 bg-indigo-500/10 px-2.5 py-1 text-[11px] font-medium text-indigo-300 transition hover:bg-indigo-500/20"
              >
                + {j.title.length > 24 ? j.title.slice(0, 24) + '…' : j.title}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {items.length === 0 ? (
        <p className="py-3 text-center text-xs text-slate-500">릴리즈 승인 항목이 없습니다. 완료된 작업에서 생성하세요.</p>
      ) : (
        <div className="space-y-4">
          {groups.map((g) => {
            const rows = items.filter(g.match)
            if (rows.length === 0) return null
            return (
              <div key={g.key}>
                <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  {g.label} ({rows.length})
                </div>
                <div className="space-y-2">
                  {rows.map((item) => <ApprovalCard key={item.id} item={item} />)}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Deployment placeholder (disabled) */}
      <div className="mt-4 flex items-start gap-2 rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2.5 text-xs text-slate-500">
        <Lock className="mt-0.5 h-4 w-4 shrink-0" />
        <div>
          <div className="font-semibold text-slate-400">배포 실행</div>
          자동 배포는 다음 안정화 단계에서 활성화됩니다. 현재는 릴리즈 승인과 준비 상태만 관리합니다.
        </div>
      </div>
    </Card>
  )
}

function ApprovalCard({ item }: { item: ReleaseApprovalItem }): JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const missing = missingForReleaseReady(item)

  const flash = (m: string): void => {
    setMsg(m)
    window.setTimeout(() => setMsg((c) => (c === m ? null : c)), 3000)
  }
  const approve = (): void => { setReleaseStatus(item.id, 'approved'); flash('대표님 승인 완료. 릴리즈 준비 단계로 이동할 수 있습니다.') }
  const needsFix = (): void => { setReleaseStatus(item.id, 'needs-fix'); flash('수정 필요로 표시했습니다. 자동복구/수동 검토를 진행하세요.') }
  const reject = (): void => { setReleaseStatus(item.id, 'rejected'); flash('반려했습니다. 작업/보고서는 삭제하지 않습니다.') }
  const markReady = (): void => {
    if (missing.length > 0) { flash(`릴리즈 준비 미완료: ${missing.join(', ')}`); return }
    setReleaseStatus(item.id, 'release-ready')
    flash('릴리즈 준비 완료로 표시했습니다. 실제 배포는 다음 단계에서 진행됩니다.')
  }
  const copyNote = async (): Promise<void> => {
    const text = [
      `# ${item.title}`,
      '',
      `## 릴리즈 노트`,
      item.releaseNote,
      '',
      `## 검증`,
      `- typecheck: ${item.verification.typecheckStatus}`,
      `- build: ${item.verification.buildStatus}`,
      `## 커밋`,
      `- ${item.commitHash ?? '(미커밋)'} · push ${item.pushStatus}`,
      '',
      `## 수동 테스트`,
      ...item.manualTestChecklist.map((c) => `- [${item.testChecks[c] ? 'x' : ' '}] ${c}`)
    ].join('\n')
    if (await copyPromptToClipboard(text)) { setCopied(true); window.setTimeout(() => setCopied(false), 2000) }
  }

  const risk = { low: 'emerald', medium: 'amber', high: 'rose' }[item.riskLevel] as 'emerald' | 'amber' | 'rose'

  return (
    <div className="rounded-xl border border-slate-800 bg-white p-3 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-slate-100">{item.title}</div>
          <div className="mt-0.5 truncate text-[11px] text-slate-500">{item.originalUserCommand}</div>
        </div>
        <div className="flex shrink-0 gap-1.5">
          <Chip tone={risk}>위험도 {item.riskLevel}</Chip>
          <Chip tone="indigo">{item.status}</Chip>
        </div>
      </div>

      <div className="mt-2 text-[11px] text-slate-500">
        검증: typecheck={item.verification.typecheckStatus} · build={item.verification.buildStatus} · 커밋{' '}
        <span className="font-mono">{item.commitHash ?? '(미커밋)'}</span> · push {item.pushStatus}
      </div>
      <p className="mt-1 text-[11px] text-slate-400">{item.releaseNote}</p>

      {/* Actions */}
      <div className="mt-3 flex flex-wrap gap-2">
        <MiniBtn tone="slate" icon={<PackageCheck className="h-3 w-3" />} label={expanded ? '상세 숨기기' : '상세 보기'} onClick={() => setExpanded((s) => !s)} />
        <MiniBtn tone="emerald" icon={<Check className="h-3 w-3" />} label="승인" onClick={approve} />
        <MiniBtn tone="amber" icon={<Wrench className="h-3 w-3" />} label="수정 필요" onClick={needsFix} />
        <MiniBtn tone="rose" icon={<X className="h-3 w-3" />} label="반려" onClick={reject} />
        <MiniBtn tone={missing.length === 0 ? 'indigo' : 'slate'} icon={<ShieldCheck className="h-3 w-3" />} label="릴리즈 준비 완료로 표시" onClick={markReady} />
        <MiniBtn tone="slate" icon={copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />} label={copied ? '복사됨' : '릴리즈 노트 복사'} onClick={() => void copyNote()} />
      </div>

      {msg ? <div className="mt-2 rounded-lg border border-indigo-500/20 bg-indigo-500/10 px-2.5 py-1.5 text-[11px] text-indigo-200">{msg}</div> : null}

      {expanded ? (
        <div className="mt-3 space-y-3 text-[11px]">
          {/* Readiness checklist */}
          <div>
            <div className="mb-1 font-semibold text-slate-300">릴리즈 준비 체크리스트</div>
            <div className="space-y-0.5">
              <AutoCheck done={item.verification.typecheckStatus === 'passed'} label="typecheck 통과" />
              <AutoCheck done={item.verification.buildStatus === 'passed'} label="build 통과" />
              <Toggle checked={item.readiness.changedFilesReviewed} label="변경 파일 검토" onClick={() => toggleReadiness(item.id, 'changedFilesReviewed')} />
              <Toggle checked={item.readiness.manualTestsDone} label="수동 테스트 완료" onClick={() => toggleReadiness(item.id, 'manualTestsDone')} />
              <Toggle checked={item.readiness.releaseNoteConfirmed} label="릴리즈 노트 확인" onClick={() => toggleReadiness(item.id, 'releaseNoteConfirmed')} />
              <AutoCheck done={item.status === 'approved' || item.status === 'release-ready'} label="대표 승인 완료" />
              <Toggle checked={item.readiness.pushConfirmed || item.pushStatus === 'pushed'} label="push 상태 확인" onClick={() => toggleReadiness(item.id, 'pushConfirmed')} />
            </div>
            {missing.length > 0 ? <div className="mt-1 text-amber-300">미완료: {missing.join(', ')}</div> : <div className="mt-1 text-emerald-300">릴리즈 준비 조건 충족</div>}
          </div>
          {/* Manual test checklist */}
          <div>
            <div className="mb-1 font-semibold text-slate-300">수동 테스트 체크리스트</div>
            <div className="space-y-0.5">
              {item.manualTestChecklist.map((c) => (
                <Toggle key={c} checked={!!item.testChecks[c]} label={c} onClick={() => toggleTestCheck(item.id, c)} />
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

// --- helpers ---------------------------------------------------------------

type Tone = 'emerald' | 'amber' | 'rose' | 'indigo' | 'slate'
const TONES: Record<Tone, string> = {
  emerald: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  amber: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  rose: 'border-rose-500/30 bg-rose-500/10 text-rose-300',
  indigo: 'border-indigo-500/30 bg-indigo-500/10 text-indigo-300',
  slate: 'border-slate-700 bg-slate-800/60 text-slate-400'
}
function Chip({ tone, children }: { tone: Tone; children: ReactNode }): JSX.Element {
  return <span className={['rounded-full border px-2 py-0.5 text-[10px] font-bold', TONES[tone]].join(' ')}>{children}</span>
}
function MiniBtn({ tone, icon, label, onClick }: { tone: Tone; icon: ReactNode; label: string; onClick: () => void }): JSX.Element {
  return (
    <button type="button" onClick={onClick} className={['inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-medium transition hover:opacity-80', TONES[tone]].join(' ')}>
      {icon}
      {label}
    </button>
  )
}
function Toggle({ checked, label, onClick }: { checked: boolean; label: string; onClick: () => void }): JSX.Element {
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center gap-1.5 text-left text-slate-400 hover:text-slate-200">
      <span className={['inline-flex h-3.5 w-3.5 items-center justify-center rounded border text-[9px]', checked ? 'border-emerald-500/40 bg-emerald-500/20 text-emerald-300' : 'border-slate-600 text-transparent'].join(' ')}>✓</span>
      {label}
    </button>
  )
}
function AutoCheck({ done, label }: { done: boolean; label: string }): JSX.Element {
  return (
    <div className="flex items-center gap-1.5 text-slate-400">
      <span className={['inline-flex h-3.5 w-3.5 items-center justify-center rounded border text-[9px]', done ? 'border-emerald-500/40 bg-emerald-500/20 text-emerald-300' : 'border-rose-500/40 text-rose-300'].join(' ')}>{done ? '✓' : '×'}</span>
      {label} <span className="text-[10px] text-slate-600">(자동)</span>
    </div>
  )
}
