import { useEffect, useMemo, useState } from 'react'
import { ClipboardCheck, Loader2, AlertTriangle, CheckCircle2, XCircle, RefreshCw, ShieldCheck } from 'lucide-react'
import Card from '@renderer/components/ui/Card'
import {
  listRegistrations,
  processRegistration,
  REGISTRATION_STATUS_LABEL,
  type CustomerRegistration
} from '@renderer/services/commercial/registrationService'
import { useRealtimeSync } from '@renderer/services/commercial/useRealtimeSync'

/**
 * 고객등록 관리 (관리자 전용) — 직원들의 보험사 고객등록 요청을 처리한다.
 * [완료] = customers.registered_insurers 병합 + 상태 done → 요청 직원에게 실시간
 * 알림 전송(UPDATE 이벤트). [반려] = 상태만 rejected + 알림.
 */

const RT_TABLES = ['customer_registrations']

export default function RegistrationAdminPage(): JSX.Element {
  const [items, setItems] = useState<CustomerRegistration[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | undefined>()
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = async (): Promise<void> => {
    const res = await listRegistrations()
    setItems(res.items)
    setError(res.ok ? undefined : res.error)
    setLoading(false)
  }
  useEffect(() => {
    void load()
  }, [])
  useRealtimeSync(RT_TABLES, load)

  const pending = useMemo(() => items.filter((i) => i.status === 'requested'), [items])
  const processed = useMemo(() => items.filter((i) => i.status !== 'requested').slice(0, 30), [items])

  const act = async (reg: CustomerRegistration, action: 'done' | 'rejected'): Promise<void> => {
    setBusyId(reg.id)
    const res = await processRegistration(reg, action)
    setBusyId(null)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setError(undefined)
    void load()
  }

  const fmt = (iso: string): string => {
    const t = Date.parse(iso)
    return Number.isNaN(t) ? '' : new Date(t).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  }

  return (
    <div className="space-y-4">
      <Card
        title={`고객등록 관리 · 대기 ${pending.length}건`}
        icon={<ClipboardCheck className="h-4 w-4 text-indigo-600" />}
        action={
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-800 bg-white px-2.5 py-1.5 text-[11px] font-medium text-slate-300 hover:bg-slate-950"
          >
            <RefreshCw className="h-3 w-3" /> 새로고침
          </button>
        }
      >
        <p className="text-[12px] text-slate-500">
          직원이 고객관리에서 보험사를 체크해 요청하면 여기로 모입니다. <b className="text-slate-300">완료</b>하면 고객 카드에
          등록 배지가 붙고 요청한 직원에게 알림이 갑니다.
        </p>
        {error ? (
          <div className="mt-2 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-700">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}
          </div>
        ) : null}

        {loading ? (
          <div className="flex items-center gap-2 py-8 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" /> 불러오는 중…
          </div>
        ) : pending.length === 0 ? (
          <div className="mt-3 rounded-xl border border-dashed border-slate-700 py-8 text-center text-[12px] text-slate-500">
            대기 중인 요청이 없습니다. 👏
          </div>
        ) : (
          <div className="mt-3 space-y-2">
            {pending.map((r) => (
              <div key={r.id} className="rounded-xl border border-amber-200 bg-amber-50/50 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700">대기</span>
                  <span className="text-sm font-bold text-slate-100">{r.customerName || '(고객)'}</span>
                  <span className="text-[12px] text-slate-500">{r.staffName || '(직원)'} 요청 · {fmt(r.requestedAt)}</span>
                  <span className="ml-auto flex gap-1.5">
                    <button
                      type="button"
                      onClick={() => void act(r, 'done')}
                      disabled={busyId === r.id}
                      className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-[11px] font-bold text-white transition hover:bg-emerald-500 disabled:opacity-60"
                    >
                      {busyId === r.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />} 완료
                    </button>
                    <button
                      type="button"
                      onClick={() => void act(r, 'rejected')}
                      disabled={busyId === r.id}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-800 bg-white px-3 py-1.5 text-[11px] font-medium text-slate-400 transition hover:text-rose-600 disabled:opacity-60"
                    >
                      <XCircle className="h-3 w-3" /> 반려
                    </button>
                  </span>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {r.insurers.map((ins) => (
                    <span key={ins} className="rounded-full bg-indigo-50 px-2.5 py-0.5 text-[11px] font-semibold text-indigo-600">
                      {ins}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card title="처리 이력" icon={<ShieldCheck className="h-4 w-4 text-emerald-600" />}>
        {processed.length === 0 ? (
          <p className="text-[12px] text-slate-500">아직 처리 이력이 없습니다.</p>
        ) : (
          <div className="space-y-1.5">
            {processed.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-800 bg-white px-3 py-2 text-[12px]">
                <span
                  className={[
                    'rounded-full px-2 py-0.5 text-[10px] font-bold',
                    r.status === 'done' ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'
                  ].join(' ')}
                >
                  {REGISTRATION_STATUS_LABEL[r.status]}
                </span>
                <span className="font-semibold text-slate-100">{r.customerName}</span>
                <span className="text-slate-500">{r.insurers.join(' · ')}</span>
                <span className="ml-auto text-[11px] text-slate-500">
                  {r.staffName} · {r.processedAt ? fmt(r.processedAt) : ''}
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}
