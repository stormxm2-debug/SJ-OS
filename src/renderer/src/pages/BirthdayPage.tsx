import { useEffect, useMemo, useState } from 'react'
import { Cake, ChevronLeft, ChevronRight, Share2, Phone, Check, Users, Info } from 'lucide-react'
import { useSession } from '@renderer/navigation/SessionContext'
import { isAdminRole } from '@renderer/navigation/roleAccess'
import { listCustomers, type CustomerDataMode } from '@renderer/services/commercial/customerService'
import type { CustomerRecord } from '@shared/commercial/models'
import {
  toBirthdays,
  upcomingBirthdays,
  birthdaysInMonth,
  buildBirthdayMessage,
  type CustomerBirthday
} from '@renderer/services/commercial/birthdayService'
import { shareMeetingText } from '@renderer/services/share/meetingShare'

/**
 * 생일 챙기기 — 이미 등록된 고객의 주민번호/생년월일에서 생일을 자동 계산해
 * 월별로 보여주고, 카톡 축하 메시지를 바로 보낼 수 있는 화면. DB 변경 없음.
 *
 * 접근 범위: FC는 본인 고객만(RLS), 관리자는 "내 고객 기본 + 직원 고객 토글"
 * (내것↔직원것 분리 원칙). 직원 고객에는 담당 FC 배지를 붙인다.
 */

