import { useMemo, useState } from 'react'
import { ClipboardList, Plus, Trash2, Download, Save, FilePlus2, RotateCcw } from 'lucide-react'
import {
  listAnalyses,
  saveAnalysis,
  removeAnalysis,
  exportAnalysis,
  blankAnalysis,
  summarize,
  verdictOf,
  defaultCoverages,
  VERDICT_LABEL,
  VERDICT_TONE,
  type CoverageAnalysis,
  type HeldPolicy
} from '@renderer/services/commercial/coverageAnalysis'

/**
 * 보장분석 정리 — 고객 보유 보험을 담보별로 정리하고 부족/미가입을 한눈에.
 * 저장은 이 브라우저(FC 개인 작업 자료). 권장금액은 참고 기준(수정 가능). 엑셀 내보내기 지원.
 *
 * 색상: 이 앱은 slate 스케일 반전 리맵 — 어두운 글씨 text-slate-100/200, 밝은 면 bg-white/bg-slate-950.
 */

const TONE_CHIP: Record<string, string> = {
  rose: 'bg-rose-50 text-rose-700 border-rose-200',
  amber: 'bg-amber-50 text-amber-700 border-amber-200',
  emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  slate: 'bg-slate-950 text-slate-500 border-slate-800'
}

const won = (n: number): string => (Number(n) || 0).toLocaleString('ko-KR')

