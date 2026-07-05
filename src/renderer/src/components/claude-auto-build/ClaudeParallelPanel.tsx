import { useState } from 'react'
import { GitBranch, FolderGit2, Play, ScrollText, ShieldAlert, Loader2 } from 'lucide-react'
import Card from '@renderer/components/ui/Card'
import type { ClaudeAutoBuildJob } from '@shared/claudeAutoBuild'
import type { ParallelBuildJob, ParallelStatus } from '@shared/claudeParallel'
import { MAX_PARALLEL_JOBS } from '@shared/claudeParallel'
import { useClaudeAutoBuild } from '@renderer/services/claude-auto-build/useClaudeAutoBuild'
import { useClaudeParallel } from '@renderer/services/claude-auto-build/useClaudeParallel'

/**
 * 병렬 Claude 개발 — worktree-based parallel builder (foundation). Parallel mode is
 * OFF by default; enabling it lets each candidate job run in its OWN git worktree
 * + branch. Nothing auto-merges. Inline cards only — no overlay/modal.
 */
export default function ClaudeParallelPanel(): JSX.Element {
  const { jobs } = useClaudeAutoBuild()
  const { parallelJobs, available, prepareWorktree, runWorktreeJob } = useClaudeParallel()
  const [parallelMode, setParallelMode] = useState(false)

  // Candidates: safe jobs the user could split into worktrees.
  const candidates = jobs.filter((j) => j.safetyResult.promptSafe).slice(0, 6)
  const activeCount = parallelJobs.filter(
    (p) => p.parallelStatus === 'running' || p.parallelStatus === 'verifying'
  ).length

  return (
    <Card
      title="병렬 Claude 개발"
      icon={<FolderGit2 className="h-4 w-4 text-indigo-300" />}
      action={
        <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-600">
          worktree 병렬 안전 빌드
        </span>
      }
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-slate-500">
          같은 폴더에서 동시에 수정하면 위험하므로, 각 작업을 별도 git worktree로 분리해 병렬 실행합니다. 자동
          병합은 하지 않습니다. 최대 {MAX_PARALLEL_JOBS}개까지 병렬 실행됩니다.
        </p>
        <button
          type="button"
          onClick={() => setParallelMode((v) => !v)}
          className={[
            'shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition',
            parallelMode
              ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
              : 'border-slate-700 bg-slate-800/50 text-slate-400'
          ].join(' ')}
        >
          병렬 모드: {parallelMode ? 'ON' : 'OFF'}
        </button>
      </div>

      {!available ? (
        <p className="mt-2 text-[11px] text-amber-300">병렬 실행은 데스크톱 앱에서만 가능합니다.</p>
      ) : null}

      {!parallelMode ? (
        <p className="mt-3 text-[11px] text-slate-500">
          병렬 모드를 켜면 후보 작업을 worktree로 준비할 수 있습니다. (기본값 OFF · 순차 실행 권장)
        </p>
      ) : candidates.length === 0 ? (
        <p className="mt-3 text-[11px] text-slate-500">병렬 후보 작업이 없습니다. Jarvis에서 개발 명령을 입력하세요.</p>
      ) : (
        <div className="mt-3 space-y-2">
          <div className="text-[11px] text-slate-500">현재 병렬 실행: {activeCount}/{MAX_PARALLEL_JOBS}</div>
          {candidates.map((job) => (
            <ParallelRow
              key={job.id}
              job={job}
              parallel={parallelJobs.find((p) => p.sourceJobId === job.id) ?? null}
              atLimit={activeCount >= MAX_PARALLEL_JOBS}
              onPrepare={() => void prepareWorktree(job.id)}
              onRun={() => void runWorktreeJob(job.id)}
            />
          ))}
        </div>
      )}
    </Card>
  )
}

