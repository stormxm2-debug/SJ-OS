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
 * 고객 건강기록(공단·심평원) 조회 — CODEF 간편인증.
 *
 * 1) 고객 정보 입력 → 간편인증 요청  2) 고객이 휴대폰(카카오/PASS)에서 승인
 * 3) 승인 완료 → 결과 조회(진료·검진 내역).  민감 의료정보이므로 동의 하에만 진행한다.
 *
 * ※ CODEF 상품 URL·요청변수는 서버(엣지함수) 설정을 따른다. 아래 요청변수(param) 필드명은
 *    CODEF 콘솔의 「진료받은내용/건강검진」 상품 스펙에 맞춰 최종 확정한다(현재는 뼈대).
 */

const TELECOMS = ['SKT', 'KT', 'LGU+', 'SKT알뜰폰', 'KT알뜰폰', 'LGU+알뜰폰']

const digits = (s: string): string => s.replace(/[^\d]/g, '')
const todayStr = (): string => new Date().toISOString().slice(0, 10).replace(/-/g, '')
const monthsAgoStr = (n: number): string => {
  const d = new Date()
  d.setMonth(d.getMonth() - n)
  return d.toISOString().slice(0, 10).replace(/-/g, '')
}

export default function HealthRecordPage(): JSX.Element {
  const [name, setName] = useState('')
  const [rrn, setRrn] = useState('') // 주민번호 13자리
  const [phone, setPhone] = useState('')
  const [telecom, setTelecom] = useState('SKT')

  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [configNote, setConfigNote] = useState<string | null>(null)

  const [requestId, setRequestId] = useState<string | undefined>(undefined)
  const [twoWay, setTwoWay] = useState<TwoWayInfo | undefined>(undefined)
  const [result, setResult] = useState<Record<string, unknown> | null>(null)
  const [history, setHistory] = useState<HealthRecordRequest[]>([])

  const refresh = async (): Promise<void> => {
    const r = await listHealthRecords()
    if (r.ok) setHistory(r.items)
  }
  useEffect(() => {
    void refresh()
  }, [])

  // CODEF 요청 변수 — 상품 스펙대로 최종 확정. (조회기간: 최근 14개월, 최근 2개월 제외 권장)
  const buildParam = (): Record<string, unknown> => ({
    loginType: '5', // 간편인증 (상품 스펙에 맞춰 확정)
    userName: name.trim(),
    identity: digits(rrn), // 주민번호 — 서버에서 RSA 암호화
    phoneNo: digits(phone),
    telecom,
    startDate: monthsAgoStr(14),
    endDate: monthsAgoStr(2),
    inquiryType: '0'
  })

  const canStart = name.trim() && digits(rrn).length === 13 && digits(phone).length >= 10

  const onStart = async (): Promise<void> => {
    setError(null)
    setNotice(null)
    setConfigNote(null)
    setResult(null)
    setTwoWay(undefined)
    if (!canStart) {
      setError('고객 성함·주민번호(13자리)·휴대폰 번호를 확인해주세요.')
      return
    }
    setBusy('고객 휴대폰으로 간편인증을 요청하는 중…')
    try {
      const r = await startHealthRecord({
        customerName: name.trim(),
        param: buildParam(),
        encryptFields: ['identity']
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
        setError(r.error ?? '아직 승인 전이거나 조회에 실패했습니다. 고객 승인 후 다시 시도해주세요.')
        return
      }
      setResult(r.result ?? {})
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
          <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-bold text-white/80">공단·심평원 · 간편인증(CODEF)</span>
        </div>
        <p className="mt-1 text-[11px] text-white/60">
          고객 동의 하에 간편인증으로 진료·검진 내역을 확인합니다. 민감 의료정보는 저장 시 접근 권한(RLS)으로 보호됩니다.
        </p>
      </div>

      {configNote ? (
        <div className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-[12px] text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <b className="font-bold">CODEF 연동 설정 필요</b> — {configNote}
            <div className="mt-1 text-[11px] text-amber-700">
              Supabase 시크릿에 CODEF_CLIENT_ID / CODEF_CLIENT_SECRET / CODEF_PUBLIC_KEY / CODEF_HEALTH_PRODUCT_URL 을 등록하면 즉시 동작합니다.
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
            <div>
              <label className="text-[11px] font-semibold text-slate-400">주민등록번호 (13자리)</label>
              <input value={rrn} onChange={(e) => setRrn(e.target.value)} inputMode="numeric" placeholder="앞 6자리-뒤 7자리"
                className="mt-1 w-full rounded-lg border border-slate-700 bg-white px-3 py-2 text-[13px] text-slate-100 outline-none focus:border-[#c6982f]" />
              <p className="mt-0.5 text-[10px] text-slate-500">서버에서 암호화되어 전송됩니다. 앱·화면에 저장되지 않습니다.</p>
            </div>
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="text-[11px] font-semibold text-slate-400">휴대폰 번호</label>
                <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="numeric" placeholder="01012345678"
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-white px-3 py-2 text-[13px] text-slate-100 outline-none focus:border-[#c6982f]" />
              </div>
              <div className="w-32">
                <label className="text-[11px] font-semibold text-slate-400">통신사</label>
                <select value={telecom} onChange={(e) => setTelecom(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-white px-2 py-2 text-[13px] text-slate-100 outline-none focus:border-[#c6982f]">
                  {TELECOMS.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <button type="button" onClick={() => void onStart()} disabled={Boolean(busy) || !canStart}
            className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-[#0e1e3a] px-4 py-2.5 text-[13px] font-bold text-white transition hover:opacity-90 disabled:opacity-50">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            간편인증 요청
          </button>
          <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
            조회 범위: 최근 약 14개월(최근 2개월 제외). 요청 후 고객 휴대폰의 인증앱(카카오/PASS 등)에서 승인해야 합니다.
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
              <p className="mt-1 text-[10px] text-slate-500">※ 표시 형식은 CODEF 응답 스펙 확정 후 진료/검진 항목 표로 정리합니다.</p>
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
