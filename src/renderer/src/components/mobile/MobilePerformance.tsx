import { useEffect, useMemo, useState } from 'react'
import { BarChart3, ChevronLeft, ChevronRight, Plus, Trash2, Loader2, Crown, X, AlertTriangle } from 'lucide-react'
import { useSession } from '@renderer/navigation/SessionContext'
import {
  addEntry,
  deleteEntry,
  listEntriesMonth,
  listExcelMonth,
  buildEffectiveMonthly,
  weightedTotal,
  currentMonth,
  todayDate,
  monthOfDate,
  CATEGORY_LABEL,
  SHORT_TERM_RATE,
  type ContractEntry,
  type PerformanceEntry,
  type PerformanceCategory
} from '@renderer/services/commercial/performanceRecordsService'
import { useRealtimeSync } from '@renderer/services/commercial/useRealtimeSync'

/**
 * 모바일 실적관리 v2 — 데스크톱과 같은 실데이터(performance_entries + 관리자 엑셀
 * performance_records)로 전면 재개발. 이전 화면은 서버 미연동 MVP 스텁이었다.
 *
 * - 골드 총매출 카드: 생보 + 손보 + 단기납×60% 자동 환산, 엑셀 확정/본인 입력 배지
 * - 월 이동(◀ ▶), 건별 등록·삭제 (폰에서 바로 입력 — 대표 승인)
 * - 전사 평균 비교 칩 + 관리자 순위 보드(TOP, 금·은·동) — 대표 선택 기능
 */

const RT_TABLES = ['performance_entries', 'performance_records']

const CATEGORY_CHIP: Record<PerformanceCategory, string> = {
  life: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  'non-life': 'bg-sky-50 text-sky-700 border-sky-200',
  'short-term': 'bg-amber-50 text-amber-700 border-amber-200'
}

