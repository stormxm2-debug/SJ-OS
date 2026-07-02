import { type ReactNode, useMemo, useState } from 'react'
import {
  ShieldCheck,
  FileSearch,
  AlertTriangle,
  ShieldAlert,
  Tag,
  Sparkles,
  Download,
  RotateCcw,
  Plus,
  FileText,
  Layers,
  Wallet,
  Filter
} from 'lucide-react'
import Card from '@renderer/components/ui/Card'
import ProgressBar from '@renderer/components/ui/ProgressBar'
import { useAnalysis } from '@renderer/services/insurance-analysis/useAnalysis'
import { analysisRepository } from '@renderer/services/insurance-analysis/AnalysisRepository'
import { customerRepository } from '@renderer/services/customer/CustomerRepository'
import type {
  AnalysisStatus,
  CoverageAdequacy,
  CoverageCategory,
  GapSeverity,
  InsuranceAnalysis
} from '@renderer/services/insurance-analysis/types'

const STATUS_LABEL: Record<AnalysisStatus, string> = {
  'not-started': '미시작',
  'in-progress': '분석중',
  draft: '초안',
  reviewed: '검토완료'
}

const STATUS_TONE: Record<AnalysisStatus, string> = {
  'not-started': 'border-slate-600/40 bg-slate-600/10 text-slate-400',
  'in-progress': 'border-sky-500/30 bg-sky-500/10 text-sky-300',
  draft: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  reviewed: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
}

const CATEGORY_LABEL: Record<CoverageCategory, string> = {
  death: '사망',
  diagnosis: '진단비',
  hospitalization: '입원',
  surgery: '수술',
  'medical-actual': '실손',
  disability: '후유장해',
  liability: '배상책임',
  income: '소득보장',
  pension: '연금',
  savings: '저축'
}

const ADEQUACY_LABEL: Record<CoverageAdequacy, string> = {
  sufficient: '충분',
  partial: '부분',
  insufficient: '부족',
  none: '미가입'
}

const ADEQUACY_TONE: Record<CoverageAdequacy, string> = {
  sufficient: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  partial: 'border-sky-500/30 bg-sky-500/10 text-sky-300',
  insufficient: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  none: 'border-rose-500/30 bg-rose-500/10 text-rose-300'
}

const SEVERITY_TONE: Record<GapSeverity, string> = {
  low: 'border-slate-600/40 bg-slate-600/10 text-slate-300',
  medium: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  high: 'border-rose-500/30 bg-rose-500/10 text-rose-300'
}

const STATUS_OPTIONS = Object.keys(STATUS_LABEL) as AnalysisStatus[]

function won(value: number): string {
  if (value >= 100_000_000) return `${(value / 100_000_000).toFixed(1)}억`
  if (value >= 10_000) return `${Math.round(value / 10_000).toLocaleString('ko-KR')}만`
  return value.toLocaleString('ko-KR')
}

function exportReport(): void {
  const json = analysisRepository.serializeSnapshot()
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = 'insurance-analysis-report.json'
  anchor.click()
  URL.revokeObjectURL(url)
}

function handleCreate(): void {
  if (typeof window === 'undefined') return
  const roster = customerRepository
    .listCustomers()
    .slice(0, 20)
    .map((c) => `${c.customerId} · ${c.name}`)
    .join('\n')
  const customerId = window.prompt(`새 보험분석 개설 — 고객 ID 입력\n\n${roster}`)
  if (!customerId || !customerId.trim()) return
  const result = analysisRepository.createAnalysis(customerId.trim())
  if (!result.success) window.alert(result.error ?? '분석 개설에 실패했습니다.')
}

/**
 * Insurance Analysis Entry — the foundation entry point for policy analysis.
 * Reads analyses (via useAnalysis) and rollups from analysisRepository. This is
 * a mock/manual foundation only: no real AI or external API runs. The
 * recommendation is a local placeholder and the Jarvis entry points describe
 * seams a future engine will fill.
 */
