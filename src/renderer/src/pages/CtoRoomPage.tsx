import { useMemo, useState, type ReactNode } from 'react'
import {
  ShieldCheck,
  Activity,
  Gauge,
  Rocket,
  AlertTriangle,
  Wrench,
  ShieldAlert,
  Lock,
  ListTree,
  Download,
  RotateCcw,
  CheckCheck,
  Plus,
  History,
  GitBranch,
  ClipboardCheck,
  Server,
  Layers,
  KanbanSquare
} from 'lucide-react'
import Card from '@renderer/components/ui/Card'
import { useCto } from '@renderer/services/cto/useCto'
import { ctoRepository } from '@renderer/services/cto/CtoRepository'
import { usePm } from '@renderer/services/pm/usePm'
import { useDeveloperPrompt } from '@renderer/services/developer-prompt/useDeveloperPrompt'
import { developerPromptRepository } from '@renderer/services/developer-prompt/DeveloperPromptRepository'
import type {
  CtoLikelihood,
  CtoLogType,
  CtoPriority,
  CtoSeverity,
  CtoSignal,
  ReleaseReadinessLevel
} from '@renderer/services/cto/types'

// --- shared styling maps ---------------------------------------------------

const SEVERITY_STYLES: Record<CtoSeverity, string> = {
  critical: 'border-rose-500/40 bg-rose-500/15 text-rose-200',
  high: 'border-rose-500/30 bg-rose-500/10 text-rose-300',
  medium: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  low: 'border-sky-500/30 bg-sky-500/10 text-sky-300'
}

const PRIORITY_STYLES: Record<CtoPriority, string> = {
  P0: 'border-rose-500/30 bg-rose-500/10 text-rose-300',
  P1: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  P2: 'border-sky-500/30 bg-sky-500/10 text-sky-300',
  P3: 'border-slate-600/40 bg-slate-700/20 text-slate-300'
}

const SIGNAL_STYLES: Record<CtoSignal, string> = {
  green: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  yellow: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  red: 'border-rose-500/30 bg-rose-500/10 text-rose-300'
}

const SIGNAL_LABELS: Record<CtoSignal, string> = {
  green: '양호',
  yellow: '주의',
  red: '위험'
}

