import { useEffect, useMemo, useState } from 'react'
import {
  Users,
  Search,
  Loader2,
  UserRound,
  CalendarDays,
  ClipboardList,
  BarChart3,
  Clock,
  MapPin,
  Phone,
  RefreshCw
} from 'lucide-react'
import {
  listOverviewStaff,
  loadStaffOverview,
  takeStaffOverviewPrefill,
  type OverviewStaff,
  type StaffOverview
} from '@renderer/services/commercial/staffOverviewService'
import { currentMonth, CATEGORY_LABEL } from '@renderer/services/commercial/performanceRecordsService'
import { SCHEDULE_TYPE_LABEL } from '@renderer/services/commercial/scheduleValidation'
import { ROLE_LABEL } from '@renderer/navigation/roleAccess'

/**
 * 관리자 전용 "직원 현황" — 직원을 선택하면 그 직원의 데이터 전체(고객·일정·
 * 상담·실적·출퇴근)를 요약 카드 + 탭으로 한눈에 본다. 읽기 전용.
 */

type Tab = 'customer' | 'schedule' | 'consult' | 'perf' | 'attendance'

const TABS: { key: Tab; label: string; icon: typeof UserRound }[] = [
  { key: 'customer', label: '고객', icon: UserRound },
  { key: 'schedule', label: '일정', icon: CalendarDays },
  { key: 'consult', label: '상담', icon: ClipboardList },
  { key: 'perf', label: '실적', icon: BarChart3 },
  { key: 'attendance', label: '출퇴근', icon: Clock }
]

