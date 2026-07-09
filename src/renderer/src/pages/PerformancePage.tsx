import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import {
  BarChart3,
  Wallet,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  Download,
  UploadCloud,
  FileSpreadsheet,
  Trophy,
  Info,
  ShieldCheck,
  Plus,
  Pencil,
  Trash2,
  X
} from 'lucide-react'
import Card from '@renderer/components/ui/Card'
import { useSession } from '@renderer/navigation/SessionContext'
import { useRealtimeSync } from '@renderer/services/commercial/useRealtimeSync'
import {
  addEntry,
  adminApplyExcelRows,
  buildEffectiveMonthly,
  CATEGORY_LABEL,
  currentMonth,
  deleteEntry,
  listEntriesMonth,
  listExcelMonth,
  loadStaffDirectory,
  monthOfDate,
  SHORT_TERM_RATE,
  summarize,
  todayDate,
  updateEntry,
  weightedTotal,
  type ContractEntry,
  type PerformanceCategory,
  type PerformanceEntry,
  type StaffDirectoryEntry
} from '@renderer/services/commercial/performanceRecordsService'
import {
  downloadTemplate,
  matchExcelRows,
  parseExcelFile,
  type ExcelMatchResult
} from '@renderer/services/commercial/performanceExcel'

/**
 * 실적 워크스페이스 — 건별 입력 + 관리자 엑셀.
 *
 *  - 직원: 계약이 들어올 때마다 한 건씩 추가(날짜·분류·금액·메모). 실수하면 그 건만
 *    수정/삭제. 월 합계·계약건수는 자동 합산.
 *  - 관리자(owner/admin): 엑셀 일괄 업로드(월 총액) → **엑셀 우선** 적용.
 *  - 매출 합계 = 생명 + 손해 + 단기납종신×60%.
 *  - 조회 범위 RLS 그대로(FC=본인, 팀장=팀, 관리자=전체) + 실시간 동기화.
 */

const RT_TABLES = ['performance_records', 'performance_entries']

const GOLD = '#b0821f'

const CATEGORY_OPTIONS: PerformanceCategory[] = ['life', 'non-life', 'short-term']
const CATEGORY_BADGE: Record<PerformanceCategory, string> = {
  life: 'bg-indigo-50 text-indigo-600',
  'non-life': 'bg-sky-50 text-sky-600',
  'short-term': 'bg-amber-50 text-amber-700'
}

function comma(n: number): string {
  return Math.round(n).toLocaleString('ko-KR')
}
function won(value: number): string {
  if (value >= 100_000_000) return `${(value / 100_000_000).toFixed(1)}억`
  if (value >= 10_000) return `${Math.round(value / 10_000).toLocaleString('ko-KR')}만`
  return comma(value)
}
function parseAmountInput(s: string): number {
  const n = Number(s.replace(/[^0-9]/g, ''))
  return Number.isFinite(n) ? n : 0
}

