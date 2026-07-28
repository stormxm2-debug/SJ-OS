import { useEffect, useState } from 'react'
import { Plus, Trash2, Loader2, AlertTriangle, Printer, Search, X } from 'lucide-react'
import {
  listInsurerFax,
  upsertInsurerFax,
  deleteInsurerFax,
  type InsurerFax
} from '@renderer/services/insurance-claim/claimFaxService'
import { useSession } from '@renderer/navigation/SessionContext'
import { isAdminRole } from '@renderer/navigation/roleAccess'
import { INSURERS } from '@renderer/services/commercial/registrationService'

/**
 * 보험사 청구접수 팩스번호 관리 — 독립 카드.
 *
 * 원래 청구비서 분석 결과 화면 안에만 있어서, 번호 하나 등록하려면 매번 서류를 올려
 * AI 분석을 돌려야 했다(대표 지적, 2026-07-28). 매니저 연락처 화면의 '청구 팩스' 탭에서
 * 바로 열 수 있도록 분리했고, 청구비서 패널도 이 컴포넌트를 그대로 재사용한다.
 *
 * 조회는 전 직원(발송 전 번호 확인용), 등록·삭제는 관리자만 — RLS와 같은 기준.
 */
export default function InsurerFaxManagerCard({
  /** 청구비서 패널 안에서는 목록 갱신을 부모와 공유한다. */
  list: listProp,
  onChanged,
  /** 페이지 단독 사용 시 제목/설명을 보여준다. */
  standalone = false
}: {
  list?: InsurerFax[]
  onChanged?: () => void
  standalone?: boolean
}): JSX.Element {
  const { session } = useSession()
  const admin = isAdminRole(session.role)

  const [own, setOwn] = useState<InsurerFax[]>([])
  const [loading, setLoading] = useState(standalone)
  const [configured, setConfigured] = useState(true)
  const [q, setQ] = useState('')

  const [insurer, setInsurer] = useState<string>(INSURERS[0])
  const [fax, setFax] = useState('')
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const controlled = Array.isArray(listProp)
  const list = controlled ? (listProp as InsurerFax[]) : own

  const reload = async (): Promise<void> => {
    if (controlled) {
      onChanged?.()
      return
    }
    setLoading(true)
    const r = await listInsurerFax()
    setLoading(false)
    setConfigured(r.configured !== false)
    setOwn(r.items ?? [])
  }

  useEffect(() => {
    if (!controlled) void reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controlled])

  const add = async (): Promise<void> => {
    setBusy(true)
    setMsg('')
    const r = await upsertInsurerFax({ insurer, fax, label })
    setBusy(false)
    if (!r.ok) {
      setMsg(r.error ?? '저장 실패')
      return
    }
    setFax('')
    setLabel('')
    void reload()
  }

  const remove = async (id: string, name: string): Promise<void> => {
    if (!window.confirm(`${name} 청구 팩스번호를 삭제할까요?`)) return
    const r = await deleteInsurerFax(id)
    if (r.ok) void reload()
    else setMsg(r.error ?? '삭제 실패')
  }

  const t = q.trim().toLowerCase()
  const shown = t
    ? list.filter((f) => [f.insurer, f.fax, f.label ?? ''].some((v) => v.toLowerCase().includes(t)))
    : list
  const missing = INSURERS.filter((c) => !list.some((f) => f.insurer === c))

  return (
    <div className={standalone ? 'space-y-3' : 'mt-4 border-t border-slate-800 pt-3'}>
      {standalone ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Printer className="h-5 w-5 text-indigo-500" />
            <h2 className="text-base font-bold text-slate-100">보험사 청구 팩스번호</h2>
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-bold text-slate-600">
              {list.length}곳
            </span>
          </div>
          <p className="px-1 text-[11px] leading-4 text-slate-500">
            보험금 청구비서에서 <b className="text-slate-700">팩스 자동 접수</b>를 쓸 때 서류가 발송되는 번호입니다. 각 보험사의
            <b className="text-slate-700"> 보상서비스센터 청구접수 대표 팩스</b>만 넣어주세요.
          </p>
        </>
      ) : null}

      {!configured ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
          <AlertTriangle className="mr-1 inline h-3 w-3" />
          자동청구 설정이 아직 적용되지 않았습니다. 등록은 설정 완료 후 가능합니다.
        </div>
      ) : null}

      {standalone && list.length > 3 ? (
        <div className="flex items-center gap-1.5 rounded-2xl border border-slate-200 bg-white px-3 shadow-sm">
          <Search className="h-4 w-4 shrink-0 text-slate-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="보험사 · 번호 검색"
            className="w-full bg-transparent py-2.5 text-sm text-slate-100 outline-none placeholder:text-slate-400"
          />
          {t ? (
            <button type="button" onClick={() => setQ('')} aria-label="검색 지우기" className="rounded-lg p-1 text-slate-400 active:bg-slate-50">
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
      ) : null}

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-6 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" /> 불러오는 중…
        </div>
      ) : shown.length > 0 ? (
        <div className="space-y-1">
          {shown.map((f) => (
            <div
              key={f.id}
              className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950 px-2.5 py-2 text-[12px]"
            >
              <span className="min-w-0 text-slate-100">
                <b>{f.insurer}</b> <span className="text-slate-500">{f.fax}</span>
                {f.label ? <span className="text-slate-500"> · {f.label}</span> : null}
              </span>
              {admin ? (
                <button
                  type="button"
                  onClick={() => void remove(f.id, f.insurer)}
                  aria-label="삭제"
                  className="shrink-0 text-slate-400 hover:text-rose-600"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <p className={standalone ? 'rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500' : 'text-[11px] text-slate-500'}>
          {t ? `'${q.trim()}' 검색 결과가 없습니다.` : '등록된 청구 팩스번호가 없습니다.'}
          {!t && !admin ? ' 관리자가 등록하면 여기에 표시됩니다.' : ''}
        </p>
      )}

      {admin ? (
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <select
              value={insurer}
              onChange={(e) => setInsurer(e.target.value)}
              className="rounded-lg border border-slate-800 bg-white px-2 py-1.5 text-[12px] text-slate-100"
            >
              {INSURERS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <input
              value={fax}
              onChange={(e) => setFax(e.target.value)}
              placeholder="청구 팩스번호"
              inputMode="tel"
              className="w-36 rounded-lg border border-slate-800 bg-slate-950 px-2 py-1.5 text-[12px] text-slate-100 outline-none placeholder:text-slate-500 focus:border-[#c6982f]"
            />
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="라벨(선택)"
              className="w-28 rounded-lg border border-slate-800 bg-slate-950 px-2 py-1.5 text-[12px] text-slate-100 outline-none placeholder:text-slate-500 focus:border-[#c6982f]"
            />
            <button
              type="button"
              onClick={() => void add()}
              disabled={busy || !fax.trim()}
              className={[
                'inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[12px] font-bold',
                busy || !fax.trim() ? 'cursor-not-allowed bg-slate-200 text-slate-400' : 'bg-[#0e1e3a] text-[#e6c877] hover:brightness-125'
              ].join(' ')}
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} 저장
            </button>
          </div>
          {msg ? <div className="text-[11px] font-medium text-rose-600">{msg}</div> : null}
          {standalone && missing.length > 0 ? (
            <p className="text-[11px] text-slate-500">
              아직 없는 곳: <span className="text-amber-600">{missing.join(' · ')}</span>
            </p>
          ) : null}
          <p className="text-[11px] leading-4 text-slate-500">
            청구접수 대표 팩스(보상서비스센터)만 등록하세요. 진단서·수술확인서는 민감한 질병정보라
            <b className="text-slate-700"> 오발송 시 회수가 불가능</b>합니다 — 번호를 꼭 두 번 확인해주세요.
          </p>
        </div>
      ) : null}
    </div>
  )
}