function krw(n: number): string {
  return `${n.toLocaleString('ko-KR')}원`
}
function dt(iso?: string): string {
  if (!iso) return '-'
  const d = new Date(iso)
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export default function StaffOverviewPage(): JSX.Element {
  const [staff, setStaff] = useState<OverviewStaff[]>([])
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<OverviewStaff | null>(null)
  const [overview, setOverview] = useState<StaffOverview | null>(null)
  const [loading, setLoading] = useState(false)
  const [tab, setTab] = useState<Tab>('customer')
  const month = currentMonth()

  useEffect(() => {
    void listOverviewStaff().then((list) => {
      setStaff(list)
      // 정리표에서 행 클릭으로 넘어온 경우 해당 직원 자동 선택
      const pre = takeStaffOverviewPrefill()
      const target = pre ? list.find((s) => s.id === pre) : undefined
      if (target) void pick(target)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return staff
    return staff.filter((s) => s.name.toLowerCase().includes(q) || (s.phone ?? '').includes(q))
  }, [staff, query])

  const pick = async (s: OverviewStaff): Promise<void> => {
    setSelected(s)
    setLoading(true)
    setOverview(null)
    const data = await loadStaffOverview(s.id, month)
    setOverview(data)
    setLoading(false)
  }

  const reload = async (): Promise<void> => {
    if (selected) await pick(selected)
  }

  return (
    <div className="flex h-full min-h-[70vh] gap-4">
      {/* 왼쪽: 직원 목록 */}
      <div className="flex w-64 shrink-0 flex-col rounded-2xl border border-slate-800 bg-white shadow-sm">
        <div className="border-b border-slate-800 p-3">
          <div className="mb-2 flex items-center gap-2">
            <Users className="h-4 w-4 text-[#b0821f]" />
            <h2 className="text-sm font-extrabold text-slate-100">직원 현황</h2>
            <span className="ml-auto rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500">{staff.length}명</span>
          </div>
          <div className="flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-950 px-2 py-1.5">
            <Search className="h-3.5 w-3.5 text-slate-500" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="이름/전화 검색"
              className="w-full bg-transparent text-[12px] text-slate-100 outline-none placeholder:text-slate-500"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-1.5">
          {filtered.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => void pick(s)}
              className={[
                'flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left transition',
                selected?.id === s.id ? 'bg-[#0e1e3a] text-white' : 'hover:bg-slate-950'
              ].join(' ')}
            >
              <span
                className={[
                  'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[12px] font-bold',
                  selected?.id === s.id ? 'bg-[#c6982f] text-[#0e1e3a]' : 'bg-slate-100 text-slate-500'
                ].join(' ')}
              >
                {s.name.slice(0, 1)}
              </span>
              <span className="min-w-0">
                <span className={['block truncate text-[13px] font-bold', selected?.id === s.id ? 'text-white' : 'text-slate-100'].join(' ')}>{s.name}</span>
                <span className={['block text-[10px]', selected?.id === s.id ? 'text-slate-300' : 'text-slate-500'].join(' ')}>
                  {ROLE_LABEL[s.role as keyof typeof ROLE_LABEL] ?? s.role}
                </span>
              </span>
            </button>
          ))}
          {filtered.length === 0 ? <p className="p-3 text-center text-[12px] text-slate-500">검색 결과 없음</p> : null}
        </div>
      </div>

      {/* 오른쪽: 선택 직원 상세 */}
      <div className="min-w-0 flex-1">
        {!selected ? (
          <div className="flex h-full items-center justify-center rounded-2xl border border-dashed border-slate-700 bg-slate-950/50">
            <div className="text-center">
              <Users className="mx-auto h-10 w-10 text-slate-400" />
              <p className="mt-2 text-sm font-semibold text-slate-400">왼쪽에서 직원을 선택하세요</p>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {/* 헤더 */}
            <div className="flex items-center justify-between rounded-2xl border border-slate-800 bg-[#0e1e3a] px-4 py-3">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#c6982f] text-sm font-black text-[#0e1e3a]">
                  {selected.name.slice(0, 1)}
                </span>
                <div>
                  <div className="text-sm font-extrabold text-white">{selected.name}</div>
                  <div className="text-[11px] text-slate-300">
                    {ROLE_LABEL[selected.role as keyof typeof ROLE_LABEL] ?? selected.role}
                    {selected.phone ? (
                      <span className="ml-2 inline-flex items-center gap-1">
                        <Phone className="h-3 w-3" />
                        {selected.phone}
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => void reload()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-white/20 px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-white/10"
              >
                <RefreshCw className={['h-3.5 w-3.5', loading ? 'animate-spin' : ''].join(' ')} /> 새로고침
              </button>
            </div>

            {loading ? (
              <div className="flex items-center gap-2 rounded-2xl border border-slate-800 bg-white p-6 text-sm text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" /> {selected.name} 님의 데이터를 불러오는 중…
              </div>
            ) : overview ? (
              <>
                {/* 요약 카드 */}
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  <SummaryCard label="고객" value={`${overview.customerCount}명`} sub="등록 고객" />
                  <SummaryCard label={`${month.slice(5)}월 총매출`} value={krw(overview.perf.total)} sub={overview.perf.source === 'excel' ? '관리자 엑셀 기준' : overview.perf.source === 'self' ? `본인 입력 ${overview.perf.contractCount}건` : '입력 없음'} gold />
                  <SummaryCard label="이번달 출근" value={`${overview.attendance.workDays}일`} sub={overview.attendance.lateDays > 0 ? `지각 ${overview.attendance.lateDays}회 · 벌금 ${krw(overview.attendance.lateFee)}` : '지각 없음'} warn={overview.attendance.lateDays > 0} />
                  <SummaryCard label="예정 일정" value={`${overview.upcoming.length}건`} sub={overview.upcoming[0] ? `다음: ${dt(overview.upcoming[0].startsAt)}` : '없음'} />
                </div>

                {/* 탭 */}
                <div className="rounded-2xl border border-slate-800 bg-white shadow-sm">
                  <div className="flex border-b border-slate-800">
                    {TABS.map((t) => {
                      const Icon = t.icon
                      return (
                        <button
                          key={t.key}
                          type="button"
                          onClick={() => setTab(t.key)}
                          className={[
                            'flex flex-1 items-center justify-center gap-1.5 px-2 py-2.5 text-[12px] font-bold transition',
                            tab === t.key ? 'border-b-2 border-[#c6982f] text-[#b0821f]' : 'text-slate-500 hover:text-slate-300'
                          ].join(' ')}
                        >
                          <Icon className="h-3.5 w-3.5" /> {t.label}
                        </button>
                      )
                    })}
                  </div>
                  <div className="max-h-[52vh] overflow-y-auto p-3">
                    {tab === 'customer' ? (
                      overview.customers.length === 0 ? (
                        <Empty text="등록된 고객이 없습니다." />
                      ) : (
                        <table className="w-full text-left text-[12px]">
                          <thead>
                            <tr className="text-[11px] text-slate-500">
                              <th className="py-1.5 font-semibold">이름</th>
                              <th className="font-semibold">전화</th>
                              <th className="font-semibold">유입</th>
                              <th className="font-semibold">등록일</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-800/50">
                            {overview.customers.map((c) => (
                              <tr key={c.id}>
                                <td className="py-2 font-bold text-slate-100">{c.name}</td>
                                <td className="text-slate-300">{c.phone ?? '-'}</td>
                                <td className="text-slate-400">{c.source ?? '-'}</td>
                                <td className="text-slate-400">{new Date(c.createdAt).toLocaleDateString('ko-KR')}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )
                    ) : null}

                    {tab === 'schedule' ? (
                      overview.upcoming.length === 0 ? (
                        <Empty text="예정된 일정이 없습니다." />
                      ) : (
                        <ul className="space-y-2">
                          {overview.upcoming.map((s) => (
                            <li key={s.id} className="flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-950 px-3 py-2">
                              <span className="rounded-lg bg-[#0e1e3a] px-2 py-1 text-[10px] font-bold text-[#e6c877]">
                                {SCHEDULE_TYPE_LABEL[s.type as keyof typeof SCHEDULE_TYPE_LABEL] ?? s.type}
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-[13px] font-bold text-slate-100">{s.customerName ?? s.title ?? '일정'}</span>
                                {s.location ? (
                                  <span className="flex items-center gap-1 text-[10px] text-slate-500">
                                    <MapPin className="h-3 w-3" />
                                    {s.location}
                                  </span>
                                ) : null}
                              </span>
                              <span className="shrink-0 text-[12px] font-semibold text-slate-300">{dt(s.startsAt)}</span>
                            </li>
                          ))}
                        </ul>
                      )
                    ) : null}

                    {tab === 'consult' ? (
                      overview.consultations.length === 0 ? (
                        <Empty text="상담 기록이 없습니다." />
                      ) : (
                        <ul className="space-y-2">
                          {overview.consultations.map((c) => (
                            <li key={c.id} className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2">
                              <div className="flex items-center justify-between">
                                <span className="text-[12px] font-bold text-slate-100">
                                  {c.customerName ?? '고객'}
                                  {c.type ? <span className="ml-1.5 text-[10px] font-medium text-slate-500">{c.type}</span> : null}
                                </span>
                                <span className="text-[10px] text-slate-500">{dt(c.createdAt)}</span>
                              </div>
                              <p className="mt-1 line-clamp-2 text-[12px] leading-5 text-slate-300">{c.summary}</p>
                            </li>
                          ))}
                        </ul>
                      )
                    ) : null}

                    {tab === 'perf' ? (
                      <div className="space-y-3">
                        <div className="grid grid-cols-3 gap-2">
                          <PerfCell label={CATEGORY_LABEL.life} value={krw(overview.perf.life)} />
                          <PerfCell label={CATEGORY_LABEL['non-life']} value={krw(overview.perf.nonLife)} />
                          <PerfCell label={`${CATEGORY_LABEL['short-term']} (60% 반영)`} value={krw(overview.perf.shortTerm)} />
                        </div>
                        <div className="flex items-center justify-between rounded-xl bg-[#0e1e3a] px-4 py-3">
                          <span className="text-[12px] font-bold text-slate-300">{month} 총매출 (생보+손보+단기납×60%)</span>
                          <span className="text-lg font-black text-[#e6c877]">{krw(overview.perf.total)}</span>
                        </div>
                        <p className="text-[11px] text-slate-500">
                          {overview.perf.source === 'excel' ? '관리자 엑셀 업로드 값 기준 (본인 입력보다 우선)' : overview.perf.source === 'self' ? `본인 건별 입력 ${overview.perf.contractCount}건 집계` : '이번 달 입력된 실적이 없습니다.'}
                        </p>
                      </div>
                    ) : null}

                    {tab === 'attendance' ? (
                      <div className="space-y-3">
                        <div className="grid grid-cols-3 gap-2">
                          <PerfCell label="이번달 출근" value={`${overview.attendance.workDays}일`} />
                          <PerfCell label="지각" value={`${overview.attendance.lateDays}회`} />
                          <PerfCell label="벌금 누적" value={krw(overview.attendance.lateFee)} />
                        </div>
                        <p className="text-[11px] text-slate-500">최근 출근: {dt(overview.attendance.lastCheckIn)} · 상세 기록은 출퇴근 관리 화면에서 확인하세요.</p>
                      </div>
                    ) : null}
                  </div>
                </div>
              </>
            ) : (
              <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-[13px] text-rose-700">데이터를 불러오지 못했습니다. 새로고침을 눌러주세요.</div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function SummaryCard({ label, value, sub, gold, warn }: { label: string; value: string; sub?: string; gold?: boolean; warn?: boolean }): JSX.Element {
  return (
    <div className={['rounded-2xl border p-3.5 shadow-sm', gold ? 'border-[#c6982f]/40 bg-gradient-to-br from-[#c6982f]/10 to-white' : 'border-slate-800 bg-white'].join(' ')}>
      <div className="text-[11px] font-semibold text-slate-500">{label}</div>
      <div className={['mt-1 text-xl font-black', gold ? 'text-[#b0821f]' : 'text-slate-100'].join(' ')}>{value}</div>
      {sub ? <div className={['mt-0.5 text-[10px]', warn ? 'font-bold text-rose-600' : 'text-slate-500'].join(' ')}>{sub}</div> : null}
    </div>
  )
}

function PerfCell({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2.5">
      <div className="text-[10px] font-semibold text-slate-500">{label}</div>
      <div className="mt-0.5 text-[14px] font-extrabold text-slate-100">{value}</div>
    </div>
  )
}

function Empty({ text }: { text: string }): JSX.Element {
  return <p className="py-8 text-center text-[12px] text-slate-500">{text}</p>
}
