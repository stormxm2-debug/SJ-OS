import { useEffect, useMemo, useState } from 'react'
import { ShieldCheck, Send, RefreshCw, Loader2, Smartphone, AlertTriangle } from 'lucide-react'
import {
  startHealthRecord,
  confirmHealthRecord,
  listHealthRecords,
  type TwoWayInfo,
  type HealthRecordRequest
} from '@renderer/services/commercial/healthRecordService'

/**
 * 고객 건강기록(건강보험공단 「진료받은 내용」) 조회 — CODEF 간편인증.
 *
 * 1) 고객 정보 입력 → 간편인증 요청  2) 고객이 휴대폰(카카오/네이버/통신사 등)에서 승인
 * 3) 승인 완료 → 결과 조회(진료 내역).  민감 의료정보이므로 동의 하에만 진행한다.
 *
 * 요청 변수(CODEF 상품 스펙 — /v1/kr/public/pp/nhis-list/medical-history, loginType "5" 간편인증):
 *   organization "0002"(고정) · loginType "5" · loginTypeLevel(간편인증 수단) ·
 *   userName(이름) · identity(생년월일 YYYYMMDD) · phoneNo(휴대폰) ·
 *   telecom(loginTypeLevel="5" 통신사인증서일 때만) · startDate/endDate(YYYYMMDD).
 *   ※ 간편인증은 주민번호를 쓰지 않으므로 RSA 암호화 필드가 없다(생년월일만 사용).
 */

/** 간편인증 수단 (loginTypeLevel). CODEF 스펙값. */
const AUTH_PROVIDERS: { v: string; label: string }[] = [
  { v: '1', label: '카카오톡' },
  { v: '6', label: '네이버' },
  { v: '8', label: '토스' },
  { v: '5', label: '통신사(PASS)' },
  { v: '4', label: 'KB모바일' },
  { v: '7', label: '신한인증서' },
  { v: '3', label: '삼성패스' },
  { v: '10', label: 'NH인증서' }
]

/** 통신사 (telecom) — loginTypeLevel="5"(통신사인증서)일 때만 필수. */
const TELECOMS: { v: string; label: string }[] = [
  { v: '0', label: 'SKT (알뜰폰 포함)' },
  { v: '1', label: 'KT (알뜰폰 포함)' },
  { v: '2', label: 'LG U+ (알뜰폰 포함)' }
]

const digits = (s: string): string => s.replace(/[^\d]/g, '')
const monthsAgoStr = (n: number): string => {
  const d = new Date()
  d.setMonth(d.getMonth() - n)
  return d.toISOString().slice(0, 10).replace(/-/g, '')
}

