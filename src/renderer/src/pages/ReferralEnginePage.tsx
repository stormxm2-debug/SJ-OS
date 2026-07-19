import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Sparkles,
  Users,
  Trophy,
  Share2,
  Check,
  Phone,
  Trash2,
  Plus,
  Info,
  ChevronRight,
  X,
  UserPlus,
  QrCode,
  Copy
} from 'lucide-react'
import QRCode from 'qrcode'
import { useSession } from '@renderer/navigation/SessionContext'
import { isAdminRole } from '@renderer/navigation/roleAccess'
import { listCustomers, type CustomerDataMode } from '@renderer/services/commercial/customerService'
import type { CustomerRecord } from '@shared/commercial/models'
import { supabaseScheduleAdapter, type ScheduleWithCustomer } from '@renderer/services/commercial/supabaseScheduleAdapter'
import { shareMeetingText } from '@renderer/services/share/meetingShare'
import { copyText } from '@renderer/services/share/clipboard'
import {
  listReferrals,
  createReferralAsk,
  createReferral,
  convertAskToReceived,
  updateReferralStatus,
  deleteReferral,
  computeGoldenMoments,
  referralFunnel,
  fcLeaderboard,
  monthlyCounts,
  buildReferralAskMessage,
  buildApplyLink,
  buildCompanyApplyLink,
  buildApplyShareMessage,
  nextReferralStatus,
  REFERRAL_STATUS_LABEL,
  GOLDEN_REASON_LABEL,
  type Referral,
  type ReferralDataMode,
  type ReferralStatus,
  type GoldenMoment
} from '@renderer/services/commercial/referralService'

/**
 * 소개 영업 엔진 — DB 구매 대신 자체생산: 기존 고객의 소개를 체계적으로
 * 요청·추적·전환하는 화면.
 *
 * ① 골든타임: 계약·증권전달·클로징 직후(14일)·생일 임박 고객 = 지금 소개를
 *    요청하기 가장 좋은 순간. 카톡 요청 버튼 한 번으로 문안 공유 + 요청 기록.
 * ② 소개 현황: 요청함 → 소개받음 → 콜 → 상담 → 계약/무산 파이프라인 관리.
 * ③ 성과: 내 퍼널 + (관리자) FC별 리더보드.
 *
 * 접근 범위: FC는 본인 것만(RLS), 관리자는 "내 것 기본 + 직원 것 토글".
 */

type Tab = 'golden' | 'pipeline' | 'stats' | 'funnel'

const STATUS_CHIP: Record<ReferralStatus, string> = {
  asked: 'bg-slate-950 text-slate-300 ring-1 ring-slate-800',
  received: 'bg-indigo-50 text-indigo-600 ring-1 ring-indigo-200',
  called: 'bg-sky-50 text-sky-600 ring-1 ring-sky-200',
  consulted: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
  contracted: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
  failed: 'bg-rose-50 text-rose-600 ring-1 ring-rose-200'
}

const REASON_CHIP: Record<GoldenMoment['reason'], string> = {
  contract: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
  delivery: 'bg-indigo-50 text-indigo-600 ring-1 ring-indigo-200',
  closing: 'bg-sky-50 text-sky-600 ring-1 ring-sky-200',
  birthday: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200'
}

/** 받침 유무에 따라 '으로/로'를 붙인다 (상담으로/계약으로, 콜 완료로). */
function withRo(word: string): string {
  const last = word.charCodeAt(word.length - 1)
  const hasBatchim = last >= 0xac00 && last <= 0xd7a3 && (last - 0xac00) % 28 !== 0
  return `${word}${hasBatchim ? '으로' : '로'}`
}

interface ReferralFormState {
  referrerCustomerId: string // '' = 직접 입력
  referrerName: string
  referredName: string
  referredPhone: string
  relation: string
  memo: string
}

const EMPTY_FORM: ReferralFormState = {
  referrerCustomerId: '',
  referrerName: '',
  referredName: '',
  referredPhone: '',
  relation: '',
  memo: ''
}