export default function BirthdayPage(): JSX.Element {
  const { session } = useSession()
  const admin = isAdminRole(session.role)
  const [customers, setCustomers] = useState<CustomerRecord[]>([])
  const [mode, setMode] = useState<CustomerDataMode>('local-mock')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [monthOffset, setMonthOffset] = useState(0)
  const [includeStaff, setIncludeStaff] = useState(false)
  const [shared, setShared] = useState<Record<string, 'shared' | 'copied' | 'failed'>>({})

  useEffect(() => {
    let alive = true
    void (async () => {
      const res = await listCustomers()
      if (!alive) return
      setMode(res.mode)
      setCustomers(res.ok ? res.customers : [])
      setError(res.ok ? null : (res.error ?? '고객 목록을 불러오지 못했습니다.'))
      setLoading(false)
    })()
    return () => {
      alive = false
    }
  }, [session.id])

  // 내 고객 기본 — 관리자가 토글을 켜면 직원 고객까지 포함 (담당 배지 표시).
  // 로컬목업/데모 모드에서는 소유자 id가 세션과 달라 전부로 취급한다.
  const base = useMemo(() => {
    if (mode !== 'supabase') return customers
    if (admin && includeStaff) return customers
    return customers.filter((c) => c.ownerStaffId === session.id)
  }, [customers, mode, admin, includeStaff, session.id])

  const birthdays = useMemo(() => toBirthdays(base), [base])
  const todayList = useMemo(() => upcomingBirthdays(birthdays, 0), [birthdays])
  const weekList = useMemo(() => upcomingBirthdays(birthdays, 7), [birthdays])

  const now = new Date()
  const viewDate = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1)
  const viewMonth = viewDate.getMonth() + 1
  const monthList = useMemo(() => birthdaysInMonth(birthdays, viewMonth), [birthdays, viewMonth])
  const missingCount = base.length - birthdays.length

  const sendCongrats = async (b: CustomerBirthday): Promise<void> => {
    const outcome = await shareMeetingText(buildBirthdayMessage(b.customer.name, session.name))
    setShared((s) => ({ ...s, [b.customer.id]: outcome }))
    window.setTimeout(() => {
      setShared((s) => {
        const next = { ...s }
        delete next[b.customer.id]
        return next
      })
    }, 3000)
  }

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
        <div className="flex items-center gap-2">
          <Cake className="h-5 w-5 text-[#e6c877]" />
          <h1 className="text-lg font-bold">생일 챙기기</h1>
        </div>
        <p className="mt-1 text-xs text-white/60">
          고객 정보의 주민번호·생년월일로 자동 계산됩니다. 카톡 버튼으로 축하 메시지를 바로 보내세요.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <span className="rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-bold text-white ring-1 ring-white/20">
            오늘 {todayList.length}명
          </span>
          <span className="rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-bold text-white ring-1 ring-white/20">
            7일 내 {weekList.length}명
          </span>
          <span className="rounded-full bg-[#c6982f] px-2.5 py-1 text-[11px] font-bold text-[#201603]">
            {viewMonth}월 {monthList.length}명
          </span>
        </div>
      </div>

      {/* 관리자: 직원 고객 포함 토글 */}
      {admin ? (
        <label className="flex cursor-pointer items-center justify-between rounded-xl border border-slate-800 bg-white px-4 py-3">
          <span className="flex items-center gap-2 text-sm font-semibold text-slate-200">
            <Users className="h-4 w-4 text-[#c6982f]" /> 직원 고객 포함
            <span className="text-[11px] font-normal text-slate-500">(기본은 내 고객만)</span>
          </span>
          <input
            type="checkbox"
            checked={includeStaff}
            onChange={(e) => setIncludeStaff(e.target.checked)}
            className="h-4 w-4 accent-[#c6982f]"
          />
        </label>
      ) : null}

      {/* 월 이동 */}
      <div className="flex items-center justify-between rounded-xl border border-slate-800 bg-white px-3 py-2">
        <button
          type="button"
          onClick={() => setMonthOffset((v) => v - 1)}
          className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-950 hover:text-slate-200"
          aria-label="이전 달"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <div className="text-sm font-bold text-slate-100">
          {viewDate.getFullYear()}년 {viewMonth}월
          {monthOffset !== 0 ? (
            <button
              type="button"
              onClick={() => setMonthOffset(0)}
              className="ml-2 rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[10px] font-bold text-indigo-600"
            >
              이번 달
            </button>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => setMonthOffset((v) => v + 1)}
          className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-950 hover:text-slate-200"
          aria-label="다음 달"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>

      {/* 목록 */}
      {loading ? (
        <div className="rounded-2xl border border-slate-800 bg-white p-8 text-center text-sm text-slate-500">불러오는 중…</div>
      ) : error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-center text-sm text-rose-600">{error}</div>
      ) : monthList.length === 0 ? (
        <div className="rounded-2xl border border-slate-800 bg-white p-8 text-center">
          <Cake className="mx-auto mb-2 h-8 w-8 text-slate-400" />
          <p className="text-sm font-semibold text-slate-300">{viewMonth}월에 생일인 고객이 없습니다.</p>
          <p className="mt-1 text-xs text-slate-500">주민번호나 생년월일이 등록된 고객만 표시됩니다.</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {monthList.map((b) => {
            const isToday = b.dDay === 0
            const soon = b.dDay > 0 && b.dDay <= 30
            const other = b.customer.ownerStaffId !== session.id && mode === 'supabase'
            const outcome = shared[b.customer.id]
            return (
              <li
                key={b.customer.id}
                className={[
                  'flex items-center gap-3 rounded-2xl border bg-white p-3',
                  isToday ? 'border-[#c6982f] shadow-[0_0_0_1px_#c6982f]' : 'border-slate-800'
                ].join(' ')}
              >
                {/* 날짜 뱃지 */}
                <div
                  className={[
                    'flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-xl',
                    isToday ? 'bg-[#0e1e3a] text-[#e6c877]' : 'bg-slate-950 text-slate-300'
                  ].join(' ')}
                >
                  <span className="text-[10px] font-bold leading-none">{b.month}월</span>
                  <span className="text-lg font-black leading-tight">{b.day}</span>
                </div>

                {/* 이름·정보 */}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-sm font-bold text-slate-100">{b.customer.name}</span>
                    {b.turningAge !== undefined ? (
                      <span className="text-[11px] text-slate-500">만 {b.turningAge}세</span>
                    ) : null}
                    {isToday ? (
                      <span className="rounded-full bg-[#c6982f] px-1.5 py-0.5 text-[10px] font-bold text-[#201603]">오늘 🎉</span>
                    ) : soon ? (
                      <span className="rounded-full bg-indigo-50 px-1.5 py-0.5 text-[10px] font-bold text-indigo-600 ring-1 ring-indigo-200">
                        D-{b.dDay}
                      </span>
                    ) : null}
                    {other ? (
                      <span className="rounded-full border border-[#c6982f]/40 bg-[#c6982f]/10 px-1.5 py-0.5 text-[10px] font-bold text-[#8a6a1e]">
                        담당 {b.customer.ownerStaffName || '직원'}
                      </span>
                    ) : null}
                  </div>
                  {b.customer.phone ? (
                    <a
                      href={`tel:${b.customer.phone}`}
                      className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-slate-500 underline-offset-2 hover:underline"
                    >
                      <Phone className="h-3 w-3" />
                      {b.customer.phone}
                    </a>
                  ) : null}
                </div>

                {/* 카톡 축하 */}
                <button
                  type="button"
                  onClick={() => void sendCongrats(b)}
                  className={[
                    'inline-flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold transition',
                    outcome === 'shared' || outcome === 'copied'
                      ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
                      : 'bg-[#FEE500] text-[#191919] hover:brightness-95'
                  ].join(' ')}
                >
                  {outcome === 'shared' ? (
                    <>
                      <Check className="h-3.5 w-3.5" /> 공유됨
                    </>
                  ) : outcome === 'copied' ? (
                    <>
                      <Check className="h-3.5 w-3.5" /> 복사됨
                    </>
                  ) : (
                    <>
                      <Share2 className="h-3.5 w-3.5" /> 카톡 축하
                    </>
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {/* 생일 정보 없는 고객 안내 */}
      {!loading && missingCount > 0 ? (
        <div className="flex items-start gap-2 rounded-xl border border-dashed border-slate-700 bg-white/60 px-4 py-3 text-[12px] text-slate-500">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            생일 정보가 없는 고객이 <b className="text-slate-300">{missingCount}명</b> 있습니다. 고객 관리에서 주민등록번호 또는
            생년월일을 입력하면 자동으로 여기에 표시됩니다.
          </span>
        </div>
      ) : null}
    </div>
  )
}
