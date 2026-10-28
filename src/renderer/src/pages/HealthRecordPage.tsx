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
 * 고객 건강기록 조회 — CODEF 간편인증. 상품(건강보험공단/심평원)별로 입력·요청변수가 달라
 * 상품 설정(HEALTH_PRODUCTS)으로 폼·파라미터·결과 렌더러를 바꾼다.
 *
 * 1) 상품 선택 + 고객 정보 입력 → 간편인증 요청  2) 고객이 휴대폰에서 승인  3) 결과 조회.
 * 민감 의료정보이므로 동의 하에만 진행하고, 저장은 RLS로 보호 + 30일 후 자동 만료한다.
 */

type IdField = 'birth' | 'rrn'
type DateMode = 'range' | 'none'

interface HealthProduct {
  key: string
  label: string
  short: string // 헤더 배지
  url: string // CODEF Endpoint 경로
  organization: string // 기관코드
  idField: IdField // identity = 생년월일(8) | 주민번호(13)
  dateMode: DateMode // range: startDate/endDate(YYYYMMDD) | none: 최근 1년 자동
  extraParams?: Record<string, string> // detailYN 등
  encrypt?: string[] // 서버 RSA 암호화 필드(주민번호 등)
  kind: 'treatment' | 'medicine' // 결과 렌더러
  note: string
}

/** CODEF 상품 설정. 요청변수는 각 상품 스펙(developer.codef.io)에 맞춰 확정. */
const HEALTH_PRODUCTS: HealthProduct[] = [
  {
    key: 'medical-history',
    label: '진료받은 내용 (건강보험공단)',
    short: '진료받은 내용',
    url: '/v1/kr/public/pp/nhis-list/medical-history',
    organization: '0002',
    idField: 'birth',
    dateMode: 'range',
    kind: 'treatment',
    note: '병원·약국별 진료형태·처방횟수·투약일수·본인/공단 부담금. 생년월일로 간편인증.'
  },
  {
    key: 'my-medicine',
    label: '내가먹는약 한눈에 (심평원·약품 상세)',
    short: '내가먹는약',
    url: '/v1/kr/public/hw/hira-list/my-medicine',
    organization: '0020',
    idField: 'rrn',
    dateMode: 'none',
    extraParams: { detailYN: '1' }, // 의약품 상세 포함
    encrypt: ['identity'], // 주민번호 RSA 암호화
    kind: 'medicine',
    note: '최근 1년간 조제받은 의약품(약품명·성분·조제기관·투약일수). 주민번호로 조회하며 암호화 전송됩니다.'
  }
]

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

type Row = Record<string, unknown>

/** 응답(data)에서 레코드 배열을 꺼낸다 — 배열이면 그대로, 객체면 첫 배열 속성. */
const toRecords = (result: unknown): Row[] => {
  if (Array.isArray(result)) return result as Row[]
  if (result && typeof result === 'object') {
    for (const v of Object.values(result as Record<string, unknown>)) {
      if (Array.isArray(v)) return v as Row[]
    }
  }
  return []
}

const num = (v: unknown): number => {
  const n = Number(String(v ?? '').replace(/[^\d.-]/g, ''))
  return Number.isFinite(n) ? n : 0
}
const won = (v: unknown): string => `${num(v).toLocaleString('ko-KR')}원`
const ymd = (v: unknown): string => {
  const d = String(v ?? '').replace(/[^\d]/g, '')
  return d.length === 8 ? `${d.slice(0, 4)}.${d.slice(4, 6)}.${d.slice(6, 8)}` : String(v ?? '') || '-'
}

/** 조회 결과 보관·열람 기간(일). 지나면 cron 이 결과를 비우고 '만료' 처리한다. */
const RETAIN_DAYS = 30
const daysSince = (iso: string): number => Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)