export default function ReferralEnginePage(): JSX.Element {
  const { session } = useSession()
  const admin = isAdminRole(session.role)

  const [tab, setTab] = useState<Tab>('golden')
  const [customers, setCustomers] = useState<CustomerRecord[]>([])
  const [custMode, setCustMode] = useState<CustomerDataMode>('local-mock')
  const [events, setEvents] = useState<ScheduleWithCustomer[]>([])
  const [referrals, setReferrals] = useState<Referral[]>([])
  const [refMode, setRefMode] = useState<ReferralDataMode>('local')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [includeStaff, setIncludeStaff] = useState(false)

  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<ReferralFormState>(EMPTY_FORM)
  const [convertId, setConvertId] = useState<string | null>(null)
  const [convert, setConvert] = useState({ referredName: '', referredPhone: '', relation: '' })
  const [busy, setBusy] = useState(false)
  const [shared, setShared] = useState<Record<string, 'shared' | 'copied' | 'failed'>>({})

  // 내 QR 탭 — 셀프 유입 퍼널 링크·QR 이미지
  const [myQr, setMyQr] = useState<string | null>(null)
  const [companyQr, setCompanyQr] = useState<string | null>(null)
  const [linkFlash, setLinkFlash] = useState<Record<string, 'shared' | 'copied' | 'failed'>>({})

  const refreshReferrals = useCallback(async (): Promise<void> => {
    const res = await listReferrals()
    setRefMode(res.mode)
    setReferrals(res.ok ? res.referrals : [])
    if (!res.ok) setError(res.error ?? '소개 목록을 불러오지 못했습니다.')
  }, [])

  useEffect(() => {
    let alive = true
    void (async () => {
      const [custRes, evRes, refRes] = await Promise.all([
        listCustomers(),
        supabaseScheduleAdapter.listScheduleEvents(),
        listReferrals()
      ])
      if (!alive) return
      setCustMode(custRes.mode)
      setCustomers(custRes.ok ? custRes.customers : [])
      setEvents(evRes.ok ? evRes.data : [])
      setRefMode(refRes.mode)
      setReferrals(refRes.ok ? refRes.referrals : [])
      setError(refRes.ok ? null : (refRes.error ?? '소개 목록을 불러오지 못했습니다.'))
      setLoading(false)
    })()
    return () => {
      alive = false
    }
  }, [session.id])

  // 골든타임은 내 고객 대상 (소개 요청은 담당 FC가 직접 하는 행동).
  const myCustomers = useMemo(() => {
    if (custMode !== 'supabase') return customers
    return customers.filter((c) => c.ownerStaffId === session.id)
  }, [customers, custMode, session.id])

  // 소개 목록: 내 것 기본 — 관리자가 토글을 켜면 직원 것 포함 (담당 배지).
  const myReferrals = useMemo(() => referrals.filter((r) => r.fcId === session.id || refMode !== 'supabase'), [referrals, refMode, session.id])
  const visibleReferrals = useMemo(() => {
    if (admin && includeStaff) return referrals
    return myReferrals
  }, [admin, includeStaff, referrals, myReferrals])

  const golden = useMemo(
    () => computeGoldenMoments(myCustomers, events, myReferrals, session.id),
    [myCustomers, events, myReferrals, session.id]
  )
  const funnel = useMemo(() => referralFunnel(myReferrals), [myReferrals])
  const monthly = useMemo(() => monthlyCounts(myReferrals), [myReferrals])
  const leaderboard = useMemo(() => (admin ? fcLeaderboard(referrals) : []), [admin, referrals])

  const myLink = useMemo(() => buildApplyLink(session.id, session.name), [session.id, session.name])
  const companyLink = useMemo(() => buildCompanyApplyLink(), [])

  // 탭을 열 때 QR 이미지를 생성한다 (딥네이비 도트 — 인쇄·명함에서도 선명).
  useEffect(() => {
    if (tab !== 'funnel') return
    const opts = { width: 512, margin: 2, color: { dark: '#0e1e3a', light: '#ffffff' } }
    QRCode.toDataURL(myLink, opts)
      .then(setMyQr)
      .catch(() => setMyQr(null))
    if (admin) {
      QRCode.toDataURL(companyLink, opts)
        .then(setCompanyQr)
        .catch(() => setCompanyQr(null))
    }
  }, [tab, myLink, companyLink, admin])

  const flashLink = (key: string, outcome: 'shared' | 'copied' | 'failed'): void => {
    setLinkFlash((s) => ({ ...s, [key]: outcome }))
    window.setTimeout(() => {
      setLinkFlash((s) => {
        const next = { ...s }
        delete next[key]
        return next
      })
    }, 3000)
  }

  const copyLink = async (key: string, link: string): Promise<void> => {
    // 인앱 브라우저(카톡 등)에서 표준 API가 막히면 execCommand 폴백까지 시도한다.
    const ok = await copyText(link)
    flashLink(key, ok ? 'copied' : 'failed')
  }

  const shareLink = async (key: string, link: string): Promise<void> => {
    const outcome = await shareMeetingText(buildApplyShareMessage(link, session.name))
    flashLink(key, outcome)
  }

  const flashShare = (key: string, outcome: 'shared' | 'copied' | 'failed'): void => {
    setShared((s) => ({ ...s, [key]: outcome }))
    window.setTimeout(() => {
      setShared((s) => {
        const next = { ...s }
        delete next[key]
        return next
      })
    }, 3000)
  }

  /** 카톡 소개 요청 — 문안 공유에 성공하면 '요청함' 기록까지 자동으로 남긴다. */
  const askViaKakao = async (m: GoldenMoment): Promise<void> => {
    const outcome = await shareMeetingText(buildReferralAskMessage(m.customer.name, session.name))
    flashShare(m.customer.id, outcome)
    if (outcome === 'shared' || outcome === 'copied') {
      await createReferralAsk(
        { referrerCustomerId: m.customer.id, referrerName: m.customer.name, memo: `골든타임(${GOLDEN_REASON_LABEL[m.reason]}) 카톡 요청` },
        { id: session.id, name: session.name }
      )
      await refreshReferrals()
    }
  }

  const submitForm = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    const res = await createReferral(
      {
        referrerCustomerId: form.referrerCustomerId || undefined,
        referrerName: form.referrerName,
        referredName: form.referredName,
        referredPhone: form.referredPhone,
        relation: form.relation,
        memo: form.memo
      },
      { id: session.id, name: session.name }
    )
    setBusy(false)
    if (!res.ok) {
      setError(res.error ?? '저장에 실패했습니다.')
      return
    }
    setError(null)
    setForm(EMPTY_FORM)
    setShowForm(false)
    await refreshReferrals()
  }

  const submitConvert = async (id: string): Promise<void> => {
    if (busy) return
    setBusy(true)
    const res = await convertAskToReceived(id, convert)
    setBusy(false)
    if (!res.ok) {
      setError(res.error ?? '전환에 실패했습니다.')
      return
    }
    setError(null)
    setConvertId(null)
    setConvert({ referredName: '', referredPhone: '', relation: '' })
    await refreshReferrals()
  }

  const advance = async (r: Referral): Promise<void> => {
    const next = nextReferralStatus(r.status)
    if (!next || busy) return
    setBusy(true)
    await updateReferralStatus(r.id, next)
    setBusy(false)
    await refreshReferrals()
  }

  const markFailed = async (r: Referral): Promise<void> => {
    if (busy) return
    setBusy(true)
    await updateReferralStatus(r.id, 'failed')
    setBusy(false)
    await refreshReferrals()
  }

  const remove = async (r: Referral): Promise<void> => {
    if (busy) return
    if (!window.confirm(`'${r.referredName ?? r.referrerName}' 소개 기록을 삭제할까요?`)) return
    setBusy(true)
    await deleteReferral(r.id)
    setBusy(false)
    await refreshReferrals()
  }

  const pickReferrer = (id: string): void => {
    const c = myCustomers.find((x) => x.id === id)
    setForm((f) => ({ ...f, referrerCustomerId: id, referrerName: c ? c.name : f.referrerName }))
  }

  const input = 'w-full rounded-xl border border-slate-800 bg-white px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-[#c6982f] focus:outline-none'
  const label = 'mb-1 block text-[11px] font-bold text-slate-500'

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
          <UserPlus className="h-5 w-5 text-[#e6c877]" />
          <h1 className="text-lg font-bold">소개 영업</h1>
        </div>
        <p className="mt-1 text-xs text-white/60">
          DB는 사는 게 아니라 만드는 것 — 계약·증권전달·생일 직후가 소개 요청 골든타임입니다.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <span className="rounded-full bg-[#c6982f] px-2.5 py-1 text-[11px] font-bold text-[#201603]">
            골든타임 {golden.length}명
          </span>
          <span className="rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-bold text-white ring-1 ring-white/20">
            이번 달 소개 {monthly.received}건
          </span>
          <span className="rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-bold text-white ring-1 ring-white/20">
            이번 달 계약 전환 {monthly.contracted}건
          </span>
        </div>
      </div>

      {/* 탭 */}
      <div className="grid grid-cols-4 gap-2">
        {(
          [
            { key: 'golden', labelText: '골든타임', icon: Sparkles },
            { key: 'pipeline', labelText: '소개 현황', icon: Users },
            { key: 'stats', labelText: '성과', icon: Trophy },
            { key: 'funnel', labelText: '내 QR', icon: QrCode }
          ] as const
        ).map((t) => {
          const active = tab === t.key
          const Icon = t.icon
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={[
                'flex items-center justify-center gap-1.5 rounded-xl border px-3 py-2.5 text-sm font-bold transition',
                active ? 'border-transparent text-[#e6c877]' : 'border-slate-800 bg-white text-slate-300 hover:text-slate-100'
              ].join(' ')}
              style={active ? { background: 'linear-gradient(120deg, #0e1e3a, #1d2f57)' } : undefined}
            >
              <Icon className={['h-4 w-4', active ? 'text-[#e6c877]' : 'text-[#c6982f]'].join(' ')} />
              {t.labelText}
            </button>
          )
        })}
      </div>

      {/* 관리자: 직원 것 포함 토글 (소개 현황 탭) */}
      {admin && tab === 'pipeline' ? (
        <label className="flex cursor-pointer items-center justify-between rounded-xl border border-slate-800 bg-white px-4 py-3">
          <span className="flex items-center gap-2 text-sm font-semibold text-slate-200">
            <Users className="h-4 w-4 text-[#c6982f]" /> 직원 소개 포함
            <span className="text-[11px] font-normal text-slate-500">(기본은 내 것만)</span>
          </span>
          <input
            type="checkbox"
            checked={includeStaff}
            onChange={(e) => setIncludeStaff(e.target.checked)}
            className="h-4 w-4 accent-[#c6982f]"
          />
        </label>
      ) : null}

      {error ? <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-center text-sm text-rose-600">{error}</div> : null}

      {loading ? (
        <div className="rounded-2xl border border-slate-800 bg-white p-8 text-center text-sm text-slate-500">불러오는 중…</div>
      ) : tab === 'golden' ? (
        /* ───────── 골든타임 ───────── */
        <>
          {golden.length === 0 ? (
            <div className="rounded-2xl border border-slate-800 bg-white p-8 text-center">
              <Sparkles className="mx-auto mb-2 h-8 w-8 text-slate-400" />
              <p className="text-sm font-semibold text-slate-300">지금 골든타임인 고객이 없습니다.</p>
              <p className="mt-1 text-xs text-slate-500">
                계약·클로징·증권 전달 일정을 완료(메모 저장)하거나 고객 생일이 다가오면 여기에 자동으로 표시됩니다.
              </p>
            </div>
          ) : (
            <ul className="space-y-2">
              {golden.map((m) => {
                const outcome = shared[m.customer.id]
                return (
                  <li key={m.customer.id} className="flex items-center gap-3 rounded-2xl border border-slate-800 bg-white p-3">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#0e1e3a]">
                      <Sparkles className="h-5 w-5 text-[#e6c877]" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-sm font-bold text-slate-100">{m.customer.name}</span>
                        <span className={['rounded-full px-1.5 py-0.5 text-[10px] font-bold', REASON_CHIP[m.reason]].join(' ')}>
                          {m.detail}
                        </span>
                        {m.alreadyAsked ? (
                          <span className="rounded-full bg-slate-950 px-1.5 py-0.5 text-[10px] font-bold text-slate-400 ring-1 ring-slate-800">
                            90일 내 요청함
                          </span>
                        ) : null}
                      </div>
                      {m.customer.phone ? (
                        <a
                          href={`tel:${m.customer.phone}`}
                          className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-slate-500 underline-offset-2 hover:underline"
                        >
                          <Phone className="h-3 w-3" />
                          {m.customer.phone}
                        </a>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      onClick={() => void askViaKakao(m)}
                      className={[
                        'inline-flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold transition',
                        outcome === 'shared' || outcome === 'copied'
                          ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
                          : outcome === 'failed'
                            ? 'bg-rose-50 text-rose-600 ring-1 ring-rose-200'
                            : 'bg-[#FEE500] text-[#191919] hover:brightness-95'
                      ].join(' ')}
                    >
                      {outcome === 'shared' ? (
                        <>
                          <Check className="h-3.5 w-3.5" /> 요청 기록됨
                        </>
                      ) : outcome === 'copied' ? (
                        <>
                          <Check className="h-3.5 w-3.5" /> 복사·기록됨
                        </>
                      ) : outcome === 'failed' ? (
                        <>다시 시도</>
                      ) : (
                        <>
                          <Share2 className="h-3.5 w-3.5" /> 카톡 소개 요청
                        </>
                      )}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
          <div className="flex items-start gap-2 rounded-xl border border-dashed border-slate-700 bg-white/60 px-4 py-3 text-[12px] text-slate-500">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              골든타임 = 고객 만족이 가장 높은 순간입니다. <b className="text-slate-300">최근 14일 내 계약·클로징·증권전달을 완료한 고객</b>과{' '}
              <b className="text-slate-300">생일이 3일 내인 고객</b>이 자동으로 올라옵니다. 카톡 요청을 보내면 소개 현황에 '요청함'으로
              기록됩니다.
            </span>
          </div>
        </>
      ) : tab === 'pipeline' ? (
        /* ───────── 소개 현황 ───────── */
        <>
          {showForm ? (
            <div className="space-y-3 rounded-2xl border border-[#c6982f]/40 bg-white p-4">
              <div className="flex items-center justify-between">
                <h2 className="flex items-center gap-1.5 text-sm font-bold text-slate-100">
                  <UserPlus className="h-4 w-4 text-[#c6982f]" /> 소개받은 분 기록
                </h2>
                <button type="button" onClick={() => setShowForm(false)} className="rounded-lg p-1 text-slate-400 hover:text-slate-200">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <span className={label}>소개자 (기존 고객)</span>
                  <select value={form.referrerCustomerId} onChange={(e) => pickReferrer(e.target.value)} className={input}>
                    <option value="">직접 입력</option>
                    {myCustomers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <span className={label}>소개자 이름 *</span>
                  <input
                    value={form.referrerName}
                    onChange={(e) => setForm((f) => ({ ...f, referrerName: e.target.value }))}
                    placeholder="예: 김민수"
                    className={input}
                    disabled={!!form.referrerCustomerId}
                  />
                </div>
                <div>
                  <span className={label}>소개받은 분 이름 *</span>
                  <input
                    value={form.referredName}
                    onChange={(e) => setForm((f) => ({ ...f, referredName: e.target.value }))}
                    placeholder="예: 박지영"
                    className={input}
                  />
                </div>
                <div>
                  <span className={label}>연락처</span>
                  <input
                    value={form.referredPhone}
                    onChange={(e) => setForm((f) => ({ ...f, referredPhone: e.target.value }))}
                    placeholder="010-0000-0000"
                    className={input}
                  />
                </div>
                <div>
                  <span className={label}>소개자와의 관계</span>
                  <input
                    value={form.relation}
                    onChange={(e) => setForm((f) => ({ ...f, relation: e.target.value }))}
                    placeholder="예: 직장 동료"
                    className={input}
                  />
                </div>
                <div>
                  <span className={label}>메모</span>
                  <input
                    value={form.memo}
                    onChange={(e) => setForm((f) => ({ ...f, memo: e.target.value }))}
                    placeholder="관심 분야, 상황 등"
                    className={input}
                  />
                </div>
              </div>
              <button
                type="button"
                onClick={() => void submitForm()}
                disabled={busy || !form.referrerName.trim() || !form.referredName.trim()}
                className="w-full rounded-xl bg-[#c6982f] px-4 py-2.5 text-sm font-bold text-[#201603] transition hover:brightness-105 disabled:opacity-40"
              >
                {busy ? '저장 중…' : '소개 기록 저장'}
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowForm(true)}
              className="flex w-full items-center justify-center gap-1.5 rounded-2xl border border-dashed border-[#c6982f]/50 bg-white px-4 py-3 text-sm font-bold text-[#8a6a1e] transition hover:bg-[#c6982f]/5"
            >
              <Plus className="h-4 w-4" /> 소개받은 분 기록하기
            </button>
          )}

          {visibleReferrals.length === 0 ? (
            <div className="rounded-2xl border border-slate-800 bg-white p-8 text-center">
              <Users className="mx-auto mb-2 h-8 w-8 text-slate-400" />
              <p className="text-sm font-semibold text-slate-300">아직 소개 기록이 없습니다.</p>
              <p className="mt-1 text-xs text-slate-500">골든타임 탭에서 카톡 요청을 보내거나, 소개받은 분을 직접 기록해 보세요.</p>
            </div>
          ) : (
            <ul className="space-y-2">
              {visibleReferrals.map((r) => {
                const next = nextReferralStatus(r.status)
                const others = r.fcId !== session.id
                return (
                  <li key={r.id} className="rounded-2xl border border-slate-800 bg-white p-3">
                    <div className="flex items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {r.referredName ? (
                            <span className="text-sm font-bold text-slate-100">{r.referredName}</span>
                          ) : (
                            <span className="text-sm font-bold text-slate-400">(소개 대기)</span>
                          )}
                          <span className={['rounded-full px-1.5 py-0.5 text-[10px] font-bold', STATUS_CHIP[r.status]].join(' ')}>
                            {REFERRAL_STATUS_LABEL[r.status]}
                          </span>
                          {others ? (
                            <span className="rounded-full border border-[#c6982f]/40 bg-[#c6982f]/10 px-1.5 py-0.5 text-[10px] font-bold text-[#8a6a1e]">
                              담당 {r.fcName || '직원'}
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-0.5 text-[11px] text-slate-500">
                          소개자 <b className="text-slate-300">{r.referrerName}</b>
                          {r.relation ? ` · ${r.relation}` : ''}
                          {r.referredPhone ? (
                            <>
                              {' · '}
                              <a href={`tel:${r.referredPhone}`} className="underline-offset-2 hover:underline">
                                {r.referredPhone}
                              </a>
                            </>
                          ) : null}
                        </p>
                        {r.memo ? <p className="mt-0.5 text-[11px] text-slate-500">{r.memo}</p> : null}
                      </div>
                      <button
                        type="button"
                        onClick={() => void remove(r)}
                        className="rounded-lg p-1.5 text-slate-500 transition hover:bg-rose-50 hover:text-rose-600"
                        aria-label="삭제"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>

                    {/* 진행 액션 */}
                    {r.status === 'asked' ? (
                      convertId === r.id ? (
                        <div className="mt-2 space-y-2 rounded-xl border border-slate-800 bg-slate-950 p-3">
                          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                            <input
                              value={convert.referredName}
                              onChange={(e) => setConvert((c) => ({ ...c, referredName: e.target.value }))}
                              placeholder="소개받은 분 이름 *"
                              className={input}
                            />
                            <input
                              value={convert.referredPhone}
                              onChange={(e) => setConvert((c) => ({ ...c, referredPhone: e.target.value }))}
                              placeholder="연락처"
                              className={input}
                            />
                            <input
                              value={convert.relation}
                              onChange={(e) => setConvert((c) => ({ ...c, relation: e.target.value }))}
                              placeholder="관계"
                              className={input}
                            />
                          </div>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => void submitConvert(r.id)}
                              disabled={busy || !convert.referredName.trim()}
                              className="flex-1 rounded-xl bg-[#c6982f] px-3 py-2 text-xs font-bold text-[#201603] disabled:opacity-40"
                            >
                              소개받음으로 전환
                            </button>
                            <button
                              type="button"
                              onClick={() => setConvertId(null)}
                              className="rounded-xl border border-slate-800 px-3 py-2 text-xs font-bold text-slate-400"
                            >
                              취소
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            setConvertId(r.id)
                            setConvert({ referredName: '', referredPhone: '', relation: '' })
                          }}
                          className="mt-2 inline-flex items-center gap-1 rounded-xl bg-indigo-50 px-3 py-1.5 text-xs font-bold text-indigo-600 ring-1 ring-indigo-200 transition hover:bg-indigo-100"
                        >
                          소개받았어요 <ChevronRight className="h-3.5 w-3.5" />
                        </button>
                      )
                    ) : next || r.status !== 'contracted' ? (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {next ? (
                          <button
                            type="button"
                            onClick={() => void advance(r)}
                            disabled={busy}
                            className="inline-flex items-center gap-1 rounded-xl bg-[#0e1e3a] px-3 py-1.5 text-xs font-bold text-[#e6c877] transition hover:brightness-125 disabled:opacity-40"
                          >
                            {withRo(REFERRAL_STATUS_LABEL[next])} 진행 <ChevronRight className="h-3.5 w-3.5" />
                          </button>
                        ) : null}
                        {r.status !== 'contracted' && r.status !== 'failed' ? (
                          <button
                            type="button"
                            onClick={() => void markFailed(r)}
                            disabled={busy}
                            className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-bold text-rose-600 transition hover:bg-rose-100 disabled:opacity-40"
                          >
                            무산
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          )}
        </>
      ) : tab === 'stats' ? (
        /* ───────── 성과 ───────── */
        <>
          {/* 내 퍼널 */}
          <div className="rounded-2xl border border-slate-800 bg-white p-4">
            <h2 className="flex items-center gap-1.5 text-sm font-bold text-slate-100">
              <Sparkles className="h-4 w-4 text-[#c6982f]" /> 내 소개 퍼널
            </h2>
            <div className="mt-3 grid grid-cols-5 gap-1.5 text-center">
              {(
                [
                  { label: '요청', value: funnel.asked },
                  { label: '소개', value: funnel.received },
                  { label: '콜', value: funnel.called },
                  { label: '상담', value: funnel.consulted },
                  { label: '계약', value: funnel.contracted }
                ] as const
              ).map((s, i) => (
                <div
                  key={s.label}
                  className={['rounded-xl px-1 py-2.5', i === 4 ? '' : 'bg-slate-950'].join(' ')}
                  style={i === 4 ? { background: 'linear-gradient(120deg, #0e1e3a, #1d2f57)' } : undefined}
                >
                  <p className={['text-lg font-black leading-tight', i === 4 ? 'text-[#e6c877]' : 'text-slate-100'].join(' ')}>{s.value}</p>
                  <p className={['text-[10px] font-bold', i === 4 ? 'text-[#e6c877]/70' : 'text-slate-500'].join(' ')}>{s.label}</p>
                </div>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
              <span className="rounded-full bg-emerald-50 px-2.5 py-1 font-bold text-emerald-700 ring-1 ring-emerald-200">
                소개→계약 전환율 {funnel.conversionPct === null ? '—' : `${funnel.conversionPct}%`}
              </span>
              <span className="rounded-full bg-rose-50 px-2.5 py-1 font-bold text-rose-600 ring-1 ring-rose-200">무산 {funnel.failed}건</span>
            </div>
          </div>

          {/* 관리자: FC별 리더보드 */}
          {admin ? (
            <div className="rounded-2xl border border-slate-800 bg-white p-4">
              <h2 className="flex items-center gap-1.5 text-sm font-bold text-slate-100">
                <Trophy className="h-4 w-4 text-[#c6982f]" /> FC별 소개 성과 <span className="text-[11px] font-normal text-slate-500">(관리자)</span>
              </h2>
              {leaderboard.length === 0 ? (
                <p className="mt-3 text-center text-xs text-slate-500">아직 집계할 소개 기록이 없습니다.</p>
              ) : (
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-800 text-[11px] text-slate-500">
                        <th className="py-1.5 pr-2">순위</th>
                        <th className="py-1.5 pr-2">이름</th>
                        <th className="py-1.5 pr-2 text-right">소개받음</th>
                        <th className="py-1.5 pr-2 text-right">계약</th>
                        <th className="py-1.5 text-right">전환율</th>
                      </tr>
                    </thead>
                    <tbody>
                      {leaderboard.map((s, i) => (
                        <tr key={s.fcId} className="border-b border-slate-800/50 last:border-0">
                          <td className="py-2 pr-2">
                            {i === 0 ? (
                              <span className="font-black text-[#c6982f]">1위 👑</span>
                            ) : (
                              <span className="font-bold text-slate-400">{i + 1}위</span>
                            )}
                          </td>
                          <td className="py-2 pr-2 font-bold text-slate-100">{s.fcName}</td>
                          <td className="py-2 pr-2 text-right font-bold text-slate-200">{s.received}</td>
                          <td className="py-2 pr-2 text-right font-bold text-emerald-700">{s.contracted}</td>
                          <td className="py-2 text-right text-slate-300">{s.conversionPct === null ? '—' : `${s.conversionPct}%`}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : null}

          <div className="flex items-start gap-2 rounded-xl border border-dashed border-slate-700 bg-white/60 px-4 py-3 text-[12px] text-slate-500">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              소개 리드는 구매 DB보다 전환율이 훨씬 높고 비용이 들지 않습니다. <b className="text-slate-300">한 계약이 끝날 때마다 소개
              요청 1번</b>을 습관으로 만들면 DB를 사지 않아도 파이프라인이 유지됩니다.
            </span>
          </div>
        </>
      ) : (
        /* ───────── 내 QR (셀프 유입 퍼널) ───────── */
        <>
          {/* 내 개인 링크 */}
          <div className="rounded-2xl border border-slate-800 bg-white p-4">
            <h2 className="flex items-center gap-1.5 text-sm font-bold text-slate-100">
              <QrCode className="h-4 w-4 text-[#c6982f]" /> 내 신청 링크
              <span className="text-[11px] font-normal text-slate-500">— 이 QR로 신청하면 나에게 배정</span>
            </h2>
            <div className="mt-3 flex flex-col items-center gap-3">
              {myQr ? (
                <img src={myQr} alt="내 신청 QR 코드" className="h-44 w-44 rounded-xl border border-slate-800 bg-[#ffffff] p-2" />
              ) : (
                <div className="flex h-44 w-44 items-center justify-center rounded-xl border border-slate-800 text-xs text-slate-500">
                  QR 생성 중…
                </div>
              )}
              <p className="w-full break-all rounded-xl bg-slate-950 px-3 py-2 text-center text-[11px] text-slate-400">{myLink}</p>
              <div className="flex w-full gap-2">
                <button
                  type="button"
                  onClick={() => void copyLink('my', myLink)}
                  className={[
                    'flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2.5 text-xs font-bold transition',
                    linkFlash.my === 'copied'
                      ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
                      : 'bg-[#0e1e3a] text-[#e6c877] hover:brightness-125'
                  ].join(' ')}
                >
                  {linkFlash.my === 'copied' ? (
                    <>
                      <Check className="h-3.5 w-3.5" /> 복사됨
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5" /> 링크 복사
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => void shareLink('my-share', myLink)}
                  className={[
                    'flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2.5 text-xs font-bold transition',
                    linkFlash['my-share'] === 'shared' || linkFlash['my-share'] === 'copied'
                      ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
                      : 'bg-[#FEE500] text-[#191919] hover:brightness-95'
                  ].join(' ')}
                >
                  {linkFlash['my-share'] === 'shared' ? (
                    <>
                      <Check className="h-3.5 w-3.5" /> 공유됨
                    </>
                  ) : linkFlash['my-share'] === 'copied' ? (
                    <>
                      <Check className="h-3.5 w-3.5" /> 문안 복사됨
                    </>
                  ) : (
                    <>
                      <Share2 className="h-3.5 w-3.5" /> 카톡 공유
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* 관리자: 회사 공용 링크 (자동배정) */}
          {admin ? (
            <div className="rounded-2xl border border-slate-800 bg-white p-4">
              <h2 className="flex items-center gap-1.5 text-sm font-bold text-slate-100">
                <Users className="h-4 w-4 text-[#c6982f]" /> 회사 공용 링크
                <span className="text-[11px] font-normal text-slate-500">— 신청 시 최소부하 자동배정 (관리자)</span>
              </h2>
              <div className="mt-3 flex flex-col items-center gap-3">
                {companyQr ? (
                  <img src={companyQr} alt="회사 공용 신청 QR 코드" className="h-36 w-36 rounded-xl border border-slate-800 bg-[#ffffff] p-2" />
                ) : (
                  <div className="flex h-36 w-36 items-center justify-center rounded-xl border border-slate-800 text-xs text-slate-500">
                    QR 생성 중…
                  </div>
                )}
                <p className="w-full break-all rounded-xl bg-slate-950 px-3 py-2 text-center text-[11px] text-slate-400">{companyLink}</p>
                <button
                  type="button"
                  onClick={() => void copyLink('company', companyLink)}
                  className={[
                    'flex w-full items-center justify-center gap-1.5 rounded-xl px-3 py-2.5 text-xs font-bold transition',
                    linkFlash.company === 'copied'
                      ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
                      : 'bg-[#0e1e3a] text-[#e6c877] hover:brightness-125'
                  ].join(' ')}
                >
                  {linkFlash.company === 'copied' ? (
                    <>
                      <Check className="h-3.5 w-3.5" /> 복사됨
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5" /> 링크 복사
                    </>
                  )}
                </button>
              </div>
            </div>
          ) : null}

          <div className="flex items-start gap-2 rounded-xl border border-dashed border-slate-700 bg-white/60 px-4 py-3 text-[12px] text-slate-500">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              QR을 <b className="text-slate-300">명함·카톡 프로필·SNS·매장</b>에 붙여 두세요. 방문자가 로그인 없이 무료 보장분석을
              신청하면 <b className="text-slate-300">DB 배정</b>에 자동으로 들어오고, 내 링크로 온 신청은 나에게 배정됩니다.
            </span>
          </div>
        </>
      )}
    </div>
  )
}
