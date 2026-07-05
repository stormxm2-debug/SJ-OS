import { useState } from 'react'
import { GitCommitHorizontal, UploadCloud, FileDiff, GitBranch, Loader2, Check } from 'lucide-react'
import Card from '@renderer/components/ui/Card'
import type { ClaudeAutoBuildJob, ClaudeJobCommitState } from '@shared/claudeAutoBuild'
import { useClaudeAutoBuild } from '@renderer/services/claude-auto-build/useClaudeAutoBuild'

/**
 * 커밋 / 푸시 — after a main-workspace auto-build job succeeds (verification passed),
 * the user reviews changed files, commits (safe staging, no `git add .`), then
 * separately approves the push (git push origin <currentBranch>, never force). The
 * renderer never runs git. Inline cards only — two explicit approval steps.
 */
export default function ClaudeCommitPushPanel(): JSX.Element | null {
  const { jobs, loadJobCommitState, commitApprovedJob, pushApprovedCommit } = useClaudeAutoBuild()
  const succeeded = jobs
    .filter((j) => j.status === 'succeeded')
    .sort((a, b) => b.queueIndex - a.queueIndex)
    .slice(0, 6)

  if (succeeded.length === 0) return null

  return (
    <Card
      title="커밋 / 푸시"
      icon={<GitCommitHorizontal className="h-4 w-4 text-indigo-300" />}
      action={
        <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-600">
          승인 커밋/푸시 안전 빌드
        </span>
      }
    >
      <p className="mb-3 text-xs text-slate-500">
        검증을 통과한 작업의 변경사항을 확인하고, 승인 후 커밋하고, 두 번째 승인 후 origin에 push합니다. 렌더러는
        git을 실행하지 않으며, git add . / 강제 푸시는 사용하지 않습니다.
      </p>
      <div className="space-y-3">
        {succeeded.map((job) => (
          <CommitPushCard
            key={job.id}
            job={job}
            onLoad={() => loadJobCommitState(job.id)}
            onCommit={() => commitApprovedJob(job.id)}
            onPush={() => pushApprovedCommit(job.id)}
          />
        ))}
      </div>
    </Card>
  )
}

