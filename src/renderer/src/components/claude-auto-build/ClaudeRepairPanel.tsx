import { useState } from 'react'
import { Wrench, ShieldCheck, Play, ScrollText, FileText, X, Loader2 } from 'lucide-react'
import Card from '@renderer/components/ui/Card'
import type { ClaudeAutoBuildJob } from '@shared/claudeAutoBuild'
import { MAX_REPAIR_ATTEMPTS } from '@shared/claudeAutoBuild'
import { useClaudeAutoBuild } from '@renderer/services/claude-auto-build/useClaudeAutoBuild'

/**
 * Claude 자동복구 — when an auto-build job fails typecheck/build, a focused repair
 * job is auto-GENERATED from the error logs (never auto-run). The user approves it,
 * then runs it through the same Electron-main runner. Max 2 attempts per chain.
 * The renderer never runs shell commands. Inline cards only.
 */
export default function ClaudeRepairPanel(): JSX.Element | null {
  const { jobs, envReady, runJob, cancelQueuedJob, approveRepairJob } = useClaudeAutoBuild()
  const repairs = jobs
    .filter((j) => j.repairOfJobId)
    .sort((a, b) => b.queueIndex - a.queueIndex)

  if (repairs.length === 0) return null

  return (
    <Card
      title="Claude 자동복구"
      icon={<Wrench className="h-4 w-4 text-indigo-300" />}
      action={
        <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-600">
          Claude 자동복구 안전 빌드
        </span>
      }
    >
      <p className="mb-3 text-xs text-slate-500">
        typecheck/build 실패 시 오류 로그로 복구 프롬프트를 자동 생성합니다. 승인 후에만 실행되며, 소스 작업당
        최대 {MAX_REPAIR_ATTEMPTS}회까지 복구를 시도합니다.
      </p>
      <div className="space-y-3">
        {repairs.map((job) => (
          <RepairCard
            key={job.id}
            job={job}
            envReady={envReady}
            onApprove={() => void approveRepairJob(job.id)}
            onRun={() => void runJob(job.id)}
            onCancel={() => void cancelQueuedJob(job.id)}
          />
        ))}
      </div>
    </Card>
  )
}

function RepairCard({
  job,
  envReady,
  onApprove,
  onRun,
  onCancel
}: {
  job: ClaudeAutoBuildJob
  envReady: boolean
  onApprove: () => void
  onRun: () => void
  onCancel: () => void
}): JSX.Element {
  const [showPrompt, setShowPrompt] = useState(false)
  const [showLogs, setShowLogs] = useState(false)

  const approved = job.repairApproved === true
  const active = job.status === 'running' || job.status === 'verifying'
  const runnable =
    job.status === 'queued' || job.status === 'failed' || job.status === 'needs-review'
  const canRun = approved && envReady && runnable
  const limitReached =
    (job.repairAttempt ?? 0) >= MAX_REPAIR_ATTEMPTS &&
    (job.status === 'failed' || job.status === 'needs-review')

  return (
    <div className="rounded-xl border border-slate-800 bg-white p-3 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-slate-100">자동 복구 프롬프트 생성됨</div>
          <div className="mt-0.5 truncate text-[11px] text-slate-500">{job.title}</div>
        </div>
        <span className="shrink-0 rounded-full border border-indigo-500/30 bg-indigo-500/10 px-2 py-0.5 text-[10px] font-bold text-indigo-300">
          {job.status}
        </span>
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5 text-[10px]">
        <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 font-semibold text-amber-300">
          실패 단계: {job.failedStage ?? 'unknown'}
        </span>
        <span className="rounded-full border border-slate-700 bg-slate-800/60 px-2 py-0.5 font-semibold text-slate-400">
          {job.repairAttempt ?? 1}/{MAX_REPAIR_ATTEMPTS}차
        </span>
        <span className={['rounded-full border px-2 py-0.5 font-semibold', approved ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : 'border-slate-700 bg-slate-800/60 text-slate-400'].join(' ')}>
          {approved ? '승인됨' : '승인 대기'}
        </span>
      </div>

      {job.errorSummary ? (
        <div className="mt-2 rounded-lg border border-rose-500/20 bg-rose-500/5 px-2.5 py-1.5 font-mono text-[10px] text-rose-200">
          오류 요약: {job.errorSummary}
        </div>
      ) : null}

      {limitReached ? (
        <div className="mt-2 rounded-lg border border-amber-500/20 bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-200">
          자동 복구 한도에 도달했습니다. 수동 검토가 필요합니다.
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        <MiniBtn icon={<FileText className="h-3 w-3" />} label={showPrompt ? '프롬프트 숨기기' : '복구 프롬프트 보기'} onClick={() => setShowPrompt((s) => !s)} />
        {!approved ? (
          <MiniBtn tone="emerald" icon={<ShieldCheck className="h-3 w-3" />} label="복구 작업 승인" onClick={onApprove} />
        ) : null}
        <button
          type="button"
          onClick={onRun}
          disabled={!canRun}
          className={[
            'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-medium transition',
            canRun
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20'
              : 'cursor-not-allowed border-slate-800 bg-slate-900/40 text-slate-600'
          ].join(' ')}
        >
          {active ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
          Claude Code로 복구 실행
        </button>
        <MiniBtn icon={<ScrollText className="h-3 w-3" />} label={showLogs ? '로그 숨기기' : '로그 보기'} onClick={() => setShowLogs((s) => !s)} />
        {runnable && !active ? (
          <MiniBtn icon={<X className="h-3 w-3" />} label="취소" onClick={onCancel} />
        ) : null}
      </div>

      {approved && !envReady ? (
        <p className="mt-2 text-[11px] text-amber-300">Claude Code 실행 환경을 먼저 확인해주세요.</p>
      ) : null}

      {showPrompt ? (
        <pre className="mt-2 max-h-52 overflow-y-auto rounded-lg border border-slate-800 bg-slate-950/70 p-2 font-mono text-[10px] leading-5 text-slate-400">
          {job.generatedPrompt}
        </pre>
      ) : null}
      {showLogs ? (
        <pre className="mt-2 max-h-48 overflow-y-auto rounded-lg border border-slate-800 bg-slate-950/70 p-2 font-mono text-[10px] leading-5 text-slate-400">
          {job.logLines.slice(-100).join('\n') || '(로그 없음)'}
        </pre>
      ) : null}
    </div>
  )
}

function MiniBtn({ tone, icon, label, onClick }: { tone?: 'emerald'; icon: JSX.Element; label: string; onClick: () => void }): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-medium transition',
        tone === 'emerald'
          ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20'
          : 'border-slate-700 bg-slate-800/50 text-slate-300 hover:bg-slate-700/60'
      ].join(' ')}
    >
      {icon}
      {label}
    </button>
  )
}
