import { type ReactNode } from 'react'
import {
  Rocket,
  Play,
  StepForward,
  Pause,
  Square,
  RotateCcw,
  Download,
  ShieldOff,
  Activity,
  ListChecks,
  AlertTriangle,
  AlertCircle,
  ArrowRight,
  Building2,
  User,
  CheckCircle2,
  Circle,
  Loader2,
  Ban,
  Boxes
} from 'lucide-react'
import Card from '@renderer/components/ui/Card'
import ProgressBar from '@renderer/components/ui/ProgressBar'
import { useAutopilot } from '@renderer/services/autopilot/useAutopilot'
import { autopilotService } from '@renderer/services/autopilot/AutopilotService'
import { useUniversalBuilder } from '@renderer/services/universal-builder/useUniversalBuilder'
import { universalBuilderRepository } from '@renderer/services/universal-builder/UniversalBuilderRepository'
import { useNavigation } from '@renderer/navigation/NavigationContext'
import type {
  AutopilotState,
  AutopilotStatus,
  AutopilotStepStatus,
  AutopilotTimelineEntry
} from '@renderer/services/autopilot/types'

// --- styling helpers -------------------------------------------------------

const STATUS_TONE: Record<AutopilotStatus, { dot: string; text: string; label: string }> = {
  idle: { dot: 'bg-slate-500', text: 'text-slate-300', label: '대기 중' },
  running: { dot: 'bg-emerald-400', text: 'text-emerald-300', label: '실행 중' },
  paused: { dot: 'bg-amber-400', text: 'text-amber-300', label: '일시정지됨' },
  blocked: { dot: 'bg-rose-400', text: 'text-rose-300', label: '차단됨' },
  'waiting-for-approval': { dot: 'bg-amber-400', text: 'text-amber-300', label: '승인 대기 중' },
  completed: { dot: 'bg-emerald-400', text: 'text-emerald-300', label: '완료' },
  failed: { dot: 'bg-rose-400', text: 'text-rose-300', label: '실패' }
}

const STEP_ICON: Record<AutopilotStepStatus, ReactNode> = {
  pending: <Circle className="h-3.5 w-3.5 text-slate-600" />,
  active: <Loader2 className="h-3.5 w-3.5 animate-spin text-emerald-300" />,
  done: <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />,
  blocked: <Ban className="h-3.5 w-3.5 text-rose-400" />,
  skipped: <Circle className="h-3.5 w-3.5 text-slate-700" />
}

function progressTone(value: number): string {
  if (value >= 80) return 'text-emerald-300'
  if (value >= 50) return 'text-amber-300'
  return 'text-rose-300'
}

function formatTimestamp(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString()
}

/** Trigger a client-side download of the current run as JSON. */
function exportReport(): void {
  const json = autopilotService.serializeReport()
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = 'autopilot-report.json'
  anchor.click()
  URL.revokeObjectURL(url)
}

/**
 * Autopilot — the AI Company Operating Loop. Reads the operating-loop state (via
 * useAutopilot) and drives it through autopilotService. The loop walks the whole
 * company one safe, local step at a time: Approval Center → PM Planner →
 * Development OS → Worker Memory → CTO Room → QA → Release → DevOps → Live
 * Company. No business logic lives in this component.
 */