function CommitPushCard({
  job,
  onLoad,
  onCommit,
  onPush
}: {
  job: ClaudeAutoBuildJob
  onLoad: () => Promise<ClaudeJobCommitState | null>
  onCommit: () => Promise<ClaudeJobCommitState | null>
  onPush: () => Promise<ClaudeJobCommitState | null>
}): JSX.Element {
  const [state, setState] = useState<ClaudeJobCommitState | null>(null)
  const [busy, setBusy] = useState<'load' | 'commit' | 'push' | null>(null)
  const [pushConfirm, setPushConfirm] = useState(false)

  const committed = !!job.committed || state?.status === 'push-ready' || state?.status === 'pushed'
  const pushed = !!job.pushed || state?.status === 'pushed'
  const canCommit = state?.status === 'commit-ready'
  const v = job.verification

  const load = async (): Promise<void> => { setBusy('load'); setState(await onLoad()); setBusy(null) }
  const commit = async (): Promise<void> => { setBusy('commit'); setState(await onCommit()); setBusy(null) }
  const push = async (): Promise<void> => { setBusy('push'); setPushConfirm(false); setState(await onPush()); setBusy(null) }

  return (
    <div className="rounded-xl border border-slate-800 bg-white p-3 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-slate-100">{job.title}</div>
          <div className="mt-0.5 text-[11px] text-slate-500">검증: typecheck={v.typecheckStatus} · build={v.buildStatus}</div>
        </div>
        <span className={['shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold', pushed ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : committed ? 'border-indigo-500/30 bg-indigo-500/10 text-indigo-300' : 'border-slate-700 bg-slate-800/60 text-slate-400'].join(' ')}>
          {pushed ? 'pushed' : committed ? 'committed' : (state?.status ?? '미확인')}
        </span>
      </div>

      {state ? (
        <div className="mt-2 space-y-1 text-[11px] text-slate-500">
          {state.currentBranch ? (
            <div className="flex items-center gap-1"><GitBranch className="h-3 w-3" /> 현재 브랜치: <span className="font-mono text-slate-400">{state.currentBranch}</span></div>
          ) : null}
          {state.commitHash ? <div>커밋 해시: <span className="font-mono text-emerald-300">{state.commitHash}</span></div> : null}
          <div>커밋 메시지: <span className="text-slate-400">{state.commitMessage}</span></div>
          <div>변경 파일: {state.changedFiles.length}개</div>
          {state.changedFiles.length > 0 ? (
            <div className="max-h-28 overflow-y-auto rounded border border-slate-800 bg-slate-950/40 p-1.5 font-mono text-[10px] text-slate-400">
              {state.changedFiles.slice(0, 60).map((f) => <div key={f} className="truncate">{f}</div>)}
            </div>
          ) : null}
          {state.errorMessage ? <div className="text-rose-300">{state.errorMessage}</div> : null}
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        <MiniBtn tone="slate" icon={busy === 'load' ? <Loader2 className="h-3 w-3 animate-spin" /> : <FileDiff className="h-3 w-3" />} label="변경사항 확인" onClick={() => void load()} disabled={busy !== null} />
        <MiniBtn tone="indigo" icon={busy === 'commit' ? <Loader2 className="h-3 w-3 animate-spin" /> : <GitCommitHorizontal className="h-3 w-3" />} label="커밋 생성" onClick={() => void commit()} disabled={!canCommit || busy !== null} />
        {committed && !pushed ? (
          !pushConfirm ? (
            <MiniBtn tone="emerald" icon={<UploadCloud className="h-3 w-3" />} label="푸시 승인" onClick={() => setPushConfirm(true)} disabled={busy !== null} />
          ) : null
        ) : null}
      </div>

      {pushConfirm ? (
        <div className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-2">
          <p className="text-[11px] font-semibold text-amber-200">이 커밋을 원격 저장소 origin에 push합니다. 계속하시겠습니까?</p>
          <div className="mt-2 flex gap-2">
            <MiniBtn tone="emerald" icon={busy === 'push' ? <Loader2 className="h-3 w-3 animate-spin" /> : <UploadCloud className="h-3 w-3" />} label="푸시 실행" onClick={() => void push()} disabled={busy !== null} />
            <MiniBtn tone="slate" icon={<span />} label="취소" onClick={() => setPushConfirm(false)} />
          </div>
        </div>
      ) : null}

      {pushed ? (
        <div className="mt-2 flex items-center gap-1.5 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1.5 text-[11px] text-emerald-200">
          <Check className="h-3 w-3" /> push 완료 · origin/{state?.currentBranch ?? ''}
        </div>
      ) : null}

      {state?.logLines && state.logLines.length > 0 ? (
        <pre className="mt-2 max-h-40 overflow-y-auto rounded-lg border border-slate-800 bg-slate-950/70 p-2 font-mono text-[10px] leading-5 text-slate-400">
          {state.logLines.slice(-200).join('\n')}
        </pre>
      ) : null}
    </div>
  )
}

function MiniBtn({ tone, icon, label, onClick, disabled }: { tone: 'slate' | 'indigo' | 'emerald'; icon: JSX.Element; label: string; onClick: () => void; disabled?: boolean }): JSX.Element {
  const tones = {
    slate: 'border-slate-700 bg-slate-800/50 text-slate-300 hover:bg-slate-700/60',
    indigo: 'border-indigo-500/30 bg-indigo-500/10 text-indigo-300 hover:bg-indigo-500/20',
    emerald: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20'
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={['inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-medium transition', disabled ? 'cursor-not-allowed border-slate-800 bg-slate-900/40 text-slate-600' : tones[tone]].join(' ')}
    >
      {icon}
      {label}
    </button>
  )
}
