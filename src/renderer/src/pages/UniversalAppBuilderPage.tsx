import { useState } from 'react'
import {
  Boxes,
  Sparkles,
  Layers,
  Compass,
  GitBranch,
  Copy,
  Check,
  ShieldAlert,
  ShieldCheck,
  ArrowRight,
  Cpu,
  ListChecks,
  Trash2,
  Send
} from 'lucide-react'
import Card from '@renderer/components/ui/Card'
import { useUniversalBuilder } from '@renderer/services/universal-builder/useUniversalBuilder'
import { universalBuilderRepository } from '@renderer/services/universal-builder/UniversalBuilderRepository'
import { AI_TOOL_REGISTRY } from '@renderer/services/universal-builder/toolRegistry'
import type {
  AiToolStatus,
  UniversalBuildProject,
  UniversalBuildStatus,
  UniversalRiskLevel
} from '@renderer/services/universal-builder/types'
import { useNavigation } from '@renderer/navigation/NavigationContext'

const RISK_TONE: Record<UniversalRiskLevel, string> = {
  low: 'text-slate-300',
  medium: 'text-amber-300',
  high: 'text-rose-300',
  critical: 'text-rose-400'
}

const STATUS_TONE: Record<UniversalBuildStatus, string> = {
  captured: 'border-slate-700 bg-slate-800/60 text-slate-300',
  interpreted: 'border-sky-500/30 bg-sky-500/10 text-sky-300',
  planned: 'border-sky-500/30 bg-sky-500/10 text-sky-300',
  'needs-approval': 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  approved: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  'prompt-generated': 'border-violet-500/30 bg-violet-500/10 text-violet-300',
  'sent-to-claude': 'border-indigo-500/30 bg-indigo-500/10 text-indigo-300',
  'in-development': 'border-indigo-500/30 bg-indigo-500/10 text-indigo-300',
  completed: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  blocked: 'border-rose-500/30 bg-rose-500/10 text-rose-300',
  rejected: 'border-rose-500/30 bg-rose-500/10 text-rose-300'
}

const TOOL_STATUS_TONE: Record<AiToolStatus, string> = {
  'not-configured': 'text-slate-400',
  planned: 'text-sky-300',
  ready: 'text-emerald-300',
  blocked: 'text-rose-300',
  legacy: 'text-amber-300'
}

function formatTimestamp(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString()
}

/**
 * Universal App Builder — the CEO-facing view over Jarvis's app-building
 * projects. SJ OS is no longer insurance-only: the CEO can ask Jarvis to build
 * ecommerce, education, hospital-reservation, marketing/content and internal
 * dashboard systems. This page lists recent build projects, their AI-tool plan,
 * generated Claude Code prompt, risk and approval state, and next action. No
 * business logic lives here — everything reads through universalBuilderRepository.
 */
