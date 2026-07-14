import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Activity,
  CalendarDays,
  CircleDollarSign,
  Users,
  RefreshCw,
  Loader2,
  AlertTriangle,
  Sparkles,
  UserRound,
  PhoneOff,
  ClipboardCheck,
  Trophy,
  UserPlus
} from 'lucide-react'
import Card from '@renderer/components/ui/Card'
import { ROLE_LABEL, type UserRole } from '@renderer/navigation/roleAccess'
import { useRealtimeSync } from '@renderer/services/commercial/useRealtimeSync'
import { SCHEDULE_TYPE_LABEL } from '@renderer/services/commercial/scheduleValidation'
import type { ScheduleType } from '@renderer/services/commercial/scheduleValidation'
import { loadCompanyControl, type CompanyControlSnapshot, type ControlMode } from '@renderer/services/commercial/companyControlService'

/**
 * CEO 관제 센터 — 실데이터(Supabase) 회사 스냅샷. 기존 로컬 목업 위젯을 걷어내고
 * 직원현황·실적·일정·고객·DB·출퇴근을 실시간 집계한다. 관리자/대표 전용(RLS 전 직원).
 */

const RT_TABLES = ['schedule_events', 'leads', 'customers', 'attendance_records', 'customer_registrations', 'performance_records']

const MODE_NOTICE: Record<ControlMode, string | null> = {
  supabase: null,
  local: '데모(로컬) 모드입니다. 실제 회사 데이터는 서버 로그인 후 표시됩니다.',
  'no-session': '로그인 후 회사 데이터가 표시됩니다.'
}

function krw(n: number): string {
  return `₩${Math.round(n).toLocaleString('ko-KR')}`
}
function krwShort(n: number): string {
  if (n >= 100_000_000) return `${(n / 100_000_000).toFixed(1)}억`
  if (n >= 10_000) return `${Math.round(n / 10_000).toLocaleString('ko-KR')}만`
  return n.toLocaleString('ko-KR')
}
function typeLabel(t: string): string {
  return SCHEDULE_TYPE_LABEL[t as ScheduleType] ?? t
}
function fmtTime(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
}

const EMPTY: CompanyControlSnapshot = {
  ok: true,
  mode: 'no-session',
  summary: { staffCount: 0, checkedInToday: 0, monthlyRevenue: 0, todayScheduleCount: 0, newCustomersThisMonth: 0, uncalledLeads: 0, overdueLeads: 0, pendingRegistrations: 0 },
  staff: [],
  todaySchedule: [],
  recentCustomers: []
}

