import { type ReactNode } from 'react'
import {
  BarChart3,
  Wallet,
  FileSignature,
  Target,
  Trophy,
  Users,
  TrendingUp,
  TrendingDown,
  Minus,
  Download,
  RotateCcw,
  Award,
  Activity,
  CalendarRange
} from 'lucide-react'
import Card from '@renderer/components/ui/Card'
import ProgressBar from '@renderer/components/ui/ProgressBar'
import { usePerformance } from '@renderer/services/performance/usePerformance'
import { performanceRepository } from '@renderer/services/performance/PerformanceRepository'
import type { PeriodView, ProductionPoint, TrendCard } from '@renderer/services/performance/types'

const VIEW_LABEL: Record<PeriodView, string> = {
  daily: '일간',
  weekly: '주간',
  monthly: '월간'
}

const VIEW_OPTIONS: PeriodView[] = ['daily', 'weekly', 'monthly']

function won(value: number): string {
  if (value >= 100_000_000) return `${(value / 100_000_000).toFixed(1)}억`
  return `${Math.round(value / 10_000).toLocaleString('ko-KR')}만`
}

function exportReport(): void {
  const json = performanceRepository.serializeSnapshot()
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = 'performance-report.json'
  anchor.click()
  URL.revokeObjectURL(url)
}

/**
 * Performance Workspace — the production scoreboard of SJ Invest. FC / team
 * rankings and the production summary are derived live from the FC OS roster via
 * performanceRepository; the daily / weekly / monthly trend series come from the
 * persisted snapshot (usePerformance). All mutations delegate to the repository.
 */