export default function UniversalAppBuilderPage(): JSX.Element {
  const snapshot = useUniversalBuilder()
  const { navigate } = useNavigation()
  const summary = universalBuilderRepository.getSummary()
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const selected =
    snapshot.projects.find((p) => p.id === snapshot.selectedProjectId) ?? snapshot.projects[0] ?? null

  const copyPrompt = (project: UniversalBuildProject): void => {
    const done = (): void => {
      setCopiedId(project.id)
      window.setTimeout(() => setCopiedId(null), 2000)
    }
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(project.generatedDeveloperPrompt).then(done).catch(() => undefined)
    }
  }

  const handleReset = (): void => {
    if (
      typeof window !== 'undefined' &&
      !window.confirm('Universal App Builder 프로젝트 목록을 초기화할까요? 다른 모듈은 영향받지 않습니다.')
    ) {
      return
    }
    universalBuilderRepository.resetDemoState()
  }

  return (
    <div className="space-y-5">
      {/* Intro / positioning */}
      <Card title="범용 앱 빌더" icon={<Boxes className="h-4 w-4 text-violet-300" />}>
        <div className="space-y-3">
          <p className="text-sm leading-6 text-slate-300">
            SJ OS는 더 이상 보험 전용 시스템이 아닙니다. SJ OS는 보험 시스템뿐 아니라 쇼핑몰(ecommerce),
            마케팅/콘텐츠 자동화, 사내 운영 OS 툴까지 어떤 비즈니스 시스템도 설계·계획할 수 있습니다.
          </p>
          <p className="text-xs text-slate-500">
            Jarvis에 "쇼핑몰 시스템 만들어", "학원 관리 프로그램 만들어", "병원 예약 시스템 만들어" 처럼
            말하면 구조화된 앱 빌드 프로젝트(모듈·화면·데이터 모델·AI 도구 오케스트레이션·Claude Code 프롬프트)로
            변환됩니다. 외부 AI 도구는 계획된 어댑터이며 아직 모두 활성화된 것은 아닙니다 — 도구별 공식 API/키
            상태를 검증한 뒤 별도 승인으로 연동합니다.
          </p>
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <SummaryTile label="전체" value={summary.total} />
            <SummaryTile label="대기" value={summary.pending} tone="text-sky-300" />
            <SummaryTile label="승인 필요" value={summary.needsApproval} tone="text-amber-300" />
            <SummaryTile label="프롬프트 생성" value={summary.promptGenerated} tone="text-violet-300" />
            <SummaryTile label="개발 중" value={summary.inDevelopment} tone="text-indigo-300" />
            <SummaryTile label="완료" value={summary.completed} tone="text-emerald-300" />
          </div>
        </div>
      </Card>

      <div className="grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
        {/* Recent build projects */}
        <Card
          title="최근 빌드 프로젝트"
          icon={<ListChecks className="h-4 w-4 text-violet-300" />}
          action={
            snapshot.projects.length > 0 ? (
              <button
                type="button"
                onClick={handleReset}
                className="inline-flex items-center gap-1.5 rounded-md border border-rose-500/30 bg-rose-500/10 px-2 py-1 text-[11px] font-medium text-rose-300 transition hover:bg-rose-500/20"
              >
                <Trash2 className="h-3 w-3" />
                초기화
              </button>
            ) : null
          }
        >
          {snapshot.projects.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-800 p-4 text-sm text-slate-500">
              아직 빌드 프로젝트가 없습니다. Jarvis(Ctrl + Space)에 "쇼핑몰 시스템 만들어" 처럼 말해 보세요.
            </div>
          ) : (
            <ul className="space-y-2">
              {snapshot.projects.map((project) => {
                const active = selected?.id === project.id
                return (
                  <li key={project.id}>
                    <button
                      type="button"
                      onClick={() => universalBuilderRepository.selectProject(project.id)}
                      className={[
                        'w-full rounded-xl border px-3 py-2.5 text-left transition',
                        active
                          ? 'border-violet-500/40 bg-violet-500/10'
                          : 'border-slate-800 bg-slate-950/40 hover:border-slate-600'
                      ].join(' ')}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium text-slate-100">{project.projectName}</span>
                        <span className={['shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium', STATUS_TONE[project.status]].join(' ')}>
                          {project.status}
                        </span>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                        <span className="rounded-full border border-slate-700 bg-slate-800/60 px-2 py-0.5 text-slate-300">{project.appType}</span>
                        <span>· 위험도 <span className={RISK_TONE[project.riskLevel]}>{project.riskLevel}</span></span>
                        <span>· {project.approvalRequired ? '승인 필요' : '승인 불필요'}</span>
                        <span>· {formatTimestamp(project.createdAt)}</span>
                      </div>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </Card>

        {/* Selected project detail */}
        <Card title="프로젝트 상세" icon={<Boxes className="h-4 w-4 text-violet-300" />}>
          {!selected ? (
            <div className="rounded-xl border border-dashed border-slate-800 p-4 text-sm text-slate-500">
              프로젝트를 선택하면 상세 계획과 개발자 프롬프트가 표시됩니다.
            </div>
          ) : (
            <div className="space-y-3">
              <div className="rounded-lg border border-violet-500/20 bg-violet-500/5 px-3 py-2">
                <div className="text-sm font-medium text-slate-100">{selected.projectName}</div>
                <div className="mt-0.5 text-[11px] text-slate-500">
                  {selected.industry} · 대상: {selected.targetUsers}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className={['rounded-full border px-2 py-0.5 font-medium', STATUS_TONE[selected.status]].join(' ')}>{selected.status}</span>
                <span className="inline-flex items-center gap-1 rounded-full border border-slate-700 bg-slate-800/60 px-2 py-0.5 text-slate-300">{selected.appType}</span>
                <span className={['inline-flex items-center gap-1 rounded-full border px-2 py-0.5', selected.approvalRequired ? 'border-amber-500/30 bg-amber-500/10 text-amber-300' : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'].join(' ')}>
                  {selected.approvalRequired ? <ShieldAlert className="h-3 w-3" /> : <ShieldCheck className="h-3 w-3" />}
                  {selected.approvalRequired ? '승인 필요' : '승인 불필요'}
                </span>
                <span className={['inline-flex items-center gap-1 rounded-full border border-slate-700 bg-slate-800/60 px-2 py-0.5', RISK_TONE[selected.riskLevel]].join(' ')}>위험도 {selected.riskLevel}</span>
              </div>

              <div className="rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2 text-sm text-slate-300">
                <span className="text-slate-500">해석된 목표: </span>{selected.interpretedGoal}
              </div>

              {selected.assumptions.length > 0 ? (
                <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-200">
                  <div className="mb-1 font-medium">가정 (custom/unknown — 확인 필요)</div>
                  <ul className="space-y-0.5">
                    {selected.assumptions.map((a) => (
                      <li key={a}>· {a}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <div className="grid gap-3 sm:grid-cols-2">
                <TagList label="필요 모듈" icon={<Layers className="h-3.5 w-3.5 text-violet-300" />} items={selected.requiredModules} />
                <TagList label="추천 화면" icon={<Compass className="h-3.5 w-3.5 text-sky-300" />} items={selected.suggestedScreens} />
                <TagList label="데이터 모델" icon={<Boxes className="h-3.5 w-3.5 text-emerald-300" />} items={selected.suggestedDataModels} />
                <TagList label="추천 연동" icon={<GitBranch className="h-3.5 w-3.5 text-indigo-300" />} items={selected.suggestedIntegrations} />
              </div>

              {/* AI tool plan */}
              {selected.aiToolPlan.length > 0 ? (
                <div className="space-y-1">
                  <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">AI 도구 계획</div>
                  <ul className="space-y-1">
                    {selected.aiToolPlan.map((t) => (
                      <li key={t.toolId} className="flex items-start gap-2 rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-1.5 text-xs">
                        <span className="mt-0.5 inline-flex shrink-0 items-center rounded-full border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 font-medium text-violet-300">{t.toolName}</span>
                        <span className="flex-1 text-slate-400">{t.role}</span>
                        <span className="shrink-0 text-[10px] text-slate-500">{t.officialApiStatus} API · {t.status}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {/* Sprint plan */}
              {selected.sprintPlan.length > 0 ? (
                <div className="space-y-1">
                  <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">스프린트 계획</div>
                  <ul className="space-y-1">
                    {selected.sprintPlan.map((s) => (
                      <li key={s.id} className="rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-1.5 text-xs text-slate-300">
                        <div className="font-medium text-slate-200">{s.name}</div>
                        <div className="text-slate-500">{s.goal}</div>
                        <ul className="mt-1 space-y-0.5 text-[11px] text-slate-500">
                          {s.deliverables.map((d) => (
                            <li key={d}>· {d}</li>
                          ))}
                        </ul>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {/* Generated developer prompt */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Claude Code 개발자 프롬프트</div>
                  <button
                    type="button"
                    onClick={() => copyPrompt(selected)}
                    className="inline-flex items-center gap-1.5 rounded-md border border-violet-500/30 bg-violet-500/10 px-2.5 py-1 text-[11px] font-medium text-violet-300 transition hover:bg-violet-500/20"
                  >
                    {copiedId === selected.id ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                    {copiedId === selected.id ? '복사됨' : '프롬프트 복사'}
                  </button>
                </div>
                <textarea
                  readOnly
                  value={selected.generatedDeveloperPrompt}
                  onFocus={(e) => e.currentTarget.select()}
                  className="h-48 w-full resize-y rounded-lg border border-slate-800 bg-slate-950/70 p-3 font-mono text-[11px] leading-5 text-slate-300 outline-none"
                />
              </div>

              <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-sm text-emerald-200">
                다음 액션: 생성된 개발자 프롬프트를 복사해 Claude Code에 붙여넣어 개발을 진행하세요.
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => universalBuilderRepository.markSentToClaude(selected.id)}
                  className="inline-flex items-center gap-2 rounded-lg border border-indigo-500/30 bg-indigo-500/10 px-3 py-1.5 text-xs font-medium text-indigo-300 transition hover:bg-indigo-500/20"
                >
                  <Send className="h-3.5 w-3.5" />
                  Claude Code로 전달 표시
                </button>
                <button
                  type="button"
                  onClick={() => navigate({ name: 'pm' })}
                  className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-300 transition hover:bg-emerald-500/20"
                >
                  <ArrowRight className="h-3.5 w-3.5" />
                  PM Planner
                </button>
                {selected.approvalRequired ? (
                  <button
                    type="button"
                    onClick={() => navigate({ name: 'approvals' })}
                    className="inline-flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-300 transition hover:bg-amber-500/20"
                  >
                    <ArrowRight className="h-3.5 w-3.5" />
                    Approval Center
                  </button>
                ) : null}
              </div>
            </div>
          )}
        </Card>
      </div>

      {/* AI Tool Connector Registry */}
      <Card title="AI 도구 커넥터 레지스트리" icon={<Cpu className="h-4 w-4 text-violet-300" />}>
        <p className="mb-3 text-xs text-slate-500">
          외부 AI 도구는 계획된 어댑터입니다. 아직 실제 API를 호출하지 않습니다. 각 도구의 공식 API/키 상태를
          검증한 뒤 별도 승인으로 활성화합니다. API 키는 렌더러/프론트엔드에 저장하지 않습니다.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-slate-800 text-[11px] uppercase tracking-[0.15em] text-slate-500">
                <th className="px-2 py-2">도구</th>
                <th className="px-2 py-2">분류</th>
                <th className="px-2 py-2">상태</th>
                <th className="px-2 py-2">공식 API</th>
                <th className="px-2 py-2">용도</th>
                <th className="px-2 py-2">위험도</th>
              </tr>
            </thead>
            <tbody>
              {AI_TOOL_REGISTRY.map((tool) => (
                <tr key={tool.id} className="border-b border-slate-800/60">
                  <td className="px-2 py-2 font-medium text-slate-200">{tool.name}</td>
                  <td className="px-2 py-2 text-slate-400">{tool.category}</td>
                  <td className={['px-2 py-2 font-medium', TOOL_STATUS_TONE[tool.status]].join(' ')}>{tool.status}</td>
                  <td className="px-2 py-2 text-slate-400">{tool.officialApiStatus}</td>
                  <td className="px-2 py-2 text-slate-400">{tool.purpose}</td>
                  <td className="px-2 py-2 text-slate-400">{tool.riskLevel}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

function SummaryTile({ label, value, tone }: { label: string; value: number; tone?: string }): JSX.Element {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2.5">
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className={['mt-0.5 text-lg font-semibold', tone ?? 'text-slate-200'].join(' ')}>{value}</div>
    </div>
  )
}

function TagList({ label, icon, items }: { label: string; icon: JSX.Element; items: string[] }): JSX.Element {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2">
      <div className="mb-1.5 flex items-center gap-1.5 text-[11px] uppercase tracking-[0.15em] text-slate-500">
        {icon}
        {label}
      </div>
      {items.length === 0 ? (
        <div className="text-xs text-slate-600">—</div>
      ) : (
        <div className="flex flex-wrap gap-1">
          {items.map((item) => (
            <span key={item} className="rounded-full border border-slate-700 bg-slate-800/50 px-2 py-0.5 text-[10px] text-slate-300">
              {item}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
