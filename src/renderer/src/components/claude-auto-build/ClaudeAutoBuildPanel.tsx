import { useEffect, useState, type ReactNode } from 'react'
import {
  Bot,
  Play,
  Square,
  ShieldAlert,
  ShieldCheck,
  ScrollText,
  FileText,
  CheckCircle2,
  XCircle,
  Loader2,
  Zap
} from 'lucide-react'
import Card from '@renderer/components/ui/Card'
import type {
  ClaudeAutoBuildJob,
  ClaudeAutoBuildStatus,
  VerificationStatus
} from '@shared/claudeAutoBuild'
import { useClaudeAutoBuild } from '@renderer/services/claude-auto-build/useClaudeAutoBuild'
import ClaudeRunnerDiagnosticsPanel from './ClaudeRunnerDiagnosticsPanel'

/**
 * Claude 자동 개발 (Jarvis → Claude Code Auto Builder) panel. Create a job from a
 * development command, run it (Electron main spawns Claude Code), and watch the
 * execution log + verification stream in. The renderer never executes shell
 * commands. Inline cards only — no overlays, no modals.
 *
 * The normal (대표/관리자) view keeps only the simple flow — 작업 생성 → 프롬프트
 * 미리보기 → 승인하고 실행 → 실행 로그 → 결과 확인. Queue controls and the runner
 * environment diagnostics are shown only when `advanced` is true (고급 설정 열기).
 */
