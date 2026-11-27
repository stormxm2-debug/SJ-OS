import { useEffect, useMemo, useState } from 'react'
import { Download, FileSpreadsheet, Loader2, Pencil, RefreshCw, Search, Trash2 } from 'lucide-react'
import { useNavigation } from '@renderer/navigation/NavigationContext'
import { useRealtimeSync } from '@renderer/services/commercial/useRealtimeSync'
import {
  LEAD_STATUS_LABEL,
  deleteLeads,
  listAllLeadsFull,
  listDbTypes,
  listSalesStaff,
  listVendors,
  updateLead,
  updateLeadsBulk,
  type Lead,
  type LeadDbType,
  type SalesStaff
} from '@renderer/services/commercial/leadService'
import { NO_FC, bucketOf, fcRows, summarize, vendorOf, vendorTabs, type StatusBucket } from '@renderer/services/commercial/leadSheets'
import { downloadLeadList, downloadVendorWorkbook } from '@renderer/services/commercial/leadSheetsExport'

/**
 * DB 업체별 시트 — 여러 회사에서 들어오는 DB를 업체별 탭으로 나눠 보고,
 * FC별 개수·상태 요약을 확인하고, 업체마다 시트가 나뉜 엑셀로 저장한다. (관리자 전용)
 */

const RT_TABLES = ['leads', 'lead_vendors']
const PAGE = 200
const BUCKET_LABEL: Record<StatusBucket, string> = { new: '미콜', working: '진행 중', won: '계약', closed: '종료(거절·무효)' }

