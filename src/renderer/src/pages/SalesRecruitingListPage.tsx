import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Trash2,
  Download,
  CheckCircle2,
  Archive,
  ListChecks
} from 'lucide-react'
import {
  FIELDS,
  SALES_RT_TABLES,
  isSupabaseMode,
  currentMonth,
  shiftMonth,
  ensureMonth,
  listRows,
  addRow,
  updateField,
  setDone,
  deleteRow,
  exportExcel,
  type ListKind,
  type ListRow
} from '@renderer/services/commercial/salesListService'
import { useRealtimeSync } from '@renderer/services/commercial/useRealtimeSync'

type Tab = 'list' | 'archive'

/**
 * 영업·리쿠르팅 리스트 (전산) — FC 본인이 앱에서 직접 입력·수정하고 엑셀로 내려받는 화면.
 * · 완료 체크 → 현재 리스트에서 빠지고 '완료 보관함'으로 이동(다음 달 이월 안 됨).
 * · 체크 안 한 줄 → 다음 달로 자동 이월(고객·리쿠르팅 둘 다, 서버 ensure_sales_month).
 */
export default function SalesRecruitingListPage(): JSX.Element {
  const supa = isSupabaseMode()
  const [month, setMonth] = useState<string>(() => currentMonth())
  const [tab, setTab] = useState<Tab>('list')
  const [customers, setCustomers] = useState<ListRow[]>([])
  const [recruits, setRecruits] = useState<ListRow[]>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const editingRef = useRef(false) // 입력 중 realtime 리로드로 글자 날아가는 것 방지

  const load = useCallback(async () => {
    if (!supa) return
    if (editingRef.current) return
    setLoading(true)
    setErr(null)
    try {
      const doneFlag = tab === 'archive'
      const [c, r] = await Promise.all([
        listRows('customer', { month, done: doneFlag }),
        listRows('recruit', { month, done: doneFlag })
      ])
      setCustomers(c)
      setRecruits(r)
    } catch (e) {
      setErr(e instanceof Error ? e.message : '불러오지 못했습니다.')
    } finally {
      setLoading(false)
    }
  }, [supa, month, tab])

  // 월이 바뀌면(리스트 탭) 지난달 미완료 자동 이월 후 로드.
  useEffect(() => {
    let alive = true
    void (async () => {
      if (!supa) return
      if (tab === 'list') {
        try {
          await ensureMonth(month)
        } catch {
          /* 이월 실패해도 로드는 시도 */
        }
      }
      if (alive) await load()
    })()
    return () => {
      alive = false
    }
  }, [supa, month, tab, load])

  useRealtimeSync(SALES_RT_TABLES, load)

  const rowsOf = (k: ListKind): ListRow[] => (k === 'customer' ? customers : recruits)
  const setRowsOf = (k: ListKind, v: ListRow[]): void =>
    k === 'customer' ? setCustomers(v) : setRecruits(v)

  const onAdd = async (k: ListKind): Promise<void> => {
    try {
      const next = rowsOf(k).length
      const created = await addRow(k, month, next)
      setRowsOf(k, [...rowsOf(k), created])
    } catch (e) {
      setErr(e instanceof Error ? e.message : '추가하지 못했습니다.')
    }
  }

  const onEdit = (k: ListKind, id: string, key: string, value: string): void => {
    setRowsOf(
      k,
      rowsOf(k).map((r) => (r.id === id ? { ...r, values: { ...r.values, [key]: value } } : r))
    )
  }

  const onCommit = async (k: ListKind, id: string, key: string, value: string): Promise<void> => {
    editingRef.current = false
    try {
      await updateField(k, id, key, value)
    } catch (e) {
      setErr(e instanceof Error ? e.message : '저장하지 못했습니다.')
    }
  }

  const onToggleDone = async (k: ListKind, id: string, done: boolean): Promise<void> => {
    // 즉시 목록에서 제거(완료→보관함 이동 / 보관함에서 복원 시 리스트로)
    setRowsOf(k, rowsOf(k).filter((r) => r.id !== id))
    try {
      await setDone(k, id, done)
    } catch (e) {
      setErr(e instanceof Error ? e.message : '처리하지 못했습니다.')
      await load()
    }
  }

  const onDelete = async (k: ListKind, id: string): Promise<void> => {
    if (!window.confirm('이 줄을 삭제할까요?')) return
    setRowsOf(k, rowsOf(k).filter((r) => r.id !== id))
    try {
      await deleteRow(k, id)
    } catch (e) {
      setErr(e instanceof Error ? e.message : '삭제하지 못했습니다.')
      await load()
    }
  }

  const onExport = async (): Promise<void> => {
    try {
      await exportExcel(month, customers, recruits, { archive: tab === 'archive' })
    } catch (e) {
      setErr(e instanceof Error ? e.message : '엑셀 생성 실패')
    }
  }

  const archive = tab === 'archive'

  return (
    <div className="space-y-4">
      {/* 헤더 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-slate-100">
            <ListChecks className="h-5 w-5 text-[#e6c877]" /> 영업 · 리쿠르팅 리스트
          </h1>
          <p className="mt-0.5 text-xs text-slate-400">
            앱에서 바로 입력 · 완료 체크하면 보관함으로, 미완료는 다음 달로 자동 이월
          </p>
        </div>
        <button
          type="button"
          onClick={onExport}
          className="flex items-center gap-2 rounded-xl bg-[#0e1e3a] px-3 py-2 text-sm font-semibold text-white transition hover:brightness-125"
        >
          <Download className="h-4 w-4" /> 엑셀 다운로드
        </button>
      </div>

      {/* 월 이동 + 탭 */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-white p-2">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setMonth(shiftMonth(month, -1))}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-300 text-slate-500 hover:bg-slate-100"
            aria-label="이전 달"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <div className="min-w-[96px] text-center text-sm font-bold text-slate-700">{month}</div>
          <button
            type="button"
            onClick={() => setMonth(shiftMonth(month, 1))}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-300 text-slate-500 hover:bg-slate-100"
            aria-label="다음 달"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setMonth(currentMonth())}
            className="ml-1 rounded-lg border border-slate-300 px-2 py-1.5 text-xs font-semibold text-slate-500 hover:bg-slate-100"
          >
            이번 달
          </button>
        </div>
        <div className="flex items-center gap-1 rounded-xl border border-slate-200 bg-slate-100 p-1">
          {([
            ['list', '리스트', ListChecks],
            ['archive', '완료 보관함', Archive]
          ] as [Tab, string, typeof ListChecks][]).map(([t, label, Icon]) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={[
                'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition',
                tab === t ? 'bg-[#0e1e3a] text-white shadow-sm' : 'text-slate-500 hover:text-slate-700'
              ].join(' ')}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>
      </div>

      {!supa ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          전산(서버) 연동 환경에서만 동작합니다. 웹앱(sj-invest)에서 로그인 후 이용하세요.
        </div>
      ) : null}
      {err ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{err}</div>
      ) : null}

      <ListTable
        kind="customer"
        title="① 고객 영업 리스트"
        rows={customers}
        archive={archive}
        loading={loading}
        onAdd={() => onAdd('customer')}
        onEdit={onEdit}
        onCommit={onCommit}
        onFocus={() => (editingRef.current = true)}
        onToggleDone={onToggleDone}
        onDelete={onDelete}
      />
      <ListTable
        kind="recruit"
        title="② 리쿠르팅(CIS) 리스트"
        rows={recruits}
        archive={archive}
        loading={loading}
        onAdd={() => onAdd('recruit')}
        onEdit={onEdit}
        onCommit={onCommit}
        onFocus={() => (editingRef.current = true)}
        onToggleDone={onToggleDone}
        onDelete={onDelete}
      />
    </div>
  )
}

