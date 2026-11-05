import { useMemo, useState } from 'react'
import { Calculator, SlidersHorizontal, AlertTriangle } from 'lucide-react'
import {
  DEFAULT_GEN_RULES,
  estimateInsurancePayout,
  wonFormat,
  type GenRule,
  type Generation,
  type CareType
} from '@renderer/services/health-record/insuranceEstimate'

/**
 * 실손의료보험 '예상 지급액' 시나리오 계산 — 수동 입력 기반.
 * 금액을 자동으로 지어내지 않고, FC가 입력한 의료비 + (수정 가능한) 세대 규칙으로만 추정한다.
 * 결과는 추정이며 실제 지급과 다를 수 있음을 항상 표시한다.
 */
const GENERATIONS: Generation[] = ['1', '2', '3', '4']
const onlyDigits = (s: string): number => Number((s ?? '').replace(/[^\d]/g, '')) || 0
const pct = (v: number): string => `${Math.round(v * 1000) / 10}`

export default function SonsonEstimator(): JSX.Element {
  const [generation, setGeneration] = useState<Generation>('4')
  const [careType, setCareType] = useState<CareType>('out')
  const [covered, setCovered] = useState('')
  const [uncovered, setUncovered] = useState('')
  const [rules, setRules] = useState<Record<Generation, GenRule>>(() => structuredClone(DEFAULT_GEN_RULES))
  const [showRules, setShowRules] = useState(false)

  const rule = rules[generation]
  const result = useMemo(
    () => estimateInsurancePayout({ generation, careType, coveredMedical: onlyDigits(covered), uncoveredMedical: onlyDigits(uncovered) }, rule),
    [generation, careType, covered, uncovered, rule]
  )

  const setRuleField = (field: keyof GenRule, value: number): void =>
    setRules((prev) => ({ ...prev, [generation]: { ...prev[generation], [field]: value } }))

  const hasInput = onlyDigits(covered) > 0 || onlyDigits(uncovered) > 0
  const field = 'mt-1 w-full rounded-lg border border-slate-700 bg-white px-2 py-2 text-[13px] text-[#0f172a] outline-none focus:border-[#c6982f]'
  const chip = (on: boolean): string =>
    `rounded-lg px-3 py-1.5 text-[12px] font-semibold ${on ? 'bg-[#0e1e3a] text-white' : 'bg-slate-800 text-slate-300'}`

  return (
    <section className="mt-4 rounded-xl border border-slate-800 bg-slate-900 p-3">
      <div className="flex items-center gap-2">
        <Calculator className="h-4 w-4 text-[#c6982f]" />
        <h3 className="text-[13px] font-bold text-slate-100">실손 예상 (시나리오)</h3>
        <button type="button" onClick={() => setShowRules((v) => !v)} className="ml-auto inline-flex items-center gap-1 rounded-lg bg-slate-800 px-2 py-1 text-[11px] font-semibold text-slate-300">
          <SlidersHorizontal className="h-3 w-3" /> 규칙 수정
        </button>
      </div>

      <div className="mt-2 flex items-start gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-[11px] leading-relaxed text-amber-200">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
        <span>추정 시나리오입니다. 실제 지급은 <b>가입 담보·약관 버전·잔여 한도·급여/비급여 판정·면책</b>에 따라 달라집니다. 아래 세대 규칙은 일반 근사치이니 실제 증권값으로 수정해 사용하세요.</span>
      </div>

      {/* 세대 / 진료구분 */}
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="text-[11px] font-semibold text-slate-400">실손 세대</label>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {GENERATIONS.map((g) => (
              <button key={g} type="button" onClick={() => setGeneration(g)} className={chip(generation === g)}>{g}세대</button>
            ))}
          </div>
          <p className="mt-1 text-[10px] leading-relaxed text-slate-500">{rule.label} · {rule.note}</p>
        </div>
        <div>
          <label className="text-[11px] font-semibold text-slate-400">진료 구분</label>
          <div className="mt-1 flex gap-1.5">
            <button type="button" onClick={() => setCareType('out')} className={chip(careType === 'out')}>통원</button>
            <button type="button" onClick={() => setCareType('in')} className={chip(careType === 'in')}>입원</button>
          </div>
        </div>
      </div>

      {/* 의료비 입력 */}
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="text-[11px] font-semibold text-slate-400">급여 의료비 (본인부담, 원)</label>
          <input value={covered} onChange={(e) => setCovered(e.target.value)} inputMode="numeric" placeholder="예: 300,000" className={field} />
        </div>
        <div>
          <label className="text-[11px] font-semibold text-slate-400">비급여 의료비 (원)</label>
          <input value={uncovered} onChange={(e) => setUncovered(e.target.value)} inputMode="numeric" placeholder="예: 500,000" className={field} />
        </div>
      </div>

      {/* 규칙 수정 패널 */}
      {showRules ? (
        <div className="mt-3 rounded-lg border border-slate-700 bg-slate-950 p-2.5">
          <div className="text-[11px] font-semibold text-slate-300">{rule.label} 규칙 (이 세션에서만 적용)</div>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <label className="text-[10px] text-slate-400">급여 자기부담 %
              <input value={pct(rule.coveredCopayRate)} onChange={(e) => setRuleField('coveredCopayRate', (Number(e.target.value.replace(/[^\d.]/g, '')) || 0) / 100)} inputMode="decimal" className={field} />
            </label>
            <label className="text-[10px] text-slate-400">비급여 자기부담 %
              <input value={pct(rule.uncoveredCopayRate)} onChange={(e) => setRuleField('uncoveredCopayRate', (Number(e.target.value.replace(/[^\d.]/g, '')) || 0) / 100)} inputMode="decimal" className={field} />
            </label>
            <label className="text-[10px] text-slate-400">통원 정액공제 (원)
              <input value={String(rule.outpatientDeduction)} onChange={(e) => setRuleField('outpatientDeduction', onlyDigits(e.target.value))} inputMode="numeric" className={field} />
            </label>
            <label className="text-[10px] text-slate-400">연 한도 (원)
              <input value={String(rule.annualLimit)} onChange={(e) => setRuleField('annualLimit', onlyDigits(e.target.value))} inputMode="numeric" className={field} />
            </label>
          </div>
          <button type="button" onClick={() => setRules((prev) => ({ ...prev, [generation]: structuredClone(DEFAULT_GEN_RULES[generation]) }))} className="mt-2 rounded-lg bg-slate-800 px-2 py-1 text-[10px] font-semibold text-slate-300">기본값으로 되돌리기</button>
        </div>
      ) : null}

      {/* 결과 */}
      <div className="mt-3 rounded-lg border border-slate-700 bg-slate-950 p-3">
        <div className="flex items-end justify-between">
          <span className="text-[11px] text-slate-400">예상 지급액 (추정)</span>
          <span className="text-[20px] font-extrabold text-[#c6982f]">{hasInput ? wonFormat(result.estimatedPayout) : '—'}</span>
        </div>
        {hasInput ? (
          <div className="mt-2 space-y-0.5 text-[11px] text-slate-400">
            <div className="flex justify-between"><span>급여분 보험금</span><span className="text-slate-200">{wonFormat(result.coveredBenefit)}</span></div>
            <div className="flex justify-between"><span>비급여분 보험금</span><span className="text-slate-200">{wonFormat(result.uncoveredBenefit)}</span></div>
            <div className="flex justify-between"><span>자기부담 공제</span><span>-{wonFormat(result.rateCopay)}</span></div>
            {result.outpatientExtraDeduction > 0 ? <div className="flex justify-between"><span>통원 정액공제(추가)</span><span>-{wonFormat(result.outpatientExtraDeduction)}</span></div> : null}
            {result.limitCut > 0 ? <div className="flex justify-between text-orange-400"><span>연 한도 초과</span><span>-{wonFormat(result.limitCut)}</span></div> : null}
          </div>
        ) : (
          <p className="mt-1 text-[11px] text-slate-500">급여·비급여 의료비를 입력하면 세대 규칙으로 예상액을 계산합니다.</p>
        )}
      </div>
    </section>
  )
}