export default function InsuranceAnalysisPage(): JSX.Element {
  const snapshot = useAnalysis()
  const [statusFilter, setStatusFilter] = useState<AnalysisStatus | 'all'>('all')
  const summary = analysisRepository.getSummary()
  const jarvisEntryPoints = analysisRepository.getJarvisEntryPoints()

  const analyses = useMemo(
    () => snapshot.analyses.filter((a) => statusFilter === 'all' || a.status === statusFilter),
    [snapshot, statusFilter]
  )
  const selected = snapshot.selectedAnalysisId
    ? analysisRepository.getAnalysis(snapshot.selectedAnalysisId)
    : null

  const handleReset = (): void => {
    if (typeof window !== 'undefined' && !window.confirm('보험분석 데모 데이터를 초기화할까요?')) return
    analysisRepository.resetDemoState()
  }

  return (
    <div className="space-y-5">
      {/* Header + summary */}
      <Card
        title="Insurance Analysis Entry — 보험 분석 (기초)"
        icon={<ShieldCheck className="h-4 w-4" />}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <ActionButton icon={<Plus className="h-4 w-4" />} variant="primary" onClick={handleCreate}>
              새 분석
            </ActionButton>
            <ActionButton icon={<Download className="h-4 w-4" />} onClick={exportReport}>
              Export report
            </ActionButton>
            <ActionButton icon={<RotateCcw className="h-4 w-4" />} variant="danger" onClick={handleReset}>
              Reset demo state
            </ActionButton>
          </div>
        }
      >
        <div className="mb-4 rounded-lg border border-indigo-500/20 bg-indigo-500/5 px-3 py-2 text-xs text-indigo-200/80">
          <Sparkles className="mr-1 inline h-3.5 w-3.5" />
          자동 AI 분석은 아직 연동되지 않았습니다. 현재는 로컬 목업 구조와 FC 수동 검토용 초안입니다.
        </div>
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Metric icon={<FileSearch className="h-4 w-4" />} label="전체 분석" value={`${summary.total}건`} />
          <Metric icon={<FileText className="h-4 w-4" />} label="분석중/초안" value={`${summary.inProgress + summary.draft}건`} tone="text-sky-300" />
          <Metric icon={<ShieldCheck className="h-4 w-4" />} label="검토완료" value={`${summary.reviewed}건`} tone="text-emerald-300" />
          <Metric icon={<AlertTriangle className="h-4 w-4" />} label="보장 공백" value={`${summary.totalGaps}건`} tone="text-amber-300" />
          <Metric icon={<ShieldAlert className="h-4 w-4" />} label="고위험 공백" value={`${summary.highSeverityGaps}건`} tone="text-rose-300" />
          <Metric icon={<Wallet className="h-4 w-4" />} label="평균 월납" value={`${won(summary.averageMonthlyPremium)}원`} />
        </div>
      </Card>

      {/* Future Jarvis entry points */}
      <Card title="향후 Jarvis 분석 진입점" icon={<Sparkles className="h-4 w-4" />} action={<span className="text-xs text-slate-500">연동 예정</span>}>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {jarvisEntryPoints.map((e) => (
            <div key={e.key} className="rounded-lg border border-slate-800 bg-slate-900/40 p-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-slate-200">{e.label}</span>
                <span className="rounded-full border border-slate-600/40 bg-slate-600/10 px-1.5 py-0.5 text-[10px] text-slate-400">
                  {e.ready ? '준비됨' : '연동 예정'}
                </span>
              </div>
              <p className="mt-1 text-[11px] text-slate-500">{e.description}</p>
            </div>
          ))}
        </div>
      </Card>

      {/* Filter + list + detail */}
      <Card title="분석 필터" icon={<Filter className="h-4 w-4" />}>
        <div className="flex flex-wrap items-center gap-2">
          <FilterChip label="전체" active={statusFilter === 'all'} onClick={() => setStatusFilter('all')} />
          {STATUS_OPTIONS.map((s) => (
            <FilterChip key={s} label={STATUS_LABEL[s]} active={statusFilter === s} onClick={() => setStatusFilter(s)} />
          ))}
        </div>
      </Card>

      <div className="grid gap-5 lg:grid-cols-[360px_1fr]">
        <Card title="분석 목록" icon={<FileSearch className="h-4 w-4" />} action={<span className="text-xs text-slate-500">{analyses.length}건</span>}>
          <ol className="max-h-[36rem] space-y-1.5 overflow-y-auto pr-1">
            {analyses.map((a) => (
              <AnalysisRow key={a.analysisId} analysis={a} selected={a.analysisId === snapshot.selectedAnalysisId}
                onSelect={() => analysisRepository.selectAnalysis(a.analysisId)} />
            ))}
            {analyses.length === 0 ? <li className="px-2 py-4 text-sm text-slate-500">조건에 맞는 분석이 없습니다.</li> : null}
          </ol>
        </Card>

        {selected ? <AnalysisDetail analysis={selected} /> : <EmptyDetail />}
      </div>
    </div>
  )
}

