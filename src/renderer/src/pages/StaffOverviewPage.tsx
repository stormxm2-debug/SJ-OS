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
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  X,
  FileText,
  Image as ImageIcon,
  ExternalLink,
  Paperclip
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
import { getCustomerById } from '@renderer/services/commercial/customerService'
import { signedUrlsFor } from '@renderer/services/commercial/customerFilesStorage'
import { parseRrn, bmiOf } from '@renderer/services/commercial/customerValidation'
import type { CustomerRecord } from '@shared/commercial/models'

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
  const [detailId, setDetailId] = useState<string | null>(null)
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
      {/* 직원 목록 — 모바일: 전체 폭, 직원 선택 시 숨김(2단계) / 데스크톱: 왼쪽 고정 열 */}
      <div
        className={[
          'w-full shrink-0 flex-col rounded-2xl border border-slate-800 bg-white shadow-sm lg:flex lg:w-64',
          selected ? 'hidden' : 'flex'
        ].join(' ')}
      >
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

      {/* 선택 직원 상세 — 모바일: 선택 시 전체 화면(2단계) / 데스크톱: 오른쪽 열 */}
      <div className={['min-w-0 flex-1', selected ? '' : 'hidden lg:block'].join(' ')}>
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
              <div className="flex min-w-0 items-center gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setSelected(null)
                    setOverview(null)
                  }}
                  aria-label="직원 목록으로"
                  className="-ml-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white/80 active:bg-white/10 lg:hidden"
                >
                  <ChevronLeft className="h-5 w-5" />
                </button>
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#c6982f] text-sm font-black text-[#0e1e3a]">
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
                            'flex flex-1 items-center justify-center gap-1 whitespace-nowrap px-1 py-2.5 text-[12px] font-bold transition sm:gap-1.5 sm:px-2',
                            tab === t.key ? 'border-b-2 border-[#c6982f] text-[#b0821f]' : 'text-slate-500 hover:text-slate-300'
                          ].join(' ')}
                        >
                          <Icon className="h-3.5 w-3.5" /> {t.label}
                        </button>
                      )
                    })}
                  </div>
                  <div className="max-h-[52vh] overflow-y-auto overflow-x-auto p-3">
                    {tab === 'customer' ? (
                      overview.customers.length === 0 ? (
                        <Empty text="등록된 고객이 없습니다." />
                      ) : (
                        <>
                          <p className="mb-1.5 text-[11px] text-slate-500">행을 누르면 주민번호·주소·병력·첨부서류까지 전체 정보를 볼 수 있습니다.</p>
                          <table className="w-full text-left text-[12px]">
                            <thead>
                              <tr className="text-[11px] text-slate-500">
                                <th className="py-1.5 font-semibold">이름</th>
                                <th className="font-semibold">전화</th>
                                <th className="font-semibold">유입</th>
                                <th className="font-semibold">등록일</th>
                                <th></th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-800/50">
                              {overview.customers.map((c) => (
                                <tr
                                  key={c.id}
                                  onClick={() => setDetailId(c.id)}
                                  className="cursor-pointer transition hover:bg-slate-950"
                                >
                                  <td className="py-2 font-bold text-slate-100">{c.name}</td>
                                  <td className="text-slate-300">{c.phone ?? '-'}</td>
                                  <td className="text-slate-400">{c.source ?? '-'}</td>
                                  <td className="text-slate-400">{new Date(c.createdAt).toLocaleDateString('ko-KR')}</td>
                                  <td className="text-right text-slate-400">
                                    <ChevronRight className="ml-auto h-3.5 w-3.5" />
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </>
                      )
                    ) : null}

                    {tab === 'schedule' ? (
                      overview.schedules.length === 0 ? (
                        <Empty text="등록된 일정이 없습니다." />
                      ) : (
                        <ScheduleList schedules={overview.schedules} />
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

      {detailId ? <CustomerDetailModal customerId={detailId} onClose={() => setDetailId(null)} /> : null}
    </div>
  )
}

/** 일정 전체 목록 — 예정/지난 두 구획으로 나눠 보여준다. */
function ScheduleList({ schedules }: { schedules: StaffOverview['schedules'] }): JSX.Element {
  const nowIso = new Date().toISOString()
  const upcoming = schedules.filter((s) => s.startsAt >= nowIso).sort((a, b) => a.startsAt.localeCompare(b.startsAt))
  const past = schedules.filter((s) => s.startsAt < nowIso).sort((a, b) => b.startsAt.localeCompare(a.startsAt))
  return (
    <div className="space-y-3">
      {upcoming.length > 0 ? (
        <div>
          <div className="mb-1.5 text-[11px] font-bold text-[#b0821f]">예정 {upcoming.length}건</div>
          <ul className="space-y-2">
            {upcoming.map((s) => (
              <ScheduleItem key={s.id} s={s} past={false} />
            ))}
          </ul>
        </div>
      ) : null}
      {past.length > 0 ? (
        <div>
          <div className="mb-1.5 text-[11px] font-bold text-slate-500">지난 일정 {past.length}건</div>
          <ul className="space-y-2">
            {past.map((s) => (
              <ScheduleItem key={s.id} s={s} past />
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}

const SCHEDULE_STATUS_LABEL: Record<string, string> = { planned: '예정', completed: '완료', cancelled: '취소' }

function ScheduleItem({ s, past }: { s: StaffOverview['schedules'][number]; past: boolean }): JSX.Element {
  return (
    <li className={['flex items-center gap-3 rounded-xl border border-slate-800 px-3 py-2', past ? 'bg-white opacity-80' : 'bg-slate-950'].join(' ')}>
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
      <span className="shrink-0 text-right">
        <span className="block text-[12px] font-semibold text-slate-300">{dt(s.startsAt)}</span>
        {s.status && s.status !== 'planned' ? (
          <span className={['text-[10px] font-bold', s.status === 'cancelled' ? 'text-rose-500' : 'text-emerald-600'].join(' ')}>
            {SCHEDULE_STATUS_LABEL[s.status] ?? s.status}
          </span>
        ) : null}
      </span>
    </li>
  )
}

/** 고객 전체 정보 + 첨부서류(서명URL) 모달 — 관리자 열람 전용. */
function CustomerDetailModal({ customerId, onClose }: { customerId: string; onClose: () => void }): JSX.Element {
  const [customer, setCustomer] = useState<CustomerRecord | null>(null)
  const [urls, setUrls] = useState<Map<string, string>>(new Map())
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    setLoading(true)
    void getCustomerById(customerId).then(async (c) => {
      if (!alive) return
      setCustomer(c)
      if (c && c.attachments.length > 0) {
        const map = await signedUrlsFor(c.attachments)
        if (alive) setUrls(map)
      }
      if (alive) setLoading(false)
    })
    return () => {
      alive = false
    }
  }, [customerId])

  const rrn = parseRrn(customer?.rrn)
  const bmi = bmiOf(customer?.heightCm, customer?.weightKg)

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div
        className="max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-slate-800 bg-white p-4 shadow-xl sm:rounded-2xl sm:p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="flex items-center gap-1.5 text-sm font-extrabold text-slate-100">
            <UserRound className="h-4 w-4 text-[#b0821f]" /> 고객 상세
          </h3>
          <button type="button" onClick={onClose} aria-label="닫기" className="rounded-lg p-1 text-slate-400 hover:text-slate-100">
            <X className="h-5 w-5" />
          </button>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 py-8 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" /> 불러오는 중…
          </div>
        ) : !customer ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-[13px] text-rose-700">고객 정보를 찾을 수 없습니다.</div>
        ) : (
          <div className="space-y-3">
            <div className="rounded-xl bg-[#0e1e3a] px-4 py-3">
              <div className="text-base font-extrabold text-white">{customer.name}</div>
              <div className="mt-0.5 text-[12px] text-slate-300">
                {customer.phone ?? '전화 없음'}
                {rrn ? <span className="ml-2">· 만 {rrn.age}세 · {rrn.gender}</span> : null}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <DetailField label="주민번호" value={customer.rrn} />
              <DetailField label="생년월일" value={rrn?.birthDate} />
              <DetailField label="유입경로" value={customer.source} />
              <DetailField label="관계" value={customer.relation} />
              <DetailField label="키/몸무게" value={customer.heightCm || customer.weightKg ? `${customer.heightCm ?? '-'}cm / ${customer.weightKg ?? '-'}kg${bmi ? ` (BMI ${bmi})` : ''}` : undefined} />
              <DetailField label="등록일" value={new Date(customer.createdAt).toLocaleDateString('ko-KR')} />
            </div>
            <DetailField label="주소" value={customer.address} wide />
            <DetailField label="병력" value={customer.medicalHistory} wide />
            <DetailField label="메모" value={customer.memo} wide />
            {customer.registeredInsurers.length > 0 ? (
              <div>
                <div className="mb-1 text-[11px] font-semibold text-slate-500">등록 보험사</div>
                <div className="flex flex-wrap gap-1.5">
                  {customer.registeredInsurers.map((n) => (
                    <span key={n} className="rounded-full border border-slate-800 bg-slate-950 px-2.5 py-1 text-[11px] font-medium text-slate-300">{n}</span>
                  ))}
                </div>
              </div>
            ) : null}

            {/* 첨부서류 */}
            <div>
              <div className="mb-1.5 flex items-center gap-1 text-[11px] font-semibold text-slate-500">
                <Paperclip className="h-3 w-3" /> 첨부 서류 {customer.attachments.length}건
              </div>
              {customer.attachments.length === 0 ? (
                <p className="text-[12px] text-slate-500">첨부된 서류가 없습니다.</p>
              ) : (
                <div className="grid grid-cols-3 gap-2">
                  {customer.attachments.map((a) => {
                    const url = urls.get(a.path)
                    return (
                      <a
                        key={a.path}
                        href={url ?? undefined}
                        target="_blank"
                        rel="noreferrer"
                        className={['group relative flex aspect-square flex-col items-center justify-center overflow-hidden rounded-xl border border-slate-800 bg-slate-950 text-center', url ? 'cursor-pointer hover:border-[#c6982f]' : 'cursor-not-allowed opacity-60'].join(' ')}
                      >
                        {a.kind === 'image' && url ? (
                          <img src={url} alt={a.name} className="h-full w-full object-cover" />
                        ) : a.kind === 'image' ? (
                          <ImageIcon className="h-6 w-6 text-slate-400" />
                        ) : (
                          <FileText className="h-6 w-6 text-slate-400" />
                        )}
                        <span className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-0.5 truncate bg-black/60 px-1 py-0.5 text-[9px] text-white">
                          {url ? <ExternalLink className="h-2.5 w-2.5" /> : null}
                          {a.kind === 'pdf' ? 'PDF' : truncate(a.name, 8)}
                        </span>
                      </a>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function DetailField({ label, value, wide }: { label: string; value?: string; wide?: boolean }): JSX.Element {
  return (
    <div className={['rounded-xl border border-slate-800 bg-slate-950 px-3 py-2', wide ? 'col-span-2' : ''].join(' ')}>
      <div className="text-[10px] font-semibold text-slate-500">{label}</div>
      <div className="mt-0.5 whitespace-pre-wrap text-[12px] font-medium text-slate-100">{value?.trim() ? value : '-'}</div>
    </div>
  )
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s
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