function ListTable({
  kind,
  title,
  rows,
  archive,
  loading,
  onAdd,
  onEdit,
  onCommit,
  onFocus,
  onToggleDone,
  onDelete
}: {
  kind: ListKind
  title: string
  rows: ListRow[]
  archive: boolean
  loading: boolean
  onAdd: () => void
  onEdit: (k: ListKind, id: string, key: string, value: string) => void
  onCommit: (k: ListKind, id: string, key: string, value: string) => void
  onFocus: () => void
  onToggleDone: (k: ListKind, id: string, done: boolean) => void
  onDelete: (k: ListKind, id: string) => void
}): JSX.Element {
  const fields = FIELDS[kind]
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-800 bg-white shadow-sm">
      <div className="flex items-center justify-between bg-[#1f3864] px-4 py-2">
        <div className="text-sm font-bold text-white">{title}</div>
        {!archive ? (
          <button
            type="button"
            onClick={onAdd}
            className="flex items-center gap-1 rounded-lg bg-white/15 px-2.5 py-1 text-xs font-semibold text-white hover:bg-white/25"
          >
            <Plus className="h-3.5 w-3.5" /> 줄 추가
          </button>
        ) : null}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-[#2e4a74] text-white">
              <th className="whitespace-nowrap px-2 py-2 text-xs font-bold">{archive ? '완료' : '완료'}</th>
              {fields.map((f) => (
                <th key={f.key} className="whitespace-nowrap px-2 py-2 text-xs font-bold">
                  {f.label}
                </th>
              ))}
              <th className="px-2 py-2 text-xs font-bold">삭제</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={fields.length + 2} className="px-3 py-6 text-center text-xs text-slate-400">
                  {loading ? '불러오는 중…' : archive ? '완료된 항목이 없습니다.' : '‘줄 추가’로 시작하세요.'}
                </td>
              </tr>
            ) : (
              rows.map((row, idx) => (
                <tr key={row.id} className={idx % 2 === 1 ? 'bg-[#eef3fa]' : 'bg-white'}>
                  <td className="px-2 py-1 text-center">
                    <input
                      type="checkbox"
                      checked={archive}
                      onChange={(e) => onToggleDone(kind, row.id, e.target.checked)}
                      title={archive ? '완료 해제(리스트로 복원)' : '완료 처리(보관함으로 이동)'}
                      className="h-4 w-4 accent-[#0e1e3a]"
                    />
                  </td>
                  {fields.map((f) => (
                    <td key={f.key} className="px-1 py-1">
                      <input
                        value={row.values[f.key] ?? ''}
                        disabled={archive}
                        onFocus={onFocus}
                        onChange={(e) => onEdit(kind, row.id, f.key, e.target.value)}
                        onBlur={(e) => onCommit(kind, row.id, f.key, e.target.value)}
                        className="w-full min-w-[64px] rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 outline-none focus:border-[#2e4a74] disabled:bg-slate-50 disabled:text-slate-500"
                      />
                    </td>
                  ))}
                  <td className="px-2 py-1 text-center">
                    <button
                      type="button"
                      onClick={() => onDelete(kind, row.id)}
                      className="text-slate-400 transition hover:text-rose-500"
                      aria-label="삭제"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {!archive ? (
        <div className="flex items-center gap-1 border-t border-slate-100 px-4 py-2 text-[11px] text-slate-400">
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
          완료 체크 → 보관함으로 이동 · 체크 안 하면 다음 달 리스트로 자동 이월
        </div>
      ) : null}
    </section>
  )
}