function fmt(iso: string | null): string {
  if (!iso) return ''
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return ''
  return new Date(t).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export default function LeadSheetsPage(): JSX.Element {
  const { navigate } = useNavigation()
  const [leads, setLeads] = useState<Lead[]>([])
  const [registered, setRegistered] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [tab, setTab] = useState('__all__')
  const [fcFilter, setFcFilter] = useState('')
  const [bucketFilter, setBucketFilter] = useState<'' | StatusBucket>('')
  const [typeFilter, setTypeFilter] = useState('')
  const [q, setQ] = useState('')
  const [shown, setShown] = useState(PAGE)
  const [batchFilter, setBatchFilter] = useState('')
  const [staff, setStaff] = useState<SalesStaff[]>([])
  const [dbTypes, setDbTypes] = useState<LeadDbType[]>([])
  // 선택·수정·삭제
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkVendor, setBulkVendor] = useState('')
  const [bulkType, setBulkType] = useState('')
  const [bulkFc, setBulkFc] = useState('')
  const [editing, setEditing] = useState<{ id: string; name: string; phone: string; memo: string; vendor: string; dbType: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const load = async (): Promise<void> => {
    const [res, vs, st, ty] = await Promise.all([listAllLeadsFull(), listVendors(), listSalesStaff(), listDbTypes()])
    setLeads(res.leads)
    setRegistered(vs.map((v) => v.name))
    setStaff(st)
    setDbTypes(ty)
    // 없어진 항목은 선택에서 뺀다
    setSelected((prev) => {
      const ids = new Set(res.leads.map((l) => l.id))
      return new Set([...prev].filter((id) => ids.has(id)))
    })
    setError(res.ok ? '' : res.error ?? '불러오지 못했습니다.')
    setLoading(false)
  }
  useEffect(() => {
    void load()
  }, [])
  useRealtimeSync(RT_TABLES, () => {
    void load()
  })

  const tabs = useMemo(() => vendorTabs(leads, registered), [leads, registered])
  const inTab = useMemo(() => (tab === '__all__' ? leads : leads.filter((l) => vendorOf(l) === tab)), [leads, tab])
  const summary = useMemo(() => summarize(inTab), [inTab])
  const fcs = useMemo(() => fcRows(inTab), [inTab])
  const types = useMemo(() => [...new Set(inTab.map((l) => l.dbType ?? '').filter(Boolean))].sort(), [inTab])
  // 올린 시각(분 단위)별 묶음 — 잘못 올린 파일을 한꺼번에 찾아 고치거나 지우는 데 쓴다.
  const batches = useMemo(() => {
    const m = new Map<string, number>()
    for (const l of inTab) m.set(l.createdAt.slice(0, 16), (m.get(l.createdAt.slice(0, 16)) ?? 0) + 1)
    return [...m.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([key, n]) => ({ key, n }))
  }, [inTab])

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return inTab.filter((l) => {
      if (fcFilter === '__none__' ? l.assignedFcId : fcFilter && l.assignedFcId !== fcFilter) return false
      if (bucketFilter && bucketOf(l.status) !== bucketFilter) return false
      if (typeFilter && (l.dbType ?? '') !== typeFilter) return false
      if (batchFilter && l.createdAt.slice(0, 16) !== batchFilter) return false
      if (needle && !`${l.name} ${l.phone ?? ''} ${l.memo ?? ''}`.toLowerCase().includes(needle)) return false
      return true
    })
  }, [inTab, fcFilter, bucketFilter, typeFilter, batchFilter, q])

  // 탭·필터를 바꾸면 보이는 줄 수를 처음으로
  useEffect(() => setShown(PAGE), [tab, fcFilter, bucketFilter, typeFilter, batchFilter, q])

  const tabLabel = tab === '__all__' ? '전체' : tab
  const selectedIds = useMemo(() => filtered.filter((l) => selected.has(l.id)).map((l) => l.id), [filtered, selected])
  const allSelected = filtered.length > 0 && selectedIds.length === filtered.length

  const toggleAll = (): void => setSelected(allSelected ? new Set() : new Set(filtered.map((l) => l.id)))
  const toggleOne = (id: string): void =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const finish = async (text: string): Promise<void> => {
    setMsg(text)
    setBusy(false)
    setSelected(new Set())
    await load()
  }

  const applyBulk = async (kind: 'vendor' | 'type' | 'fc'): Promise<void> => {
    if (selectedIds.length === 0) return
    let patch: Parameters<typeof updateLeadsBulk>[1] = {}
    let label = ''
    if (kind === 'vendor') {
      if (bulkVendor === '') return
      const v = bulkVendor === '__none__' ? '' : bulkVendor
      patch = { vendor: v }
      label = `업체를 ${v || '(업체 없음)'}(으)로`
    } else if (kind === 'type') {
      if (bulkType === '') return
      const t = bulkType === '__none__' ? '' : bulkType
      patch = { dbType: t }
      label = `DB종류를 ${t || '(없음)'}(으)로`
    } else {
      if (bulkFc === '') return
      if (bulkFc === '__none__') {
        patch = { fc: null }
        label = '담당 FC를 미배정으로'
      } else {
        const fc = staff.find((x) => x.id === bulkFc)
        if (!fc) return
        patch = { fc: { id: fc.id, name: fc.name } }
        label = `담당 FC를 ${fc.name}님으로 (24시간 콜 시계가 새로 시작되고 상태가 미콜로 돌아갑니다)`
      }
    }
    if (typeof window !== 'undefined' && !window.confirm(`선택한 ${selectedIds.length}건의 ${label} 바꿀까요?`)) return
    setBusy(true)
    const res = await updateLeadsBulk(selectedIds, patch)
    await finish(res.ok ? `✅ ${res.updated}건을 바꿨습니다.` : res.error ?? '수정에 실패했습니다.')
  }

  const removeSelected = async (): Promise<void> => {
    if (selectedIds.length === 0) return
    if (typeof window === 'undefined') return
    if (!window.confirm(`선택한 ${selectedIds.length}건을 삭제할까요?\n삭제하면 되돌릴 수 없습니다.`)) return
    // 많이 지울 때는 한 번 더: '삭제'를 직접 입력해야 진행
    if (selectedIds.length >= 10 && window.prompt(`${selectedIds.length}건을 지웁니다. 계속하려면 "삭제"라고 입력하세요.`) !== '삭제') return
    setBusy(true)
    const res = await deleteLeads(selectedIds)
    await finish(res.ok ? `🗑 ${res.deleted}건을 삭제했습니다.` : res.error ?? '삭제에 실패했습니다.')
  }

  const saveEdit = async (): Promise<void> => {
    if (!editing) return
    setBusy(true)
    const res = await updateLead(editing.id, editing)
    setBusy(false)
    if (!res.ok) {
      setMsg(res.error ?? '수정에 실패했습니다.')
      return
    }
    setEditing(null)
    setMsg('✅ 수정했습니다.')
    await load()
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-extrabold text-slate-100">
            <FileSpreadsheet className="h-5 w-5 text-[#b0821f]" /> DB 업체별 시트
          </h1>
          <p className="mt-0.5 text-[12px] text-slate-500">여러 회사에서 들어오는 DB를 업체별로 나눠 보고, FC별 개수를 확인합니다.</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <button type="button" onClick={() => void load()} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-800 bg-white px-2.5 py-1.5 text-[11px] font-medium text-slate-300 hover:bg-slate-950">
            <RefreshCw className="h-3 w-3" /> 새로고침
          </button>
          <button type="button" onClick={() => navigate({ name: 'leads' })} className="rounded-lg border border-slate-800 bg-white px-2.5 py-1.5 text-[11px] font-medium text-slate-300 hover:bg-slate-950">
            DB 배정으로
          </button>
          <button
            type="button"
            onClick={() => downloadVendorWorkbook(leads, registered)}
            disabled={leads.length === 0}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#0e1e3a] px-3 py-1.5 text-[11px] font-bold text-[#e6c877] hover:brightness-125 disabled:opacity-50"
          >
            <Download className="h-3 w-3" /> 업체별 시트 엑셀
          </button>
        </div>
      </div>

      {error ? <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-700">{error}</div> : null}

      {loading ? (
        <div className="flex items-center gap-2 py-8 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" /> 불러오는 중…
        </div>
      ) : (
        <>
          {/* 업체 탭 */}
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {[{ name: '__all__', count: leads.length }, ...tabs].map((t) => (
              <button
                key={t.name}
                type="button"
                onClick={() => {
                  setTab(t.name)
                  setFcFilter('')
                  setTypeFilter('')
                }}
                className={[
                  'shrink-0 whitespace-nowrap rounded-full px-3 py-1.5 text-[12px] font-semibold transition',
                  tab === t.name ? 'bg-[#0e1e3a] text-[#e6c877]' : 'border border-slate-700 bg-white text-slate-400 hover:text-slate-200'
                ].join(' ')}
              >
                {t.name === '__all__' ? '전체' : t.name} <span className="opacity-70">{t.count}</span>
              </button>
            ))}
          </div>
          {registered.length === 0 && leads.length > 0 ? (
            <p className="text-[11px] text-slate-500">등록된 업체가 없습니다. DB 배정 화면의 "DB 업체(회사) 관리"에서 업체를 추가하면 탭이 생깁니다.</p>
          ) : null}

          {/* 요약 */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
            {[
              ['전체', summary.total],
              ['배정', summary.assigned],
              ['미배정', summary.unassigned],
              ['미콜', summary.uncalled],
              ['24시간 초과', summary.overdue],
              ['진행 중', summary.working],
              ['계약', summary.won],
              ['종료', summary.closed]
            ].map(([label, n]) => (
              <div key={String(label)} className="rounded-xl border border-slate-800 bg-white px-3 py-2">
                <div className="text-[11px] text-slate-500">{label}</div>
                <div className="text-lg font-extrabold tabular-nums text-slate-100">{n}</div>
              </div>
            ))}
          </div>

          {/* FC별 개수 */}
          <div className="rounded-2xl border border-slate-800 bg-white p-3">
            <div className="mb-2 text-[13px] font-bold text-slate-100">FC별 개수 — {tabLabel}</div>
            {fcs.length === 0 ? (
              <p className="text-[12px] text-slate-500">표시할 DB가 없습니다.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[480px] text-left text-[12px]">
                  <thead>
                    <tr className="text-[11px] text-slate-500">
                      <th className="px-2 py-1.5">FC</th>
                      <th className="px-2 py-1.5 text-right">전체</th>
                      <th className="px-2 py-1.5 text-right">미콜</th>
                      <th className="px-2 py-1.5 text-right">진행 중</th>
                      <th className="px-2 py-1.5 text-right">계약</th>
                      <th className="px-2 py-1.5 text-right">종료</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fcs.map((r) => (
                      <tr key={r.fcId || 'none'} className="border-t border-slate-800/60">
                        <td className="px-2 py-1.5 font-semibold text-slate-100">
                          <button type="button" className="hover:underline" onClick={() => setFcFilter(r.fcId || '__none__')}>
                            {r.name}
                          </button>
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-slate-100">{r.total}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-slate-300">{r.uncalled}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-slate-300">{r.working}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-emerald-600">{r.won}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-slate-500">{r.closed}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* 시트 */}
          <div className="rounded-2xl border border-slate-800 bg-white p-3">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="text-[13px] font-bold text-slate-100">
                시트 — {tabLabel} <span className="font-normal text-slate-500">{filtered.length}건</span>
              </span>
              <div className="ml-auto flex flex-wrap items-center gap-1.5">
                <label className="relative">
                  <Search className="pointer-events-none absolute left-2 top-1.5 h-3.5 w-3.5 text-slate-500" />
                  <input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="이름·전화·메모 검색"
                    className="w-44 rounded-lg border border-slate-800 bg-slate-950 py-1 pl-7 pr-2 text-[12px] text-slate-100 outline-none placeholder:text-slate-500 focus:border-[#c6982f]"
                  />
                </label>
                <select value={fcFilter} onChange={(e) => setFcFilter(e.target.value)} className="rounded-lg border border-slate-800 bg-slate-950 px-2 py-1 text-[12px] text-slate-100 outline-none">
                  <option value="">FC 전체</option>
                  {fcs.map((r) => (
                    <option key={r.fcId || 'none'} value={r.fcId || '__none__'}>
                      {r.name}
                    </option>
                  ))}
                </select>
                <select value={bucketFilter} onChange={(e) => setBucketFilter(e.target.value as '' | StatusBucket)} className="rounded-lg border border-slate-800 bg-slate-950 px-2 py-1 text-[12px] text-slate-100 outline-none">
                  <option value="">상태 전체</option>
                  {(Object.keys(BUCKET_LABEL) as StatusBucket[]).map((b) => (
                    <option key={b} value={b}>
                      {BUCKET_LABEL[b]}
                    </option>
                  ))}
                </select>
                {types.length > 0 ? (
                  <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="rounded-lg border border-slate-800 bg-slate-950 px-2 py-1 text-[12px] text-slate-100 outline-none">
                    <option value="">DB종류 전체</option>
                    {types.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                ) : null}
                <select value={batchFilter} onChange={(e) => setBatchFilter(e.target.value)} className="rounded-lg border border-slate-800 bg-slate-950 px-2 py-1 text-[12px] text-slate-100 outline-none" title="같은 시각에 올린 DB만 보기">
                  <option value="">올린 시각 전체</option>
                  {batches.map((b) => (
                    <option key={b.key} value={b.key}>
                      {fmt(`${b.key}:00Z`)} · {b.n}건
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => downloadLeadList(filtered, tabLabel)}
                  disabled={filtered.length === 0}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1 text-[11px] font-semibold text-slate-200 hover:bg-slate-700 disabled:opacity-50"
                >
                  <Download className="h-3 w-3" /> 현재 목록 엑셀
                </button>
              </div>
            </div>

            {msg ? <p className="mb-2 text-[12px] text-slate-300">{msg}</p> : null}

            {/* 선택한 DB 한꺼번에 고치기·지우기 */}
            {selectedIds.length > 0 ? (
              <div className="mb-2 flex flex-wrap items-center gap-1.5 rounded-xl border border-[#c6982f]/40 bg-slate-950/60 px-3 py-2">
                <span className="text-[12px] font-bold text-[#e6c877]">선택 {selectedIds.length}건</span>
                <select value={bulkVendor} onChange={(e) => setBulkVendor(e.target.value)} className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-[12px] text-slate-100 outline-none">
                  <option value="">업체 바꾸기…</option>
                  <option value="__none__">(업체 없음)</option>
                  {registered.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
                <button type="button" disabled={busy || bulkVendor === ''} onClick={() => void applyBulk('vendor')} className="rounded-lg border border-slate-700 bg-slate-800 px-2 py-1 text-[11px] font-semibold text-slate-200 hover:bg-slate-700 disabled:opacity-40">
                  적용
                </button>
                <select value={bulkType} onChange={(e) => setBulkType(e.target.value)} className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-[12px] text-slate-100 outline-none">
                  <option value="">DB종류 바꾸기…</option>
                  <option value="__none__">(종류 없음)</option>
                  {dbTypes.map((t) => (
                    <option key={t.id} value={t.name}>
                      {t.name}
                    </option>
                  ))}
                </select>
                <button type="button" disabled={busy || bulkType === ''} onClick={() => void applyBulk('type')} className="rounded-lg border border-slate-700 bg-slate-800 px-2 py-1 text-[11px] font-semibold text-slate-200 hover:bg-slate-700 disabled:opacity-40">
                  적용
                </button>
                <select value={bulkFc} onChange={(e) => setBulkFc(e.target.value)} className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-[12px] text-slate-100 outline-none">
                  <option value="">담당 FC 바꾸기…</option>
                  <option value="__none__">(미배정으로)</option>
                  {staff.map((st) => (
                    <option key={st.id} value={st.id}>
                      {st.name}
                    </option>
                  ))}
                </select>
                <button type="button" disabled={busy || bulkFc === ''} onClick={() => void applyBulk('fc')} className="rounded-lg border border-slate-700 bg-slate-800 px-2 py-1 text-[11px] font-semibold text-slate-200 hover:bg-slate-700 disabled:opacity-40">
                  적용
                </button>
                <button type="button" disabled={busy} onClick={() => void removeSelected()} className="ml-auto inline-flex items-center gap-1 rounded-lg border border-rose-300/50 px-2.5 py-1 text-[11px] font-bold text-rose-400 hover:bg-rose-500/10 disabled:opacity-40">
                  <Trash2 className="h-3 w-3" /> 삭제
                </button>
                <button type="button" onClick={() => setSelected(new Set())} className="text-[11px] text-slate-500 hover:text-slate-300">
                  선택 해제
                </button>
              </div>
            ) : null}

            {/* 한 건 수정 */}
            {editing ? (
              <div className="mb-2 rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                <div className="mb-2 text-[12px] font-bold text-slate-200">DB 수정</div>
                <div className="grid gap-1.5 sm:grid-cols-2">
                  <input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="이름" className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-[12px] text-slate-100 outline-none focus:border-[#c6982f]" />
                  <input value={editing.phone} onChange={(e) => setEditing({ ...editing, phone: e.target.value })} placeholder="전화" className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-[12px] text-slate-100 outline-none focus:border-[#c6982f]" />
                  <select value={editing.vendor} onChange={(e) => setEditing({ ...editing, vendor: e.target.value })} className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-[12px] text-slate-100 outline-none">
                    <option value="">(업체 없음)</option>
                    {[...new Set([...registered, editing.vendor].filter(Boolean))].map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </select>
                  <select value={editing.dbType} onChange={(e) => setEditing({ ...editing, dbType: e.target.value })} className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-[12px] text-slate-100 outline-none">
                    <option value="">(종류 없음)</option>
                    {[...new Set([...dbTypes.map((t) => t.name), editing.dbType].filter(Boolean))].map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                  <textarea value={editing.memo} onChange={(e) => setEditing({ ...editing, memo: e.target.value })} rows={2} placeholder="메모" className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-[12px] text-slate-100 outline-none focus:border-[#c6982f] sm:col-span-2" />
                </div>
                <div className="mt-2 flex justify-end gap-1.5">
                  <button type="button" onClick={() => setEditing(null)} className="rounded-lg border border-slate-700 px-3 py-1 text-[11px] text-slate-300 hover:bg-slate-800">
                    취소
                  </button>
                  <button type="button" disabled={busy} onClick={() => void saveEdit()} className="rounded-lg bg-[#0e1e3a] px-3 py-1 text-[11px] font-bold text-[#e6c877] hover:brightness-125 disabled:opacity-50">
                    저장
                  </button>
                </div>
              </div>
            ) : null}

            <div className="max-h-[60vh] overflow-auto rounded-lg border border-slate-800">
              <table className="w-full min-w-[860px] text-left text-[12px]">
                <thead className="sticky top-0 bg-slate-900">
                  <tr className="text-[11px] text-slate-500">
                    <th className="w-8 px-2 py-1.5">
                      <input type="checkbox" checked={allSelected} onChange={toggleAll} className="h-3.5 w-3.5 accent-[#c6982f]" aria-label="필터 결과 전체 선택" />
                    </th>
                    <th className="px-2 py-1.5">이름</th>
                    <th className="px-2 py-1.5">전화</th>
                    <th className="px-2 py-1.5">업체</th>
                    <th className="px-2 py-1.5">DB종류</th>
                    <th className="px-2 py-1.5">담당 FC</th>
                    <th className="px-2 py-1.5">상태</th>
                    <th className="px-2 py-1.5">배정</th>
                    <th className="px-2 py-1.5">메모</th>
                    <th className="px-2 py-1.5"></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.slice(0, shown).map((l) => (
                    <tr key={l.id} className="border-t border-slate-800/60">
                      <td className="px-2 py-1.5">
                        <input type="checkbox" checked={selected.has(l.id)} onChange={() => toggleOne(l.id)} className="h-3.5 w-3.5 accent-[#c6982f]" aria-label={`${l.name} 선택`} />
                      </td>
                      <td className="px-2 py-1.5 font-semibold text-slate-100">{l.name}</td>
                      <td className="px-2 py-1.5 text-slate-300">{l.phone ?? ''}</td>
                      <td className="px-2 py-1.5 text-slate-400">{vendorOf(l)}</td>
                      <td className="px-2 py-1.5 text-slate-400">{l.dbType ?? ''}</td>
                      <td className="px-2 py-1.5 text-slate-300">{l.assignedFcName ?? NO_FC}</td>
                      <td className="px-2 py-1.5 text-slate-300">{LEAD_STATUS_LABEL[l.status] ?? l.status}</td>
                      <td className="px-2 py-1.5 text-slate-500">{fmt(l.assignedAt)}</td>
                      <td className="max-w-[260px] truncate px-2 py-1.5 text-slate-500">{l.memo ?? ''}</td>
                      <td className="px-2 py-1.5">
                        <button
                          type="button"
                          onClick={() => setEditing({ id: l.id, name: l.name, phone: l.phone ?? '', memo: l.memo ?? '', vendor: l.vendor ?? '', dbType: l.dbType ?? '' })}
                          className="inline-flex items-center gap-1 rounded-md border border-slate-700 px-1.5 py-0.5 text-[11px] text-slate-300 hover:bg-slate-800"
                        >
                          <Pencil className="h-3 w-3" /> 수정
                        </button>
                      </td>
                    </tr>
                  ))}
                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="px-2 py-8 text-center text-slate-500">
                        조건에 맞는 DB가 없습니다.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            {filtered.length > shown ? (
              <button type="button" onClick={() => setShown((n) => n + PAGE)} className="mt-2 w-full rounded-lg border border-slate-800 py-1.5 text-[12px] text-slate-300 hover:bg-slate-950">
                더 보기 ({filtered.length - shown}건 남음)
              </button>
            ) : null}
            <p className="mt-2 text-[11px] text-slate-500">엑셀 파일에는 고객 이름·전화가 들어 있습니다. 외부에 공유하지 마세요.</p>
          </div>
        </>
      )}
    </div>
  )
}
