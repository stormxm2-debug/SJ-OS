import { useEffect, useMemo, useState } from 'react'
import { Download, FileSpreadsheet, Loader2, RefreshCw, Search } from 'lucide-react'
import { useNavigation } from '@renderer/navigation/NavigationContext'
import { useRealtimeSync } from '@renderer/services/commercial/useRealtimeSync'
import { LEAD_STATUS_LABEL, listAllLeadsFull, listVendors, type Lead } from '@renderer/services/commercial/leadService'
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

  const load = async (): Promise<void> => {
    const [res, vs] = await Promise.all([listAllLeadsFull(), listVendors()])
    setLeads(res.leads)
    setRegistered(vs.map((v) => v.name))
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

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return inTab.filter((l) => {
      if (fcFilter === '__none__' ? l.assignedFcId : fcFilter && l.assignedFcId !== fcFilter) return false
      if (bucketFilter && bucketOf(l.status) !== bucketFilter) return false
      if (typeFilter && (l.dbType ?? '') !== typeFilter) return false
      if (needle && !`${l.name} ${l.phone ?? ''} ${l.memo ?? ''}`.toLowerCase().includes(needle)) return false
      return true
    })
  }, [inTab, fcFilter, bucketFilter, typeFilter, q])

  // 탭·필터를 바꾸면 보이는 줄 수를 처음으로
  useEffect(() => setShown(PAGE), [tab, fcFilter, bucketFilter, typeFilter, q])

  const tabLabel = tab === '__all__' ? '전체' : tab

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

            <div className="max-h-[60vh] overflow-auto rounded-lg border border-slate-800">
              <table className="w-full min-w-[760px] text-left text-[12px]">
                <thead className="sticky top-0 bg-slate-900">
                  <tr className="text-[11px] text-slate-500">
                    <th className="px-2 py-1.5">이름</th>
                    <th className="px-2 py-1.5">전화</th>
                    <th className="px-2 py-1.5">업체</th>
                    <th className="px-2 py-1.5">DB종류</th>
                    <th className="px-2 py-1.5">담당 FC</th>
                    <th className="px-2 py-1.5">상태</th>
                    <th className="px-2 py-1.5">배정</th>
                    <th className="px-2 py-1.5">메모</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.slice(0, shown).map((l) => (
                    <tr key={l.id} className="border-t border-slate-800/60">
                      <td className="px-2 py-1.5 font-semibold text-slate-100">{l.name}</td>
                      <td className="px-2 py-1.5 text-slate-300">{l.phone ?? ''}</td>
                      <td className="px-2 py-1.5 text-slate-400">{vendorOf(l)}</td>
                      <td className="px-2 py-1.5 text-slate-400">{l.dbType ?? ''}</td>
                      <td className="px-2 py-1.5 text-slate-300">{l.assignedFcName ?? NO_FC}</td>
                      <td className="px-2 py-1.5 text-slate-300">{LEAD_STATUS_LABEL[l.status] ?? l.status}</td>
                      <td className="px-2 py-1.5 text-slate-500">{fmt(l.assignedAt)}</td>
                      <td className="max-w-[260px] truncate px-2 py-1.5 text-slate-500">{l.memo ?? ''}</td>
                    </tr>
                  ))}
                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-2 py-8 text-center text-slate-500">
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
