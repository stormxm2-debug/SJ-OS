import { useCallback, useEffect, useMemo, useState } from 'react'
import { PhoneCall, Phone, Check, Users, Info, Cake, Sparkles, History, ChevronRight, X } from 'lucide-react'
import { useSession } from '@renderer/navigation/SessionContext'
import { isAdminRole } from '@renderer/navigation/roleAccess'
import { listCustomers, type CustomerDataMode } from '@renderer/services/commercial/customerService'
import type { CustomerRecord } from '@shared/commercial/models'
import { supabaseScheduleAdapter, type ScheduleWithCustomer } from '@renderer/services/commercial/supabaseScheduleAdapter'
import { listConsultations } from '@renderer/services/commercial/consultationService'
import type { ConsultationRecord } from '@shared/commercial/models'
import { listReferrals, updateReferralStatus, type Referral } from '@renderer/services/commercial/referralService'
import {
  listContactLogs,
  logContact,
  computeContactList,
  monthlyContactCount,
  staffContactStats,
  CONTACT_CHANNEL_LABEL,
  CONTACT_REASON_LABEL,
  type ContactLog,
  type ContactChannel,
  type ContactDataMode,
  type ContactItem
} from '@renderer/services/commercial/contactListService'

/**
 * 오늘의 접촉 — 자체생산 영업 2단계. 매일 아침 "오늘 연락할 고객"이 이유와
 * 함께 준비되어 있는 화면.
 *
 * 신호: 소개 첫 콜 대기 → 생일(D-0~7) → 소개 리마인드(7일+) → 90일 무접촉.
 * [연락함] 원탭으로 채널·메모를 기록하면 완료로 내려가고, 그 기록이 곧
 * '마지막 접촉일'이 되어 무접촉 계산이 자동 갱신된다.
 *
 * 접근 범위: 내 리스트는 본인 것만. 관리자에게는 직원 접촉 현황 카드가 별도로
 * 보인다 (내것↔직원것 분리 원칙).
 */

const REASON_CHIP: Record<ContactItem['reason'], string> = {
  'referral-call': 'bg-[#c6982f] text-[#201603]',
  birthday: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
  'referral-remind': 'bg-indigo-50 text-indigo-600 ring-1 ring-indigo-200',
  dormant: 'bg-rose-50 text-rose-600 ring-1 ring-rose-200'
}

const REASON_ICON: Record<ContactItem['reason'], typeof Phone> = {
  'referral-call': Sparkles,
  birthday: Cake,
  'referral-remind': Users,
  dormant: History
}

const CHANNELS: ContactChannel[] = ['call', 'kakao', 'sms']

