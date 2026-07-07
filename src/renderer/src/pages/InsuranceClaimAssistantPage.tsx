import { useState } from 'react'
import {
  ShieldCheck,
  Calculator,
  FileText,
  Loader2,
  AlertTriangle,
  Copy,
  Check,
  Sparkles,
  ReceiptText
} from 'lucide-react'
import Card from '@renderer/components/ui/Card'
import {
  estimateClaim,
  buildClaimPrompt,
  DEFAULT_INSURER,
  type ClaimEstimate
} from '@renderer/services/insurance-claim/insuranceClaimService'

/**
 * 보험금 청구비서 (Insurance Claim Assistant).
 *
 * The CEO/FC pastes the policy(증권) + incident details; the assistant asks the
 * AI to find applicable 약관 clauses + 사례 and estimate the total payout. The
 * OpenAI key never touches the renderer — this calls the backend AI proxy via the
 * shared Jarvis GPT brain. When the proxy is disabled, the user can still copy the
 * expert prompt into any external AI (graceful fallback).
 */
export default function InsuranceClaimAssistantPage(): JSX.Element {
  const [insurer, setInsurer] = useState(DEFAULT_INSURER)
  const [policyInfo, setPolicyInfo] = useState('')
  const [incident, setIncident] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<ClaimEstimate | null>(null)
  const [copied, setCopied] = useState(false)

  const canAnalyze = incident.trim().length > 0 && !loading

  const analyze = async (): Promise<void> => {
    if (!incident.trim()) return
    setLoading(true)
    setResult(null)
    try {
      const r = await estimateClaim({ insurer, policyInfo, incident })
      setResult(r)
    } finally {
      setLoading(false)
    }
  }

  const copyPrompt = (): void => {
    const prompt = buildClaimPrompt({ insurer, policyInfo, incident })
    const done = (): void => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    }
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(prompt).then(done).catch(done)
    } else {
      done()
    }
  }

  return (
    <div className="space-y-5">
      {/* Intro */}
      <Card title="보험금 청구비서" icon={<ShieldCheck className="h-4 w-4 text-indigo-500" />}>
        <p className="text-sm leading-6 text-slate-600">
          보험 <span className="font-semibold text-slate-800">증권·서류 내용</span>과{' '}
          <span className="font-semibold text-slate-800">사고·청구 내용</span>을 입력하면, 적용 가능한{' '}
          <span className="font-semibold text-slate-800">약관 담보</span>와 참고{' '}
          <span className="font-semibold text-slate-800">사례</span>를 찾아{' '}
          <span className="font-semibold text-indigo-600">예상 지급 보험금</span>을 추정해 드립니다.
        </p>
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-300/60 bg-amber-50 px-3 py-2 text-[12px] leading-5 text-amber-800">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            결과는 AI 추정치이며 실제 지급액은 약관 심사·손해사정 결과에 따라 달라질 수 있습니다. 참고용으로만
            사용하세요.
          </span>
        </div>
      </Card>

      {/* Inputs */}
      <Card title="① 정보 입력" icon={<FileText className="h-4 w-4 text-slate-400" />}>
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700">보험사</label>
            <input
              value={insurer}
              onChange={(e) => setInsurer(e.target.value)}
              placeholder="삼성화재"
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-400 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700">
              증권 / 가입 담보 정보 <span className="font-normal text-slate-400">(선택 · 붙여넣기)</span>
            </label>
            <textarea
              value={policyInfo}
              onChange={(e) => setPolicyInfo(e.target.value)}
              placeholder="예: 실손의료비, 상해입원일당 3만원, 질병수술비 특약 200만원, 골절진단금 30만원 …"
              className="h-28 w-full resize-y rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm leading-6 text-slate-900 placeholder:text-slate-400 focus:border-indigo-400 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700">
              사고 / 청구 내용 <span className="text-rose-500">*</span>
            </label>
            <textarea
              value={incident}
              onChange={(e) => setIncident(e.target.value)}
              placeholder="예: 계단에서 낙상하여 우측 발목 골절, 3일 입원 후 수술, 통원 5회. 진단명·경위·치료내역·입원일수를 적어주세요."
              className="h-32 w-full resize-y rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm leading-6 text-slate-900 placeholder:text-slate-400 focus:border-indigo-400 focus:outline-none"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void analyze()}
              disabled={!canAnalyze}
              className={[
                'inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition',
                canAnalyze
                  ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-sm shadow-indigo-500/30 hover:brightness-110'
                  : 'cursor-not-allowed bg-slate-200 text-slate-400'
              ].join(' ')}
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Calculator className="h-4 w-4" />}
              {loading ? '분석 중…' : '약관·사례 분석 및 예상 보험금 계산'}
            </button>
            <button
              type="button"
              onClick={copyPrompt}
              disabled={!incident.trim()}
              className={[
                'inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition',
                incident.trim()
                  ? 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
                  : 'cursor-not-allowed border-slate-200 bg-slate-50 text-slate-300'
              ].join(' ')}
            >
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? '복사됨' : '프롬프트 복사'}
            </button>
          </div>
          <p className="text-[11px] text-slate-400">
            * 사고/청구 내용은 필수입니다. 개인정보(주민번호·연락처 등)는 입력하지 마세요.
          </p>
        </div>
      </Card>

      {/* Result */}
      {loading ? (
        <Card title="② 분석 결과" icon={<Sparkles className="h-4 w-4 text-indigo-400" />}>
          <div className="flex items-center gap-2 py-6 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            약관과 사례를 분석하고 예상 보험금을 계산하는 중입니다…
          </div>
        </Card>
      ) : result ? (
        <Card title="② 분석 결과" icon={<Sparkles className="h-4 w-4 text-indigo-400" />}>
          {result.ok ? (
            <div className="space-y-4">
              {result.headline ? (
                <div className="flex items-center gap-3 rounded-xl border border-indigo-200 bg-gradient-to-r from-indigo-50 to-violet-50 px-4 py-3">
                  <ReceiptText className="h-6 w-6 shrink-0 text-indigo-600" />
                  <div className="text-base font-bold text-indigo-800">{result.headline}</div>
                </div>
              ) : null}
              <div className="whitespace-pre-wrap rounded-xl border border-slate-200 bg-slate-50 p-4 text-[13px] leading-6 text-slate-800">
                {result.answer}
              </div>
              <p className="text-[11px] text-slate-400">
                분석 소스: {result.source} · AI 추정치이며 실제 지급과 다를 수 있습니다.
              </p>
            </div>
          ) : result.disabled ? (
            <div className="space-y-3">
              <div className="flex items-start gap-2 rounded-lg border border-sky-300/60 bg-sky-50 px-3 py-2.5 text-[13px] leading-6 text-sky-800">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <div className="font-semibold">AI 브레인(GPT 프록시)이 아직 켜져 있지 않습니다.</div>
                  <div className="mt-1 text-[12px] text-sky-700">
                    백엔드 프록시에서 <code className="rounded bg-sky-100 px-1">OPENAI_ENABLED=true</code>와 키를,
                    렌더러에서 <code className="rounded bg-sky-100 px-1">VITE_AI_PROXY_ENABLED=true</code>를 설정하면
                    자동 분석이 됩니다. 지금은 아래 <b>프롬프트 복사</b>로 다른 AI(ChatGPT/Claude)에 붙여넣어 바로 쓸 수
                    있습니다.
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={copyPrompt}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-600 transition hover:bg-slate-50"
              >
                {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? '복사됨' : '전문가 프롬프트 복사'}
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-start gap-2 rounded-lg border border-rose-300/60 bg-rose-50 px-3 py-2.5 text-[13px] leading-6 text-rose-800">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{result.error ?? '분석에 실패했습니다.'}</span>
              </div>
              {result.canRetry ? (
                <button
                  type="button"
                  onClick={() => void analyze()}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-indigo-500"
                >
                  <Loader2 className="h-3.5 w-3.5" />
                  다시 시도
                </button>
              ) : null}
            </div>
          )}
        </Card>
      ) : null}
    </div>
  )
}