const RELEASE_STYLES: Record<ReleaseReadinessLevel, { label: string; className: string }> = {
  ready: { label: '준비됨', className: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' },
  at_risk: { label: '위험', className: 'border-amber-500/30 bg-amber-500/10 text-amber-300' },
  not_ready: { label: '준비 안 됨', className: 'border-rose-500/30 bg-rose-500/10 text-rose-300' }
}

const LOG_STYLES: Record<CtoLogType, { label: string; className: string }> = {
  'debt-added': { label: '부채 추가', className: 'text-amber-300' },
  'debt-resolved': { label: '부채 해결', className: 'text-emerald-300' },
  'risk-added': { label: '위험 추가', className: 'text-rose-300' },
  'risk-mitigated': { label: '위험 완화', className: 'text-emerald-300' },
  'decision-blocked': { label: '의사결정 차단', className: 'text-rose-300' },
  'decision-cleared': { label: '의사결정 해제', className: 'text-emerald-300' },
  'priority-promoted': { label: '우선순위 승격', className: 'text-indigo-300' },
  reset: { label: '초기화', className: 'text-amber-300' }
}

const SEVERITIES: CtoSeverity[] = ['low', 'medium', 'high', 'critical']
const LIKELIHOODS: CtoLikelihood[] = ['low', 'medium', 'high']

function formatTimestamp(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString()
}

/** Colour the architecture health score by band. */
function scoreClass(score: number): string {
  if (score >= 80) return 'text-emerald-300'
  if (score >= 60) return 'text-amber-300'
  return 'text-rose-300'
}

/** Trigger a client-side download of the current CTO Room as JSON. */
function exportReport(): void {
  const json = ctoRepository.serializeSnapshot()
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = 'cto-report.json'
  anchor.click()
  URL.revokeObjectURL(url)
}

/**
 * CTO Room view. Reads the persisted CTO state from the cto repository (via
 * useCto) and summarises technical health, sprint direction, debt, risks,
 * blocked decisions, next priorities, and QA / DevOps / release readiness. It
 * also summarises the live PM Planner plan (via usePm). All mutations delegate
 * to ctoRepository — no business logic in the component.
 */
export default function CtoRoomPage(): JSX.Element {
  const cto = useCto()
  const pm = usePm()

  const pmSummary = useMemo(
    () => ({
      backlogItems: pm.backlogItems.length,
      activeEpics: pm.epics.filter((e) => e.status === 'in_progress').length,
      openTasks: pm.tasks.filter((t) => t.status !== 'completed').length,
      blockedTasks: pm.tasks.filter((t) => t.status === 'blocked').length,
      completedTasks: pm.tasks.filter((t) => t.status === 'completed').length
    }),
    [pm]
  )

  const openDebt = cto.technicalDebtItems.filter((d) => d.status === 'open').length
  const openRisks = cto.riskItems.filter((r) => r.status === 'open').length
  const openDecisions = cto.blockedDecisions.filter((d) => d.status === 'blocked').length

  // Developer Prompt Center risk read-through (subscribe keeps counts live).
  useDeveloperPrompt()
  const promptSummary = developerPromptRepository.getSummary()

  const handleReset = (): void => {
    if (typeof window !== 'undefined' && !window.confirm('CTO 룸을 초기 값으로 되돌릴까요?')) {
      return
    }
    ctoRepository.resetDemoState()
  }

  return (
    <div className="space-y-5">
      {/* Header + executive summary */}
      <Card
        title="CTO 룸"
        icon={<ShieldCheck className="h-4 w-4" />}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <ActionButton icon={<Download className="h-4 w-4" />} onClick={exportReport}>
              CTO 리포트 내보내기
            </ActionButton>
            <ActionButton variant="danger" icon={<RotateCcw className="h-4 w-4" />} onClick={handleReset}>
              데모 상태 초기화
            </ActionButton>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-4">
            <div className="rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-3">
              <div className="flex items-center gap-1.5 text-xs text-slate-500">
                <Gauge className="h-4 w-4 text-slate-400" />
                아키텍처 상태
              </div>
              <div className={['mt-1 text-2xl font-semibold', scoreClass(cto.architectureHealth.score)].join(' ')}>
                {cto.architectureHealth.score}
                <span className="text-sm text-slate-500">/100</span>
              </div>
            </div>
            <StatTile icon={<Wrench className="h-4 w-4" />} label="미해결 부채" value={openDebt} />
            <StatTile icon={<ShieldAlert className="h-4 w-4" />} label="미해결 위험" value={openRisks} />
            <StatTile icon={<Lock className="h-4 w-4" />} label="차단된 의사결정" value={openDecisions} />
          </div>

          <div>
            <SectionLabel>기술 총평</SectionLabel>
            <p className="mt-1 text-sm leading-relaxed text-slate-300">{cto.architectureHealth.summary}</p>
          </div>

          <div className="text-xs text-slate-500">최근 CTO 리뷰: {formatTimestamp(cto.lastReviewAt)}</div>
        </div>
      </Card>

      {/* Current sprint + active work */}
      <Card title="현재 스프린트" icon={<Activity className="h-4 w-4" />}>
        <div className="grid gap-3 sm:grid-cols-2">
          <StatTile icon={<Rocket className="h-4 w-4" />} label="스프린트" value={cto.currentSprint} />
          <StatTile icon={<Layers className="h-4 w-4" />} label="활성 에픽" value={cto.activeEpic} />
          <StatTile icon={<GitBranch className="h-4 w-4" />} label="활성 기능" value={cto.activeFeature} />
          <StatTile icon={<ListTree className="h-4 w-4" />} label="활성 작업" value={cto.activeTask} />
        </div>
      </Card>

      {/* Architecture health detail */}
      <Card title="아키텍처 상태" icon={<Gauge className="h-4 w-4" />}>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <SectionLabel>강점</SectionLabel>
            <BulletList items={cto.architectureHealth.strengths} tone="good" />
          </div>
          <div>
            <SectionLabel>우려 사항</SectionLabel>
            <BulletList items={cto.architectureHealth.concerns} tone="warn" />
          </div>
        </div>
      </Card>

      {/* QA / DevOps / Release readiness */}
      <div className="grid gap-5 lg:grid-cols-3">
        <Card title="QA 상태" icon={<ClipboardCheck className="h-4 w-4" />}>
          <div className="space-y-3">
            <SignalBadge signal={cto.qaStatus.signal} />
            <p className="text-sm text-slate-300">{cto.qaStatus.summary}</p>
            <div className="flex flex-wrap gap-4 text-xs text-slate-500">
              <span>
                검사: {cto.qaStatus.passingChecks}/{cto.qaStatus.totalChecks} 통과
              </span>
              <span>미해결 이슈: {cto.qaStatus.openIssues}</span>
            </div>
          </div>
        </Card>

        <Card title="DevOps 상태" icon={<Server className="h-4 w-4" />}>
          <div className="space-y-3">
            <SignalBadge signal={cto.devOpsStatus.signal} />
            <p className="text-sm text-slate-300">{cto.devOpsStatus.summary}</p>
            <div className="space-y-1 text-xs text-slate-500">
              <div>타입체크: {cto.devOpsStatus.typecheckPassing ? '통과' : '실패'}</div>
              <div>빌드: {cto.devOpsStatus.buildPassing ? '통과' : '실패'}</div>
              <div>파이프라인: {cto.devOpsStatus.pipeline}</div>
              <div>최근 배포: {cto.devOpsStatus.lastDeploy}</div>
            </div>
          </div>
        </Card>

        <Card title="릴리즈 준비도" icon={<Rocket className="h-4 w-4" />}>
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <ReleaseBadge level={cto.releaseReadiness.level} />
              <span className="text-xs text-slate-500">{cto.releaseReadiness.score}/100</span>
            </div>
            <p className="text-sm text-slate-300">{cto.releaseReadiness.summary}</p>
            <ul className="space-y-1">
              {cto.releaseReadiness.checklist.map((c, i) => (
                <li key={i} className="flex items-center gap-2 text-xs">
                  <span
                    className={[
                      'inline-flex h-4 w-4 items-center justify-center rounded-full border text-[10px]',
                      c.done
                        ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                        : 'border-slate-700 bg-slate-800/40 text-slate-600'
                    ].join(' ')}
                  >
                    {c.done ? '✓' : ''}
                  </span>
                  <span className={c.done ? 'text-slate-400' : 'text-slate-300'}>{c.label}</span>
                </li>
              ))}
            </ul>
          </div>
        </Card>
      </div>

      {/* PM Planner summary */}
      <Card
        title="PM 플래너 요약"
        icon={<KanbanSquare className="h-4 w-4" />}
        action={<span className="text-xs text-slate-500">PM 플래너 실시간</span>}
      >
        <div className="grid gap-3 sm:grid-cols-5">
          <StatTile icon={<ClipboardCheck className="h-4 w-4" />} label="백로그 항목" value={pmSummary.backlogItems} />
          <StatTile icon={<Layers className="h-4 w-4" />} label="활성 에픽" value={pmSummary.activeEpics} />
          <StatTile icon={<ListTree className="h-4 w-4" />} label="열린 작업" value={pmSummary.openTasks} />
          <StatTile icon={<AlertTriangle className="h-4 w-4" />} label="차단된 작업" value={pmSummary.blockedTasks} />
          <StatTile icon={<CheckCheck className="h-4 w-4" />} label="완료된 작업" value={pmSummary.completedTasks} />
        </div>
      </Card>

      {/* Developer Prompt Center risk summary */}
      <Card
        title="개발 프롬프트 위험 요약"
        icon={<ShieldAlert className="h-4 w-4" />}
        action={<span className="text-xs text-slate-500">프롬프트 센터 실시간</span>}
      >
        <div className="grid gap-3 sm:grid-cols-4">
          <StatTile icon={<ShieldAlert className="h-4 w-4" />} label="고위험 프롬프트" value={promptSummary.highRisk} />
          <StatTile icon={<ListTree className="h-4 w-4" />} label="개발 중" value={promptSummary.inDevelopment} />
          <StatTile icon={<AlertTriangle className="h-4 w-4" />} label="차단됨" value={promptSummary.blocked} />
          <StatTile icon={<CheckCheck className="h-4 w-4" />} label="완료" value={promptSummary.completed} />
        </div>
      </Card>

      {/* Next priorities */}
      <Card
        title="다음 CTO 우선순위"
        icon={<Rocket className="h-4 w-4" />}
        action={<span className="text-xs text-slate-500">{cto.nextPriorities.length}건 대기</span>}
      >
        {cto.nextPriorities.length === 0 ? (
          <p className="text-sm text-slate-500">대기 중인 우선순위가 없습니다. PM 플래너에서 작업을 승격하거나 추가하세요.</p>
        ) : (
          <div className="space-y-3">
            {cto.nextPriorities.map((p) => (
              <div key={p.id} className="rounded-lg border border-slate-800 bg-slate-900/40 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <PriorityBadge priority={p.priority} />
                    <span className="text-sm font-medium text-slate-100">{p.title}</span>
                  </div>
                  <ActionButton
                    icon={<Rocket className="h-4 w-4" />}
                    variant="primary"
                    onClick={() => ctoRepository.promoteNextPriority(p.id)}
                  >
                    활성화로 승격
                  </ActionButton>
                </div>
                <p className="mt-2 text-sm text-slate-400">{p.rationale}</p>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                  <span>에픽: {p.epic}</span>
                  <span>기능: {p.feature}</span>
                  <span>작업: {p.task}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Technical debt */}
      <Card
        title="기술 부채"
        icon={<Wrench className="h-4 w-4" />}
        action={<span className="text-xs text-slate-500">{openDebt}건 미해결</span>}
      >
        <div className="space-y-3">
          <AddDebtForm />
          {cto.technicalDebtItems.length === 0 ? (
            <p className="text-sm text-slate-500">추적 중인 기술 부채가 없습니다.</p>
          ) : (
            cto.technicalDebtItems.map((item) => (
              <div
                key={item.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2.5"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <Wrench className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                  <span
                    className={[
                      'truncate text-sm',
                      item.status === 'resolved' ? 'text-slate-500 line-through' : 'text-slate-200'
                    ].join(' ')}
                  >
                    {item.title}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Chip>{item.area}</Chip>
                  <SeverityBadge severity={item.severity} />
                  {item.status === 'resolved' ? (
                    <Chip tone="good">해결됨</Chip>
                  ) : (
                    <MiniButton
                      icon={<CheckCheck className="h-3 w-3" />}
                      onClick={() => ctoRepository.resolveTechnicalDebt(item.id)}
                    >
                      해결
                    </MiniButton>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </Card>

      {/* Risks */}
      <Card
        title="기술 위험"
        icon={<ShieldAlert className="h-4 w-4" />}
        action={<span className="text-xs text-slate-500">{openRisks}건 미해결</span>}
      >
        <div className="space-y-3">
          <AddRiskForm />
          {cto.riskItems.length === 0 ? (
            <p className="text-sm text-slate-500">추적 중인 위험이 없습니다.</p>
          ) : (
            cto.riskItems.map((risk) => (
              <div key={risk.id} className="rounded-lg border border-slate-800 bg-slate-900/40 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <ShieldAlert className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                    <span
                      className={[
                        'text-sm',
                        risk.status === 'mitigated' ? 'text-slate-500 line-through' : 'text-slate-200'
                      ].join(' ')}
                    >
                      {risk.title}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Chip>{risk.area}</Chip>
                    <SeverityBadge severity={risk.severity} />
                    <Chip>가능성: {risk.likelihood}</Chip>
                    {risk.status === 'mitigated' ? (
                      <Chip tone="good">완화됨</Chip>
                    ) : (
                      <MiniButton
                        icon={<CheckCheck className="h-3 w-3" />}
                        onClick={() => ctoRepository.mitigateRisk(risk.id)}
                      >
                        완화
                      </MiniButton>
                    )}
                  </div>
                </div>
                <p className="mt-2 text-xs text-slate-400">
                  <span className="text-slate-500">완화 방안: </span>
                  {risk.mitigation}
                </p>
              </div>
            ))
          )}
        </div>
      </Card>

      {/* Blocked decisions */}
      <Card
        title="차단된 의사결정"
        icon={<Lock className="h-4 w-4" />}
        action={<span className="text-xs text-slate-500">{openDecisions}건 대기</span>}
      >
        <div className="space-y-3">
          <AddDecisionForm />
          {cto.blockedDecisions.length === 0 ? (
            <p className="text-sm text-slate-500">차단된 의사결정이 없습니다.</p>
          ) : (
            cto.blockedDecisions.map((decision) => (
              <div key={decision.id} className="rounded-lg border border-slate-800 bg-slate-900/40 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <Lock className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                    <span
                      className={[
                        'text-sm',
                        decision.status === 'cleared' ? 'text-slate-500 line-through' : 'text-slate-200'
                      ].join(' ')}
                    >
                      {decision.title}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Chip>담당자: {decision.owner}</Chip>
                    {decision.status === 'cleared' ? (
                      <Chip tone="good">해제됨</Chip>
                    ) : (
                      <MiniButton
                        icon={<CheckCheck className="h-3 w-3" />}
                        onClick={() => ctoRepository.clearBlockedDecision(decision.id)}
                      >
                        해제
                      </MiniButton>
                    )}
                  </div>
                </div>
                {decision.context ? <p className="mt-2 text-xs text-slate-400">{decision.context}</p> : null}
              </div>
            ))
          )}
        </div>
      </Card>

      {/* Event log */}
      <Card
        title="CTO 룸 이벤트 로그"
        icon={<History className="h-4 w-4" />}
        action={<span className="text-xs text-slate-500">이벤트 {cto.eventLog.length}건</span>}
      >
        {cto.eventLog.length === 0 ? (
          <p className="text-sm text-slate-500">아직 이벤트가 없습니다. CTO 작업으로 활동을 기록하세요.</p>
        ) : (
          <ol className="space-y-2">
            {cto.eventLog.map((entry) => {
              const meta = LOG_STYLES[entry.type]
              return (
                <li
                  key={entry.id}
                  className="flex items-start justify-between gap-3 rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className={['text-xs font-medium', meta.className].join(' ')}>{meta.label}</div>
                    <div className="truncate text-sm text-slate-300">{entry.message}</div>
                  </div>
                  <span className="shrink-0 text-xs text-slate-600">{formatTimestamp(entry.createdAt)}</span>
                </li>
              )
            })}
          </ol>
        )}
      </Card>
    </div>
  )
}

// --- action forms ----------------------------------------------------------

function AddDebtForm(): JSX.Element {
  const [title, setTitle] = useState('')
  const [area, setArea] = useState('')
  const [severity, setSeverity] = useState<CtoSeverity>('medium')

  const submit = (): void => {
    if (ctoRepository.addTechnicalDebt({ title, area, severity }).success) {
      setTitle('')
      setArea('')
      setSeverity('medium')
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-slate-800 bg-slate-950/30 p-2.5">
      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
        placeholder="기술 부채 추가…"
        className="min-w-0 flex-1 rounded-md border border-slate-700 bg-slate-900/60 px-2 py-1 text-xs text-slate-200 placeholder:text-slate-600 focus:border-indigo-500/50 focus:outline-none"
      />
      <input
        type="text"
        value={area}
        onChange={(e) => setArea(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
        placeholder="영역"
        className="w-28 rounded-md border border-slate-700 bg-slate-900/60 px-2 py-1 text-xs text-slate-200 placeholder:text-slate-600 focus:border-indigo-500/50 focus:outline-none"
      />
      <SeveritySelect value={severity} onChange={setSeverity} />
      <MiniButton icon={<Plus className="h-3 w-3" />} onClick={submit}>
        추가
      </MiniButton>
    </div>
  )
}

function AddRiskForm(): JSX.Element {
  const [title, setTitle] = useState('')
  const [area, setArea] = useState('')
  const [severity, setSeverity] = useState<CtoSeverity>('medium')
  const [likelihood, setLikelihood] = useState<CtoLikelihood>('medium')
  const [mitigation, setMitigation] = useState('')

  const submit = (): void => {
    if (ctoRepository.addRisk({ title, area, severity, likelihood, mitigation }).success) {
      setTitle('')
      setArea('')
      setSeverity('medium')
      setLikelihood('medium')
      setMitigation('')
    }
  }

  return (
    <div className="space-y-2 rounded-lg border border-dashed border-slate-800 bg-slate-950/30 p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="위험 추가…"
          className="min-w-0 flex-1 rounded-md border border-slate-700 bg-slate-900/60 px-2 py-1 text-xs text-slate-200 placeholder:text-slate-600 focus:border-indigo-500/50 focus:outline-none"
        />
        <input
          type="text"
          value={area}
          onChange={(e) => setArea(e.target.value)}
          placeholder="영역"
          className="w-28 rounded-md border border-slate-700 bg-slate-900/60 px-2 py-1 text-xs text-slate-200 placeholder:text-slate-600 focus:border-indigo-500/50 focus:outline-none"
        />
        <SeveritySelect value={severity} onChange={setSeverity} />
        <LikelihoodSelect value={likelihood} onChange={setLikelihood} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={mitigation}
          onChange={(e) => setMitigation(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder="완화 방안 (선택)"
          className="min-w-0 flex-1 rounded-md border border-slate-700 bg-slate-900/60 px-2 py-1 text-xs text-slate-200 placeholder:text-slate-600 focus:border-indigo-500/50 focus:outline-none"
        />
        <MiniButton icon={<Plus className="h-3 w-3" />} onClick={submit}>
          위험 추가
        </MiniButton>
      </div>
    </div>
  )
}

function AddDecisionForm(): JSX.Element {
  const [title, setTitle] = useState('')
  const [owner, setOwner] = useState('CEO')
  const [context, setContext] = useState('')

  const submit = (): void => {
    if (ctoRepository.addBlockedDecision({ title, owner, context }).success) {
      setTitle('')
      setOwner('CEO')
      setContext('')
    }
  }

  return (
    <div className="space-y-2 rounded-lg border border-dashed border-slate-800 bg-slate-950/30 p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="차단된 의사결정 추가…"
          className="min-w-0 flex-1 rounded-md border border-slate-700 bg-slate-900/60 px-2 py-1 text-xs text-slate-200 placeholder:text-slate-600 focus:border-indigo-500/50 focus:outline-none"
        />
        <input
          type="text"
          value={owner}
          onChange={(e) => setOwner(e.target.value)}
          placeholder="담당자"
          className="w-24 rounded-md border border-slate-700 bg-slate-900/60 px-2 py-1 text-xs text-slate-200 placeholder:text-slate-600 focus:border-indigo-500/50 focus:outline-none"
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={context}
          onChange={(e) => setContext(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder="맥락 (선택)"
          className="min-w-0 flex-1 rounded-md border border-slate-700 bg-slate-900/60 px-2 py-1 text-xs text-slate-200 placeholder:text-slate-600 focus:border-indigo-500/50 focus:outline-none"
        />
        <MiniButton icon={<Plus className="h-3 w-3" />} onClick={submit}>
          의사결정 추가
        </MiniButton>
      </div>
    </div>
  )
}

// --- presentational helpers ------------------------------------------------

function SeveritySelect({
  value,
  onChange
}: {
  value: CtoSeverity
  onChange: (value: CtoSeverity) => void
}): JSX.Element {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as CtoSeverity)}
      className="rounded-md border border-slate-700 bg-slate-900/60 px-2 py-1 text-xs text-slate-200 focus:border-indigo-500/50 focus:outline-none"
    >
      {SEVERITIES.map((s) => (
        <option key={s} value={s}>
          {s}
        </option>
      ))}
    </select>
  )
}

function LikelihoodSelect({
  value,
  onChange
}: {
  value: CtoLikelihood
  onChange: (value: CtoLikelihood) => void
}): JSX.Element {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as CtoLikelihood)}
      className="rounded-md border border-slate-700 bg-slate-900/60 px-2 py-1 text-xs text-slate-200 focus:border-indigo-500/50 focus:outline-none"
    >
      {LIKELIHOODS.map((l) => (
        <option key={l} value={l}>
          가능성: {l}
        </option>
      ))}
    </select>
  )
}

function StatTile({ icon, label, value }: { icon: ReactNode; label: string; value: ReactNode }): JSX.Element {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-xs text-slate-500">
        <span className="text-slate-400">{icon}</span>
        {label}
      </div>
      <div className="mt-1 text-sm font-medium text-slate-200">{value}</div>
    </div>
  )
}

function SectionLabel({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{children}</div>
  )
}

function BulletList({ items, tone }: { items: string[]; tone: 'good' | 'warn' }): JSX.Element {
  const marker = tone === 'good' ? 'marker:text-emerald-500/60' : 'marker:text-amber-500/60'
  if (items.length === 0) return <div className="ml-4 mt-1 text-xs text-slate-600">—</div>
  return (
    <ul className={['ml-4 mt-1 list-disc space-y-0.5 text-xs text-slate-400', marker].join(' ')}>
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  )
}

function SeverityBadge({ severity }: { severity: CtoSeverity }): JSX.Element {
  return (
    <span className={['rounded-full border px-2 py-0.5 text-[11px] font-medium', SEVERITY_STYLES[severity]].join(' ')}>
      {severity}
    </span>
  )
}

function PriorityBadge({ priority }: { priority: CtoPriority }): JSX.Element {
  return (
    <span className={['rounded-full border px-2 py-0.5 text-[11px] font-medium', PRIORITY_STYLES[priority]].join(' ')}>
      {priority}
    </span>
  )
}

function SignalBadge({ signal }: { signal: CtoSignal }): JSX.Element {
  return (
    <span className={['inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium', SIGNAL_STYLES[signal]].join(' ')}>
      {SIGNAL_LABELS[signal]}
    </span>
  )
}

function ReleaseBadge({ level }: { level: ReleaseReadinessLevel }): JSX.Element {
  const meta = RELEASE_STYLES[level]
  return (
    <span className={['inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium', meta.className].join(' ')}>
      {meta.label}
    </span>
  )
}

function Chip({ children, tone }: { children: ReactNode; tone?: 'good' }): JSX.Element {
  const className =
    tone === 'good'
      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
      : 'border-slate-700 bg-slate-800/40 text-slate-400'
  return (
    <span className={['rounded-full border px-2 py-0.5 text-[11px] font-medium', className].join(' ')}>{children}</span>
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
  variant = 'default'
}: {
  children: ReactNode
  onClick: () => void
  icon?: ReactNode
  variant?: ButtonVariant
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium transition',
        BUTTON_VARIANTS[variant]
      ].join(' ')}
    >
      {icon}
      {children}
    </button>
  )
}

function MiniButton({ children, onClick, icon }: { children: ReactNode; onClick: () => void; icon?: ReactNode }): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-800/60 px-2 py-1 text-[11px] font-medium text-slate-300 transition hover:bg-slate-700/60"
    >
      {icon}
      {children}
    </button>
  )
}