export default function TodayContactsPage(): JSX.Element {
  const { session } = useSession()
  const admin = isAdminRole(session.role)

  const [customers, setCustomers] = useState<CustomerRecord[]>([])
  const [custMode, setCustMode] = useState<CustomerDataMode>('local-mock')
  const [events, setEvents] = useState<ScheduleWithCustomer[]>([])
  const [consultations, setConsultations] = useState<ConsultationRecord[]>([])
  const [referrals, setReferrals] = useState<Referral[]>([])
  const [logs, setLogs] = useState<ContactLog[]>([])
  const [logMode, setLogMode] = useState<ContactDataMode>('local')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // [연락함] 인라인 기록 폼 상태
  const [openKey, setOpenKey] = useState<string | null>(null)
  const [channel, setChannel] = useState<ContactChannel>('call')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async (): Promise<void> => {
    const [logRes, refRes] = await Promise.all([listContactLogs(), listReferrals()])
    setLogMode(logRes.mode)
    setLogs(logRes.ok ? logRes.logs : [])
    setReferrals(refRes.ok ? refRes.referrals : [])
    if (!logRes.ok) setError(logRes.error ?? '접촉 기록을 불러오지 못했습니다.')
  }, [])

  useEffect(() => {
    let alive = true
    void (async () => {
      const [custRes, evRes, consRes, refRes, logRes] = await Promise.all([
        listCustomers(),
        supabaseScheduleAdapter.listScheduleEvents(),
        listConsultations(),
        listReferrals(),
        listContactLogs()
      ])
      if (!alive) return
      setCustMode(custRes.mode)
      setCustomers(custRes.ok ? custRes.customers : [])
      setEvents(evRes.ok ? evRes.data : [])
      setConsultations(consRes.ok ? consRes.consultations : [])
      setReferrals(refRes.ok ? refRes.referrals : [])
      setLogMode(logRes.mode)
      setLogs(logRes.ok ? logRes.logs : [])
      setError(logRes.ok ? null : (logRes.error ?? '접촉 기록을 불러오지 못했습니다.'))
      setLoading(false)
    })()
    return () => {
      alive = false
    }
  }, [session.id])

  // 내 리스트는 내 데이터로만 계산 (관리자도 자기 콜리스트는 자기 것).
  const myCustomers = useMemo(() => {
    if (custMode !== 'supabase') return customers
    return customers.filter((c) => c.ownerStaffId === session.id)
  }, [customers, custMode, session.id])
  const myLogs = useMemo(() => logs.filter((l) => l.fcId === session.id || logMode !== 'supabase'), [logs, logMode, session.id])
  const myReferrals = useMemo(() => referrals.filter((r) => r.fcId === session.id || logMode !== 'supabase'), [referrals, logMode, session.id])

  const { todo, doneToday } = useMemo(
    () =>
      computeContactList({
        customers: myCustomers,
        events,
        consultations,
        referrals: myReferrals,
        logs: myLogs,
        staffId: session.id
      }),
    [myCustomers, events, consultations, myReferrals, myLogs, session.id]
  )
  const monthCount = useMemo(() => monthlyContactCount(myLogs, session.id), [myLogs, session.id])
  const staffStats = useMemo(() => (admin ? staffContactStats(logs) : []), [admin, logs])

  const openLogForm = (item: ContactItem): void => {
    setOpenKey(item.key)
    setChannel('call')
    setNote('')
  }

  const submitLog = async (item: ContactItem): Promise<void> => {
    if (busy) return
    setBusy(true)
    const res = await logContact(
      {
        customerId: item.customerId,
        customerName: item.name,
        channel,
        reason: item.reason,
        note
      },
      { id: session.id, name: session.name }
    )
    setBusy(false)
    if (!res.ok) {
      setError(res.error ?? '기록에 실패했습니다.')
      return
    }
    setError(null)
    setOpenKey(null)
    await refresh()
  }

  /** 소개 첫 콜 완료 — 소개 파이프라인 상태를 '콜 완료'로 올린다. */
  const finishReferralCall = async (item: ContactItem): Promise<void> => {
    if (!item.referralId || busy) return
    setBusy(true)
    await updateReferralStatus(item.referralId, 'called')
    setBusy(false)
    await refresh()
  }

  const today = new Date()
  const dateLabel = new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', weekday: 'long' }).format(today)

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
          <PhoneCall className="h-5 w-5 text-[#e6c877]" />
          <h1 className="text-lg font-bold">오늘의 접촉</h1>
          <span className="text-xs text-white/50">{dateLabel}</span>
        </div>
        <p className="mt-1 text-xs text-white/60">오늘 연락할 고객이 이유와 함께 준비되어 있습니다. 연락하고 한 번만 눌러 기록하세요.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <span className="rounded-full bg-[#c6982f] px-2.5 py-1 text-[11px] font-bold text-[#201603]">오늘 할 연락 {todo.length}건</span>
          <span className="rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-bold text-white ring-1 ring-white/20">
            오늘 완료 {doneToday.length}건
          </span>
          <span className="rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-bold text-white ring-1 ring-white/20">
            이번 달 {monthCount}건
          </span>
        </div>
      </div>

      {error ? <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-center text-sm text-rose-600">{error}</div> : null}

      {loading ? (
        <div className="rounded-2xl border border-slate-800 bg-white p-8 text-center text-sm text-slate-500">불러오는 중…</div>
      ) : (
        <>
          {/* 오늘 할 연락 */}
          {todo.length === 0 ? (
            <div className="rounded-2xl border border-slate-800 bg-white p-8 text-center">
              <Check className="mx-auto mb-2 h-8 w-8 text-emerald-500" />
              <p className="text-sm font-semibold text-slate-300">오늘 연락할 고객이 없습니다.</p>
              <p className="mt-1 text-xs text-slate-500">소개 첫 콜·생일·소개 리마인드·90일 무접촉 고객이 생기면 자동으로 올라옵니다.</p>
            </div>
          ) : (
            <ul className="space-y-2">
              {todo.map((item) => {
                const Icon = REASON_ICON[item.reason]
                const isOpen = openKey === item.key
                return (
                  <li key={item.key} className="rounded-2xl border border-slate-800 bg-white p-3">
                    <div className="flex items-center gap-3">
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#0e1e3a]">
                        <Icon className="h-5 w-5 text-[#e6c877]" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-sm font-bold text-slate-100">{item.name}</span>
                          <span className={['rounded-full px-1.5 py-0.5 text-[10px] font-bold', REASON_CHIP[item.reason]].join(' ')}>
                            {CONTACT_REASON_LABEL[item.reason]}
                          </span>
                        </div>
                        <p className="mt-0.5 text-[11px] text-slate-500">{item.detail}</p>
                        {item.phone ? (
                          <a
                            href={`tel:${item.phone}`}
                            className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-slate-500 underline-offset-2 hover:underline"
                          >
                            <Phone className="h-3 w-3" />
                            {item.phone}
                          </a>
                        ) : null}
                      </div>
                      {item.reason === 'referral-call' ? (
                        <button
                          type="button"
                          onClick={() => void finishReferralCall(item)}
                          disabled={busy}
                          className="inline-flex shrink-0 items-center gap-1 rounded-xl bg-[#0e1e3a] px-3 py-2 text-xs font-bold text-[#e6c877] transition hover:brightness-125 disabled:opacity-40"
                        >
                          콜 완료 <ChevronRight className="h-3.5 w-3.5" />
                        </button>
                      ) : isOpen ? (
                        <button
                          type="button"
                          onClick={() => setOpenKey(null)}
                          className="rounded-lg p-1.5 text-slate-400 hover:text-slate-200"
                          aria-label="닫기"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => openLogForm(item)}
                          className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-[#c6982f] px-3 py-2 text-xs font-bold text-[#201603] transition hover:brightness-105"
                        >
                          <Check className="h-3.5 w-3.5" /> 연락함
                        </button>
                      )}
                    </div>

                    {/* 인라인 기록 폼: 채널 + 한 줄 메모 */}
                    {isOpen && item.reason !== 'referral-call' ? (
                      <div className="mt-2 space-y-2 rounded-xl border border-slate-800 bg-slate-950 p-3">
                        <div className="flex gap-1.5">
                          {CHANNELS.map((ch) => (
                            <button
                              key={ch}
                              type="button"
                              onClick={() => setChannel(ch)}
                              className={[
                                'flex-1 rounded-lg px-2 py-1.5 text-xs font-bold transition',
                                channel === ch ? 'bg-[#c6982f] text-[#201603]' : 'bg-white text-slate-400 ring-1 ring-slate-800'
                              ].join(' ')}
                            >
                              {CONTACT_CHANNEL_LABEL[ch]}
                            </button>
                          ))}
                        </div>
                        <input
                          value={note}
                          onChange={(e) => setNote(e.target.value)}
                          placeholder="한 줄 메모 (선택)"
                          className="w-full rounded-xl border border-slate-800 bg-white px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-[#c6982f] focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => void submitLog(item)}
                          disabled={busy}
                          className="w-full rounded-xl bg-[#c6982f] px-3 py-2 text-xs font-bold text-[#201603] disabled:opacity-40"
                        >
                          {busy ? '기록 중…' : '접촉 기록 저장'}
                        </button>
                      </div>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          )}

          {/* 오늘 완료 */}
          {doneToday.length > 0 ? (
            <div className="rounded-2xl border border-slate-800 bg-white p-4">
              <h2 className="flex items-center gap-1.5 text-sm font-bold text-slate-100">
                <Check className="h-4 w-4 text-emerald-500" /> 오늘 완료 {doneToday.length}건
              </h2>
              <ul className="mt-2 space-y-1.5">
                {doneToday.map((l) => (
                  <li key={l.id} className="flex items-center gap-2 rounded-xl bg-slate-950 px-3 py-2">
                    <span className="text-xs font-bold text-slate-200">{l.customerName}</span>
                    <span className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700 ring-1 ring-emerald-200">
                      {CONTACT_CHANNEL_LABEL[l.channel]}
                    </span>
                    <span className="text-[11px] text-slate-500">
                      {new Intl.DateTimeFormat('ko-KR', { hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(Date.parse(l.contactedAt)))}
                    </span>
                    {l.note ? <span className="min-w-0 flex-1 truncate text-[11px] text-slate-500">{l.note}</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {/* 관리자: 직원 접촉 현황 */}
          {admin && staffStats.length > 0 ? (
            <div className="rounded-2xl border border-slate-800 bg-white p-4">
              <h2 className="flex items-center gap-1.5 text-sm font-bold text-slate-100">
                <Users className="h-4 w-4 text-[#c6982f]" /> 직원 접촉 현황 <span className="text-[11px] font-normal text-slate-500">(관리자)</span>
              </h2>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-800 text-[11px] text-slate-500">
                      <th className="py-1.5 pr-2">이름</th>
                      <th className="py-1.5 pr-2 text-right">오늘</th>
                      <th className="py-1.5 text-right">이번 달</th>
                    </tr>
                  </thead>
                  <tbody>
                    {staffStats.map((s) => (
                      <tr key={s.fcId} className="border-b border-slate-800/50 last:border-0">
                        <td className="py-2 pr-2 font-bold text-slate-100">{s.fcName}</td>
                        <td className="py-2 pr-2 text-right font-bold text-slate-200">{s.todayCount}건</td>
                        <td className="py-2 text-right text-slate-300">{s.monthCount}건</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          <div className="flex items-start gap-2 rounded-xl border border-dashed border-slate-700 bg-white/60 px-4 py-3 text-[12px] text-slate-500">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              올라오는 기준: <b className="text-slate-300">소개 첫 콜 대기</b> → <b className="text-slate-300">생일 D-0~7</b> →{' '}
              <b className="text-slate-300">소개 요청 7일+ 리마인드</b> → <b className="text-slate-300">90일 무접촉</b>. 연락을 기록하면
              그 즉시 '마지막 접촉일'이 갱신되어 리스트가 자동으로 정리됩니다.
            </span>
          </div>
        </>
      )}
    </div>
  )
}
