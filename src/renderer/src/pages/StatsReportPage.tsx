import { useEffect, useMemo, useState } from 'react'
import { TrendingUp, BarChart3, Users, CalendarDays, UserPlus, FileSignature } from 'lucide-react'
import { useSession } from '@renderer/navigation/SessionContext'
import { isAdminRole } from '@renderer/navigation/roleAccess'
import {
  listEntriesMonth,
  listExcelMonth,
  buildEffectiveMonthly,
  weightedTotal,
  currentMonth,
  type PerformanceEntry
} from '@renderer/services/commercial/performanceRecordsService'
import { listScheduleEvents, type ScheduleWithCustomer } from '@renderer/services/commercial/scheduleService'
import { SCHEDULE_TYPE_LABEL } from '@renderer/services/commercial/scheduleValidation'
import { listCustomers } from '@renderer/services/commercial/customerService'
import { CUSTOMER_STATUS_LABEL } from '@renderer/services/commercial/customerValidation'
import type { CustomerRecord, CustomerStatus } from '@shared/commercial/models'

/**
 * 통계 리포트 — 실적·일정·고객 실데이터를 한 화면에 모아 보여준다.
 *
 * - 최근 6개월 매출 추이(경량 SVG 차트, 의존성 없음), 고객 단계 현황, 이번 달
 *   일정 활동량을 집계한다. 모든 계산은 기존 서비스가 돌려준(RLS 적용) 데이터의
 *   클라이언트 집계 — DB 변경 없음.
 * - 내것↔직원것 분리: 직원은 본인 통계만, 관리자는 "내 통계" 기본 + "전체(직원)"
 *   탭에서 직원별 실적 비교를 본다.
 */

type Scope = 'mine' | 'all'

const FUNNEL_ORDER: CustomerStatus[] = ['new', 'contacted', 'consulting', 'proposal', 'closing', 'contracted']

/** 최근 n개월 키(YYYY-MM) — 오래된 달부터. */
function recentMonths(n: number): string[] {
  const now = new Date()
  const out: string[] = []
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  return out
}

function comma(n: number): string {
  return Math.round(n).toLocaleString('ko-KR')
}

/** 1.2억 / 3,450만 / 9,800 형태의 짧은 금액 표기. */
function fmtShort(n: number): string {
  if (n >= 100000000) return `${(n / 100000000).toFixed(1).replace(/\.0$/, '')}억`
  if (n >= 10000) return `${comma(Math.round(n / 10000))}만`
  return comma(n)
}

