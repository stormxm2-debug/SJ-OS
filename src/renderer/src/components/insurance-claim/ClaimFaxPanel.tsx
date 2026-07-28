import { useEffect, useMemo, useState } from 'react'
import { Printer, Loader2, AlertTriangle, CheckCircle2, Building2, FileText } from 'lucide-react'
import type { ClaimExpertResult } from '@renderer/services/insurance-claim/claimExpertService'
import {
  createAndSendFax,
  listInsurerFax,
  suggestRouting,
  type InsurerFax,
  type SendFaxResult
} from '@renderer/services/insurance-claim/claimFaxService'
import type { CustomerRecord } from '@shared/commercial/models'
import { useSession } from '@renderer/navigation/SessionContext'
import { isAdminRole } from '@renderer/navigation/roleAccess'
import InsurerFaxManagerCard from '@renderer/components/insurance-claim/InsurerFaxManagerCard'

const MAX_TARGETS = 3

/**
 * 자동청구(팩스 동시 접수) 패널 — 청구비서 분석 결과 아래에 붙는다.
 * AI 분석의 회사·서류 분류로 "회사별 필요한 서류만" 자동 라우팅을 추천하고,
 * FC가 최대 3개사를 골라 위임 확인 후 팩스로 동시 접수한다.
 */