export default function PerformancePage(): JSX.Element {
  const snapshot = usePerformance()
  const view = snapshot.selectedView
  const summary = performanceRepository.getSummary()
  const fcRanking = performanceRepository.getFcRanking()
  const teamRanking = performanceRepository.getTeamRanking()
  const series = performanceRepository.getSeries(view)
  const trendCards = performanceRepository.getTrendCards(view)

  const handleReset = (): void => {
    if (typeof window !== 'undefined' && !window.confirm('실적 데모 데이터를 초기화할까요?')) return
    performanceRepository.resetDemoState()
  }

  return (
    <div className="space-y-5">
      {/* Header + production summary */}
      <Card
        title="Performance Workspace — 실적 현황"
        icon={<BarChart3 className="h-4 w-4" />}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <ActionButton icon={<Download className="h-4 w-4" />} onClick={exportReport}>
              Export report
            </ActionButton>
            <ActionButton icon={<RotateCcw className="h-4 w-4" />} variant="danger" onClick={handleReset}>
              Reset demo state
            </ActionButton>
          </div>
        }
      >
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Metric icon={<Wallet className="h-4 w-4" />} label="이번달 보험료" value={`${won(summary.monthlyPremiumTotal)}원`} tone="text-emerald-300" />
          <Metric icon={<FileSignature className="h-4 w-4" />} label="계약 건수" value={`${summary.contractTotal}건`} />
          <Metric icon={<Target className="h-4 w-4" />} label="목표 달성률" value={`${summary.achievementRate}%`} tone="text-sky-300" />
          <Metric icon={<Award className="h-4 w-4" />} label="목표 달성 FC" value={`${summary.targetHitCount}명`} tone="text-amber-300" />
          <Metric icon={<Trophy className="h-4 w-4" />} label="최우수 FC" value={summary.topFcName} />
          <Metric icon={<Users className="h-4 w-4" />} label="선두 팀" value={summary.topTeamName} />
        </div>
        <div className="mt-4">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>목표 {won(summary.targetPremiumTotal)}원 대비 · FC {summary.producingFcCount}명 · 평균 {won(summary.averagePremiumPerFc)}원/FC</span>
            <span className="text-emerald-300">{summary.achievementRate}%</span>
          </div>
          <div className="mt-1">
            <ProgressBar value={Math.min(summary.achievementRate, 100)} />
          </div>
        </div>
      </Card>

      {/* Trend view toggle + trend cards + chart */}
      <Card
        title="생산 추세"
        icon={<CalendarRange className="h-4 w-4" />}
        action={
          <div className="flex items-center gap-1">
            {VIEW_OPTIONS.map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => performanceRepository.setView(v)}
                className={[
                  'rounded-lg border px-2.5 py-1 text-xs font-medium transition',
                  v === view
                    ? 'border-indigo-500/40 bg-indigo-500/15 text-indigo-200'
                    : 'border-slate-700 bg-slate-800/40 text-slate-400 hover:bg-slate-700/50'
                ].join(' ')}
              >
                {VIEW_LABEL[v]}
              </button>
            ))}
          </div>
        }
      >
        <div className="grid gap-3 sm:grid-cols-3">
          {trendCards.map((c) => (
            <TrendCardView key={c.label} card={c} />
          ))}
        </div>
        <div className="mt-4">
          <PremiumChart series={series} />
        </div>
      </Card>

      {/* FC ranking + team ranking */}
      <div className="grid gap-5 lg:grid-cols-3">
        <Card title="FC 실적 순위" icon={<Trophy className="h-4 w-4" />} className="lg:col-span-2">
          <ol className="space-y-2">
            {fcRanking.map((r, i) => (
              <li key={r.fcId} className="flex items-center gap-3 rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2">
                <span className={['w-5 shrink-0 text-center text-sm font-semibold', i < 3 ? 'text-amber-300' : 'text-slate-500'].join(' ')}>{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-slate-100">{r.fcName} <span className="text-xs text-slate-500">· {r.team} · {r.role}</span></div>
                  <div className="text-xs text-slate-500">보험료 {won(r.monthlyPremium)}원 · 계약 {r.contractCount}건 · 목표 {won(r.targetPremium)}원</div>
                </div>
                <div className="shrink-0 text-right">
                  <div className={['text-sm font-medium', r.achievementRate >= 100 ? 'text-emerald-300' : 'text-slate-300'].join(' ')}>{r.achievementRate}%</div>
                </div>
              </li>
            ))}
          </ol>
        </Card>

        <Card title="팀 실적 순위" icon={<Users className="h-4 w-4" />}>
          <div className="space-y-2">
            {teamRanking.map((t, i) => (
              <div key={t.team} className="rounded-lg border border-slate-800 bg-slate-900/40 p-2.5">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-200"><span className="mr-1 text-xs text-slate-500">{i + 1}.</span>{t.team}</span>
                  <span className={['', t.achievementRate >= 100 ? 'text-emerald-300' : 'text-slate-300'].join(' ')}>{t.achievementRate}%</span>
                </div>
                <div className="mt-1 text-[11px] text-slate-500">보험료 {won(t.monthlyPremium)}원 · 계약 {t.contractCount}건 · {t.memberCount}명</div>
                <div className="mt-1"><ProgressBar value={Math.min(t.achievementRate, 100)} /></div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Production summary table */}
      <Card title={`생산 요약 · ${VIEW_LABEL[view]}`} icon={<Activity className="h-4 w-4" />} action={<span className="text-xs text-slate-500">{series.length} 구간</span>}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800 text-left text-xs text-slate-500">
                <th className="py-2 pr-4 font-medium">구간</th>
                <th className="py-2 pr-4 font-medium">보험료</th>
                <th className="py-2 pr-4 font-medium">계약</th>
                <th className="py-2 pr-4 font-medium">활동</th>
              </tr>
            </thead>
            <tbody>
              {series.slice().reverse().map((p) => (
                <tr key={p.periodKey} className="border-b border-slate-800/60">
                  <td className="py-2 pr-4 text-slate-300">{p.label}</td>
                  <td className="py-2 pr-4 text-emerald-300">{won(p.premium)}원</td>
                  <td className="py-2 pr-4 text-slate-300">{p.contractCount}건</td>
                  <td className="py-2 pr-4 text-slate-400">{p.activityCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

// --- trend card -------------------------------------------------------------

const DIRECTION_TONE: Record<TrendCard['direction'], { icon: ReactNode; text: string }> = {
  up: { icon: <TrendingUp className="h-3.5 w-3.5" />, text: 'text-emerald-300' },
  down: { icon: <TrendingDown className="h-3.5 w-3.5" />, text: 'text-rose-300' },
  flat: { icon: <Minus className="h-3.5 w-3.5" />, text: 'text-slate-400' }
}

function TrendCardView({ card }: { card: TrendCard }): JSX.Element {
  const tone = DIRECTION_TONE[card.direction]
  const isPremium = card.label === '보험료'
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2.5">
      <div className="text-xs text-slate-500">{card.label}</div>
      <div className="mt-1 flex items-end justify-between gap-2">
        <span className="text-lg font-semibold text-slate-100">
          {isPremium ? `${won(card.current)}원` : card.current.toLocaleString('ko-KR')}
        </span>
        <span className={['flex items-center gap-1 text-xs font-medium', tone.text].join(' ')}>
          {tone.icon}
          {card.deltaPct >= 0 ? '+' : ''}{card.deltaPct}%
        </span>
      </div>
      <div className="mt-0.5 text-[11px] text-slate-500">
        직전 {isPremium ? `${won(card.previous)}원` : card.previous.toLocaleString('ko-KR')}
      </div>
    </div>
  )
}

// --- premium bar chart ------------------------------------------------------

function PremiumChart({ series }: { series: ProductionPoint[] }): JSX.Element {
  const max = series.reduce((m, p) => Math.max(m, p.premium), 0)
  return (
    <div className="flex h-40 items-end gap-2">
      {series.map((p, i) => {
        const height = max > 0 ? Math.max(6, Math.round((p.premium / max) * 100)) : 6
        const isLast = i === series.length - 1
        return (
          <div key={p.periodKey} className="flex flex-1 flex-col items-center gap-1">
            <div className="flex w-full flex-1 items-end">
              <div
                className={['w-full rounded-t transition-all', isLast ? 'bg-indigo-500/70' : 'bg-slate-700/70'].join(' ')}
                style={{ height: `${height}%` }}
                title={`${p.label} · ${won(p.premium)}원 · ${p.contractCount}건`}
              />
            </div>
            <span className="text-[10px] text-slate-500">{p.label}</span>
          </div>
        )
      })}
      {series.length === 0 ? <p className="text-sm text-slate-500">추세 데이터가 없습니다.</p> : null}
    </div>
  )
}

// --- presentational helpers -------------------------------------------------

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
