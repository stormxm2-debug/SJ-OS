import { useEffect, useState } from 'react'
import { Table2, Loader2, RefreshCw, ChevronRight } from 'lucide-react'
import {
  loadStaffTable,
  setStaffOverviewPrefill,
  type StaffTableRow
} from '@renderer/services/commercial/staffOverviewService'
import { currentMonth } from '@renderer/services/commercial/performanceRecordsService'
import { ROLE_LABEL } from '@renderer/navigation/roleAccess'
import { useNavigation } from '@renderer/navigation/NavigationContext'

/**
 * 전 직원 정리표 (관리자 전용) — 전 직원의 고객·실적·일정·출퇴근을 한 표로.
 * 행 클릭 → 직원 현황 상세(탭)로 이동. 읽기 전용.
 */
export default function StaffTablePage(): JSX.Element {
  const { navigate } = useNavigation()
  const [rows, setRows] = useState<StaffTableRow[]>([])
  const [loading, setLoading] = useState(true)
  const month = currentMonth()

  const load = async (): Promise<void> => {
    setLoading(true)
    setRows(await loadStaffTable(month))
    setLoading(false)
  }
  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const openDetail = (id: string): void => {
    setStaffOverviewPrefill(id)
    navigate({ name: 'staff-overview' })
  }

  const won = (n: number): string => n.toLocaleString('ko-KR')
  const totals = rows.reduce(
    (t, r) => ({ cust: t.cust + r.customerCount, total: t.total + r.total, up: t.up + r.upcoming, fee: t.fee + r.lateFee }),
    { cust: 0, total: 0, up: 0, fee: 0 }
  )

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between rounded-2xl border border-slate-800 bg-[#0e1e3a] px-4 py-3">
        <div className="flex items-center gap-2">
          <Table2 className="h-4 w-4 text-[#e6c877]" />
          <h1 className="text-sm font-extrabold text-white">전 직원 정리표</h1>
          <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-bold text-slate-200">{month} · {rows.length}명</span>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex items-center gap-1.5 rounded-lg border border-white/20 px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-white/10"
        >
          <RefreshCw className={['h-3.5 w-3.5', loading ? 'animate-spin' : ''].join(' ')} /> 새로고침
        </button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 rounded-2xl border border-slate-800 bg-white p-6 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" /> 전 직원 데이터를 모으는 중…
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-white shadow-sm">
          <table className="w-full min-w-[860px] text-left text-[12px]">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-950 text-[11px] text-slate-500">
                <th className="px-3 py-2.5 font-semibold">직원</th>
                <th className="px-2 py-2.5 text-right font-semibold">고객</th>
                <th className="px-2 py-2.5 text-right font-semibold">생보</th>
                <th className="px-2 py-2.5 text-right font-semibold">손보</th>
                <th className="px-2 py-2.5 text-right font-semibold">단기납</th>
                <th className="px-2 py-2.5 text-right font-semibold">총매출</th>
                <th className="px-2 py-2.5 text-right font-semibold">계약</th>
                <th className="px-2 py-2.5 text-right font-semibold">예정일정</th>
                <th className="px-2 py-2.5 text-right font-semibold">출근</th>
                <th className="px-2 py-2.5 text-right font-semibold">지각</th>
                <th className="px-2 py-2.5 text-right font-semibold">벌금</th>
                <th className="px-2 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/40">
              {rows.map((r, i) => (
                <tr key={r.id} onClick={() => openDetail(r.id)} className="cursor-pointer transition hover:bg-[#c6982f]/5">
                  <td className="px-3 py-2.5">
                    <span className="flex items-center gap-2">
                      <span className={['flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-black', i === 0 && r.total > 0 ? 'bg-[#c6982f] text-[#0e1e3a]' : 'bg-slate-100 text-slate-500'].join(' ')}>
                        {i + 1}
                      </span>
                      <span>
                        <span className="block text-[13px] font-bold text-slate-100">{r.name}</span>
                        <span className="block text-[10px] text-slate-500">{ROLE_LABEL[r.role as keyof typeof ROLE_LABEL] ?? r.role}</span>
                      </span>
                    </span>
                  </td>
                  <td className="px-2 py-2.5 text-right font-semibold text-slate-200">{r.customerCount}</td>
                  <td className="px-2 py-2.5 text-right tabular-nums text-slate-400">{won(r.life)}</td>
                  <td className="px-2 py-2.5 text-right tabular-nums text-slate-400">{won(r.nonLife)}</td>
                  <td className="px-2 py-2.5 text-right tabular-nums text-slate-400">{won(r.shortTerm)}</td>
                  <td className="px-2 py-2.5 text-right">
                    <span className="tabular-nums text-[13px] font-extrabold text-[#b0821f]">{won(r.total)}</span>
                    {r.perfSource === 'excel' ? <span className="ml-1 rounded bg-emerald-50 px-1 text-[9px] font-bold text-emerald-600">엑셀</span> : null}
                  </td>
                  <td className="px-2 py-2.5 text-right text-slate-300">{r.contractCount}</td>
                  <td className="px-2 py-2.5 text-right text-slate-300">{r.upcoming}</td>
                  <td className="px-2 py-2.5 text-right text-slate-300">{r.workDays}일</td>
                  <td className={['px-2 py-2.5 text-right font-semibold', r.lateDays > 0 ? 'text-rose-600' : 'text-slate-400'].join(' ')}>{r.lateDays}</td>
                  <td className={['px-2 py-2.5 text-right tabular-nums', r.lateFee > 0 ? 'font-bold text-rose-600' : 'text-slate-400'].join(' ')}>{won(r.lateFee)}</td>
                  <td className="px-2 py-2.5 text-slate-400">
                    <ChevronRight className="h-3.5 w-3.5" />
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-slate-800 bg-slate-950 text-[12px] font-extrabold">
                <td className="px-3 py-2.5 text-slate-300">합계</td>
                <td className="px-2 py-2.5 text-right text-slate-100">{totals.cust}</td>
                <td colSpan={3} />
                <td className="px-2 py-2.5 text-right tabular-nums text-[#b0821f]">{won(totals.total)}</td>
                <td colSpan={2} />
                <td className="px-2 py-2.5 text-right text-slate-300" colSpan={2}>예정 {totals.up}건</td>
                <td className="px-2 py-2.5 text-right tabular-nums text-rose-600">{won(totals.fee)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      <p className="text-[11px] text-slate-500">행을 클릭하면 해당 직원의 상세(고객·일정·상담·실적·출퇴근 탭)로 이동합니다. 총매출 = 생보+손보+단기납×60%, 엑셀 배지 = 관리자 엑셀 우선 적용.</p>
    </div>
  )
}