export default function ClaudeAutoBuildPanel({ advanced = false }: { advanced?: boolean }): JSX.Element {
  const {
    jobs,
    available,
    envReady,
    checking,
    diagnostics,
    checkEnvironment,
    createFromCommand,
    runJob,
    cancelJob,
    queueState,
    setQueueAutoRun,
    pauseQueue,
    resumeQueue,
    runNextQueued,
    cancelQueuedJob
  } = useClaudeAutoBuild()
  const [command, setCommand] = useState('')
  const [busy, setBusy] = useState(false)

  // Auto-check the runner environment once so 승인하고 실행 works without the CEO
  // having to open 고급 설정 first. Read-only fixed checks in the main process.
  useEffect(() => {
    if (available && !diagnostics) void checkEnvironment()
  }, [available, diagnostics, checkEnvironment])

  const activeJob = jobs.find((j) => j.status === 'running' || j.status === 'verifying') ?? null
  const queuedJobs = jobs
    .filter((j) => j.status === 'queued')
    .sort((a, b) => a.queueIndex - b.queueIndex)

  const create = async (): Promise<void> => {
    const text = command.trim()
    if (!text) return
    setBusy(true)
    await createFromCommand(text, 'developer-prompt-center')
    setCommand('')
    setBusy(false)
  }

  return (
    <div className="space-y-5">
      {advanced ? <ClaudeRunnerDiagnosticsPanel /> : null}
      <Card
        title="자비스 자동개발"
        icon={<Bot className="h-4 w-4 text-indigo-300" />}
        action={
          <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-600">
            Claude Code 실제 실행 안전 빌드
          </span>
        }
      >
        <p className="mb-3 text-xs text-slate-500">
          ① 명령 입력 → ② 프롬프트 미리보기 → ③ 승인하고 실행 → ④ 실행 로그 → ⑤ 결과 확인. 개발 명령을 입력하면
          Claude Code 실행용 프롬프트를 자동 생성하고, Electron Main에서 안전하게 실행한 뒤 typecheck / build /
          git status 검증까지 자동으로 수행합니다.
        </p>

        {/* 자동 실행 모드 — 켜면 명령 입력만으로 승인 단계 없이 개발→검증→다음 작업까지 자동으로 흐른다.
            위험 의도가 감지된 명령은 자동 실행에서 제외되어 '승인하고 실행'을 눌러야 한다(메인 프로세스 가드). */}
        {available ? (
          <div className="mb-3 flex items-start justify-between gap-3 rounded-lg border border-indigo-500/20 bg-indigo-500/5 px-3 py-2.5">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-indigo-200">
                <Zap className="h-3.5 w-3.5" />
                자동 실행 모드
              </div>
              <p className="mt-0.5 text-[11px] text-slate-500">
                {queueState?.autoRun
                  ? '켜짐 · 명령을 입력하면 승인 없이 바로 개발 → 검증 → 다음 작업까지 자동으로 진행합니다.'
                  : '꺼짐 · 각 작업마다 "승인하고 실행"을 눌러야 합니다. 켜면 명령만 입력하면 끝까지 자동입니다.'}
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={!!queueState?.autoRun}
              aria-label="자동 실행 모드"
              onClick={() => void setQueueAutoRun(!queueState?.autoRun)}
              className={[
                'relative mt-0.5 h-5 w-9 shrink-0 rounded-full border transition',
                queueState?.autoRun
                  ? 'border-emerald-500/40 bg-emerald-500/30'
                  : 'border-slate-700 bg-slate-800'
              ].join(' ')}
            >
              <span
                className={[
                  'absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white transition-all',
                  queueState?.autoRun ? 'left-[18px]' : 'left-0.5'
                ].join(' ')}
              />
            </button>
          </div>
        ) : null}

        {!available ? (
          <div className="mb-3 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            자비스 자동개발은 PC앱 전용입니다. (데스크톱 앱 · 대표/관리자) Web/PWA에서는 실행할 수 없습니다.
          </div>
        ) : null}

        {/* ① Command input */}
        <div className="mb-2 flex gap-2">
          <input
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void create()
            }}
            placeholder="예: 직원 출퇴근 기능 만들어줘"
            className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-900/50 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:border-blue-500/50 focus:outline-none"
          />
          <button
            type="button"
            onClick={() => void create()}
            disabled={busy || !command.trim()}
            className={[
              'shrink-0 rounded-lg border px-3 py-2 text-sm font-semibold transition',
              busy || !command.trim()
                ? 'cursor-not-allowed border-slate-800 bg-slate-900/40 text-slate-600'
                : 'border-blue-500/40 bg-blue-600 text-white hover:bg-blue-500'
            ].join(' ')}
          >
            작업 생성
          </button>
        </div>

        {/* Compact runner-readiness hint (not a button — full diagnostics live in 고급 설정) */}
        {available ? (
          <div className="mb-4 text-[11px]">
            {envReady ? (
              <span className="inline-flex items-center gap-1 text-emerald-400">
                <ShieldCheck className="h-3 w-3" /> 실행 환경 준비됨
              </span>
            ) : checking || !diagnostics ? (
              <span className="inline-flex items-center gap-1 text-slate-500">
                <Loader2 className="h-3 w-3 animate-spin" /> 실행 환경 확인 중…
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-amber-300">
                <ShieldAlert className="h-3 w-3" /> 실행 환경 준비 안 됨 · 고급 설정에서 실행 환경을 확인하세요.
              </span>
            )}
          </div>
        ) : null}

        {/* Queue controls — advanced only (single writer, one job at a time) */}
        {advanced ? (
          <div className="mb-4 rounded-xl border border-slate-800 bg-slate-950/40 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs font-semibold text-slate-300">Claude 자동개발 큐 (고급)</div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void setQueueAutoRun(!queueState?.autoRun)}
                  className={[
                    'rounded-full border px-2.5 py-1 text-[11px] font-semibold transition',
                    queueState?.autoRun
                      ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                      : 'border-slate-700 bg-slate-800/50 text-slate-400'
                  ].join(' ')}
                >
                  큐 자동 실행: {queueState?.autoRun ? 'ON' : 'OFF'}
                </button>
                {queueState?.paused ? (
                  <button
                    type="button"
                    onClick={() => void resumeQueue()}
                    className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-300 transition hover:bg-emerald-500/20"
                  >
                    큐 재개
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void pauseQueue()}
                    className="rounded-md border border-slate-700 bg-slate-800/50 px-2.5 py-1 text-[11px] font-medium text-slate-300 transition hover:bg-slate-700/60"
                  >
                    큐 일시정지
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void runNextQueued()}
                  disabled={!envReady || !!activeJob || queuedJobs.length === 0}
                  className={[
                    'rounded-md border px-2.5 py-1 text-[11px] font-medium transition',
                    !envReady || !!activeJob || queuedJobs.length === 0
                      ? 'cursor-not-allowed border-slate-800 bg-slate-900/40 text-slate-600'
                      : 'border-indigo-500/30 bg-indigo-500/10 text-indigo-300 hover:bg-indigo-500/20'
                  ].join(' ')}
                >
                  다음 작업 실행
                </button>
              </div>
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500">
              <span>현재 작업: {activeJob ? activeJob.title : '없음'}</span>
              <span>대기: {queuedJobs.length}건</span>
            </div>
            {queueState?.paused && queueState.pausedReason ? (
              <p className="mt-1 text-[11px] text-amber-300">{queueState.pausedReason}</p>
            ) : null}
            <p className="mt-1 text-[10px] text-slate-600">
              같은 작업 폴더에서는 한 번에 하나의 작업만 실행됩니다. 병렬 실행은 git worktree 기반 안정화 후 활성화됩니다.
            </p>
          </div>
        ) : null}

        {jobs.length === 0 ? (
          <p className="py-4 text-center text-sm text-slate-500">아직 자동 개발 작업이 없습니다.</p>
        ) : (
          <div className="space-y-3">
            {jobs.map((job) => (
              <JobCard
                key={job.id}
                job={job}
                envReady={envReady}
                envChecked={!!diagnostics}
                advanced={advanced}
                runnerUnavailable={diagnostics?.selectedRunner === 'unavailable'}
                onRun={() => void runJob(job.id)}
                onCancel={() => void cancelJob(job.id)}
                onCancelQueued={() => void cancelQueuedJob(job.id)}
              />
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}

// --- job card --------------------------------------------------------------

function JobCard({
  job,
  envReady,
  envChecked,
  advanced,
  runnerUnavailable,
  onRun,
  onCancel,
  onCancelQueued
}: {
  job: ClaudeAutoBuildJob
  envReady: boolean
  envChecked: boolean
  advanced: boolean
  runnerUnavailable: boolean
  onRun: () => void
  onCancel: () => void
  onCancelQueued: () => void
}): JSX.Element {
  const [showLogs, setShowLogs] = useState(false)
  const [showPrompt, setShowPrompt] = useState(false)
  const active = job.status === 'running' || job.status === 'verifying'
  const statusRunnable =
    job.status === 'queued' ||
    job.status === 'ready' ||
    job.status === 'needs-review' ||
    job.status === 'failed'
  // Only allow a run when the job is runnable AND the environment is confirmed ready.
  const canRun = statusRunnable && envReady
  const blocked = job.status === 'blocked'
  const isQueued = job.status === 'queued'
  const isRetry = job.status === 'failed' || job.status === 'needs-review'

  return (
    <div className="rounded-xl border border-slate-800 bg-white p-3 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-slate-100">{job.title}</div>
          <div className="mt-0.5 truncate text-[11px] text-slate-500">
            명령: {job.originalUserCommand}
            {isQueued ? ` · 대기 순번 ${job.queueIndex}번 · ${job.conflictGroup}` : ''}
          </div>
        </div>
        <StatusBadge status={job.status} />
      </div>

      {/* Safety */}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {job.safetyResult.workspaceAllowed ? (
          <Chip tone="emerald" icon={<ShieldCheck className="h-3 w-3" />}>작업 폴더 허용</Chip>
        ) : (
          <Chip tone="rose" icon={<ShieldAlert className="h-3 w-3" />}>작업 폴더 불가</Chip>
        )}
        {job.safetyResult.promptSafe ? (
          <Chip tone="emerald" icon={<ShieldCheck className="h-3 w-3" />}>
            {job.safetyResult.allowedSafetyMentions.length > 0 ? '금지 명령 안전 규칙 확인됨' : '안전 검사 통과'}
          </Chip>
        ) : (
          <Chip tone="rose" icon={<ShieldAlert className="h-3 w-3" />}>위험 명령 실행 지시 감지</Chip>
        )}
      </div>
      {blocked && job.safetyResult.blockedReason ? (
        <div className="mt-2 rounded-lg border border-rose-500/20 bg-rose-500/10 px-2.5 py-1.5 text-[11px] text-rose-200">
          {job.safetyResult.blockedReason}
        </div>
      ) : null}

      {/* Actions — 승인하고 실행 · 프롬프트 미리보기 · 실행 로그 보기 · 중지 · 다시 실행 */}
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onRun}
          disabled={!canRun}
          className={[
            'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-medium transition',
            !canRun
              ? 'cursor-not-allowed border-slate-800 bg-slate-900/40 text-slate-600'
              : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20'
          ].join(' ')}
        >
          <Play className="h-3 w-3" />
          {isRetry ? '다시 실행' : '승인하고 실행'}
        </button>
        <button
          type="button"
          onClick={() => setShowPrompt((s) => !s)}
          className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800/50 px-2.5 py-1 text-[11px] font-medium text-slate-300 transition hover:bg-slate-700/60"
        >
          <FileText className="h-3 w-3" />
          {showPrompt ? '프롬프트 숨기기' : '프롬프트 미리보기'}
        </button>
        <button
          type="button"
          onClick={() => setShowLogs((s) => !s)}
          className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800/50 px-2.5 py-1 text-[11px] font-medium text-slate-300 transition hover:bg-slate-700/60"
        >
          <ScrollText className="h-3 w-3" />
          {showLogs ? '실행 로그 숨기기' : '실행 로그 보기'}
        </button>
        {active ? (
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex items-center gap-1.5 rounded-md border border-rose-500/30 bg-rose-500/10 px-2.5 py-1 text-[11px] font-medium text-rose-300 transition hover:bg-rose-500/20"
          >
            <Square className="h-3 w-3" />
            중지
          </button>
        ) : null}
        {advanced && isQueued ? (
          <button
            type="button"
            onClick={onCancelQueued}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800/50 px-2.5 py-1 text-[11px] font-medium text-slate-300 transition hover:bg-slate-700/60"
          >
            <Square className="h-3 w-3" />
            큐에서 취소
          </button>
        ) : null}
        {statusRunnable && !canRun ? (
          <span className="inline-flex items-center text-[11px] text-amber-300">
            {runnerUnavailable
              ? 'Claude Code CLI를 찾을 수 없습니다. Claude Code 설치 또는 npx 실행 환경을 확인해주세요.'
              : envChecked
                ? 'Claude Code 실행 환경이 준비되지 않았습니다.'
                : 'Claude Code 실행 환경을 먼저 확인해주세요.'}
          </span>
        ) : null}
      </div>

      {/* ② Prompt preview */}
      {showPrompt ? (
        <div className="mt-3">
          <div className="mb-1 text-[11px] font-semibold text-slate-500">실행될 프롬프트 미리보기</div>
          <textarea
            readOnly
            value={job.generatedPrompt}
            onFocus={(e) => e.currentTarget.select()}
            className="h-48 w-full resize-y rounded-lg border border-slate-800 bg-slate-950/70 p-3 font-mono text-[10px] leading-5 text-slate-300 outline-none"
          />
        </div>
      ) : null}

      {/* ⑤ Result (verification summary) */}
      {job.status !== 'ready' && job.status !== 'blocked' && job.status !== 'draft' ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          <VerifyChip label="typecheck" status={job.verification.typecheckStatus} />
          <VerifyChip label="build" status={job.verification.buildStatus} />
          {typeof job.exitCode === 'number' ? (
            <Chip tone="slate" icon={null}>exit {job.exitCode}</Chip>
          ) : null}
        </div>
      ) : null}

      {/* ④ Execution log — fixed canonical order + raw stream */}
      {showLogs ? (
        <div className="mt-3 space-y-2">
          <StageGuide job={job} />
          <pre className="max-h-56 overflow-y-auto rounded-lg border border-slate-800 bg-slate-950/70 p-3 font-mono text-[10px] leading-5 text-slate-400">
            {job.logLines.slice(-100).join('\n') || '(로그 없음)'}
          </pre>
          {job.verification.gitStatusShort ? (
            <div>
              <div className="mb-1 text-[11px] font-semibold text-slate-500">git status --short</div>
              <pre className="max-h-32 overflow-y-auto rounded-lg border border-slate-800 bg-slate-950/70 p-2 font-mono text-[10px] text-slate-400">
                {job.verification.gitStatusShort}
              </pre>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

// --- execution-log stage guide (fixed order) -------------------------------

type StageState = 'done' | 'active' | 'failed' | 'pending'

function verifState(status: VerificationStatus): StageState {
  if (status === 'passed') return 'done'
  if (status === 'failed') return 'failed'
  if (status === 'running') return 'active'
  return 'pending'
}

/**
 * The canonical execution-log order the runner (Electron main) actually emits:
 * 작업 생성됨 → 승인됨 → Claude Code 실행 시작 → cwd 확인 → 프롬프트 전달 →
 * Claude Code 완료(exit) → typecheck → build → git status → 완료/실패. Derived from
 * the live job fields (status / logLines / verification) — presentation only.
 */
function computeStages(job: ClaudeAutoBuildJob): { label: string; state: StageState; note?: string }[] {
  const has = (marker: string): boolean => job.logLines.some((l) => l.includes(marker))
  const running = job.status === 'running' || job.status === 'verifying'
  const finished =
    job.status === 'succeeded' ||
    job.status === 'failed' ||
    job.status === 'needs-review' ||
    job.status === 'cancelled' ||
    job.status === 'timed-out'
  const approved = running || finished || has('실행 시작')
  const claudeDone = typeof job.exitCode === 'number'
  const v = job.verification
  return [
    { label: '작업 생성됨', state: 'done' },
    { label: '승인됨', state: approved ? 'done' : 'pending' },
    { label: 'Claude Code 실행 시작', state: has('실행 시작') ? 'done' : running ? 'active' : 'pending' },
    { label: 'cwd 확인', state: has('작업 폴더(cwd)') ? 'done' : 'pending' },
    { label: '프롬프트 전달', state: has('프롬프트 전달') ? 'done' : 'pending' },
    {
      label: 'Claude Code 완료',
      state: claudeDone ? (job.exitCode === 0 ? 'done' : 'failed') : running ? 'active' : 'pending',
      note: claudeDone ? `exit ${job.exitCode}` : undefined
    },
    { label: 'typecheck', state: verifState(v.typecheckStatus), note: v.typecheckStatus },
    { label: 'build', state: verifState(v.buildStatus), note: v.buildStatus },
    { label: 'git status', state: v.gitStatusShort ? 'done' : has('git status --short') ? 'active' : 'pending' },
    {
      label: job.status === 'succeeded' ? '완료' : finished ? '실패 / 검토 필요' : '완료',
      state: job.status === 'succeeded' ? 'done' : finished ? 'failed' : 'pending'
    }
  ]
}

function StageIcon({ state }: { state: StageState }): JSX.Element {
  if (state === 'done') return <CheckCircle2 className="h-3 w-3 text-emerald-400" />
  if (state === 'failed') return <XCircle className="h-3 w-3 text-rose-400" />
  if (state === 'active') return <Loader2 className="h-3 w-3 animate-spin text-amber-400" />
  return <span className="inline-block h-3 w-3 rounded-full border border-slate-600" />
}

function StageGuide({ job }: { job: ClaudeAutoBuildJob }): JSX.Element {
  const stages = computeStages(job)
  return (
    <ol className="space-y-1 rounded-lg border border-slate-800 bg-slate-950/40 p-2.5">
      {stages.map((s, i) => (
        <li key={s.label} className="flex items-center gap-2 text-[11px]">
          <span className="w-4 shrink-0 text-right font-mono text-slate-600">{i + 1}</span>
          <StageIcon state={s.state} />
          <span
            className={[
              s.state === 'pending' ? 'text-slate-500' : 'text-slate-300',
              s.state === 'failed' ? 'text-rose-300' : ''
            ].join(' ')}
          >
            {s.label}
          </span>
          {s.note ? <span className="font-mono text-[10px] text-slate-500">· {s.note}</span> : null}
        </li>
      ))}
    </ol>
  )
}

// --- small ui helpers ------------------------------------------------------

type Tone = 'emerald' | 'amber' | 'rose' | 'indigo' | 'slate'
const TONES: Record<Tone, string> = {
  emerald: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  amber: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  rose: 'border-rose-500/30 bg-rose-500/10 text-rose-300',
  indigo: 'border-indigo-500/30 bg-indigo-500/10 text-indigo-300',
  slate: 'border-slate-700 bg-slate-800/60 text-slate-400'
}

function Chip({ tone, icon, children }: { tone: Tone; icon: ReactNode; children: ReactNode }): JSX.Element {
  return (
    <span className={['inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold', TONES[tone]].join(' ')}>
      {icon}
      {children}
    </span>
  )
}

const STATUS_LABEL: Record<ClaudeAutoBuildStatus, { text: string; tone: Tone }> = {
  draft: { text: '초안', tone: 'slate' },
  'prompt-generated': { text: '프롬프트 생성', tone: 'slate' },
  'safety-checking': { text: '안전 검사 중', tone: 'amber' },
  blocked: { text: '차단됨', tone: 'rose' },
  ready: { text: '실행 준비', tone: 'indigo' },
  queued: { text: '대기 중', tone: 'slate' },
  running: { text: '실행 중', tone: 'indigo' },
  verifying: { text: '검증 중', tone: 'amber' },
  succeeded: { text: '완료', tone: 'emerald' },
  failed: { text: '실패', tone: 'rose' },
  cancelled: { text: '취소됨', tone: 'slate' },
  'timed-out': { text: '시간 초과', tone: 'rose' },
  'needs-review': { text: '검토 필요', tone: 'amber' },
  skipped: { text: '건너뜀', tone: 'slate' }
}

function StatusBadge({ status }: { status: ClaudeAutoBuildStatus }): JSX.Element {
  const s = STATUS_LABEL[status]
  const spinning = status === 'running' || status === 'verifying'
  return (
    <span className={['inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold', TONES[s.tone]].join(' ')}>
      {spinning ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
      {s.text}
    </span>
  )
}

function VerifyChip({ label, status }: { label: string; status: VerificationStatus }): JSX.Element {
  const map: Record<VerificationStatus, { tone: Tone; icon: ReactNode }> = {
    pending: { tone: 'slate', icon: null },
    running: { tone: 'amber', icon: <Loader2 className="h-3 w-3 animate-spin" /> },
    passed: { tone: 'emerald', icon: <CheckCircle2 className="h-3 w-3" /> },
    failed: { tone: 'rose', icon: <XCircle className="h-3 w-3" /> },
    skipped: { tone: 'slate', icon: null }
  }
  const m = map[status]
  return (
    <Chip tone={m.tone} icon={m.icon}>
      {label}: {status}
    </Chip>
  )
}