export default function ClaimFaxPanel({
  result,
  files,
  customer
}: {
  result: ClaimExpertResult
  files: File[]
  customer: CustomerRecord | null
}): JSX.Element {
  const { session } = useSession()
  const admin = isAdminRole(session.role)

  const fileNames = useMemo(() => files.map((f) => f.name), [files])
  const plan = useMemo(() => suggestRouting(result, fileNames), [result, fileNames])

  const [faxList, setFaxList] = useState<InsurerFax[]>([])
  const [configured, setConfigured] = useState(true)
  const faxByInsurer = useMemo(() => {
    const m = new Map<string, InsurerFax>()
    for (const f of faxList) m.set(f.insurer, f)
    return m
  }, [faxList])

  // 회사 선택 + 회사별 서류 선택
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [fileSel, setFileSel] = useState<Record<string, Set<number>>>({})
  const [consent, setConsent] = useState(false)
  const [note, setNote] = useState('')

  const [sending, setSending] = useState(false)
  const [sendMsg, setSendMsg] = useState('')
  const [notConfigured, setNotConfigured] = useState(false)
  const [statuses, setStatuses] = useState<{ insurer: string; ok: boolean; error?: string }[] | null>(null)

  const refreshFax = (): void => {
    void listInsurerFax().then((r) => {
      setFaxList(r.items)
      setConfigured(r.configured)
    })
  }
  useEffect(refreshFax, [])

  // 라우팅 추천으로 초기 선택값 세팅(회사 처음 3개, 추천 서류 체크)
  useEffect(() => {
    const sel: Record<string, boolean> = {}
    const fsel: Record<string, Set<number>> = {}
    plan.perCompany.forEach((c, idx) => {
      sel[c.insurer] = idx < MAX_TARGETS
      fsel[c.insurer] = new Set(c.fileIndexes)
    })
    setSelected(sel)
    setFileSel(fsel)
  }, [plan])

  const selectedCount = Object.values(selected).filter(Boolean).length

  const toggleCompany = (insurer: string): void => {
    setSelected((prev) => {
      const next = { ...prev }
      if (next[insurer]) next[insurer] = false
      else {
        if (selectedCount >= MAX_TARGETS) return prev // 3개 초과 차단
        next[insurer] = true
      }
      return next
    })
  }

  const toggleFile = (insurer: string, idx: number): void => {
    setFileSel((prev) => {
      const set = new Set(prev[insurer] ?? [])
      if (set.has(idx)) set.delete(idx)
      else set.add(idx)
      return { ...prev, [insurer]: set }
    })
  }

  const targets = plan.perCompany
    .filter((c) => selected[c.insurer])
    .map((c) => ({ insurer: c.insurer, fileIndexes: [...(fileSel[c.insurer] ?? new Set())] }))
  const canSend = consent && targets.some((t) => t.fileIndexes.length > 0) && !sending

  const onSend = async (): Promise<void> => {
    setSending(true)
    setSendMsg('')
    setNotConfigured(false)
    setStatuses(null)
    const res: SendFaxResult = await createAndSendFax({
      files,
      targets,
      customerId: customer?.id ?? null,
      customerName: customer?.name ?? null,
      consent,
      note,
      fileDocTypes: plan.fileDocTypes
    })
    setSending(false)
    if (res.code === 'NOT_CONFIGURED') {
      setNotConfigured(true)
      return
    }
    if (res.results) setStatuses(res.results)
    if (!res.ok) {
      setSendMsg(res.error ?? '팩스 발송에 실패했습니다.')
      return
    }
    setSendMsg('')
  }

  const noCompanies = plan.perCompany.length === 0

  return (
    <div className="rounded-2xl border border-[#c6982f]/40 bg-white p-4 shadow-sm sm:p-5">
      <div className="mb-1 flex items-center gap-1.5">
        <Printer className="h-4 w-4 text-[#b0821f]" />
        <h3 className="text-sm font-extrabold text-slate-100">자동청구 · 팩스 동시 접수</h3>
      </div>
      <p className="mb-3 text-[12px] leading-5 text-slate-500">
        AI가 분석한 회사·담보에 맞춰 <b className="text-slate-300">회사별로 필요한 서류만</b> 자동 배정했습니다. 확인 후 최대{' '}
        {MAX_TARGETS}개사에 동시에 팩스로 접수합니다.
      </p>

      {noCompanies ? (
        <div className="rounded-xl border border-slate-800 bg-slate-950 p-3 text-[12px] text-slate-400">
          분석에서 청구 대상 보험사를 찾지 못했습니다. 증권을 함께 올리면 회사별 자동 배정이 정확해집니다.
        </div>
      ) : (
        <div className="space-y-2.5">
          {plan.perCompany.map((c) => {
            const on = Boolean(selected[c.insurer])
            const fax = faxByInsurer.get(c.insurer)
            const disabled = !on && selectedCount >= MAX_TARGETS
            return (
              <div
                key={c.insurer}
                className={[
                  'rounded-xl border p-3 transition',
                  on ? 'border-[#c6982f] bg-[#faf6ec]' : 'border-slate-800 bg-slate-950'
                ].join(' ')}
              >
                <div className="flex items-center justify-between gap-2">
                  <label className={['flex items-center gap-2', disabled ? 'opacity-40' : 'cursor-pointer'].join(' ')}>
                    <input
                      type="checkbox"
                      checked={on}
                      disabled={disabled}
                      onChange={() => toggleCompany(c.insurer)}
                      className="h-4 w-4 accent-[#c6982f]"
                    />
                    <Building2 className="h-4 w-4 text-slate-500" />
                    <span className="text-[13px] font-bold text-slate-100">{c.insurer}</span>
                  </label>
                  {fax ? (
                    <span className="text-[10px] font-semibold text-slate-500">FAX {fax.fax}</span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] font-bold text-rose-600">
                      <AlertTriangle className="h-3 w-3" /> 팩스번호 미등록
                    </span>
                  )}
                </div>

                {on ? (
                  <div className="mt-2 flex flex-wrap gap-1.5 pl-6">
                    {plan.faxableIndexes.length === 0 ? (
                      <span className="text-[11px] text-slate-500">보낼 수 있는 서류가 없습니다 (증권·약관은 제외).</span>
                    ) : (
                      plan.faxableIndexes.map((i) => {
                        const picked = (fileSel[c.insurer] ?? new Set()).has(i)
                        return (
                          <button
                            key={i}
                            type="button"
                            onClick={() => toggleFile(c.insurer, i)}
                            className={[
                              'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium transition',
                              picked
                                ? 'border-[#c6982f] bg-[#0e1e3a] text-[#e6c877]'
                                : 'border-slate-800 bg-white text-slate-400'
                            ].join(' ')}
                          >
                            <FileText className="h-3 w-3" />
                            {plan.fileDocTypes[i]} · {truncate(fileNames[i], 14)}
                          </button>
                        )
                      })
                    )}
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      )}

      {/* 상태 결과 */}
      {statuses ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {statuses.map((s, i) => (
            <span
              key={i}
              className={[
                'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold',
                s.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-600'
              ].join(' ')}
            >
              {s.ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
              {s.insurer} {s.ok ? '접수됨' : s.error ?? '실패'}
            </span>
          ))}
        </div>
      ) : null}

      {notConfigured ? <NotConfiguredCard /> : null}

      {!noCompanies ? (
        <>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="접수 메모(선택) — 예: 통원 3회분, 골절 부위 좌측 손목"
            className="mt-3 w-full rounded-xl border border-slate-800 bg-slate-950 p-2.5 text-[12px] leading-5 text-slate-100 outline-none placeholder:text-slate-500 focus:border-[#c6982f]"
          />
          <label className="mt-2 flex items-start gap-2 rounded-xl border border-slate-800 bg-slate-950 p-3 text-[12px] leading-5 text-slate-300">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[#c6982f]" />
            <span>
              고객에게 <b className="text-slate-100">청구 위임을 확인</b>받았으며, 위 서류를 선택한 보험사에 팩스로 접수하는 데 동의합니다.
              <span className="mt-0.5 block text-[11px] text-slate-500">민감 정보가 포함된 서류입니다 — 회사·서류가 맞는지 한 번 더 확인하세요.</span>
            </span>
          </label>

          <button
            type="button"
            onClick={() => void onSend()}
            disabled={!canSend}
            className={[
              'mt-2 inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-[13px] font-extrabold transition',
              canSend ? 'bg-gradient-to-r from-[#0e1e3a] to-[#1b3a6b] text-[#e6c877] hover:brightness-125' : 'cursor-not-allowed bg-slate-200 text-slate-400'
            ].join(' ')}
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}
            {sending ? '팩스 접수 중…' : `팩스 동시 접수 (${targets.filter((t) => t.fileIndexes.length > 0).length}개사)`}
          </button>
          {sendMsg ? <div className="mt-2 text-[12px] font-medium text-rose-600">{sendMsg}</div> : null}
          {!configured ? (
            <p className="mt-2 text-[11px] text-amber-600">※ 자동청구 스키마가 아직 적용되지 않았습니다(설정 전). 접수는 설정 완료 후 실제 발송됩니다.</p>
          ) : null}
        </>
      ) : null}

      {admin ? <InsurerFaxManagerCard list={faxList} onChanged={refreshFax} /> : null}
    </div>
  )
}

function NotConfiguredCard(): JSX.Element {
  return (
    <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-[12px] leading-5 text-amber-800">
      <div className="mb-1 flex items-center gap-1.5 font-extrabold">
        <AlertTriangle className="h-4 w-4" /> 자동청구(팩스) 설정 전입니다
      </div>
      실제 발송을 위해 필요한 항목: ① 솔라피 팩스 발신번호·API 키 등록, ② 보험사별 청구 팩스번호 입력(아래 관리),
      ③ 자동청구 스키마·엣지 함수 배포. 설정 완료 전까지 접수 내용은 저장되지만 실제 전송은 되지 않습니다.
    </div>
  )
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s
}