// --- analysis list row ------------------------------------------------------

function AnalysisRow({
  analysis,
  selected,
  onSelect
}: {
  analysis: InsuranceAnalysis
  selected: boolean
  onSelect: () => void
}): JSX.Element {
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        className={[
          'flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition',
          selected ? 'border-indigo-500/40 bg-indigo-500/10' : 'border-slate-800 bg-slate-900/40 hover:bg-slate-800/60'
        ].join(' ')}
      >
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-slate-100">{analysis.customerName}</div>
          <div className="truncate text-[11px] text-slate-500">{analysis.fcName} · 공백 {analysis.missingCoverage.length} · 태그 {analysis.riskTags.length}</div>
        </div>
        <span className={['shrink-0 rounded-full border px-1.5 py-0.5 text-[10px]', STATUS_TONE[analysis.status]].join(' ')}>
          {STATUS_LABEL[analysis.status]}
        </span>
      </button>
    </li>
  )
}

// --- selected analysis detail -----------------------------------------------

function AnalysisDetail({ analysis }: { analysis: InsuranceAnalysis }): JSX.Element {
  const id = analysis.analysisId
  const premiumTotal = analysis.policies.reduce((s, p) => s + p.monthlyPremium, 0)

  const promptRecommendation = (): void => {
    const text = window.prompt('추천 메모 (수동)', analysis.recommendationPlaceholder)
    if (text) analysisRepository.updateRecommendationPlaceholder(id, text)
  }
  const promptRiskTag = (): void => {
    const text = window.prompt('리스크 태그 추가')
    if (text) analysisRepository.addRiskTag(id, text)
  }
  const promptGap = (): void => {
    const note = window.prompt('보장 공백 내용')
    if (note) analysisRepository.addMissingCoverage(id, 'diagnosis', note)
  }

  return (
    <div className="space-y-5">
      <Card
        title="분석 상세"
        icon={<ShieldCheck className="h-4 w-4" />}
        action={<span className={['rounded-full border px-2 py-0.5 text-[11px] font-medium', STATUS_TONE[analysis.status]].join(' ')}>{STATUS_LABEL[analysis.status]}</span>}
      >
        <div className="space-y-4">
          <div>
            <span className="text-lg font-semibold text-slate-100">{analysis.customerName}</span>
            <p className="mt-1 text-sm text-slate-400">{analysis.fcName} · {analysis.team} · 월납 합계 {won(premiumTotal)}원</p>
          </div>

          {/* Status controls */}
          <div className="flex flex-wrap items-center gap-2">
            {STATUS_OPTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => analysisRepository.setStatus(id, s)}
                className={[
                  'rounded-lg border px-2.5 py-1 text-xs font-medium transition',
                  s === analysis.status ? STATUS_TONE[s] : 'border-slate-700 bg-slate-800/40 text-slate-400 hover:bg-slate-700/50'
                ].join(' ')}
              >
                {STATUS_LABEL[s]}
              </button>
            ))}
          </div>
        </div>
      </Card>

      {/* Policy overview */}
      <Card title="보유 증권 개요" icon={<Layers className="h-4 w-4" />} action={<span className="text-xs text-slate-500">{analysis.policies.length}건</span>}>
        {analysis.policies.length === 0 ? (
          <p className="text-sm text-slate-500">등록된 증권이 없습니다.</p>
        ) : (
          <ul className="space-y-2">
            {analysis.policies.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2">
                <div className="min-w-0">
                  <div className="truncate text-sm text-slate-200">{p.name} <span className="text-xs text-slate-500">· {p.type} · {p.insurer}</span></div>
                  <div className="text-[11px] text-slate-500">{p.coverage}</div>
                </div>
                <span className="shrink-0 text-sm text-emerald-300">{won(p.monthlyPremium)}원</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Coverage categories */}
      <Card title="보장 카테고리" icon={<ShieldCheck className="h-4 w-4" />} action={<span className="text-xs text-slate-500">{analysis.coverage.length}개</span>}>
        {analysis.coverage.length === 0 ? (
          <p className="text-sm text-slate-500">보장 카테고리 데이터가 없습니다.</p>
        ) : (
          <div className="space-y-2">
            {analysis.coverage.map((c) => {
              const pct = c.recommendedAmount > 0 ? Math.min(100, Math.round((c.currentAmount / c.recommendedAmount) * 100)) : 0
              return (
                <div key={c.category} className="rounded-lg border border-slate-800 bg-slate-900/40 p-2.5">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-200">{CATEGORY_LABEL[c.category]}</span>
                    <span className={['rounded-full border px-1.5 py-0.5 text-[10px]', ADEQUACY_TONE[c.adequacy]].join(' ')}>{ADEQUACY_LABEL[c.adequacy]}</span>
                  </div>
                  <div className="mt-1 text-[11px] text-slate-500">현재 {won(c.currentAmount)}원 / 권장 {won(c.recommendedAmount)}원</div>
                  <div className="mt-1"><ProgressBar value={pct} /></div>
                </div>
              )
            })}
          </div>
        )}
      </Card>

      {/* Missing coverage + risk tags */}
      <div className="grid gap-5 lg:grid-cols-2">
        <Card
          title="보장 공백"
          icon={<AlertTriangle className="h-4 w-4" />}
          action={<ActionButton icon={<Plus className="h-4 w-4" />} onClick={promptGap}>공백</ActionButton>}
        >
          {analysis.missingCoverage.length === 0 ? (
            <p className="text-sm text-emerald-300/80">식별된 보장 공백이 없습니다.</p>
          ) : (
            <ul className="space-y-2">
              {analysis.missingCoverage.map((g) => (
                <li key={g.id} className="flex items-start justify-between gap-3 rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2">
                  <div className="min-w-0">
                    <div className="text-sm text-slate-200">{CATEGORY_LABEL[g.category]}</div>
                    <div className="text-[11px] text-slate-500">{g.note}</div>
                  </div>
                  <span className={['shrink-0 rounded-full border px-1.5 py-0.5 text-[10px]', SEVERITY_TONE[g.severity]].join(' ')}>{g.severity}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card
          title="리스크 태그"
          icon={<Tag className="h-4 w-4" />}
          action={<ActionButton icon={<Plus className="h-4 w-4" />} onClick={promptRiskTag}>태그</ActionButton>}
        >
          {analysis.riskTags.length === 0 ? (
            <p className="text-sm text-slate-500">리스크 태그가 없습니다.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {analysis.riskTags.map((t) => (
                <span key={t} className="rounded-full border border-slate-700 bg-slate-800/60 px-2.5 py-1 text-xs text-slate-300">{t}</span>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* Recommendation placeholder */}
      <Card
        title="추천 (플레이스홀더)"
        icon={<Sparkles className="h-4 w-4" />}
        action={<ActionButton icon={<FileText className="h-4 w-4" />} onClick={promptRecommendation}>메모 편집</ActionButton>}
      >
        <div className="rounded-lg border border-indigo-500/20 bg-indigo-500/5 px-3 py-2.5 text-sm text-slate-300">
          {analysis.recommendationPlaceholder}
        </div>
        <p className="mt-2 text-[11px] text-slate-500">
          aiReady: {String(analysis.aiReady)} — 자동 추천 엔진 연동 시 이 영역이 대체됩니다.
        </p>
      </Card>
    </div>
  )
}

function EmptyDetail(): JSX.Element {
  return (
    <Card title="분석 선택" icon={<ShieldCheck className="h-4 w-4" />}>
      <p className="text-sm text-slate-500">왼쪽 목록에서 분석을 선택하면 증권 개요, 보장 카테고리, 공백, 리스크 태그가 표시됩니다.</p>
    </Card>
  )
}

// --- presentational helpers -------------------------------------------------

function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'rounded-lg border px-3 py-1.5 text-xs font-medium transition',
        active ? 'border-indigo-500/40 bg-indigo-500/15 text-indigo-200' : 'border-slate-700 bg-slate-800/40 text-slate-400 hover:bg-slate-700/50'
      ].join(' ')}
    >
      {label}
    </button>
  )
}

function Metric({ icon, label, value, tone }: { icon: ReactNode; label: string; value: string; tone?: string }): JSX.Element {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-xs text-slate-500">
        <span className="text-slate-400">{icon}</span>
        {label}
      </div>
      <div className={['mt-1 truncate text-sm font-medium', tone ?? 'text-slate-200'].join(' ')}>{value}</div>
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
      className={['inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium transition', BUTTON_VARIANTS[variant]].join(' ')}
    >
      {icon}
      {children}
    </button>
  )
}