function ParallelRow({
  job,
  parallel,
  atLimit,
  onPrepare,
  onRun
}: {
  job: ClaudeAutoBuildJob
  parallel: ParallelBuildJob | null
  atLimit: boolean
  onPrepare: () => void
  onRun: () => void
}): JSX.Element {
  const [showLogs, setShowLogs] = useState(false)
  const status = parallel?.parallelStatus ?? 'not-created'
  const prepared = status === 'worktree-created' || status === 'ready' || status === 'running' ||
    status === 'verifying' || status === 'needs-merge-review' || status === 'failed'
  const running = status === 'running' || status === 'verifying'

  return (
    <div className="rounded-xl border border-slate-800 bg-white p-3 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-slate-100">{job.title}</div>
          <div className="mt-0.5 truncate text-[11px] text-slate-500">충돌 그룹: {job.conflictGroup}</div>
        </div>
        <ParallelBadge status={status} />
      </div>

      {parallel?.branchName ? (
        <div className="mt-1.5 flex items-center gap-1 text-[10px] text-slate-500">
          <GitBranch className="h-3 w-3" /> <span className="font-mono">{parallel.branchName}</span>
        </div>
      ) : null}
      {parallel?.worktreePath ? (
        <div className="truncate text-[10px] text-slate-500">worktree: <span className="font-mono">{parallel.worktreePath}</span></div>
      ) : null}
      {status === 'blocked' && parallel?.blockedReason ? (
        <div className="mt-1.5 rounded-lg border border-rose-500/20 bg-rose-500/10 px-2.5 py-1.5 text-[11px] text-rose-200">
          <ShieldAlert className="mr-1 inline h-3 w-3" />
          {parallel.blockedReason}
        </div>
      ) : null}
      {status === 'needs-merge-review' ? (
        <div className="mt-1.5 rounded-lg border border-amber-500/20 bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-200">
          작업이 별도 폴더에서 완료되었습니다. 병합은 다음 단계에서 대표님 승인 후 진행됩니다.
        </div>
      ) : null}

      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onPrepare}
          disabled={running}
          className={[
            'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-medium transition',
            running
              ? 'cursor-not-allowed border-slate-800 bg-slate-900/40 text-slate-600'
              : 'border-indigo-500/30 bg-indigo-500/10 text-indigo-300 hover:bg-indigo-500/20'
          ].join(' ')}
        >
          <FolderGit2 className="h-3 w-3" />
          worktree 준비
        </button>
        <button
          type="button"
          onClick={onRun}
          disabled={!prepared || running || atLimit}
          className={[
            'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-medium transition',
            !prepared || running || atLimit
              ? 'cursor-not-allowed border-slate-800 bg-slate-900/40 text-slate-600'
              : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20'
          ].join(' ')}
        >
          <Play className="h-3 w-3" />
          병렬 실행 시작
        </button>
        {parallel ? (
          <button
            type="button"
            onClick={() => setShowLogs((s) => !s)}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800/50 px-2.5 py-1 text-[11px] font-medium text-slate-300 transition hover:bg-slate-700/60"
          >
            <ScrollText className="h-3 w-3" />
            {showLogs ? '로그 숨기기' : '로그 보기'}
          </button>
        ) : null}
        {status === 'needs-merge-review' ? (
          <span className="inline-flex items-center rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-[11px] font-medium text-amber-300">
            병합 검토 대기
          </span>
        ) : null}
      </div>

      {parallel?.verificationResult && (status === 'needs-merge-review' || status === 'verifying') ? (
        <div className="mt-2 text-[11px] text-slate-500">
          검증(참고): typecheck={parallel.verificationResult.typecheckStatus} · build={parallel.verificationResult.buildStatus}
        </div>
      ) : null}

      {showLogs && parallel ? (
        <pre className="mt-2 max-h-48 overflow-y-auto rounded-lg border border-slate-800 bg-slate-950/70 p-3 font-mono text-[10px] leading-5 text-slate-400">
          {parallel.logLines.slice(-200).join('\n') || '(로그 없음)'}
        </pre>
      ) : null}
    </div>
  )
}

const BADGE: Record<ParallelStatus, { text: string; cls: string }> = {
  'not-created': { text: '미생성', cls: 'border-slate-700 bg-slate-800/60 text-slate-400' },
  preparing: { text: '준비 중', cls: 'border-amber-500/30 bg-amber-500/10 text-amber-300' },
  'worktree-created': { text: 'worktree 생성됨', cls: 'border-indigo-500/30 bg-indigo-500/10 text-indigo-300' },
  ready: { text: '실행 준비', cls: 'border-indigo-500/30 bg-indigo-500/10 text-indigo-300' },
  running: { text: '실행 중', cls: 'border-indigo-500/30 bg-indigo-500/10 text-indigo-300' },
  verifying: { text: '검증 중', cls: 'border-amber-500/30 bg-amber-500/10 text-amber-300' },
  succeeded: { text: '완료', cls: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' },
  failed: { text: '실패', cls: 'border-rose-500/30 bg-rose-500/10 text-rose-300' },
  'needs-merge-review': { text: '병합 검토 대기', cls: 'border-amber-500/30 bg-amber-500/10 text-amber-300' },
  blocked: { text: '차단됨', cls: 'border-rose-500/30 bg-rose-500/10 text-rose-300' }
}

function ParallelBadge({ status }: { status: ParallelStatus }): JSX.Element {
  const b = BADGE[status]
  const spinning = status === 'running' || status === 'verifying' || status === 'preparing'
  return (
    <span className={['inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold', b.cls].join(' ')}>
      {spinning ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
      {b.text}
    </span>
  )
}
