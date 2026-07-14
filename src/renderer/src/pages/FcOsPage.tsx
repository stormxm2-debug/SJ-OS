import { useEffect, useMemo, useState } from 'react'
import {
  Building2,
  Users,
  CalendarDays,
  CircleDollarSign,
  Trophy,
  Clock,
  Loader2,
  ChevronRight,
  RefreshCw,
  UserRound
} from 'lucide-react'
import Card from '@renderer/components/ui/Card'
import { useNavigation } from '@renderer/navigation/NavigationContext'
import { ROLE_LABEL } from '@renderer/navigation/roleAccess'
import { useRealtimeSync } from '@renderer/services/commercial/useRealtimeSync'
import { loadStaffTable, setStaffOverviewPrefill, type StaffTableRow } from '@renderer/services/commercial/staffOverviewService'
import { currentMonth } from '@renderer/services/commercial/performanceRecordsService'

/**
 * 내 업무 · 조직 현황 — 실데이터(loadStaffTable) 기반. 예전에는 로컬 데모 저장소
 * (fcRepository/customerRepository/salesActivityRepository)만 읽던 목업 화면이었으나,
 * 관리자 RLS로 전 직원 실집계(고객수·이번달 매출·예정 일정·출근/지각)를 그대로 보여준다.
 * 직원 클릭 → 직원 현황 상세로 이동. 읽기 전용(가짜 조작 버튼 제거).
 */

const RT_TABLES = ['customers', 'performance_entries', 'performance_records', 'schedule_events', 'attendance_records']

function wonShort(n: number): string {
  if (n >= 100_000_000) return `${(n / 100_000_000).toFixed(n % 100_000_000 === 0 ? 0 : 1)}억`
  if (n >= 10_000) return `${Math.round(n / 10_000).toLocaleString('ko-KR')}만`
  return n.toLocaleString('ko-KR')
}
function comma(n: number): string {
  return Math.round(n).toLocaleString('ko-KR')
}