export default function StatsReportPage(): JSX.Element {
  const { session } = useSession()
  const admin = isAdminRole(session.role)
  const [scope, setScope] = useState<Scope>('mine')
  const [loading, setLoading] = useState(true)
  const [monthly, setMonthly] = useState<Map<string, PerformanceEntry[]>>(new Map())
  const [events, setEvents] = useState<ScheduleWithCustomer[]>([])
  const [customers, setCustomers] = useState<CustomerRecord[]>([])
  const [customerMode, setCustomerMode] = useState<string>('local-mock')

  const months = useMemo(() => recentMonths(6), [])
  const thisMonth = currentMonth()

  useEffect(() => {
    let alive = true
    void (async () => {
      const [perMonth, sch, cust] = await Promise.all([
        Promise.all(
          months.map(async (m) => {
            const [en, ex] = await Promise.all([listEntriesMonth(m), listExcelMonth(m)])
            return [m, buildEffectiveMonthly(ex.ok ? ex.data : [], en.ok ? en.data : [])] as const
          })
        ),
        listScheduleEvents(),
        listCustomers()
      ])
      if (!alive) return
      setMonthly(new Map(perMonth))
      setEvents(sch.ok ? sch.events : [])
      setCustomerMode(cust.mode)
      setCustomers(cust.ok ? cust.customers : [])
      setLoading(false)
    })()
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id])

  // ---- 범위 필터 (직원은 항상 본인, 관리자는 탭) --------------------------------
  const effScope: Scope = admin ? scope : 'mine'

  const scopeEntries = (m: string): PerformanceEntry[] => {
    const rows = monthly.get(m) ?? []
    return effScope === 'all' ? rows : rows.filter((r) => r.staffId === session.id)
  }
  const scopeEvents = useMemo(
    () => (effScope === 'all' ? events : events.filter((e) => e.staffId === session.id)),
    [events, effScope, session.id]
  )
  const scopeCustomers = useMemo(() => {
    if (customerMode !== 'supabase') return customers
    return effScope === 'all' ? customers : customers.filter((c) => c.ownerStaffId === session.id)
  }, [customers, customerMode, effScope, session.id])

  // ---- 집계 -------------------------------------------------------------------
  const trend = useMemo(
    () =>
      months.map((m) => ({
        month: m,
        total: scopeEntries(m).reduce((sum, r) => sum + weightedTotal(r), 0)
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [monthly, effScope, session.id]
  )
  const nowRows = scopeEntries(thisMonth)
  const nowTotal = nowRows.reduce((s, r) => s + weightedTotal(r), 0)
  const nowContracts = nowRows.reduce((s, r) => s + r.contractCount, 0)

  const monthEvents = useMemo(
    () => scopeEvents.filter((e) => e.startsAt.slice(0, 7) === thisMonth && e.status !== 'cancelled'),
    [scopeEvents, thisMonth]
  )
  const doneEvents = monthEvents.filter((e) => e.status === 'done').length

  const newCustomers = useMemo(
    () => scopeCustomers.filter((c) => c.createdAt.slice(0, 7) === thisMonth).length,
    [scopeCustomers, thisMonth]
  )

  const funnel = useMemo(() => {
    const byStatus = new Map<CustomerStatus, number>()
    for (const c of scopeCustomers) byStatus.set(c.status, (byStatus.get(c.status) ?? 0) + 1)
    return { byStatus, lost: byStatus.get('lost') ?? 0 }
  }, [scopeCustomers])
  const funnelMax = Math.max(1, ...FUNNEL_ORDER.map((s) => funnel.byStatus.get(s) ?? 0))

  const typeCounts = useMemo(() => {
    const map = new Map<string, number>()
    for (const e of monthEvents) map.set(e.type, (map.get(e.type) ?? 0) + 1)
    return [...map.entries()].sort((a, b) => b[1] - a[1])
  }, [monthEvents])

  // 관리자 전체 탭: 직원별 이번 달 실적 (매출 큰 순)
  const staffRows = useMemo(() => {
    if (!(admin && effScope === 'all')) return []
    return [...(monthly.get(thisMonth) ?? [])].sort((a, b) => weightedTotal(b) - weightedTotal(a))
  }, [admin, effScope, monthly, thisMonth])

  const [yy, mm] = thisMonth.split('-')

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      {/* 헤더 — 딥네이비 + 골드 */}
      <div
        className="relative overflow-hidden rounded-2xl p-5 text-white"
        style={{
          background:
            'radial-gradient(480px 180px at 90% -30%, rgba(198,152,47,0.2), rgba(198,152,47,0) 60%), linear-gradient(120deg, #0e1e3a 0%, #16294b 70%, #1d2f57 100%)'
        }}
      >
        <div className="pointer-events-none absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-[#c6982f] to-transparent opacity-80" />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-[#e6c877]" />
            <h1 className="text-lg font-bold">통계 리포트</h1>
            <span className="text-xs text-white/60">
              {yy}년 {Number(mm)}월
            </span>
          </div>
          {admin ? (
            <div className="flex rounded-full bg-white/10 p-0.5 ring-1 ring-white/20">
              {(['mine', 'all'] as Scope[]).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setScope(s)}
                  className={[
                    'rounded-full px-3 py-1 text-[11px] font-bold transition',
                    effScope === s ? 'bg-[#c6982f] text-[#201603]' : 'text-white/70'
                  ].join(' ')}
                >
                  {s === 'mine' ? '내 통계' : '전체 (직원 포함)'}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <p className="mt-1 text-xs text-white/60">실적·일정·고객 데이터를 자동 집계한 리포트입니다.</p>
      </div>

      {loading ? (
        <div className="rounded-2xl border border-slate-800 bg-white p-8 text-center text-sm text-slate-500">집계 중…</div>
      ) : (
        <>
          {/* 요약 카드 */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <SummaryCard
              icon={<BarChart3 className="h-4 w-4" />}
              label="이번 달 매출"
              value={`${fmtShort(nowTotal)}원`}
              sub="단기납 60% 반영"
              gold
            />
            <SummaryCard icon={<FileSignature className="h-4 w-4" />} label="계약 건수" value={`${nowContracts}건`} sub="이번 달" />
            <SummaryCard
              icon={<CalendarDays className="h-4 w-4" />}
              label="일정 진행"
              value={`${doneEvents}/${monthEvents.length}건`}
              sub="완료/전체 (취소 제외)"
            />
            <SummaryCard icon={<UserPlus className="h-4 w-4" />} label="신규 고객" value={`${newCustomers}명`} sub="이번 달 등록" />
          </div>

          {/* 최근 6개월 매출 추이 */}
          <section className="rounded-2xl border border-slate-800 bg-white p-4">
            <h2 className="mb-3 flex items-center gap-1.5 text-sm font-bold text-slate-100">
              <TrendingUp className="h-4 w-4 text-[#c6982f]" /> 최근 6개월 매출 추이
            </h2>
            <TrendChart points={trend.map((t) => ({ label: `${Number(t.month.slice(5))}월`, value: t.total, highlight: t.month === thisMonth }))} />
          </section>

          {/* 고객 단계 현황 */}
          <section className="rounded-2xl border border-slate-800 bg-white p-4">
            <h2 className="mb-3 flex items-center gap-1.5 text-sm font-bold text-slate-100">
              <Users className="h-4 w-4 text-[#c6982f]" /> 고객 단계 현황
              <span className="text-[11px] font-normal text-slate-500">총 {scopeCustomers.length}명</span>
            </h2>
            <div className="space-y-2">
              {FUNNEL_ORDER.map((s) => {
                const n = funnel.byStatus.get(s) ?? 0
                return (
                  <div key={s} className="flex items-center gap-2">
                    <span className="w-16 shrink-0 text-[11px] font-semibold text-slate-300">{CUSTOMER_STATUS_LABEL[s]}</span>
                    <div className="h-4 flex-1 overflow-hidden rounded-full bg-slate-950">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${Math.max(n > 0 ? 4 : 0, (n / funnelMax) * 100)}%`,
                          background: s === 'contracted' ? 'linear-gradient(90deg,#c6982f,#e6c877)' : 'linear-gradient(90deg,#16294b,#2b4a80)'
                        }}
                      />
                    </div>
                    <span className="w-10 shrink-0 text-right text-[12px] font-bold text-slate-100">{n}명</span>
                  </div>
                )
              })}
              {funnel.lost > 0 ? <p className="pt-1 text-right text-[11px] text-slate-500">이탈(가망없음) {funnel.lost}명</p> : null}
            </div>
          </section>

          {/* 이번 달 일정 활동 */}
          <section className="rounded-2xl border border-slate-800 bg-white p-4">
            <h2 className="mb-3 flex items-center gap-1.5 text-sm font-bold text-slate-100">
              <CalendarDays className="h-4 w-4 text-[#c6982f]" /> 이번 달 일정 활동
              <span className="text-[11px] font-normal text-slate-500">
                {monthEvents.length}건 중 {doneEvents}건 완료
              </span>
            </h2>
            {typeCounts.length === 0 ? (
              <p className="py-2 text-center text-[12px] text-slate-500">이번 달 등록된 일정이 없습니다.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {typeCounts.map(([type, n]) => (
                  <span key={type} className="inline-flex items-center gap-1.5 rounded-full bg-slate-950 px-2.5 py-1 text-[11px] font-semibold text-slate-300">
                    {SCHEDULE_TYPE_LABEL[type as keyof typeof SCHEDULE_TYPE_LABEL] ?? type}
                    <b className="text-[#8a6a1e]">{n}건</b>
                  </span>
                ))}
              </div>
            )}
          </section>

          {/* 관리자 전용: 직원별 이번 달 실적 */}
          {admin && effScope === 'all' ? (
            <section className="rounded-2xl border border-slate-800 bg-white p-4">
              <h2 className="mb-3 flex items-center gap-1.5 text-sm font-bold text-slate-100">
                <Users className="h-4 w-4 text-[#c6982f]" /> 직원별 이번 달 실적
                <span className="text-[11px] font-normal text-slate-500">매출 큰 순 · 엑셀 우선 반영</span>
              </h2>
              {staffRows.length === 0 ? (
                <p className="py-2 text-center text-[12px] text-slate-500">이번 달 실적 데이터가 없습니다.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[480px] text-left text-[12px]">
                    <thead>
                      <tr className="border-b border-slate-800 text-[11px] text-slate-500">
                        <th className="py-1.5 pr-2 font-semibold">직원</th>
                        <th className="py-1.5 pr-2 text-right font-semibold">생보</th>
                        <th className="py-1.5 pr-2 text-right font-semibold">손보</th>
                        <th className="py-1.5 pr-2 text-right font-semibold">단기납</th>
                        <th className="py-1.5 pr-2 text-right font-semibold">총매출</th>
                        <th className="py-1.5 text-right font-semibold">건수</th>
                      </tr>
                    </thead>
                    <tbody>
                      {staffRows.map((r, i) => (
                        <tr key={r.staffId} className="border-b border-slate-900">
                          <td className="py-1.5 pr-2 font-semibold text-slate-100">
                            {i < 3 ? <span className="mr-1 text-[#8a6a1e]">{i + 1}위</span> : null}
                            {r.staffName || '(이름 없음)'}
                            {r.staffId === session.id ? <span className="ml-1 rounded bg-indigo-50 px-1 text-[10px] font-bold text-indigo-600">나</span> : null}
                          </td>
                          <td className="py-1.5 pr-2 text-right text-slate-300">{fmtShort(r.life)}</td>
                          <td className="py-1.5 pr-2 text-right text-slate-300">{fmtShort(r.nonLife)}</td>
                          <td className="py-1.5 pr-2 text-right text-slate-300">{fmtShort(r.shortTerm)}</td>
                          <td className="py-1.5 pr-2 text-right font-bold text-slate-100">{fmtShort(weightedTotal(r))}</td>
                          <td className="py-1.5 text-right text-slate-300">{r.contractCount}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          ) : null}
        </>
      )}
    </div>
  )
}

function SummaryCard({
  icon,
  label,
  value,
  sub,
  gold
}: {
  icon: JSX.Element
  label: string
  value: string
  sub?: string
  gold?: boolean
}): JSX.Element {
  if (gold) {
    return (
      <div className="rounded-2xl border border-[#c6982f]/40 bg-gradient-to-br from-[#0e1e3a] to-[#1b3a6b] p-3">
        <div className="flex items-center gap-1.5 text-[11px] font-bold text-[#e6c877]">
          {icon}
          {label}
        </div>
        <div className="mt-1 truncate text-lg font-black text-white">{value}</div>
        {sub ? <div className="text-[10px] text-slate-300">{sub}</div> : null}
      </div>
    )
  }
  return (
    <div className="rounded-2xl border border-slate-800 bg-white p-3">
      <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-500">
        {icon}
        {label}
      </div>
      <div className="mt-1 truncate text-lg font-black text-slate-100">{value}</div>
      {sub ? <div className="text-[10px] text-slate-500">{sub}</div> : null}
    </div>
  )
}

/** 경량 SVG 막대 차트 — 의존성 없음. 이번 달은 골드로 강조. */
function TrendChart({ points }: { points: { label: string; value: number; highlight?: boolean }[] }): JSX.Element {
  const W = 336
  const H = 148
  const max = Math.max(1, ...points.map((p) => p.value))
  const slot = W / points.length
  const barW = Math.min(36, slot * 0.55)
  const allZero = points.every((p) => p.value === 0)

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="최근 6개월 매출 추이">
      {/* 기준선 */}
      <line x1={0} y1={118} x2={W} y2={118} stroke="#e2e8f0" strokeWidth={1} />
      {allZero ? (
        <text x={W / 2} y={70} textAnchor="middle" fontSize={12} fill="#94a3b8">
          아직 실적 데이터가 없습니다
        </text>
      ) : (
        points.map((p, i) => {
          const h = Math.round((p.value / max) * 86)
          const x = slot * i + (slot - barW) / 2
          const y = 118 - h
          return (
            <g key={p.label}>
              <rect
                x={x}
                y={y}
                width={barW}
                height={Math.max(h, p.value > 0 ? 3 : 0)}
                rx={4}
                fill={p.highlight ? '#c6982f' : '#16294b'}
              />
              {p.value > 0 ? (
                <text x={x + barW / 2} y={y - 5} textAnchor="middle" fontSize={9} fontWeight={700} fill={p.highlight ? '#8a6a1e' : '#334155'}>
                  {fmtShort(p.value)}
                </text>
              ) : null}
            </g>
          )
        })
      )}
      {points.map((p, i) => (
        <text
          key={`l-${p.label}`}
          x={slot * i + slot / 2}
          y={135}
          textAnchor="middle"
          fontSize={10}
          fontWeight={p.highlight ? 700 : 400}
          fill={p.highlight ? '#8a6a1e' : '#64748b'}
        >
          {p.label}
        </text>
      ))}
    </svg>
  )
}