export default function CompanyDashboardView(): JSX.Element {
  const [snap, setSnap] = useState<CompanyControlSnapshot>(EMPTY)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async (): Promise<void> => {
    const res = await loadCompanyControl()
    setSnap(res)
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])
  useRealtimeSync(RT_TABLES, load)

  const { summary, staff, todaySchedule, recentCustomers } = snap
  const notice = MODE_NOTICE[snap.mode]

  const nameById = useMemo(() => new Map(staff.map((s) => [s.id, s.name])), [staff])
  const topStaff = useMemo(() => staff.slice(0, 12), [staff])

  const summaryCards = [
    { label: '직원 수', value: `${summary.staffCount}명`, hint: '활성 직원', tone: 'text-slate-100' },
    { label: '오늘 출근', value: `${summary.checkedInToday}명`, hint: '오늘 체크인', tone: 'text-emerald-300' },
    { label: '이번달 회사 매출', value: krw(summary.monthlyRevenue), hint: '전 직원 합계(단기납 60%)', tone: 'text-amber-300' },
    { label: '오늘 일정', value: `${summary.todayScheduleCount}건`, hint: '전 직원 오늘 일정', tone: 'text-sky-300' },
    { label: '이번달 신규 고객', value: `${summary.newCustomersThisMonth}명`, hint: '이번달 등록', tone: 'text-violet-300' },
    { label: '미콜 DB', value: `${summary.uncalledLeads}건`, hint: summary.overdueLeads > 0 ? `24h 초과 ${summary.overdueLeads}` : '콜 대기', tone: summary.overdueLeads > 0 ? 'text-rose-300' : 'text-slate-100' }
  ]

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-indigo-700/40 bg-gradient-to-br from-blue-600 via-indigo-600 to-violet-700 p-6 shadow-lg shadow-indigo-500/30">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/15 px-3 py-1 text-xs font-medium uppercase tracking-[0.2em] text-white">
              <Sparkles className="h-3.5 w-3.5" /> 실시간 회사 대시보드
            </div>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white">CEO 관제 센터</h1>
            <p className="mt-2 max-w-2xl text-sm text-indigo-100">
              {notice ?? '전 직원의 실적·출근·일정·고객·DB를 실시간으로 집계합니다.'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-2 rounded-xl border border-white/25 bg-white/15 px-3 py-2 text-sm font-medium text-white transition hover:bg-white/25"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} 전체 새로고침
          </button>
        </div>
      </section>

      {snap.error ? (
        <div className="flex items-start gap-2 rounded-xl border border-rose-500/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {snap.error}
        </div>
      ) : null}

      {/* 요약 카드 */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
        {summaryCards.map((card) => (
          <div key={card.label} className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
            <div className="text-[13px] font-medium text-slate-300">{card.label}</div>
            <div className={['mt-2 text-xl font-semibold', card.tone].join(' ')}>{card.value}</div>
            <div className="mt-1 text-[11px] text-slate-500">{card.hint}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        {/* FC별 현황 */}
        <Card
          title="직원별 현황"
          icon={<Trophy className="h-4 w-4 text-indigo-300" />}
          action={<span className="text-xs text-slate-500">{staff.length}명 · 매출순</span>}
        >
          {loading ? (
            <div className="flex items-center gap-2 py-6 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> 불러오는 중…</div>
          ) : topStaff.length === 0 ? (
            <p className="py-4 text-sm text-slate-500">표시할 직원 데이터가 없습니다.</p>
          ) : (
            <ol className="space-y-2">
              {topStaff.map((s, i) => (
                <li key={s.id} className="flex items-center gap-3 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2">
                  <span className="w-5 shrink-0 text-center text-sm font-semibold text-slate-500">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-slate-100">
                      {s.name} <span className="text-xs text-slate-500">· {ROLE_LABEL[s.role as UserRole] ?? s.role}</span>
                    </div>
                    <div className="text-[11px] text-slate-500">
                      고객 {s.customerCount} · 출근 {s.workDays}일 · 예정 {s.upcoming}
                      {s.lateDays > 0 ? <span className="text-rose-300"> · 지각 {s.lateDays}</span> : null}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-sm font-semibold text-amber-300">{krwShort(s.total)}</div>
                    <div className="text-[10px] text-slate-500">{s.perfSource === 'excel' ? '엑셀' : s.perfSource === 'self' ? '입력' : '—'}</div>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </Card>

        <div className="space-y-6">
          {/* 오늘 회사 일정 */}
          <Card title="오늘 회사 일정" icon={<CalendarDays className="h-4 w-4 text-indigo-300" />} action={<span className="text-xs text-slate-500">{todaySchedule.length}건</span>}>
            {todaySchedule.length === 0 ? (
              <p className="text-sm text-slate-500">오늘 등록된 일정이 없습니다.</p>
            ) : (
              <ul className="space-y-2">
                {todaySchedule.slice(0, 8).map((e) => (
                  <li key={e.id} className="flex items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 text-sm">
                    <div className="min-w-0">
                      <div className="truncate text-slate-200">{typeLabel(e.type)} · {e.customerName ?? '고객'}</div>
                      <div className="text-[11px] text-slate-500">{nameById.get(e.staffId) ?? '직원'}</div>
                    </div>
                    <span className="shrink-0 text-[11px] text-slate-400">{fmtTime(e.startsAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {/* 대기 작업 */}
          <Card title="대기 작업" icon={<ClipboardCheck className="h-4 w-4 text-indigo-300" />}>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
                <div className="flex items-center gap-1.5 text-[11px] text-slate-400"><ClipboardCheck className="h-3.5 w-3.5" /> 고객등록 승인</div>
                <div className="mt-1 text-lg font-semibold text-amber-300">{summary.pendingRegistrations}건</div>
              </div>
              <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
                <div className="flex items-center gap-1.5 text-[11px] text-slate-400"><PhoneOff className="h-3.5 w-3.5" /> 24h 초과 미콜</div>
                <div className={['mt-1 text-lg font-semibold', summary.overdueLeads > 0 ? 'text-rose-300' : 'text-slate-100'].join(' ')}>{summary.overdueLeads}건</div>
              </div>
            </div>
          </Card>
        </div>
      </div>

      {/* 최근 고객 */}
      <Card title="최근 신규 고객" icon={<UserPlus className="h-4 w-4 text-indigo-300" />} action={<span className="text-xs text-slate-500">{recentCustomers.length}명</span>}>
        {recentCustomers.length === 0 ? (
          <p className="text-sm text-slate-500">최근 등록된 고객이 없습니다.</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {recentCustomers.map((c) => (
              <div key={c.id} className="flex items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 text-sm">
                <div className="flex min-w-0 items-center gap-2">
                  <UserRound className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                  <span className="truncate text-slate-200">{c.name}</span>
                  {c.source ? <span className="shrink-0 rounded-full bg-violet-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-violet-300">{c.source}</span> : null}
                </div>
                <span className="shrink-0 text-[10px] text-slate-500">{c.createdAt ? new Date(c.createdAt).toLocaleDateString('ko-KR') : ''}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
        <Activity className="h-3 w-3" /> 30초마다 자동 갱신 · 실시간 이벤트 반영
        {summary.staffCount === 0 && !loading ? <span className="text-amber-400"> — 데이터가 비어 있으면 서버 연결/로그인을 확인하세요.</span> : null}
        <Users className="ml-1 h-3 w-3" /> <CircleDollarSign className="h-3 w-3" />
      </div>
    </div>
  )
}