export default function CoverageAnalysisPage(): JSX.Element {
  const [saved, setSaved] = useState<CoverageAnalysis[]>(() => listAnalyses())
  const [a, setA] = useState<CoverageAnalysis>(() => saved[0] ?? blankAnalysis())
  const [status, setStatus] = useState<string | null>(null)

  const sum = useMemo(() => summarize(a), [a])

  const patch = (p: Partial<CoverageAnalysis>): void => setA((prev) => ({ ...prev, ...p }))

  const setCoverage = (key: string, field: 'current' | 'recommended', value: number): void => {
    setA((prev) => ({
      ...prev,
      coverages: prev.coverages.map((r) => (r.key === key ? { ...r, [field]: value } : r))
    }))
  }
  const toggleYn = (key: string): void => {
    setA((prev) => ({
      ...prev,
      coverages: prev.coverages.map((r) => (r.key === key ? { ...r, current: r.current >= 1 ? 0 : 1 } : r))
    }))
  }

  const addPolicy = (): void => {
    const np: HeldPolicy = { id: `p_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, insurer: '', product: '', ptype: '', monthly: 0 }
    setA((prev) => ({ ...prev, policies: [...prev.policies, np] }))
  }
  const setPolicy = (id: string, field: keyof HeldPolicy, value: string | number): void => {
    setA((prev) => ({ ...prev, policies: prev.policies.map((p) => (p.id === id ? { ...p, [field]: value } : p)) }))
  }
  const removePolicy = (id: string): void => setA((prev) => ({ ...prev, policies: prev.policies.filter((p) => p.id !== id) }))

  const doSave = (): void => {
    if (!a.customerName.trim()) {
      setStatus('고객명을 입력해 주세요.')
      return
    }
    setSaved(saveAnalysis(a))
    setStatus('저장되었습니다. (이 브라우저에 보관)')
  }
  const doNew = (): void => {
    setA(blankAnalysis())
    setStatus(null)
  }
  const loadSaved = (id: string): void => {
    const found = listAnalyses().find((x) => x.id === id)
    if (found) {
      setA(found)
      setStatus(null)
    }
  }
  const doRemove = (): void => {
    if (!window.confirm('이 고객의 보장분석을 삭제할까요?')) return
    setSaved(removeAnalysis(a.id))
    setA(blankAnalysis())
    setStatus('삭제되었습니다.')
  }
  const resetCoverages = (): void => {
    if (!window.confirm('담보 항목을 기본값으로 되돌릴까요? (입력한 금액이 초기화됩니다)')) return
    setA((prev) => ({ ...prev, coverages: defaultCoverages() }))
  }

  return (
    <div className="space-y-4">
      {/* 헤더 */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-800 bg-[#0e1e3a] px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <ClipboardList className="h-4 w-4 text-[#e6c877]" />
          <h1 className="text-sm font-extrabold text-white">보장분석 정리</h1>
          <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-bold text-white/80">
            {a.customerName ? a.customerName : '새 분석'}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {saved.length > 0 ? (
            <select
              value=""
              onChange={(e) => e.target.value && loadSaved(e.target.value)}
              className="rounded-lg border border-white/20 bg-[#0e1e3a] px-2 py-1.5 text-[11px] font-semibold text-white outline-none"
            >
              <option value="">저장된 고객 불러오기…</option>
              {saved.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.customerName || '(이름없음)'}
                </option>
              ))}
            </select>
          ) : null}
          <button type="button" onClick={doNew} className="inline-flex items-center gap-1.5 rounded-lg border border-white/20 px-2.5 py-1.5 text-[11px] font-semibold text-white transition hover:bg-white/10">
            <FilePlus2 className="h-3.5 w-3.5" /> 새로
          </button>
          <button type="button" onClick={() => exportAnalysis(a)} className="inline-flex items-center gap-1.5 rounded-lg border border-white/20 px-2.5 py-1.5 text-[11px] font-semibold text-white transition hover:bg-white/10">
            <Download className="h-3.5 w-3.5" /> 엑셀
          </button>
          <button type="button" onClick={doSave} className="inline-flex items-center gap-1.5 rounded-lg bg-white px-2.5 py-1.5 text-[11px] font-bold text-[#0e1e3a] transition hover:opacity-90">
            <Save className="h-3.5 w-3.5" /> 저장
          </button>
        </div>
      </div>

      {status ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-[13px] font-medium text-emerald-700">{status}</div>
      ) : null}

      {/* 고객 정보 */}
      <div className="rounded-2xl border border-slate-800 bg-white p-4 shadow-sm">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <label className="text-[12px] font-semibold text-slate-500">
            고객명
            <input value={a.customerName} onChange={(e) => patch({ customerName: e.target.value })} placeholder="예: 홍길동"
              className="mt-1 w-full rounded-lg border border-slate-700 bg-white px-2.5 py-2 text-[13px] font-normal text-slate-200 outline-none placeholder:text-slate-500 focus:border-indigo-400" />
          </label>
          <label className="text-[12px] font-semibold text-slate-500">
            생년(선택)
            <input value={a.birth ?? ''} onChange={(e) => patch({ birth: e.target.value })} placeholder="예: 1980"
              className="mt-1 w-full rounded-lg border border-slate-700 bg-white px-2.5 py-2 text-[13px] font-normal text-slate-200 outline-none placeholder:text-slate-500 focus:border-indigo-400" />
          </label>
          <label className="text-[12px] font-semibold text-slate-500">
            메모(선택)
            <input value={a.memo ?? ''} onChange={(e) => patch({ memo: e.target.value })} placeholder="상담 메모"
              className="mt-1 w-full rounded-lg border border-slate-700 bg-white px-2.5 py-2 text-[13px] font-normal text-slate-200 outline-none placeholder:text-slate-500 focus:border-indigo-400" />
          </label>
        </div>
      </div>

      {/* 요약 */}
      <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
        <span className="rounded-full border border-slate-800 bg-white px-2.5 py-1 font-semibold text-slate-200 shadow-sm">월 보험료 합계 {won(sum.monthlyTotal)}원</span>
        <span className="rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 font-semibold text-rose-700">미가입 {sum.none}</span>
        <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 font-semibold text-amber-700">부족 {sum.short}</span>
        <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 font-semibold text-emerald-700">충분/가입 {sum.ok}</span>
      </div>

      {/* 담보 정리표 */}
      <div className="space-y-2">
        <div className="flex items-center justify-between px-1">
          <h2 className="text-sm font-bold text-slate-100">담보 정리</h2>
          <button type="button" onClick={resetCoverages} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-800 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-500 transition hover:bg-slate-950">
            <RotateCcw className="h-3.5 w-3.5" /> 기본값 복원
          </button>
        </div>
        <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-white shadow-sm">
          <table className="w-full min-w-[560px] text-left text-[13px]">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-950 text-[11px] text-slate-500">
                <th className="px-3 py-2.5 font-semibold">담보</th>
                <th className="px-3 py-2.5 font-semibold">현재 가입</th>
                <th className="px-3 py-2.5 font-semibold">권장(참고·수정가능)</th>
                <th className="px-3 py-2.5 font-semibold">판정</th>
              </tr>
            </thead>
            <tbody>
              {a.coverages.map((r) => {
                const v = verdictOf(r)
                return (
                  <tr key={r.key} className="border-b border-slate-800 last:border-0">
                    <td className="px-3 py-2 font-semibold text-slate-100 whitespace-nowrap">
                      {r.label}
                      {r.unit === 'daily' ? <span className="ml-1 text-[10px] text-slate-500">(일당)</span> : null}
                    </td>
                    <td className="px-3 py-2">
                      {r.unit === 'yn' ? (
                        <label className="inline-flex cursor-pointer items-center gap-1.5 text-[12px] text-slate-300">
                          <input type="checkbox" checked={r.current >= 1} onChange={() => toggleYn(r.key)} className="h-4 w-4 accent-indigo-600" />
                          {r.current >= 1 ? '가입' : '미가입'}
                        </label>
                      ) : (
                        <AmountInput value={r.current} onChange={(n) => setCoverage(r.key, 'current', n)} />
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {r.unit === 'yn' ? (
                        <span className="text-[12px] text-slate-500">가입 권장</span>
                      ) : (
                        <AmountInput value={r.recommended} onChange={(n) => setCoverage(r.key, 'recommended', n)} muted />
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <span className={['inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-bold', TONE_CHIP[VERDICT_TONE[v]]].join(' ')}>
                        {VERDICT_LABEL[v]}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* 보유 계약 */}
      <div className="space-y-2">
        <div className="flex items-center justify-between px-1">
          <h2 className="text-sm font-bold text-slate-100">보유 계약</h2>
          <button type="button" onClick={addPolicy} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-800 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-200 transition hover:bg-slate-950">
            <Plus className="h-3.5 w-3.5" /> 계약 추가
          </button>
        </div>
        <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-white shadow-sm">
          <table className="w-full min-w-[620px] text-left text-[13px]">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-950 text-[11px] text-slate-500">
                <th className="px-3 py-2.5 font-semibold">보험사</th>
                <th className="px-3 py-2.5 font-semibold">상품명</th>
                <th className="px-3 py-2.5 font-semibold">종류</th>
                <th className="px-3 py-2.5 font-semibold">월 보험료</th>
                <th className="px-3 py-2.5 font-semibold"></th>
              </tr>
            </thead>
            <tbody>
              {a.policies.length === 0 ? (
                <tr><td colSpan={5} className="px-3 py-6 text-center text-[12px] text-slate-500">「계약 추가」로 고객의 보유 보험을 입력하세요.</td></tr>
              ) : (
                a.policies.map((p) => (
                  <tr key={p.id} className="border-b border-slate-800 last:border-0">
                    <td className="px-3 py-2"><PolInput value={p.insurer} onChange={(v) => setPolicy(p.id, 'insurer', v)} placeholder="삼성화재" /></td>
                    <td className="px-3 py-2"><PolInput value={p.product} onChange={(v) => setPolicy(p.id, 'product', v)} placeholder="상품명" /></td>
                    <td className="px-3 py-2"><PolInput value={p.ptype} onChange={(v) => setPolicy(p.id, 'ptype', v)} placeholder="종신/건강/실손" /></td>
                    <td className="px-3 py-2"><AmountInput value={p.monthly} onChange={(n) => setPolicy(p.id, 'monthly', n)} /></td>
                    <td className="px-3 py-2">
                      <button type="button" onClick={() => removePolicy(p.id)} className="rounded-md border border-rose-200 bg-white p-1.5 text-rose-500 transition hover:bg-rose-50">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 하단 액션 */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <div className="text-[11px] text-slate-500">데이터는 이 브라우저에만 저장됩니다. 권장금액은 참고 기준이며 설계 기준에 맞게 수정하세요.</div>
        {saved.some((s) => s.id === a.id) ? (
          <button type="button" onClick={doRemove} className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-white px-2.5 py-2 text-[12px] font-semibold text-rose-500 transition hover:bg-rose-50">
            <Trash2 className="h-3.5 w-3.5" /> 이 고객 삭제
          </button>
        ) : null}
      </div>
    </div>
  )
}

function AmountInput({ value, onChange, muted }: { value: number; onChange: (n: number) => void; muted?: boolean }): JSX.Element {
  return (
    <div className="flex items-center gap-1">
      <input
        type="number"
        inputMode="numeric"
        value={value === 0 ? '' : value}
        onChange={(e) => onChange(Number(e.target.value.replace(/[^0-9]/g, '')) || 0)}
        placeholder="0"
        className={[
          'w-32 rounded-md border bg-white px-2 py-1 text-right text-[12px] tabular-nums outline-none focus:border-indigo-400',
          muted ? 'border-slate-800 text-slate-500' : 'border-slate-700 text-slate-200'
        ].join(' ')}
      />
      <span className="text-[10px] text-slate-500">원</span>
    </div>
  )
}

function PolInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }): JSX.Element {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full min-w-[110px] rounded-md border border-slate-700 bg-white px-2 py-1 text-[12px] text-slate-200 outline-none placeholder:text-slate-500 focus:border-indigo-400"
    />
  )
}