export default function HealthRecordPage(): JSX.Element {
  const [name, setName] = useState('')
  const [birth, setBirth] = useState('') // 생년월일 YYYYMMDD (간편인증 identity)
  const [phone, setPhone] = useState('')
  const [provider, setProvider] = useState('1') // loginTypeLevel (기본: 카카오톡)
  const [telecom, setTelecom] = useState('0') // telecom (통신사인증서일 때만)
  const [startDate, setStartDate] = useState(monthsAgoStr(14))
  const [endDate, setEndDate] = useState(monthsAgoStr(2))

  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [configNote, setConfigNote] = useState<string | null>(null)

  const [requestId, setRequestId] = useState<string | undefined>(undefined)
  const [twoWay, setTwoWay] = useState<TwoWayInfo | undefined>(undefined)
  const [result, setResult] = useState<Record<string, unknown> | null>(null)
  const [history, setHistory] = useState<HealthRecordRequest[]>([])

  const needTelecom = provider === '5'

  const refresh = async (): Promise<void> => {
    const r = await listHealthRecords()
    if (r.ok) setHistory(r.items)
  }
  useEffect(() => {
    void refresh()
  }, [])

  // CODEF 요청 변수 — 「진료받은 내용」 상품 스펙(간편인증) 그대로.
  const buildParam = (): Record<string, unknown> => {
    const p: Record<string, unknown> = {
      organization: '0002', // 건강보험공단 (고정)
      loginType: '5', // 간편인증
      loginTypeLevel: provider, // 간편인증 수단
      userName: name.trim(),
      identity: digits(birth), // 생년월일 YYYYMMDD (주민번호 아님)
      phoneNo: digits(phone),
      startDate: digits(startDate),
      endDate: digits(endDate)
    }
    if (needTelecom) p.telecom = telecom // 통신사인증서일 때만
    return p
  }

  // CODEF 「진료받은 내용」 조회기간 규칙: 조회일 기준 14개월 전부터 1년간만 가능하고,
  // 최근 진료내역은 진료개시 2개월 이후에야 반영된다 → [14개월 전, 2개월 전] 창 안이어야 한다.
  // (이 창을 벗어나면 CODEF가 CF-13001 기간오류를 돌려줌.) 전 구간이 12개월이라 1년 제한도 자동 충족.
  const minStart = monthsAgoStr(14)
  const maxEnd = monthsAgoStr(2)
  const validPeriod =
    digits(startDate).length === 8 &&
    digits(endDate).length === 8 &&
    digits(startDate) < digits(endDate) &&
    digits(startDate) >= minStart &&
    digits(endDate) <= maxEnd
  const canStart =
    Boolean(name.trim()) && digits(birth).length === 8 && digits(phone).length >= 10 && validPeriod

  const onStart = async (): Promise<void> => {
    setError(null)
    setNotice(null)
    setConfigNote(null)
    setResult(null)
    setTwoWay(undefined)
    setRequestId(undefined)
    if (!canStart) {
      setError(`입력값을 확인해주세요. 조회기간은 「약 14개월 전 ~ 2개월 전」(${minStart} ~ ${maxEnd}) 안이어야 하고(최근 2개월은 공단 미반영), 시작일이 종료일보다 앞서야 합니다.`)
      return
    }
    setBusy('고객 휴대폰으로 간편인증을 요청하는 중…')
    try {
      const r = await startHealthRecord({
        customerName: name.trim(),
        param: buildParam()
      })
      if (r.disabled) {
        setConfigNote(r.error ?? 'CODEF 연동이 아직 설정되지 않았습니다. 키·상품 URL을 등록하면 바로 동작합니다.')
        return
      }
      if (!r.ok && r.status !== 'awaiting_auth') {
        setError(r.error ?? '요청에 실패했습니다.')
        return
      }
      setRequestId(r.requestId)
      setTwoWay(r.twoWay)
      setNotice(r.message ?? '고객님 휴대폰에서 간편인증을 승인해 주세요. 승인 후 아래 「결과 조회」를 누르세요.')
      void refresh()
    } catch {
      setError('요청 중 오류가 발생했습니다.')
    } finally {
      setBusy(null)
    }
  }

  const onConfirm = async (): Promise<void> => {
    setError(null)
    if (!twoWay) {
      setError('먼저 간편인증을 요청하세요.')
      return
    }
    setBusy('고객 건강기록을 불러오는 중…')
    try {
      const r = await confirmHealthRecord({ requestId, param: buildParam(), twoWay })
      if (r.disabled) {
        setConfigNote(r.error ?? 'CODEF 연동이 아직 설정되지 않았습니다.')
        return
      }
      if (!r.ok) {
        // CF-13001: 조회기간 오류 / CF-00025: 이미 소진된 인증 세션 → 요청부터 다시.
        const deadSession = r.code === 'CF-00025' || /완료된 요청|만료|CF-00025/.test(r.error ?? '')
        if (deadSession) {
          setTwoWay(undefined)
          setRequestId(undefined)
          setError('인증 세션이 끝났습니다(1회용). 「간편인증 요청」부터 다시 하세요 — 요청 → 카톡 승인 → 결과 조회를 한 번씩만.')
        } else {
          setError(r.error ?? '아직 승인 전이거나 조회에 실패했습니다. 고객 승인 후 다시 시도해주세요.')
        }
        return
      }
      setResult(r.result ?? {})
      setTwoWay(undefined) // 2-way 세션은 1회용 — 성공 후 재조회 방지(새 조회는 다시 요청).
      setNotice('건강기록을 받아왔습니다.')
      void refresh()
    } catch {
      setError('조회 중 오류가 발생했습니다.')
    } finally {
      setBusy(null)
    }
  }

  const resultText = useMemo(() => (result ? JSON.stringify(result, null, 2) : ''), [result])

  return (
    <div className="space-y-4">
      {/* 헤더 */}
      <div className="rounded-2xl border border-slate-800 bg-[#0e1e3a] px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-[#e6c877]" />
          <h1 className="text-sm font-extrabold text-white">고객 건강기록 조회</h1>
          <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-bold text-white/80">건강보험공단 진료받은 내용 · 간편인증(CODEF)</span>
        </div>
        <p className="mt-1 text-[11px] text-white/60">
          고객 동의 하에 간편인증으로 진료 내역을 확인합니다. 간편인증은 주민번호 없이 생년월일로 진행하며, 저장 시 접근 권한(RLS)으로 보호됩니다.
        </p>
      </div>

      {configNote ? (
        <div className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-[12px] text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <b className="font-bold">CODEF 연동 설정 필요</b> — {configNote}
            <div className="mt-1 text-[11px] text-amber-700">
              Supabase 시크릿에 CODEF_CLIENT_ID / CODEF_CLIENT_SECRET / CODEF_PUBLIC_KEY 를 등록하면 즉시 동작합니다. (상품 URL은 서버 기본값 적용됨)
            </div>
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* 입력 + 요청 */}
        <div className="rounded-2xl border border-slate-800 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-bold text-slate-100">① 고객 정보 · 간편인증 요청</h2>
          <div className="mt-3 space-y-2.5">
            <div>
              <label className="text-[11px] font-semibold text-slate-400">고객 성함</label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="홍길동"
                className="mt-1 w-full rounded-lg border border-slate-700 bg-white px-3 py-2 text-[13px] text-slate-100 outline-none focus:border-[#c6982f]" />
            </div>
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="text-[11px] font-semibold text-slate-400">생년월일 (YYYYMMDD · 8자리)</label>
                <input value={birth} onChange={(e) => setBirth(e.target.value)} inputMode="numeric" maxLength={8} placeholder="19900101"
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-white px-3 py-2 text-[13px] text-slate-100 outline-none focus:border-[#c6982f]" />
              </div>
              <div className="flex-1">
                <label className="text-[11px] font-semibold text-slate-400">휴대폰 번호</label>
                <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="numeric" placeholder="01012345678"
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-white px-3 py-2 text-[13px] text-slate-100 outline-none focus:border-[#c6982f]" />
              </div>
            </div>
            <div className="flex gap-2">
              <div className={needTelecom ? 'flex-1' : 'w-full'}>
                <label className="text-[11px] font-semibold text-slate-400">간편인증 수단</label>
                <select value={provider} onChange={(e) => setProvider(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-white px-2 py-2 text-[13px] text-slate-100 outline-none focus:border-[#c6982f]">
                  {AUTH_PROVIDERS.map((p) => (
                    <option key={p.v} value={p.v}>{p.label}</option>
                  ))}
                </select>
              </div>
              {needTelecom ? (
                <div className="w-40">
                  <label className="text-[11px] font-semibold text-slate-400">통신사</label>
                  <select value={telecom} onChange={(e) => setTelecom(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-700 bg-white px-2 py-2 text-[13px] text-slate-100 outline-none focus:border-[#c6982f]">
                    {TELECOMS.map((t) => (
                      <option key={t.v} value={t.v}>{t.label}</option>
                    ))}
                  </select>
                </div>
              ) : null}
            </div>
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="text-[11px] font-semibold text-slate-400">조회 시작 (YYYYMMDD)</label>
                <input value={startDate} onChange={(e) => setStartDate(e.target.value)} inputMode="numeric" maxLength={8}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-white px-3 py-2 text-[13px] text-slate-100 outline-none focus:border-[#c6982f]" />
              </div>
              <div className="flex-1">
                <label className="text-[11px] font-semibold text-slate-400">조회 종료 (YYYYMMDD)</label>
                <input value={endDate} onChange={(e) => setEndDate(e.target.value)} inputMode="numeric" maxLength={8}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-white px-3 py-2 text-[13px] text-slate-100 outline-none focus:border-[#c6982f]" />
              </div>
            </div>
          </div>

          <button type="button" onClick={() => void onStart()} disabled={Boolean(busy) || !canStart}
            className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-[#0e1e3a] px-4 py-2.5 text-[13px] font-bold text-white transition hover:opacity-90 disabled:opacity-50">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            간편인증 요청
          </button>
          <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
            순서: <b className="text-slate-300">간편인증 요청 → 고객 휴대폰 인증앱(카카오/네이버/통신사PASS 등)에서 승인 → 결과 조회</b>. 각 단계는 한 번씩만 — 결과 조회가 안 되면 「간편인증 요청」부터 다시 하세요. 조회 가능 기간은 <b className="text-slate-300">조회일 기준 14개월 전 ~ 2개월 전</b>(최근 2개월은 공단 반영 전)이라, 기본값을 그 창으로 자동 설정했습니다.
          </p>
        </div>

        {/* 승인 대기 + 결과 조회 */}
        <div className="rounded-2xl border border-slate-800 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-bold text-slate-100">② 고객 승인 → 결과 조회</h2>
          {twoWay ? (
            <div className="mt-3 flex items-start gap-2 rounded-xl border border-[#c6982f] bg-[#fdf7ea] px-3 py-2.5 text-[12px] text-[#8a6a1f]">
              <Smartphone className="mt-0.5 h-4 w-4 shrink-0" />
              <span>고객님 휴대폰에서 <b>간편인증을 승인</b>한 뒤 아래 「결과 조회」를 눌러주세요.</span>
            </div>
          ) : (
            <p className="mt-3 text-[12px] text-slate-500">먼저 왼쪽에서 간편인증을 요청하세요.</p>
          )}

          <button type="button" onClick={() => void onConfirm()} disabled={Boolean(busy) || !twoWay}
            className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-slate-700 bg-white px-4 py-2.5 text-[13px] font-bold text-slate-200 transition hover:bg-slate-950 disabled:opacity-50">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            결과 조회
          </button>

          {result ? (
            <div className="mt-3">
              <div className="mb-1 text-[11px] font-semibold text-slate-400">조회 결과</div>
              <pre className="max-h-72 overflow-auto rounded-xl border border-slate-800 bg-slate-950 p-3 text-[11px] leading-relaxed text-slate-100">{resultText}</pre>
              <p className="mt-1 text-[10px] text-slate-500">※ 표시 형식은 CODEF 응답 스펙 확정 후 진료 항목 표로 정리합니다.</p>
            </div>
          ) : null}
        </div>
      </div>

      {notice ? <div className="rounded-xl border border-slate-800 bg-white px-4 py-2.5 text-[12px] font-semibold text-emerald-700">{notice}</div> : null}
      {error ? <div className="rounded-xl border border-rose-300 bg-rose-50 px-4 py-2.5 text-[12px] font-semibold text-rose-700">{error}</div> : null}

      {/* 최근 요청 */}
      <div className="rounded-2xl border border-slate-800 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-100">최근 요청</h2>
          <button type="button" onClick={() => void refresh()} className="text-[11px] font-semibold text-slate-400 hover:text-slate-200">새로고침</button>
        </div>
        {history.length === 0 ? (
          <p className="mt-2 text-[12px] text-slate-500">아직 요청이 없습니다.</p>
        ) : (
          <div className="mt-2 divide-y divide-slate-800">
            {history.map((h) => (
              <div key={h.id} className="flex items-center justify-between py-2 text-[12px]">
                <span className="font-semibold text-slate-200">{h.customerName || '고객 미지정'}</span>
                <span className="text-slate-500">{new Date(h.createdAt).toLocaleString('ko-KR')}</span>
                <StatusBadge status={h.status} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function StatusBadge({ status }: { status: HealthRecordRequest['status'] }): JSX.Element {
  const map: Record<string, { label: string; cls: string }> = {
    draft: { label: '작성', cls: 'bg-slate-900 text-slate-400' },
    awaiting_auth: { label: '승인 대기', cls: 'bg-amber-50 text-amber-700' },
    consented: { label: '동의', cls: 'bg-sky-50 text-sky-700' },
    fetching: { label: '조회 중', cls: 'bg-sky-50 text-sky-700' },
    completed: { label: '완료', cls: 'bg-emerald-50 text-emerald-700' },
    failed: { label: '실패', cls: 'bg-rose-50 text-rose-700' },
    expired: { label: '만료', cls: 'bg-slate-900 text-slate-400' }
  }
  const s = map[status] ?? map.draft
  return <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${s.cls}`}>{s.label}</span>
}
