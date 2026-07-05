import { useMemo, useState } from 'react'
import { Gauge, RefreshCw, Copy, Check, AlertTriangle, Lock, Download, X } from 'lucide-react'
import Card from '@renderer/components/ui/Card'
import { copyPromptToClipboard } from '@renderer/services/claude-code/claudeCodeBridge'
import { useInstallGuides } from '@renderer/services/release-approval/installGuideStore'
import {
  addDashboardRecord,
  computeDashboard,
  DASH_STATUS_LABEL,
  FAILED_NEXT_ACTIONS,
  formatDashboardReport,
  removeDashboardRecord,
  seedFromGuide,
  setDashboardStatus,
  useDashboardRecords,
  type DashboardStaffStatus,
  type StaffUpdateDashboardRecord
} from '@renderer/services/release-approval/staffUpdateDashboardStore'

/**
 * 직원 업데이트 현황 — dashboard of per-staff install/update progress with rollout
 * counts + completion rate + a failed-staff focus. Local tracking + reporting
 * ONLY: no remote install, no sending/upload, no shell. Inline cards only.
 */
export default function StaffUpdateDashboardPanel(): JSX.Element {
  const guides = useInstallGuides()
  const records = useDashboardRecords()
  const [nudge, setNudge] = useState(0) // force "새로 계산"
  const summary = useMemo(() => computeDashboard(records), [records, nudge])
  const [copied, setCopied] = useState(false)
  const [name, setName] = useState('')
  const [team, setTeam] = useState('')
  const latestVersion = guides[0]?.version ?? summary.version

  const hasSource = guides.length > 0
  const failed = records.filter((r) => r.status === 'failed')

  const copyReport = async (): Promise<void> => {
    if (await copyPromptToClipboard(formatDashboardReport(records))) {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <Card
      title="직원 업데이트 현황"
      icon={<Gauge className="h-4 w-4 text-indigo-300" />}
      action={<span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-600">직원 업데이트 현황 안전 빌드</span>}
    >
      <p className="mb-3 text-xs text-slate-500">
        직원별 설치/업데이트 진행 상황과 완료율을 한눈에 봅니다. 원격 설치·자동 발송·업로드는 하지 않습니다.
      </p>

      {!hasSource && records.length === 0 ? (
        <p className="mb-3 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200">
          설치 안내 또는 배포 패키지가 없습니다. 먼저 설치 안내를 생성해주세요.
        </p>
      ) : null}

      {/* Summary cards */}
      <div className="mb-3 grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        <Stat label="전체 대상" value={summary.totalStaff} />
        <Stat label="안내 발송" value={summary.guideSentCount} />
        <Stat label="설치 중" value={summary.installingCount} tone="indigo" />
        <Stat label="설치 완료" value={summary.installedCount} tone="emerald" />
        <Stat label="실패" value={summary.failedCount} tone="rose" />
        <Stat label="대기" value={summary.pendingCount} />
        <Stat label="완료율" value={`${summary.completionRate}%`} tone="emerald" />
      </div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <span className={['rounded-full border px-2 py-0.5 text-[10px] font-bold', statusTone(summary.status)].join(' ')}>{summary.status}</span>
        <p className="text-[11px] text-slate-500">{summary.summaryText}</p>
      </div>

      {/* Controls */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <MiniBtn icon={<RefreshCw className="h-3 w-3" />} label="현황 새로 계산" onClick={() => setNudge((n) => n + 1)} />
        {guides.length > 0 ? (
          <MiniBtn icon={<Download className="h-3 w-3" />} label="안내 기록 가져오기" onClick={() => seedFromGuide(guides[0])} />
        ) : null}
        <MiniBtn icon={copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />} label={copied ? '복사됨' : '현황 보고 복사'} onClick={() => void copyReport()} />
      </div>

      {/* Add staff */}
      <div className="mb-3 flex flex-wrap gap-1.5">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="직원명" className="w-24 rounded border border-slate-700 bg-slate-900/50 px-2 py-1 text-[11px] text-slate-100 placeholder:text-slate-600 focus:outline-none" />
        <input value={team} onChange={(e) => setTeam(e.target.value)} placeholder="팀/직책" className="w-24 rounded border border-slate-700 bg-slate-900/50 px-2 py-1 text-[11px] text-slate-100 placeholder:text-slate-600 focus:outline-none" />
        <MiniBtn icon={<span />} label="직원 추가" onClick={() => { addDashboardRecord({ staffName: name, teamName: team, targetVersion: latestVersion }); setName(''); setTeam('') }} />
      </div>

      {/* Records table */}
      {records.length === 0 ? (
        <p className="py-2 text-center text-[11px] text-slate-500">아직 직원 기록이 없습니다.</p>
      ) : (
        <div className="space-y-1.5">
          {records.map((r) => <Row key={r.id} r={r} />)}
        </div>
      )}

      {/* Failed staff focus */}
      {failed.length > 0 ? (
        <div className="mt-3 rounded-xl border border-rose-500/20 bg-rose-500/5 p-3">
          <div className="mb-1 flex items-center gap-1 text-[11px] font-semibold text-rose-300"><AlertTriangle className="h-3 w-3" /> 조치 필요 직원 ({failed.length})</div>
          {failed.map((r) => (
            <div key={r.id} className="mb-1 text-[11px] text-slate-400">
              <span className="font-semibold text-slate-200">{r.staffName}</span>{r.teamName ? ` · ${r.teamName}` : ''} · 문제: {r.issueSummary ?? '원인 미상'} · 최근 {new Date(r.lastUpdatedAt).toLocaleString()}
              <div className="text-[10px] text-slate-500">다음 조치: {FAILED_NEXT_ACTIONS.join(' · ')}</div>
            </div>
          ))}
        </div>
      ) : null}

      {/* Future (disabled) */}
      <div className="mt-4 flex items-start gap-2 rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2 text-[11px] text-slate-500">
        <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <div>
          <div className="font-semibold text-slate-400">다음 단계 (비활성)</div>
          카카오톡/이메일 안내 자동 발송 · 설치 완료 자동 보고 · 자동 업데이트 · 원격 배포 · 롤백 현황판은 다음 안정화 단계에서 활성화됩니다.
        </div>
      </div>
    </Card>
  )
}

function Row({ r }: { r: StaffUpdateDashboardRecord }): JSX.Element {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-2 text-[10px]">
      <div className="flex flex-wrap items-center justify-between gap-1.5">
        <div className="min-w-0">
          <span className="font-semibold text-slate-200">{r.staffName}</span>
          {r.teamName ? <span className="text-slate-500"> · {r.teamName}</span> : ''}
          <span className="text-slate-500"> · 목표 {r.targetVersion}{r.currentVersion ? ` · 현재 ${r.currentVersion}` : ''}</span>
          <span className="text-slate-500"> · {DASH_STATUS_LABEL[r.status]}</span>
        </div>
        <button type="button" onClick={() => removeDashboardRecord(r.id)} className="text-slate-500 hover:text-rose-300"><X className="h-3 w-3" /></button>
      </div>
      <div className="mt-1 flex flex-wrap gap-1">
        {(['not-started', 'guide-sent', 'installing', 'installed', 'failed', 'skipped'] as DashboardStaffStatus[]).map((s) => (
          <button key={s} type="button" onClick={() => setDashboardStatus(r.id, s)} className={['rounded border px-1.5 py-0.5 transition', r.status === s ? 'border-indigo-500/40 bg-indigo-500/20 text-indigo-300' : 'border-slate-700 bg-slate-800/50 text-slate-400 hover:text-slate-200'].join(' ')}>
            {DASH_STATUS_LABEL[s]}
          </button>
        ))}
      </div>
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: number | string; tone?: 'indigo' | 'emerald' | 'rose' }): JSX.Element {
  const t = tone === 'emerald' ? 'text-emerald-300' : tone === 'rose' ? 'text-rose-300' : tone === 'indigo' ? 'text-indigo-300' : 'text-slate-200'
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-2 text-center">
      <div className={['text-base font-bold', t].join(' ')}>{value}</div>
      <div className="text-[10px] text-slate-500">{label}</div>
    </div>
  )
}

function statusTone(s: string): string {
  if (s === 'completed') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
  if (s === 'needs-attention') return 'border-rose-500/30 bg-rose-500/10 text-rose-300'
  if (s === 'mostly-complete') return 'border-amber-500/30 bg-amber-500/10 text-amber-300'
  if (s === 'active') return 'border-indigo-500/30 bg-indigo-500/10 text-indigo-300'
  return 'border-slate-700 bg-slate-800/60 text-slate-400'
}

function MiniBtn({ icon, label, onClick }: { icon: JSX.Element; label: string; onClick: () => void }): JSX.Element {
  return (
    <button type="button" onClick={onClick} className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800/50 px-2.5 py-1 text-[11px] font-medium text-slate-300 transition hover:bg-slate-700/60">
      {icon}
      {label}
    </button>
  )
}