export default function FcOsPage(): JSX.Element {
  const { navigate } = useNavigation()
  const [rows, setRows] = useState<StaffTableRow[]>([])
  const [loading, setLoading] = useState(true)
  const month = currentMonth()

  const load = async (): Promise<void> => {
    setLoading(true)
    setRows(await loadStaffTable(month))
    setLoading(false)
  }
  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month])
  useRealtimeSync(RT_TABLES, () => void load())

  const agg = useMemo(() => {
    return rows.reduce(
      (a, r) => ({
        total: a.total + r.total,
        customers: a.customers + r.customerCount,
        contracts: a.contracts + r.contractCount,
        upcoming: a.upcoming + r.upcoming,
        lateDays: a.lateDays + r.lateDays,
        lateFee: a.lateFee + r.lateFee
      }),
      { total: 0, customers: 0, contracts: 0, upcoming: 0, lateDays: 0, lateFee: 0 }
    )
  }, [rows])

  const top = useMemo(() => [...rows].filter((r) => r.total > 0).sort((a, b) => b.total - a.total).slice(0, 5), [rows])

  const openStaff = (id: string): void => {
    setStaffOverviewPrefill(id)
    navigate({ name: 'staff-overview' })
  }

  return (
    <div className="space-y-5">
      <Card
        title="내 업무 · 조직 현황"
        icon={<Building2 className="h-4 w-4" />}
        action={
          <button type="button" onClick={() => void load()} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-800 bg-white px-2.5 py-1 text-[11px] font-bold text-slate-300 hover:bg-slate-950">
            <RefreshCw className={['h-3 w-3', loading ? 'animate-spin' : ''].join(' ')} /> 새로고침
          </button>
        }
      >
        {loading ? (
          <div className="flex items-center gap-2 py-6 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" /> 실시간 데이터를 불러오는 중…
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Metric icon={<Users className="h-4 w-4" />} label="전체 직원" value={`${rows.length}명`} />
            <Metric icon={<CircleDollarSign className="h-4 w-4" />} label={`${month.slice(5)}월 총매출`} value={`${wonShort(agg.total)}원`} gold />
            <Metric icon={<Trophy className="h-4 w-4" />} label="이번 달 계약" value={`${agg.contracts}건`} />
            <Metric icon={<CalendarDays className="h-4 w-4" />} label="예정 일정" value={`${agg.upcoming}건`} />
            <Metric icon={<UserRound className="h-4 w-4" />} label="관리 고객" value={`${agg.customers}명`} />
            <Metric icon={<Clock className="h-4 w-4" />} label="지각(벌금)" value={`${agg.lateDays}회`} sub={agg.lateFee > 0 ? `${wonShort(agg.lateFee)}원` : undefined} warn={agg.lateDays > 0} />
          </div>
        )}
      </Card>

      {/* 상위 실적 */}
      <Card title="상위 실적 직원" icon={<Trophy className="h-4 w-4" />}>
        {loading ? (
          <p className="text-sm text-slate-500">불러오는 중…</p>
        ) : top.length === 0 ? (
          <p className="text-sm text-slate-500">이번 달 실적 데이터가 없습니다.</p>
        ) : (
          <ol className="space-y-2">
            {top.map((m, i) => (
              <li key={m.id}>
                <button type="button" onClick={() => openStaff(m.id)} className="flex w-full items-center gap-3 rounded-lg border border-slate-800 bg-white px-3 py-2 text-left transition hover:border-[#c6982f]/50">
                  <span className={['w-5 shrink-0 text-center text-sm font-black', i === 0 ? 'text-[#c6982f]' : 'text-slate-500'].join(' ')}>{i + 1}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-bold text-slate-100">
                      {m.name} <span className="text-xs font-medium text-slate-500">· {ROLE_LABEL[m.role as keyof typeof ROLE_LABEL] ?? m.role}</span>
                    </span>
                    <span className="block text-[11px] text-slate-500">계약 {m.contractCount}건 · 고객 {m.customerCount}명</span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block text-sm font-extrabold text-[#b0821f]">{comma(m.total)}원</span>
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
                </button>
              </li>
            ))}
          </ol>
        )}
      </Card>

      {/* 직원별 현황 (실데이터, 클릭 → 상세) */}
      <Card title="직원별 현황" icon={<Users className="h-4 w-4" />} action={<span className="text-xs text-slate-500">{rows.length}명 · 클릭 시 상세</span>}>
        {loading ? (
          <p className="text-sm text-slate-500">불러오는 중…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-slate-500">직원 데이터가 없습니다.</p>
        ) : (
          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {rows.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => openStaff(m.id)}
                className="rounded-xl border border-slate-800 bg-white p-3 text-left transition hover:border-[#c6982f]/50"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-bold text-slate-100">{m.name}</span>
                  <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500">{ROLE_LABEL[m.role as keyof typeof ROLE_LABEL] ?? m.role}</span>
                </div>
                <div className="mt-1.5 text-lg font-black text-[#b0821f]">{comma(m.total)}원</div>
                <div className="mt-1 grid grid-cols-2 gap-x-2 gap-y-0.5 text-[11px] text-slate-500">
                  <span>고객 {m.customerCount}명</span>
                  <span>계약 {m.contractCount}건</span>
                  <span>예정 일정 {m.upcoming}건</span>
                  <span className={m.lateDays > 0 ? 'text-rose-600' : ''}>출근 {m.workDays}일{m.lateDays > 0 ? ` · 지각 ${m.lateDays}` : ''}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}

function Metric({ icon, label, value, sub, gold, warn }: { icon: JSX.Element; label: string; value: string; sub?: string; gold?: boolean; warn?: boolean }): JSX.Element {
  return (
    <div className={['rounded-xl border p-3', gold ? 'border-[#c6982f]/40 bg-gradient-to-br from-[#c6982f]/10 to-white' : 'border-slate-800 bg-white'].join(' ')}>
      <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
        <span className="text-slate-400">{icon}</span>
        {label}
      </div>
      <div className={['mt-1 truncate text-lg font-black', gold ? 'text-[#b0821f]' : 'text-slate-100'].join(' ')}>{value}</div>
      {sub ? <div className={['text-[10px]', warn ? 'font-bold text-rose-600' : 'text-slate-500'].join(' ')}>{sub}</div> : null}
    </div>
  )
}