export default function AutopilotPage(): JSX.Element {
  const state = useAutopilot()
  // Subscribe to the Universal Builder queue so the pending count stays live.
  useUniversalBuilder()
  const buildSummary = universalBuilderRepository.getSummary()
  const { navigate } = useNavigation()
  const tone = STATUS_TONE[state.status]

  const running = state.status === 'running'
  const paused = state.status === 'paused'
  const active = running || state.status === 'waiting-for-approval' || state.status === 'blocked'
  const canStep = active
  const activeStep = markActiveStep(state)

  const handleReset = (): void => {
    if (
      typeof window !== 'undefined' &&
      !window.confirm('오토파일럿 실행을 초기화할까요? 다른 모듈은 그대로 유지됩니다.')
    ) {
      return
    }
    autopilotService.resetDemoState()
  }

  return (
    <div className="space-y-5">
      {/* Operating-loop header + controls */}
      <Card
        title="오토파일럿 — 운영 루프"
        icon={<Rocket className="h-4 w-4" />}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <ActionButton icon={<Play className="h-4 w-4" />} variant="primary" onClick={() => autopilotService.start()}>
              회사 시작
            </ActionButton>
            <ActionButton icon={<StepForward className="h-4 w-4" />} onClick={() => autopilotService.runStep()} disabled={!canStep}>
              한 단계 실행
            </ActionButton>
            {paused ? (
              <ActionButton icon={<Play className="h-4 w-4" />} onClick={() => autopilotService.resume()}>
                재개
              </ActionButton>
            ) : (
              <ActionButton icon={<Pause className="h-4 w-4" />} onClick={() => autopilotService.pause()} disabled={!active}>
                일시정지
              </ActionButton>
            )}
            <ActionButton icon={<Square className="h-4 w-4" />} onClick={() => autopilotService.stop()} disabled={state.status === 'idle'}>
              중지
            </ActionButton>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className={['h-2.5 w-2.5 rounded-full', tone.dot, active ? 'animate-pulse' : ''].join(' ')} />
              <div>
                <div className="text-xs text-slate-500">운영 루프 상태</div>
                <div className={['text-lg font-semibold', tone.text].join(' ')}>{tone.label}</div>
              </div>
            </div>
            <div className="text-xs text-slate-500">
              {state.autopilotRunId ? `실행 ${state.autopilotRunId}` : '아직 실행 없음'} · 단계 {state.currentStep}/9 · 업데이트{' '}
              {formatTimestamp(state.updatedAt)}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>운영 루프 진행률</span>
              <span className={progressTone(state.progress)}>{state.progress}%</span>
            </div>
            <div className="mt-1">
              <ProgressBar value={state.progress} />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Tile icon={<Building2 className="h-4 w-4" />} label="현재 부서" value={state.currentDepartment} />
            <Tile icon={<User className="h-4 w-4" />} label="현재 워커" value={state.currentWorker} />
            <Tile icon={<Activity className="h-4 w-4" />} label="현재 작업" value={state.currentAction} />
            <Tile icon={<ArrowRight className="h-4 w-4" />} label="다음 작업" value={state.nextAction} />
          </div>
        </div>
      </Card>

      {/* Quick actions */}
      <Card title="빠른 작업" icon={<ListChecks className="h-4 w-4" />}>
        <div className="flex flex-wrap items-center gap-2">
          <ActionButton icon={<Play className="h-4 w-4" />} variant="primary" onClick={() => autopilotService.start()}>
            회사 시작
          </ActionButton>
          <ActionButton icon={<StepForward className="h-4 w-4" />} onClick={() => autopilotService.runStep()} disabled={!canStep}>
            루프 한 단계 실행
          </ActionButton>
          <ActionButton icon={<Pause className="h-4 w-4" />} onClick={() => autopilotService.pause()} disabled={!active}>
            루프 일시정지
          </ActionButton>
          <ActionButton icon={<Play className="h-4 w-4" />} onClick={() => autopilotService.resume()} disabled={!paused}>
            루프 재개
          </ActionButton>
          <ActionButton icon={<Square className="h-4 w-4" />} onClick={() => autopilotService.stop()} disabled={state.status === 'idle'}>
            루프 중지
          </ActionButton>
          <ActionButton icon={<ShieldOff className="h-4 w-4" />} onClick={() => autopilotService.clearBlocker()} disabled={state.blockers.length === 0}>
            오토파일럿 블로커 해제
          </ActionButton>
          <ActionButton icon={<Download className="h-4 w-4" />} onClick={exportReport}>
            오토파일럿 리포트 JSON 내보내기
          </ActionButton>
          <ActionButton icon={<RotateCcw className="h-4 w-4" />} variant="danger" onClick={handleReset}>
            오토파일럿 데모 상태 초기화
          </ActionButton>
        </div>
      </Card>

      {/* Universal App Builder queue — read-through count (no code edits here) */}
      <Card
        title="범용 앱 빌더 대기열"
        icon={<Boxes className="h-4 w-4" />}
        action={
          <button
            type="button"
            onClick={() => navigate({ name: 'app-builder' })}
            className="inline-flex items-center gap-1.5 rounded-lg border border-violet-500/30 bg-violet-500/10 px-3 py-1.5 text-xs font-medium text-violet-300 transition hover:bg-violet-500/20"
          >
            <ArrowRight className="h-3.5 w-3.5" />
            앱 빌더 열기
          </button>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Tile icon={<Boxes className="h-4 w-4" />} label="대기 중인 빌드 프로젝트" value={String(buildSummary.pending)} />
          <Tile icon={<AlertCircle className="h-4 w-4" />} label="승인 필요" value={String(buildSummary.needsApproval)} />
          <Tile icon={<ListChecks className="h-4 w-4" />} label="프롬프트 생성됨" value={String(buildSummary.promptGenerated)} />
          <Tile icon={<CheckCircle2 className="h-4 w-4" />} label="전체 프로젝트" value={String(buildSummary.total)} />
        </div>
        <p className="mt-3 text-xs text-slate-500">
          Autopilot는 이번 스프린트에서 앱 빌드 프로젝트의 대기 현황만 표시합니다(읽기 전용). 코드를 직접
          수정하거나 프로젝트를 자동 승격하지 않습니다.
        </p>
      </Card>

      {/* Blockers + warnings */}
      <div className="grid gap-5 lg:grid-cols-2">
        <Card
          title="블로커"
          icon={<AlertTriangle className="h-4 w-4" />}
          action={<span className="text-xs text-slate-500">{state.blockers.length}개 열림</span>}
        >
          {state.blockers.length === 0 ? (
            <p className="text-sm text-emerald-300/80">블로커 없음 — 루프가 진행할 준비가 되었습니다.</p>
          ) : (
            <ul className="space-y-1">
              {state.blockers.map((b, i) => (
                <li
                  key={i}
                  className="flex items-start gap-2 rounded-md border border-rose-500/20 bg-rose-500/10 px-2.5 py-1.5 text-xs text-rose-200"
                >
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {b}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card
          title="경고"
          icon={<AlertCircle className="h-4 w-4" />}
          action={<span className="text-xs text-slate-500">{state.warnings.length}건 기록됨</span>}
        >
          {state.warnings.length === 0 ? (
            <p className="text-sm text-slate-500">이번 실행에서 발생한 경고가 없습니다.</p>
          ) : (
            <ul className="space-y-1">
              {state.warnings.map((w, i) => (
                <li
                  key={i}
                  className="flex items-start gap-2 rounded-md border border-amber-500/20 bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-200"
                >
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {w}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* Step-by-step timeline */}
      <Card
        title="운영 루프 타임라인"
        icon={<ListChecks className="h-4 w-4" />}
        action={<span className="text-xs text-slate-500">{state.currentStep}/9 단계</span>}
      >
        {activeStep.length === 0 ? (
          <p className="text-sm text-slate-500">
            아직 실행이 없습니다. <span className="text-slate-300">회사 시작</span>을 눌러 운영 루프를 진행하세요.
          </p>
        ) : (
          <ol className="space-y-2">
            {activeStep.map((entry) => (
              <TimelineRow key={entry.step} entry={entry} />
            ))}
          </ol>
        )}
      </Card>

      {/* Live activity log */}
      <Card
        title="실시간 활동 로그"
        icon={<Activity className="h-4 w-4" />}
        action={<span className="text-xs text-slate-500">이벤트 {state.activity.length}건</span>}
      >
        {state.activity.length === 0 ? (
          <p className="text-sm text-slate-500">조용합니다. 회사를 시작하면 운영 루프가 움직이는 것을 볼 수 있습니다.</p>
        ) : (
          <ol className="max-h-[24rem] space-y-2 overflow-y-auto pr-1">
            {state.activity.map((entry) => (
              <li
                key={entry.id}
                className="flex items-start justify-between gap-3 rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2"
              >
                <div className="truncate text-sm text-slate-300">{entry.message}</div>
                <span className="shrink-0 text-xs text-slate-600">{formatTimestamp(entry.createdAt)}</span>
              </li>
            ))}
          </ol>
        )}
      </Card>
    </div>
  )
}

/** Mark the current step 'active' in a copy of the timeline for display. */
function markActiveStep(state: AutopilotState): AutopilotTimelineEntry[] {
  if (state.timeline.length === 0) return []
  const showActive = state.status === 'running' || state.status === 'paused'
  return state.timeline.map((entry) =>
    showActive && entry.step === state.currentStep + 1 && entry.status === 'pending'
      ? { ...entry, status: 'active' as AutopilotStepStatus }
      : entry
  )
}

// --- timeline row ----------------------------------------------------------

function TimelineRow({ entry }: { entry: AutopilotTimelineEntry }): JSX.Element {
  return (
    <li className="flex items-start gap-3 rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2">
      <span className="mt-0.5">{STEP_ICON[entry.status]}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm font-medium text-slate-100">
            {entry.step}. {entry.title}
          </div>
          <span className="shrink-0 text-[11px] text-slate-500">{entry.department}</span>
        </div>
        {entry.detail ? <div className="mt-0.5 truncate text-xs text-slate-400">{entry.detail}</div> : null}
      </div>
    </li>
  )
}

// --- presentational helpers ------------------------------------------------

function Tile({ icon, label, value }: { icon: ReactNode; label: string; value: string }): JSX.Element {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-xs text-slate-500">
        <span className="text-slate-400">{icon}</span>
        {label}
      </div>
      <div className="mt-1 text-sm text-slate-200">{value}</div>
    </div>
  )
}

type ButtonVariant = 'default' | 'primary' | 'danger'

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  default: 'border-slate-700 bg-slate-800/60 text-slate-200 hover:bg-slate-700/60',
  primary: 'border-indigo-500/30 bg-indigo-500/15 text-indigo-200 hover:bg-indigo-500/25',
  danger: 'border-rose-500/30 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20'
}

function ActionButton({
  children,
  onClick,
  icon,
  variant = 'default',
  disabled = false
}: {
  children: ReactNode
  onClick: () => void
  icon?: ReactNode
  variant?: ButtonVariant
  disabled?: boolean
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={[
        'inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium transition',
        BUTTON_VARIANTS[variant],
        disabled ? 'cursor-not-allowed opacity-40' : ''
      ].join(' ')}
    >
      {icon}
      {children}
    </button>
  )
}