interface CatRow {
  type: string
  count: number
  deductible: number
  publicCharge: number
}
/** 진료형태별 카테고리 집계 + 합계. */
const summarize = (recs: Row[]): { cats: CatRow[]; total: CatRow } => {
  const map = new Map<string, CatRow>()
  const total: CatRow = { type: '합계', count: recs.length, deductible: 0, publicCharge: 0 }
  for (const r of recs) {
    const type = (String(r.resTreatType ?? '') || '기타').trim()
    const cur = map.get(type) ?? { type, count: 0, deductible: 0, publicCharge: 0 }
    cur.count += 1
    cur.deductible += num(r.resDeductibleAmt)
    cur.publicCharge += num(r.resPublicCharge)
    map.set(type, cur)
    total.deductible += num(r.resDeductibleAmt)
    total.publicCharge += num(r.resPublicCharge)
  }
  return { cats: [...map.values()].sort((a, b) => b.count - a.count), total }
}

export default function HealthRecordPage(): JSX.Element {
  const [productKey, setProductKey] = useState(HEALTH_PRODUCTS[0].key)
  const selected = HEALTH_PRODUCTS.find((p) => p.key === productKey) ?? HEALTH_PRODUCTS[0]

  const [name, setName] = useState('')
  const [idValue, setIdValue] = useState('') // 생년월일(8) 또는 주민번호(13) — 상품에 따라
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
  const needDate = selected.dateMode === 'range'
  const idLen = selected.idField === 'birth' ? 8 : 13

  const refresh = async (): Promise<void> => {
    const r = await listHealthRecords()
    if (r.ok) setHistory(r.items)
  }
  useEffect(() => {
    void refresh()
  }, [])

  // 상품을 바꾸면 진행 중이던 세션/결과를 비운다(요청변수가 달라지므로).
  const onProductChange = (key: string): void => {
    setProductKey(key)
    setIdValue('')
    setTwoWay(undefined)
    setRequestId(undefined)
    setResult(null)
    setError(null)
    setNotice(null)
    setConfigNote(null)
  }

  // CODEF 요청 변수 — 선택 상품 스펙(간편인증 loginType "5")대로.
  const buildParam = (): Record<string, unknown> => {
    const p: Record<string, unknown> = {
      organization: selected.organization,
      loginType: '5',
      loginTypeLevel: provider,
      userName: name.trim(),
      identity: digits(idValue),
      phoneNo: digits(phone),
      ...(selected.extraParams ?? {})
    }
    if (needDate) {
      p.startDate = digits(startDate)
      p.endDate = digits(endDate)
    }
    if (needTelecom) p.telecom = telecom
    return p
  }

  // 진료받은 내용(range)만의 조회기간 규칙: 조회일 기준 14개월 전 ~ 2개월 전(최근 2개월 미반영).
  const minStart = monthsAgoStr(14)
  const maxEnd = monthsAgoStr(2)
  const validPeriod =
    !needDate ||
    (digits(startDate).length === 8 &&
      digits(endDate).length === 8 &&
      digits(startDate) < digits(endDate) &&
      digits(startDate) >= minStart &&
      digits(endDate) <= maxEnd)
  const canStart =
    Boolean(name.trim()) && digits(idValue).length === idLen && digits(phone).length >= 10 && validPeriod

  const onStart = async (): Promise<void> => {
    setError(null)
    setNotice(null)
    setConfigNote(null)
    setResult(null)
    setTwoWay(undefined)
    setRequestId(undefined)
    if (!canStart) {
      const idMsg = selected.idField === 'birth' ? '생년월일(8자리)' : '주민등록번호(13자리)'
      const dateMsg = needDate ? ` 조회기간은 「약 14개월 전 ~ 2개월 전」(${minStart} ~ ${maxEnd}) 안이어야 합니다.` : ''
      setError(`고객 성함·${idMsg}·휴대폰 번호를 확인해주세요.${dateMsg}`)
      return
    }
    setBusy('고객 휴대폰으로 간편인증을 요청하는 중…')
    try {
      const r = await startHealthRecord({
        customerName: name.trim(),
        product: selected.url,
        param: buildParam(),
        encryptFields: selected.encrypt
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
      const r = await confirmHealthRecord({
        requestId,
        product: selected.url,
        param: buildParam(),
        twoWay,
        encryptFields: selected.encrypt
      })
      if (r.disabled) {
        setConfigNote(r.error ?? 'CODEF 연동이 아직 설정되지 않았습니다.')
        return
      }
      if (!r.ok) {
        const deadSession = r.code === 'CF-00025' || /완료된 요청|만료|CF-00025/.test(r.error ?? '')
        if (deadSession) {
          setTwoWay(undefined)
          setRequestId(undefined)
          setError('인증 세션이 끝났습니다(1회용). 「간편인증 요청」부터 다시 하세요 — 요청 → 승인 → 결과 조회를 한 번씩만.')
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

  // 저장된(과거) 결과 다시 보기 — 완료 건이고 보관기간(30일) 안이면 그 결과를 결과 영역에 띄운다.
  const viewSaved = (h: HealthRecordRequest): void => {
    if (!h.result) return
    setError(null)
    setConfigNote(null)
    setTwoWay(undefined)
    setResult(h.result)
    setNotice(`저장된 결과를 불러왔습니다 — ${h.customerName || '고객'} · ${new Date(h.createdAt).toLocaleDateString('ko-KR')}`)
    setTimeout(() => document.getElementById('hr-result')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
  }

  return (
    <div className="space-y-4">
      {/* 헤더 */}
      <div className="rounded-2xl border border-slate-800 bg-[#0e1e3a] px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-[#e6c877]" />
          <h1 className="text-sm font-extrabold text-white">고객 건강기록 조회</h1>
          <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-bold text-white/80">{selected.short} · 간편인증(CODEF)</span>
        </div>
        <p className="mt-1 text-[11px] text-white/60">
          고객 동의 하에 간편인증으로 건강기록을 확인합니다. 조회 결과는 접근 권한(RLS)으로 보호되며 {RETAIN_DAYS}일 후 자동 만료됩니다.
        </p>
      </div>

      {configNote ? (
        <div className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-[12px] text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <b className="font-bold">CODEF 연동 설정 필요</b> — {configNote}
            <div className="mt-1 text-[11px] text-amber-700">
              Supabase 시크릿에 CODEF_CLIENT_ID / CODEF_CLIENT_SECRET / CODEF_PUBLIC_KEY 를 등록하면 즉시 동작합니다.
            </div>
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* 입력 + 요청 */}
        <div className="rounded-2xl border border-slate-800 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-bold text-slate-100">① 조회 상품 · 고객 정보 · 간편인증 요청</h2>
          <div className="mt-3 space-y-2.5">
            <div>
              <label className="text-[11px] font-semibold text-slate-400">조회 상품</label>
              <select value={productKey} onChange={(e) => onProductChange(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-white px-2 py-2 text-[13px] font-semibold text-slate-100 outline-none focus:border-[#c6982f]">
                {HEALTH_PRODUCTS.map((p) => (
                  <option key={p.key} value={p.key}>{p.label}</option>
                ))}
              </select>
              <p className="mt-0.5 text-[10px] leading-relaxed text-slate-500">{selected.note}</p>
            </div>
            <div>
              <label className="text-[11px] font-semibold text-slate-400">고객 성함</label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="홍길동"
                className="mt-1 w-full rounded-lg border border-slate-700 bg-white px-3 py-2 text-[13px] text-slate-100 outline-none focus:border-[#c6982f]" />
            </div>
            <div className="flex gap-2">
              <div className="flex-1">
                {selected.idField === 'birth' ? (
                  <>
                    <label className="text-[11px] font-semibold text-slate-400">생년월일 (YYYYMMDD · 8자리)</label>
                    <input value={idValue} onChange={(e) => setIdValue(e.target.value)} inputMode="numeric" maxLength={8} placeholder="19900101"
                      className="mt-1 w-full rounded-lg border border-slate-700 bg-white px-3 py-2 text-[13px] text-slate-100 outline-none focus:border-[#c6982f]" />
                  </>
                ) : (
                  <>
                    <label className="text-[11px] font-semibold text-slate-400">주민등록번호 (13자리)</label>
                    <input value={idValue} onChange={(e) => setIdValue(e.target.value)} inputMode="numeric" maxLength={14} placeholder="앞 6자리 + 뒤 7자리"
                      className="mt-1 w-full rounded-lg border border-slate-700 bg-white px-3 py-2 text-[13px] text-slate-100 outline-none focus:border-[#c6982f]" />
                  </>
                )}
              </div>
              <div className="flex-1">
                <label className="text-[11px] font-semibold text-slate-400">휴대폰 번호</label>
                <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="numeric" placeholder="01012345678"
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-white px-3 py-2 text-[13px] text-slate-100 outline-none focus:border-[#c6982f]" />
              </div>
            </div>
            {selected.idField === 'rrn' ? (
              <p className="-mt-1 text-[10px] text-slate-500">※ 주민번호는 서버에서 암호화되어 전송되며 화면·앱에 저장되지 않습니다.</p>
            ) : null}
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
            {needDate ? (
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
            ) : null}
          </div>

          <button type="button" onClick={() => void onStart()} disabled={Boolean(busy) || !canStart}
            className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-[#0e1e3a] px-4 py-2.5 text-[13px] font-bold text-white transition hover:opacity-90 disabled:opacity-50">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            간편인증 요청
          </button>
          <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
            순서: <b className="text-slate-300">간편인증 요청 → 고객 휴대폰 인증앱(카카오/네이버/통신사PASS 등)에서 승인 → 결과 조회</b>. 각 단계는 한 번씩만 — 결과 조회가 안 되면 「간편인증 요청」부터 다시 하세요.
            {needDate ? <> 조회 가능 기간은 <b className="text-slate-300">조회일 기준 14개월 전 ~ 2개월 전</b>(최근 2개월은 공단 반영 전)이라 기본값을 그 창으로 설정했습니다.</> : <> 이 상품은 <b className="text-slate-300">최근 1년치</b>를 자동 조회합니다.</>}
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
            <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-[12px] font-semibold text-emerald-700">
              조회가 완료됐습니다. 아래 <b>「조회 결과」</b>에서 상세 내역을 확인하세요.
            </div>
          ) : null}
        </div>
      </div>

      {result ? (
        <div id="hr-result">
          <ResultReport result={result} />
        </div>
      ) : null}

      {notice ? <div className="rounded-xl border border-slate-800 bg-white px-4 py-2.5 text-[12px] font-semibold text-emerald-700">{notice}</div> : null}
      {error ? <div className="rounded-xl border border-rose-300 bg-rose-50 px-4 py-2.5 text-[12px] font-semibold text-rose-700">{error}</div> : null}

      {/* 최근 요청 — 완료 건은 30일간 저장되어 다시 열람 가능 */}
      <div className="rounded-2xl border border-slate-800 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-100">최근 요청</h2>
          <button type="button" onClick={() => void refresh()} className="text-[11px] font-semibold text-slate-400 hover:text-slate-200">새로고침</button>
        </div>
        <p className="mt-0.5 text-[11px] text-slate-500">완료된 조회 결과는 <b className="text-slate-300">{RETAIN_DAYS}일간 보관</b>되어 다시 열람할 수 있고, 이후 자동 만료됩니다.</p>
        {history.length === 0 ? (
          <p className="mt-2 text-[12px] text-slate-500">아직 요청이 없습니다.</p>
        ) : (
          <div className="mt-2 divide-y divide-slate-800">
            {history.map((h) => {
              const age = daysSince(h.createdAt)
              const canViewRow = h.status === 'completed' && !!h.result && age <= RETAIN_DAYS
              const daysLeft = Math.max(0, RETAIN_DAYS - age)
              return (
                <div key={h.id} className="flex items-center gap-2 py-2 text-[12px]">
                  <span className="min-w-0 flex-1 truncate font-semibold text-slate-200">{h.customerName || '고객 미지정'}</span>
                  <span className="shrink-0 text-slate-500">{new Date(h.createdAt).toLocaleString('ko-KR')}</span>
                  {canViewRow ? <span className="shrink-0 text-[10px] font-semibold text-slate-400">{daysLeft}일 남음</span> : null}
                  <StatusBadge status={h.status} />
                  {canViewRow ? (
                    <button type="button" onClick={() => viewSaved(h)}
                      className="shrink-0 rounded-lg border border-slate-700 bg-white px-2.5 py-1 text-[11px] font-bold text-slate-200 transition hover:bg-slate-950">
                      결과 보기
                    </button>
                  ) : (
                    <span className="w-[52px] shrink-0 text-right text-[10px] text-slate-400">{h.status === 'completed' ? '보관 만료' : ''}</span>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

/** 결과 렌더러 — 데이터 모양으로 진료(카테고리 보고서)/약품·기타(상세 표)를 자동 구분. */
function ResultReport({ result }: { result: Record<string, unknown> }): JSX.Element {
  const [showRaw, setShowRaw] = useState(false)
  const records = useMemo(() => toRecords(result), [result])
  const raw = useMemo(() => JSON.stringify(result, null, 2), [result])
  const isTreatment = records.some((r) => 'resTreatType' in r || 'resPublicCharge' in r)
  const userNm = String(records[0]?.resUserNm ?? '')

  return (
    <div className="rounded-2xl border border-slate-800 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-bold text-slate-100">
          조회 결과
          {userNm ? <span className="text-slate-400"> · {userNm}</span> : null}
          {records.length ? <span className="text-slate-400"> · 총 {records.length}건</span> : null}
        </h2>
        {records.length ? (
          <button type="button" onClick={() => setShowRaw((v) => !v)} className="text-[11px] font-semibold text-slate-400 hover:text-slate-200">
            {showRaw ? '표로 보기' : '원본(JSON) 보기'}
          </button>
        ) : null}
      </div>

      {records.length === 0 || showRaw ? (
        <pre className="mt-2 max-h-80 overflow-auto rounded-xl border border-slate-800 bg-slate-950 p-3 text-[11px] leading-relaxed text-slate-100">{raw}</pre>
      ) : isTreatment ? (
        <TreatmentReport records={records} />
      ) : (
        <GenericTable records={records} />
      )}
    </div>
  )
}

/** 건강보험공단 「진료받은 내용」 — 카테고리 보고서(진료형태별) + 상세 표. */
function TreatmentReport({ records }: { records: Row[] }): JSX.Element {
  const { cats, total } = useMemo(() => summarize(records), [records])
  return (
    <>
      <div className="mt-3">
        <div className="mb-1 text-[11px] font-semibold text-slate-400">카테고리 보고서 · 진료형태별</div>
        <div className="overflow-x-auto rounded-xl border border-slate-800">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="bg-slate-950 text-slate-300">
                <th className="px-3 py-2 text-left font-semibold">진료형태</th>
                <th className="px-3 py-2 text-right font-semibold">건수</th>
                <th className="px-3 py-2 text-right font-semibold">본인부담금</th>
                <th className="px-3 py-2 text-right font-semibold">공단부담금</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800 text-slate-200">
              {cats.map((c) => (
                <tr key={c.type}>
                  <td className="px-3 py-2 font-semibold">{c.type}</td>
                  <td className="px-3 py-2 text-right">{c.count}건</td>
                  <td className="px-3 py-2 text-right">{c.deductible.toLocaleString('ko-KR')}원</td>
                  <td className="px-3 py-2 text-right">{c.publicCharge.toLocaleString('ko-KR')}원</td>
                </tr>
              ))}
              <tr className="bg-[#fdf7ea] font-bold text-[#8a6a1f]">
                <td className="px-3 py-2">합계</td>
                <td className="px-3 py-2 text-right">{total.count}건</td>
                <td className="px-3 py-2 text-right">{total.deductible.toLocaleString('ko-KR')}원</td>
                <td className="px-3 py-2 text-right">{total.publicCharge.toLocaleString('ko-KR')}원</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-4">
        <div className="mb-1 text-[11px] font-semibold text-slate-400">진료 상세 내역 · 치료/투약</div>
        <div className="overflow-x-auto rounded-xl border border-slate-800">
          <table className="w-full whitespace-nowrap text-[12px]">
            <thead>
              <tr className="bg-slate-950 text-slate-300">
                <th className="px-3 py-2 text-left font-semibold">병의원·약국</th>
                <th className="px-3 py-2 text-left font-semibold">진료개시일</th>
                <th className="px-3 py-2 text-left font-semibold">진료형태(치료)</th>
                <th className="px-3 py-2 text-right font-semibold">처방횟수</th>
                <th className="px-3 py-2 text-right font-semibold">투약일수</th>
                <th className="px-3 py-2 text-right font-semibold">방문(입원)일수</th>
                <th className="px-3 py-2 text-right font-semibold">본인부담금</th>
                <th className="px-3 py-2 text-right font-semibold">공단부담금</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800 text-slate-200">
              {records.map((r, i) => (
                <tr key={i}>
                  <td className="px-3 py-2 font-medium">{String(r.resHospitalName ?? '') || '-'}</td>
                  <td className="px-3 py-2">{ymd(r.resTreatStartDate)}</td>
                  <td className="px-3 py-2">
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700">{String(r.resTreatType ?? '') || '-'}</span>
                  </td>
                  <td className="px-3 py-2 text-right">{num(r.resPrescribeCnt)}회</td>
                  <td className="px-3 py-2 text-right font-semibold text-[#8a6a1f]">{num(r.resPrescribeDays)}일분</td>
                  <td className="px-3 py-2 text-right">{num(r.resVisitDays)}일</td>
                  <td className="px-3 py-2 text-right">{won(r.resDeductibleAmt)}</td>
                  <td className="px-3 py-2 text-right">{won(r.resPublicCharge)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-1.5 text-[10px] leading-relaxed text-slate-500">
          ※ 「진료받은 내용」(건강보험공단) 전 항목 — 진료형태(받은 치료 구분)·처방횟수·투약일수·방문(입원)일수·본인/공단 부담금. 개별 약품명은 「내가먹는약 한눈에」에서 확인하세요.
        </p>
      </div>
    </>
  )
}

/** CODEF 응답 필드 한글 라벨(알려진 것만 — 없으면 원래 키 표시). */
const FIELD_LABELS: Record<string, string> = {
  resUserNm: '성명',
  commStartDate: '조제일자',
  resPrescribeDate: '처방일자',
  resTreatDate: '처방일자',
  resPrescribeNo: '처방순번',
  resPharmacyName: '조제기관(약국)',
  resHospitalName: '처방기관(병원)',
  resTreatMeaning: '약품명',
  resDrugName: '약품명',
  resMedicineName: '약품명',
  resIngredientName: '성분명',
  resComponent: '성분',
  resPrescribeDays: '투약일수',
  resDosageDays: '투약일수',
  resOnceDosage: '1회 투약량',
  resDailyDosageCnt: '1일 투약횟수',
  resTotalDosageCnt: '총 투약횟수',
  resManufacturer: '제조사',
  resEfficacy: '효능·효과',
  resTelNo: '전화번호',
  resType: '구분'
}
const labelOf = (k: string): string => FIELD_LABELS[k] ?? k
const cellOf = (v: unknown): string => {
  if (v === null || v === undefined || v === '') return '-'
  if (Array.isArray(v)) return `${v.length}건`
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

/** 약품/기타 상품 — 응답 필드를 그대로 상세 표로. 알려진 날짜/라벨은 보기 좋게. */
function GenericTable({ records }: { records: Row[] }): JSX.Element {
  const columns = useMemo(() => {
    const seen: string[] = []
    for (const r of records) for (const k of Object.keys(r)) if (!seen.includes(k)) seen.push(k)
    return seen
  }, [records])

  return (
    <div className="mt-3">
      <div className="mb-1 text-[11px] font-semibold text-slate-400">상세 내역 · 약품/투약</div>
      <div className="overflow-x-auto rounded-xl border border-slate-800">
        <table className="w-full whitespace-nowrap text-[12px]">
          <thead>
            <tr className="bg-slate-950 text-slate-300">
              {columns.map((c) => (
                <th key={c} className="px-3 py-2 text-left font-semibold">{labelOf(c)}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800 text-slate-200">
            {records.map((r, i) => (
              <tr key={i}>
                {columns.map((c) => (
                  <td key={c} className="px-3 py-2">
                    {/[Dd]ate$/.test(c) ? ymd(r[c]) : cellOf(r[c])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-1.5 text-[10px] leading-relaxed text-slate-500">※ CODEF 응답 전 항목을 표로 표시합니다. 컬럼명은 상품 스펙 확정 후 더 다듬을 수 있어요.</p>
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