export default function PerformancePage(): JSX.Element {
  const { session } = useSession()
  const role = session.role
  const isAdmin = role === 'owner' || role === 'admin'

  const [month, setMonth] = useState(currentMonth())
  const [entries, setEntries] = useState<ContractEntry[]>([])
  const [excelRows, setExcelRows] = useState<PerformanceEntry[]>([])
  const [loadErr, setLoadErr] = useState<string | undefined>()

  const load = useCallback(async (): Promise<void> => {
    const [en, ex] = await Promise.all([listEntriesMonth(month), listExcelMonth(month)])
    if (en.ok) setEntries(en.data)
    if (ex.ok) setExcelRows(ex.data)
    setLoadErr(en.ok ? undefined : en.message)
  }, [month])

  useEffect(() => {
    void load()
  }, [load])
  useRealtimeSync(RT_TABLES, load)

  const effective = useMemo(() => buildEffectiveMonthly(excelRows, entries), [excelRows, entries])
  const totals = useMemo(() => summarize(effective), [effective])
  const ranking = useMemo(() => effective.slice().sort((a, b) => weightedTotal(b) - weightedTotal(a)), [effective])

  const myEntries = useMemo(() => entries.filter((e) => e.staffId === session.id), [entries, session.id])
  const myExcel = excelRows.find((e) => e.staffId === session.id)

  return (
    <div className="space-y-5">
      {/* 헤더: 월 선택 + 요약 */}
      <Card
        title="실적 현황 (전체)"
        icon={<BarChart3 className="h-4 w-4 text-indigo-600" />}
        action={
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="rounded-lg border border-slate-800 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-200 focus:outline-none"
          />
        }
      >
        {loadErr ? (
          <div className="mb-3 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-700">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {loadErr}
          </div>
        ) : null}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <Metric label="생명보험" value={`${won(totals.life)}원`} sub={`${comma(totals.life)}원`} tone="indigo" />
          <Metric label="손해보험" value={`${won(totals.nonLife)}원`} sub={`${comma(totals.nonLife)}원`} tone="sky" />
          <Metric
            label={`단기납종신 (${Math.round(SHORT_TERM_RATE * 100)}% 반영)`}
            value={`${won(totals.shortTermWeighted)}원`}
            sub={`원액 ${comma(totals.shortTerm)}원`}
            tone="amber"
          />
          <Metric label="총 매출 합계" value={`${won(totals.total)}원`} sub={`${comma(totals.total)}원`} tone="gold" strong />
          <Metric label="계약 건수" value={`${totals.contractCount}건`} sub={`직원 ${totals.staffCount}명 집계`} tone="emerald" />
        </div>
        <p className="mt-3 flex items-center gap-1.5 text-[11px] text-slate-500">
          <Info className="h-3 w-3" />
          총 매출 = 생명보험 + 손해보험 + 단기납종신×{Math.round(SHORT_TERM_RATE * 100)}% · 관리자 엑셀 실적이 있으면 그 값이 우선 적용됩니다.
        </p>
      </Card>

      {/* 내 실적 — 건별 추가/수정/삭제 */}
      <MyContractSection month={month} myEntries={myEntries} excelOverride={myExcel} onChanged={load} />

      {/* 직원별 실적 (전 직원 공개) */}
      {(
        <Card title={`직원별 실적 · ${month}`} icon={<Trophy className="h-4 w-4 text-amber-500" />}>
          {ranking.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-700 py-6 text-center text-[12px] text-slate-500">
              아직 입력된 실적이 없습니다.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-800 text-left text-[11px] text-slate-500">
                    <th className="py-2 pr-3 font-medium">#</th>
                    <th className="py-2 pr-3 font-medium">이름</th>
                    <th className="py-2 pr-3 text-right font-medium">생명보험</th>
                    <th className="py-2 pr-3 text-right font-medium">손해보험</th>
                    <th className="py-2 pr-3 text-right font-medium">단기납종신(60%)</th>
                    <th className="py-2 pr-3 text-right font-medium">총 매출</th>
                    <th className="py-2 pr-3 text-right font-medium">계약</th>
                    <th className="py-2 pr-0 text-right font-medium">출처</th>
                  </tr>
                </thead>
                <tbody>
                  {ranking.map((e, i) => (
                    <tr key={e.id} className="border-b border-slate-800/60">
                      <td className={['py-2 pr-3 text-xs font-semibold', i < 3 ? 'text-amber-600' : 'text-slate-500'].join(' ')}>{i + 1}</td>
                      <td className="py-2 pr-3 font-medium text-slate-200">{e.staffName || '(이름 없음)'}</td>
                      <td className="py-2 pr-3 text-right tabular-nums text-slate-300">{comma(e.life)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums text-slate-300">{comma(e.nonLife)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums text-slate-300">
                        {comma(Math.round(e.shortTerm * SHORT_TERM_RATE))}
                        <span className="ml-1 text-[10px] text-slate-500">/{comma(e.shortTerm)}</span>
                      </td>
                      <td className="py-2 pr-3 text-right font-semibold tabular-nums" style={{ color: GOLD }}>
                        {comma(weightedTotal(e))}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums text-slate-300">{e.contractCount}</td>
                      <td className="py-2 pr-0 text-right">
                        <SourceBadge source={e.source} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {/* 관리자: 엑셀 업로드 */}
      {isAdmin ? <AdminExcelUpload month={month} onApplied={load} /> : null}
    </div>
  )
}

// --- 내 실적: 건별 입력/목록 ---------------------------------------------------

function MyContractSection({
  month,
  myEntries,
  excelOverride,
  onChanged
}: {
  month: string
  myEntries: ContractEntry[]
  excelOverride?: PerformanceEntry
  onChanged: () => void
}): JSX.Element {
  const defaultDate = monthOfDate(todayDate()) === month ? todayDate() : `${month}-01`
  const [date, setDate] = useState(defaultDate)
  const [category, setCategory] = useState<PerformanceCategory>('life')
  const [amount, setAmount] = useState('')
  const [memo, setMemo] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | undefined>()

  // 수정 모드 (한 번에 한 건)
  const [editId, setEditId] = useState<string | null>(null)
  const [editDate, setEditDate] = useState('')
  const [editCategory, setEditCategory] = useState<PerformanceCategory>('life')
  const [editAmount, setEditAmount] = useState('')
  const [editMemo, setEditMemo] = useState('')

  useEffect(() => {
    setDate(monthOfDate(todayDate()) === month ? todayDate() : `${month}-01`)
    setMsg(undefined)
    setEditId(null)
  }, [month])

  const mySummary = useMemo(() => {
    const s = { life: 0, nonLife: 0, shortTerm: 0 }
    for (const e of myEntries) {
      if (e.category === 'life') s.life += e.amount
      else if (e.category === 'non-life') s.nonLife += e.amount
      else s.shortTerm += e.amount
    }
    return { ...s, total: weightedTotal(s), count: myEntries.length }
  }, [myEntries])

  const add = async (): Promise<void> => {
    const amt = parseAmountInput(amount)
    if (amt <= 0) {
      setMsg({ ok: false, text: '금액을 입력해주세요.' })
      return
    }
    setBusy(true)
    setMsg(undefined)
    const r = await addEntry({ entryDate: date, category, amount: amt, memo })
    setBusy(false)
    if (r.ok) {
      setAmount('')
      setMemo('')
      setMsg({ ok: true, text: '계약 1건이 추가되었습니다.' })
      onChanged()
    } else {
      setMsg({ ok: false, text: r.message })
    }
  }

  const startEdit = (e: ContractEntry): void => {
    setEditId(e.id)
    setEditDate(e.entryDate)
    setEditCategory(e.category)
    setEditAmount(comma(e.amount))
    setEditMemo(e.memo ?? '')
    setMsg(undefined)
  }

  const saveEdit = async (): Promise<void> => {
    if (!editId) return
    const amt = parseAmountInput(editAmount)
    if (amt <= 0) {
      setMsg({ ok: false, text: '금액을 입력해주세요.' })
      return
    }
    setBusy(true)
    const r = await updateEntry(editId, { entryDate: editDate, category: editCategory, amount: amt, memo: editMemo })
    setBusy(false)
    if (r.ok) {
      setEditId(null)
      setMsg({ ok: true, text: '수정되었습니다.' })
      onChanged()
    } else {
      setMsg({ ok: false, text: r.message })
    }
  }

  const remove = async (e: ContractEntry): Promise<void> => {
    if (typeof window !== 'undefined' && !window.confirm(`${e.entryDate} · ${CATEGORY_LABEL[e.category]} ${comma(e.amount)}원 건을 삭제할까요?`)) return
    setBusy(true)
    const r = await deleteEntry(e.id)
    setBusy(false)
    if (r.ok) {
      setMsg({ ok: true, text: '삭제되었습니다.' })
      onChanged()
    } else {
      setMsg({ ok: false, text: r.message })
    }
  }

  return (
    <Card title={`내 실적 입력 · ${month}`} icon={<Wallet className="h-4 w-4 text-emerald-600" />}>
      {excelOverride ? (
        <div className="mb-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] leading-5 text-amber-800">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            이 달은 <b>관리자 엑셀 실적이 우선 적용</b>되고 있습니다 (총 {comma(weightedTotal(excelOverride))}원). 아래 건별 입력은
            보관되며, 엑셀 실적이 삭제되면 다시 집계에 사용됩니다.
          </span>
        </div>
      ) : null}

      {/* 빠른 추가: 계약 들어올 때마다 한 건씩 */}
      <div className="grid grid-cols-1 gap-2 rounded-2xl border border-slate-800 bg-slate-950 p-3 sm:grid-cols-[150px_150px_1fr_1fr_auto]">
        <label className="block">
          <span className="mb-1 block text-[10px] font-medium text-slate-500">계약일</span>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full rounded-lg border border-slate-800 bg-white px-2 py-2 text-xs font-medium text-slate-200 focus:outline-none"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-[10px] font-medium text-slate-500">분류</span>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as PerformanceCategory)}
            className="w-full rounded-lg border border-slate-800 bg-white px-2 py-2 text-xs font-medium text-slate-200 focus:outline-none"
          >
            {CATEGORY_OPTIONS.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABEL[c]}
                {c === 'short-term' ? ` (${Math.round(SHORT_TERM_RATE * 100)}% 반영)` : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-[10px] font-medium text-slate-500">금액 (원)</span>
          <input
            value={amount}
            onChange={(e) => {
              const raw = e.target.value.replace(/[^0-9]/g, '')
              setAmount(raw ? comma(Number(raw)) : '')
            }}
            inputMode="numeric"
            placeholder="예: 30,000"
            className="w-full rounded-lg border border-slate-800 bg-white px-2 py-2 text-right text-xs font-semibold tabular-nums text-slate-100 focus:outline-none"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-[10px] font-medium text-slate-500">메모 (선택)</span>
          <input
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            placeholder="고객명·상품 등"
            className="w-full rounded-lg border border-slate-800 bg-white px-2 py-2 text-xs text-slate-200 focus:outline-none"
          />
        </label>
        <div className="flex items-end">
          <button
            type="button"
            onClick={() => void add()}
            disabled={busy}
            className="inline-flex h-[34px] items-center gap-1.5 rounded-lg bg-gradient-to-r from-emerald-600 to-teal-600 px-3.5 text-xs font-bold text-white shadow-sm transition hover:brightness-110 disabled:opacity-60"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} 추가
          </button>
        </div>
      </div>

      {msg ? (
        <p className={['mt-2 flex items-center gap-1.5 text-[12px]', msg.ok ? 'text-emerald-600' : 'text-rose-600'].join(' ')}>
          {msg.ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
          {msg.text}
        </p>
      ) : null}

      {/* 이번 달 내 계약 목록 */}
      <div className="mt-4">
        <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
          <span className="font-semibold text-slate-300">이번 달 내 계약 {mySummary.count}건</span>
          <span>
            생명 {won(mySummary.life)} · 손해 {won(mySummary.nonLife)} · 단기납 {won(mySummary.shortTerm)} →{' '}
            <b style={{ color: GOLD }}>합계 {comma(mySummary.total)}원</b>
          </span>
        </div>
        {myEntries.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-700 py-5 text-center text-[12px] text-slate-500">
            아직 입력한 계약이 없습니다. 위에서 계약이 들어올 때마다 한 건씩 추가하세요.
          </div>
        ) : (
          <div className="space-y-1.5">
            {myEntries.map((e) =>
              editId === e.id ? (
                <div key={e.id} className="grid grid-cols-1 gap-2 rounded-xl border border-indigo-300 bg-indigo-50/50 p-2.5 sm:grid-cols-[140px_140px_1fr_1fr_auto]">
                  <input
                    type="date"
                    value={editDate}
                    onChange={(ev) => setEditDate(ev.target.value)}
                    className="rounded-lg border border-slate-800 bg-white px-2 py-1.5 text-xs text-slate-200 focus:outline-none"
                  />
                  <select
                    value={editCategory}
                    onChange={(ev) => setEditCategory(ev.target.value as PerformanceCategory)}
                    className="rounded-lg border border-slate-800 bg-white px-2 py-1.5 text-xs text-slate-200 focus:outline-none"
                  >
                    {CATEGORY_OPTIONS.map((c) => (
                      <option key={c} value={c}>
                        {CATEGORY_LABEL[c]}
                      </option>
                    ))}
                  </select>
                  <input
                    value={editAmount}
                    onChange={(ev) => {
                      const raw = ev.target.value.replace(/[^0-9]/g, '')
                      setEditAmount(raw ? comma(Number(raw)) : '')
                    }}
                    inputMode="numeric"
                    className="rounded-lg border border-slate-800 bg-white px-2 py-1.5 text-right text-xs font-semibold tabular-nums text-slate-100 focus:outline-none"
                  />
                  <input
                    value={editMemo}
                    onChange={(ev) => setEditMemo(ev.target.value)}
                    placeholder="메모"
                    className="rounded-lg border border-slate-800 bg-white px-2 py-1.5 text-xs text-slate-200 focus:outline-none"
                  />
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => void saveEdit()}
                      disabled={busy}
                      className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-2.5 py-1.5 text-[11px] font-bold text-white hover:bg-indigo-500 disabled:opacity-60"
                    >
                      <CheckCircle2 className="h-3 w-3" /> 저장
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditId(null)}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-800 bg-white px-2 py-1.5 text-[11px] font-medium text-slate-400 hover:text-slate-200"
                    >
                      <X className="h-3 w-3" /> 취소
                    </button>
                  </div>
                </div>
              ) : (
                <div key={e.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-800 bg-white px-3 py-2">
                  <span className="text-[11px] tabular-nums text-slate-500">{e.entryDate}</span>
                  <span className={['rounded-full px-2 py-0.5 text-[10px] font-bold', CATEGORY_BADGE[e.category]].join(' ')}>
                    {CATEGORY_LABEL[e.category]}
                  </span>
                  <span className="text-sm font-semibold tabular-nums text-slate-100">{comma(e.amount)}원</span>
                  {e.category === 'short-term' ? (
                    <span className="text-[10px] text-amber-700">→ {comma(Math.round(e.amount * SHORT_TERM_RATE))}원 반영</span>
                  ) : null}
                  {e.memo ? <span className="truncate text-[11px] text-slate-500">· {e.memo}</span> : null}
                  <span className="ml-auto flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => startEdit(e)}
                      aria-label="수정"
                      className="rounded-lg p-1.5 text-slate-400 transition hover:bg-indigo-50 hover:text-indigo-600"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => void remove(e)}
                      aria-label="삭제"
                      className="rounded-lg p-1.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </span>
                </div>
              )
            )}
          </div>
        )}
      </div>
    </Card>
  )
}

// --- 관리자 엑셀 업로드 -------------------------------------------------------

function AdminExcelUpload({ month, onApplied }: { month: string; onApplied: () => void }): JSX.Element {
  const fileRef = useRef<HTMLInputElement>(null)
  const [directory, setDirectory] = useState<StaffDirectoryEntry[] | undefined>()
  const [dirErr, setDirErr] = useState<string | undefined>()
  const [parsing, setParsing] = useState(false)
  const [match, setMatch] = useState<ExcelMatchResult | undefined>()
  const [fileName, setFileName] = useState('')
  const [applying, setApplying] = useState(false)
  const [applied, setApplied] = useState<string | undefined>()
  const [dragOver, setDragOver] = useState(false)

  const ensureDirectory = useCallback(async (): Promise<StaffDirectoryEntry[] | undefined> => {
    if (directory) return directory
    const r = await loadStaffDirectory()
    if (r.ok) {
      setDirectory(r.data)
      setDirErr(undefined)
      return r.data
    }
    setDirErr(r.message)
    return undefined
  }, [directory])

  useEffect(() => {
    void ensureDirectory()
  }, [ensureDirectory])

  const handleFile = async (file: File): Promise<void> => {
    setParsing(true)
    setMatch(undefined)
    setApplied(undefined)
    setFileName(file.name)
    const dir = await ensureDirectory()
    const { rows, error } = await parseExcelFile(file)
    setParsing(false)
    if (error) {
      setMatch({ matched: [], unmatched: [{ rowNumber: 0, name: '', phone: '', reason: error }] })
      return
    }
    if (!dir) return
    setMatch(matchExcelRows(rows, dir, month))
  }

  const onPick = (e: ChangeEvent<HTMLInputElement>): void => {
    const f = e.target.files?.[0]
    if (f) void handleFile(f)
    e.target.value = ''
  }

  const apply = async (): Promise<void> => {
    if (!match || match.matched.length === 0) return
    setApplying(true)
    const r = await adminApplyExcelRows(match.matched)
    setApplying(false)
    if (r.ok) {
      setApplied(`${r.data.applied}명 실적이 반영되었습니다 (엑셀 우선 적용).`)
      setMatch(undefined)
      setFileName('')
      onApplied()
    } else {
      setApplied(undefined)
      setMatch({ matched: match.matched, unmatched: [...match.unmatched, { rowNumber: 0, name: '', phone: '', reason: r.message }] })
    }
  }

  return (
    <Card title="관리자 · 엑셀 실적 업로드" icon={<FileSpreadsheet className="h-4 w-4 text-indigo-600" />}>
      <p className="text-[12px] leading-5 text-slate-500">
        양식(이름·휴대폰·월·생명보험·손해보험·단기납종신·계약건수)에 맞춰 올리면 자동으로 직원과 매칭되어 반영됩니다.
        <b className="text-slate-300"> 엑셀로 반영된 실적은 직원 건별 입력보다 우선</b>합니다. 금액은 원 단위 숫자.
      </p>
      {dirErr ? (
        <div className="mt-2 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-700">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {dirErr}
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => directory && downloadTemplate(directory, month)}
          disabled={!directory}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-800 bg-white px-3 py-2 text-xs font-semibold text-slate-300 transition hover:bg-slate-950 disabled:opacity-50"
        >
          <Download className="h-3.5 w-3.5" /> 양식 다운로드 (직원 {directory?.length ?? 0}명 포함)
        </button>
        <span className="text-[11px] text-slate-500">→ 금액 채워서 아래에 업로드</span>
      </div>

      <div
        role="button"
        tabIndex={0}
        onClick={() => fileRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') fileRef.current?.click()
        }}
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragOver(false)
          const f = e.dataTransfer.files?.[0]
          if (f) void handleFile(f)
        }}
        className={[
          'mt-3 flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-2xl border-2 border-dashed px-6 py-8 text-center transition',
          dragOver ? 'border-indigo-500 bg-indigo-50' : 'border-slate-700 bg-slate-950 hover:border-indigo-400 hover:bg-indigo-50/40'
        ].join(' ')}
      >
        <UploadCloud className={['h-8 w-8', dragOver ? 'text-indigo-600' : 'text-slate-500'].join(' ')} />
        <div className="text-sm font-semibold text-slate-100">
          엑셀 파일을 드래그하거나 <span className="text-indigo-600">클릭해서 선택</span>
        </div>
        <div className="text-[11px] text-slate-500">.xlsx · .xls · .csv {fileName ? `· 선택됨: ${fileName}` : ''}</div>
      </div>
      <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" onChange={onPick} className="hidden" />

      {parsing ? (
        <div className="mt-3 flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" /> 엑셀을 읽는 중…
        </div>
      ) : null}

      {match ? (
        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-[12px]">
            <span className="rounded-full bg-emerald-50 px-2.5 py-1 font-semibold text-emerald-700">매칭 {match.matched.length}명</span>
            {match.unmatched.length > 0 ? (
              <span className="rounded-full bg-rose-50 px-2.5 py-1 font-semibold text-rose-600">미매칭 {match.unmatched.length}건</span>
            ) : null}
          </div>

          {match.matched.length > 0 ? (
            <div className="overflow-x-auto rounded-xl border border-slate-800">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="border-b border-slate-800 bg-slate-950 text-left text-[11px] text-slate-500">
                    <th className="px-2 py-1.5 font-medium">이름</th>
                    <th className="px-2 py-1.5 font-medium">월</th>
                    <th className="px-2 py-1.5 text-right font-medium">생명</th>
                    <th className="px-2 py-1.5 text-right font-medium">손해</th>
                    <th className="px-2 py-1.5 text-right font-medium">단기납</th>
                    <th className="px-2 py-1.5 text-right font-medium">반영 총매출</th>
                    <th className="px-2 py-1.5 text-right font-medium">계약</th>
                  </tr>
                </thead>
                <tbody>
                  {match.matched.map((m) => (
                    <tr key={`${m.staffId}:${m.month}`} className="border-b border-slate-800/60">
                      <td className="px-2 py-1.5 font-medium text-slate-200">
                        {m.name}
                        <span className="ml-1 text-[10px] text-slate-500">({m.matchedBy === 'phone' ? '번호' : '이름'})</span>
                      </td>
                      <td className="px-2 py-1.5 text-slate-400">{m.month}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-slate-300">{comma(m.input.life)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-slate-300">{comma(m.input.nonLife)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-slate-300">{comma(m.input.shortTerm)}</td>
                      <td className="px-2 py-1.5 text-right font-semibold tabular-nums" style={{ color: GOLD }}>{comma(weightedTotal(m.input))}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-slate-300">{m.input.contractCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {match.unmatched.length > 0 ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-3">
              <div className="mb-1 text-[12px] font-semibold text-rose-700">반영되지 않는 행</div>
              <ul className="space-y-0.5 text-[11px] text-rose-600">
                {match.unmatched.map((u, i) => (
                  <li key={i}>
                    {u.rowNumber > 0 ? `${u.rowNumber}행 ` : ''}
                    {u.name || u.phone || ''} — {u.reason}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {match.matched.length > 0 ? (
            <button
              type="button"
              onClick={() => void apply()}
              disabled={applying}
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:brightness-110 disabled:opacity-60"
            >
              {applying ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              {match.matched.length}명 실적 반영하기
            </button>
          ) : null}
        </div>
      ) : null}

      {applied ? (
        <p className="mt-3 flex items-center gap-1.5 text-[12px] font-medium text-emerald-600">
          <CheckCircle2 className="h-4 w-4" /> {applied}
        </p>
      ) : null}
    </Card>
  )
}

// --- 공용 소품 ---------------------------------------------------------------

function SourceBadge({ source }: { source: PerformanceEntry['source'] }): JSX.Element {
  return source === 'excel' ? (
    <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-bold text-indigo-600">엑셀</span>
  ) : (
    <span className="rounded-full bg-slate-950 px-2 py-0.5 text-[10px] font-bold text-slate-400">직접</span>
  )
}

function Metric({
  label,
  value,
  sub,
  tone,
  strong
}: {
  label: string
  value: string
  sub?: string
  tone: 'indigo' | 'sky' | 'amber' | 'emerald' | 'gold'
  strong?: boolean
}): JSX.Element {
  const color =
    tone === 'indigo'
      ? 'text-indigo-600'
      : tone === 'sky'
        ? 'text-sky-600'
        : tone === 'amber'
          ? 'text-amber-600'
          : tone === 'emerald'
            ? 'text-emerald-600'
            : ''
  return (
    <div
      className={[
        'rounded-2xl border p-3.5 shadow-sm',
        strong ? 'border-[#e2ce96] bg-[#faf6ea]' : 'border-slate-800 bg-white'
      ].join(' ')}
    >
      <div className="text-[11px] font-medium text-slate-500">{label}</div>
      <div
        className={['mt-1 truncate text-lg font-bold tabular-nums tracking-tight', color].join(' ')}
        style={tone === 'gold' ? { color: GOLD } : undefined}
      >
        {value}
      </div>
      {sub ? <div className="mt-0.5 truncate text-[10px] text-slate-500">{sub}</div> : null}
    </div>
  )
}