function comma(n: number): string {
  return n.toLocaleString('ko-KR')
}
function monthLabel(m: string): string {
  const [y, mm] = m.split('-')
  return `${y}년 ${Number(mm)}월`
}
function moveMonth(m: string, delta: number): string {
  const [y, mm] = m.split('-').map(Number)
  const d = new Date(y, mm - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export default function MobilePerformance(): JSX.Element {
  const { session } = useSession()
  const [month, setMonth] = useState(currentMonth())
  const [entries, setEntries] = useState<ContractEntry[]>([])
  const [excel, setExcel] = useState<PerformanceEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showAllRank, setShowAllRank] = useState(false)

  // 건별 등록 폼
  const [formOpen, setFormOpen] = useState(false)
  const [date, setDate] = useState(todayDate())
  const [category, setCategory] = useState<PerformanceCategory>('life')
  const [amount, setAmount] = useState('')
  const [memo, setMemo] = useState('')
  const [busy, setBusy] = useState(false)

  const load = async (m: string = month): Promise<void> => {
    setLoading(true)
    const [en, ex] = await Promise.all([listEntriesMonth(m), listExcelMonth(m)])
    if (en.ok) {
      setEntries(en.data)
      setNotice(null)
    } else {
      setEntries([])
      setNotice(en.message)
    }
    setExcel(ex.ok ? ex.data : [])
    setLoading(false)
  }
  useEffect(() => {
    void load(month)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month])
  useRealtimeSync(RT_TABLES, () => void load())

  // 유효 실적: 관리자 엑셀 우선, 없으면 본인 건별 합산 (데스크톱과 동일 규칙)
  const effective = useMemo(() => buildEffectiveMonthly(excel, entries), [excel, entries])
  const mine = effective.find((e) => e.staffId === session.id)
  const myTotal = mine ? weightedTotal(mine) : 0
  const myEntries = useMemo(
    () => entries.filter((e) => e.staffId === session.id).sort((a, b) => b.entryDate.localeCompare(a.entryDate)),
    [entries, session.id]
  )
  const ranked = useMemo(() => [...effective].sort((a, b) => weightedTotal(b) - weightedTotal(a)), [effective])
  const avg = effective.length > 0 ? Math.round(effective.reduce((s, e) => s + weightedTotal(e), 0) / effective.length) : 0
  const diff = myTotal - avg

  const submit = async (): Promise<void> => {
    const amt = Number(amount.replace(/[^0-9]/g, ''))
    if (!amt) {
      setError('보험료 금액을 입력해 주세요.')
      return
    }
    setBusy(true)
    const r = await addEntry({ entryDate: date, category, amount: amt, memo: memo.trim() || undefined })
    setBusy(false)
    if (!r.ok) {
      setError(r.message)
      return
    }
    setError(null)
    setAmount('')
    setMemo('')
    setFormOpen(false)
    const m = monthOfDate(date)
    if (m !== month) setMonth(m)
    else void load()
  }

  const del = async (e: ContractEntry): Promise<void> => {
    if (typeof window !== 'undefined' && !window.confirm(`${e.entryDate} · ${CATEGORY_LABEL[e.category]} ${comma(e.amount)}원 건을 삭제할까요?`)) return
    const r = await deleteEntry(e.id)
    if (!r.ok) {
      setError(r.message)
      return
    }
    void load()
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <BarChart3 className="h-5 w-5 text-[#b0821f]" />
        <h1 className="text-base font-extrabold text-slate-100">실적관리</h1>
      </div>

      {notice ? (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {notice}
        </div>
      ) : null}

      {/* ─── 골드 총매출 카드 ─── */}
      <div className="overflow-hidden rounded-2xl border shadow-lg" style={{ backgroundColor: '#0e1e3a', borderColor: '#c6982f' }}>
        <div className="flex items-center justify-between px-3 pt-3">
          <button type="button" onClick={() => setMonth((m) => moveMonth(m, -1))} aria-label="이전 달" className="rounded-full p-1.5 text-white/70 active:bg-white/10">
            <ChevronLeft className="h-5 w-5" />
          </button>
          <div className="text-sm font-bold text-white">{monthLabel(month)}</div>
          <button type="button" onClick={() => setMonth((m) => moveMonth(m, 1))} aria-label="다음 달" className="rounded-full p-1.5 text-white/70 active:bg-white/10">
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>
        <div className="px-4 pb-4 pt-1 text-center">
          <div className="text-[11px] font-bold" style={{ color: '#e6c877' }}>
            내 총매출 (단기납 {Math.round(SHORT_TERM_RATE * 100)}% 환산)
          </div>
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-3 text-sm text-white/70">
              <Loader2 className="h-4 w-4 animate-spin" /> 불러오는 중…
            </div>
          ) : (
            <>
              <div className="mt-0.5 text-3xl font-black tabular-nums text-white">{comma(myTotal)}원</div>
              <div className="mt-1 flex items-center justify-center gap-1.5 text-[10px]">
                <span
                  className="rounded-full px-2 py-0.5 font-bold"
                  style={mine?.source === 'excel' ? { backgroundColor: '#c6982f', color: '#0e1e3a' } : { backgroundColor: 'rgba(255,255,255,0.15)', color: '#fff' }}
                >
                  {mine ? (mine.source === 'excel' ? '관리자 엑셀 확정' : `본인 입력 ${mine.contractCount}건`) : '입력 없음'}
                </span>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-xl bg-white/10 px-1 py-2">
                  <div className="text-[10px] text-white/60">생명보험</div>
                  <div className="text-[13px] font-bold tabular-nums text-white">{comma(mine?.life ?? 0)}</div>
                </div>
                <div className="rounded-xl bg-white/10 px-1 py-2">
                  <div className="text-[10px] text-white/60">손해보험</div>
                  <div className="text-[13px] font-bold tabular-nums text-white">{comma(mine?.nonLife ?? 0)}</div>
                </div>
                <div className="rounded-xl bg-white/10 px-1 py-2">
                  <div className="text-[10px] text-white/60">단기납종신</div>
                  <div className="text-[13px] font-bold tabular-nums text-white">{comma(mine?.shortTerm ?? 0)}</div>
                  {mine && mine.shortTerm > 0 ? (
                    <div className="text-[9px]" style={{ color: '#e6c877' }}>
                      →{comma(Math.round(mine.shortTerm * SHORT_TERM_RATE))} 반영
                    </div>
                  ) : null}
                </div>
              </div>
              {/* 전사 평균 비교 (데이터가 2명 이상 보일 때만) */}
              {effective.length >= 2 ? (
                <div className="mt-3 flex items-center justify-center gap-2 rounded-xl bg-white/5 px-2 py-1.5 text-[11px]">
                  <span className="text-white/60">전사 평균 {comma(avg)}원</span>
                  <span className={['rounded-full px-2 py-0.5 font-bold', diff >= 0 ? 'bg-emerald-500/20 text-emerald-300' : 'bg-rose-500/20 text-rose-300'].join(' ')}>
                    평균 대비 {diff >= 0 ? '+' : '-'}
                    {comma(Math.abs(diff))}원
                  </span>
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>

      {/* ─── 직원 순위 보드 — 전 직원 상호 공개 (대표 지시) ─── */}
      {ranked.length > 0 ? (
        <div className="rounded-2xl border border-slate-800 bg-white p-3 shadow-sm">
          <div className="mb-2 flex items-center gap-1.5 text-[12px] font-bold text-slate-100">
            <Crown className="h-4 w-4 text-[#c6982f]" /> {monthLabel(month)} 직원 순위
            <span className="font-medium text-slate-500">({ranked.length}명)</span>
          </div>
          <div className="space-y-1">
            {(showAllRank ? ranked : ranked.slice(0, 5)).map((e, i) => {
              const total = weightedTotal(e)
              const medal = i === 0 ? 'text-[#c6982f]' : i === 1 ? 'text-slate-400' : i === 2 ? 'text-amber-700' : 'text-slate-500'
              const isMe = e.staffId === session.id
              return (
                <div
                  key={e.staffId}
                  className={['flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[12px]', isMe ? 'bg-[#c6982f]/10 ring-1 ring-[#c6982f]/40' : 'bg-slate-950'].join(' ')}
                >
                  <span className={['w-6 shrink-0 text-center font-black tabular-nums', medal].join(' ')}>
                    {i < 3 ? <Crown className="mx-auto h-3.5 w-3.5" /> : i + 1}
                  </span>
                  <span className="min-w-0 truncate font-semibold text-slate-100">{e.staffName}</span>
                  {e.source === 'excel' ? <span className="shrink-0 rounded-full bg-[#c6982f]/15 px-1.5 py-0.5 text-[9px] font-bold text-[#b0821f]">엑셀</span> : null}
                  <span className="ml-auto shrink-0 font-bold tabular-nums text-slate-100">{comma(total)}원</span>
                </div>
              )
            })}
          </div>
          {ranked.length > 5 ? (
            <button type="button" onClick={() => setShowAllRank((v) => !v)} className="mt-1.5 w-full text-center text-[11px] font-medium text-indigo-600">
              {showAllRank ? '접기' : `전체 ${ranked.length}명 보기`}
            </button>
          ) : null}
        </div>
      ) : null}

      {/* ─── 건별 등록 ─── */}
      {!formOpen ? (
        <button
          type="button"
          onClick={() => {
            setFormOpen(true)
            setError(null)
          }}
          className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-blue-600 to-indigo-600 py-3 text-sm font-bold text-white shadow-sm active:brightness-110"
        >
          <Plus className="h-4 w-4" /> 계약 실적 등록
        </button>
      ) : (
        <div className="rounded-2xl border border-indigo-200 bg-white p-3 shadow-sm">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-[13px] font-bold text-slate-100">계약 실적 등록</div>
            <button type="button" onClick={() => setFormOpen(false)} aria-label="닫기" className="text-slate-400">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {(Object.keys(CATEGORY_LABEL) as PerformanceCategory[]).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCategory(c)}
                className={[
                  'rounded-full border px-3 py-1.5 text-[12px] font-semibold transition',
                  CATEGORY_CHIP[c],
                  category === c ? 'ring-2 ring-indigo-400' : 'opacity-60'
                ].join(' ')}
              >
                {CATEGORY_LABEL[c]}
              </button>
            ))}
          </div>
          <div className="mb-2 grid grid-cols-2 gap-2">
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="rounded-xl border border-slate-800 bg-white px-2.5 py-2 text-[13px] text-slate-100"
            />
            <input
              inputMode="numeric"
              value={amount}
              onChange={(e) => {
                const raw = e.target.value.replace(/[^0-9]/g, '')
                setAmount(raw ? comma(Number(raw)) : '')
              }}
              placeholder="보험료 (원)"
              className="rounded-xl border border-slate-800 bg-white px-2.5 py-2 text-right text-[13px] tabular-nums text-slate-100 placeholder:text-slate-500"
            />
          </div>
          <input
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            placeholder="메모 (선택) — 고객명·상품명 등"
            className="mb-2 w-full rounded-xl border border-slate-800 bg-white px-2.5 py-2 text-[13px] text-slate-100 placeholder:text-slate-500"
          />
          {category === 'short-term' ? (
            <p className="mb-2 text-[10px] text-amber-700">단기납종신은 총매출에 {Math.round(SHORT_TERM_RATE * 100)}%로 환산 반영됩니다.</p>
          ) : null}
          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 py-2.5 text-sm font-bold text-white active:brightness-110 disabled:opacity-60"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} 등록
          </button>
        </div>
      )}
      {error ? <p className="text-center text-[12px] text-rose-600">{error}</p> : null}

      {/* ─── 내 건별 계약 목록 ─── */}
      <div className="rounded-2xl border border-slate-800 bg-white p-3 shadow-sm">
        <div className="mb-2 text-[12px] font-bold text-slate-100">
          내 계약 내역 <span className="font-medium text-slate-500">({myEntries.length}건)</span>
        </div>
        {loading ? (
          <div className="flex items-center gap-2 py-4 text-[12px] text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" /> 불러오는 중…
          </div>
        ) : myEntries.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-700 py-6 text-center text-[12px] text-slate-500">
            {monthLabel(month)} 등록한 계약이 없습니다.
          </div>
        ) : (
          <div className="space-y-1">
            {myEntries.map((e) => (
              <div key={e.id} className="flex items-center gap-2 rounded-lg bg-slate-950 px-2.5 py-2 text-[12px]">
                <span className="w-12 shrink-0 tabular-nums text-slate-500">{e.entryDate.slice(5).replace('-', '/')}</span>
                <span className={['shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold', CATEGORY_CHIP[e.category]].join(' ')}>
                  {CATEGORY_LABEL[e.category]}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-bold tabular-nums text-slate-100">{comma(e.amount)}원</span>
                  {e.memo ? <span className="block truncate text-[10px] text-slate-500">{e.memo}</span> : null}
                </span>
                <button type="button" onClick={() => void del(e)} aria-label="삭제" className="shrink-0 rounded-lg p-1.5 text-slate-400 active:text-rose-600">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
        {mine?.source === 'excel' ? (
          <p className="mt-2 text-[10px] text-slate-500">이 달은 관리자 엑셀 확정치가 우선 적용 중입니다 (건별 내역은 참고용).</p>
        ) : null}
      </div>
    </div>
  )
}
