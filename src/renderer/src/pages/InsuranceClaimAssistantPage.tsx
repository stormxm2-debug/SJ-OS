import { useRef, useState, type ChangeEvent } from 'react'
import {
  ShieldCheck,
  Calculator,
  FileText,
  Loader2,
  AlertTriangle,
  Copy,
  Check,
  Sparkles,
  ReceiptText,
  Upload,
  UserRound,
  FileCheck2
} from 'lucide-react'
import Card from '@renderer/components/ui/Card'
import {
  analyzeClaim,
  buildClaimPrompt,
  DEFAULT_INSURER,
  type ClaimEstimate
} from '@renderer/services/insurance-claim/insuranceClaimService'
import { useCustomer } from '@renderer/services/customer/useCustomer'
import type { CustomerRecord } from '@renderer/services/customer/types'

/** Format a customer's held/proposed policies into the 증권 정보 text box. */
function policiesToText(c: CustomerRecord): string {
  if (!c.policies.length) return ''
  return c.policies
    .map((p) => `${p.name} (${p.type}) · ${p.coverage} · 월 ${p.premium.toLocaleString()}원 · ${p.status}`)
    .join('\n')
}

/** Build a copyable claim-form draft from the current inputs + AI estimate. */
function buildClaimDraft(args: {
  insurer: string
  claimant: string
  headline?: string
  incident: string
  dateStr: string
}): string {
  const amount = args.headline ? args.headline.replace(/^.*예상 총 보험금\s*:?/, '').trim() : '(분석 후 자동 입력)'
  return [
    '［보험금 청구서 · 자동 초안］',
    `보험사: ${args.insurer || DEFAULT_INSURER}`,
    `청구인: ${args.claimant || '(미입력)'}`,
    `접수 예정일: ${args.dateStr}`,
    `예상 청구액: ${amount}`,
    '',
    '■ 사고 / 청구 사유',
    args.incident.trim() || '(사고 내용을 입력하세요)',
    '',
    '■ 필요 서류 체크리스트',
    '□ 보험금 청구서',
    '□ 청구인 신분증 사본',
    '□ 진단서 (병명·상해 부위 명시)',
    '□ 진료비 영수증 및 세부내역서',
    '□ 입원/수술 확인서 (해당 시)',
    '□ 수령 계좌 통장 사본',
    '',
    '※ 본 초안은 AI 추정 기반입니다. 실제 청구 전 담보·서류·금액을 반드시 확인하세요.'
  ].join('\n')
}

/**
 * 보험금 청구비서 (Insurance Claim Assistant) — automated.
 *
 * Flow: (1) pick a registered customer to auto-fill 증권 정보, OR type it; (2) either
 * upload a document photo (증권/진단서/영수증) for automatic AI vision analysis, or
 * analyze from text; (3) get an estimate + an auto-generated claim-form draft. The
 * OpenAI key never touches the renderer — everything goes through the backend proxy.
 */
export default function InsuranceClaimAssistantPage(): JSX.Element {
  const snapshot = useCustomer()
  const customers = snapshot.customers
  const [selectedCustomerId, setSelectedCustomerId] = useState('')
  const [insurer, setInsurer] = useState(DEFAULT_INSURER)
  const [policyInfo, setPolicyInfo] = useState('')
  const [incident, setIncident] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<ClaimEstimate | null>(null)
  const [copied, setCopied] = useState(false)
  const [claimCopied, setClaimCopied] = useState(false)
  const [fileName, setFileName] = useState('')
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const selectedCustomer = customers.find((c) => c.customerId === selectedCustomerId) ?? null
  const canAnalyze = incident.trim().length > 0 && !loading
  const today = new Date().toLocaleDateString('ko-KR')

  const onSelectCustomer = (id: string): void => {
    setSelectedCustomerId(id)
    const c = customers.find((x) => x.customerId === id)
    if (c) setPolicyInfo(policiesToText(c))
  }

  const analyzeText = async (): Promise<void> => {
    if (!incident.trim()) return
    setLoading(true)
    setResult(null)
    try {
      setResult(await analyzeClaim({ insurer, policyInfo, incident }))
    } finally {
      setLoading(false)
    }
  }

  const onPickFile = (): void => fileInputRef.current?.click()

  const onFile = async (e: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-selecting the same file
    if (!file) return
    const isPdf = file.type === 'application/pdf'
    setFileName(`${file.name} (${Math.round(file.size / 1024)}KB)`)
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev)
      return isPdf ? null : URL.createObjectURL(file)
    })
    setLoading(true)
    setResult(null)
    try {
      setResult(await analyzeClaim({ insurer, policyInfo, incident, file }))
    } finally {
      setLoading(false)
    }
  }

  const copyPrompt = (): void => {
    const prompt = buildClaimPrompt({ insurer, policyInfo, incident })
    writeClipboard(prompt, setCopied)
  }

  const copyClaimDraft = (): void => {
    const draft = buildClaimDraft({
      insurer,
      claimant: selectedCustomer?.name ?? '',
      headline: result?.headline,
      incident,
      dateStr: today
    })
    writeClipboard(draft, setClaimCopied)
  }

  return (
    <div className="space-y-5">
      {/* Intro */}
      <Card title="보험금 청구비서" icon={<ShieldCheck className="h-4 w-4 text-indigo-500" />}>
        <p className="text-sm leading-6 text-slate-600">
          고객을 선택해 <span className="font-semibold text-slate-100">증권 정보를 자동으로 불러오고</span>,{' '}
          <span className="font-semibold text-slate-100">서류(PDF·사진)</span>를 올리면 Claude가 직접 읽어{' '}
          <span className="font-semibold text-indigo-600">예상 보험금</span>과{' '}
          <span className="font-semibold text-slate-100">청구서 초안</span>까지 자동으로 만들어 드립니다.
        </p>
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-300/60 bg-amber-50 px-3 py-2 text-[12px] leading-5 text-amber-800">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            결과는 AI 추정치이며 실제 지급액은 약관 심사·손해사정 결과에 따라 달라질 수 있습니다. 서류 사진은 서버에
            저장되지 않고 분석 후 즉시 폐기됩니다. 개인정보(주민번호 등)가 보이는 서류는 주의해서 사용하세요.
          </span>
        </div>
      </Card>

      {/* Inputs */}
      <Card title="① 정보 입력" icon={<FileText className="h-4 w-4 text-slate-400" />}>
        <div className="space-y-4">
          {/* Customer auto-load */}
          <div>
            <label className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-slate-300">
              <UserRound className="h-3.5 w-3.5 text-indigo-500" />
              고객 선택 <span className="font-normal text-slate-400">(선택 시 증권 정보 자동 입력)</span>
            </label>
            <select
              value={selectedCustomerId}
              onChange={(e) => onSelectCustomer(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-100 focus:border-indigo-400 focus:outline-none"
            >
              <option value="">— 직접 입력 (고객 선택 안 함) —</option>
              {customers.map((c) => (
                <option key={c.customerId} value={c.customerId}>
                  {c.name} · {c.age}세 · 증권 {c.policies.length}건
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-300">보험사</label>
            <input
              value={insurer}
              onChange={(e) => setInsurer(e.target.value)}
              placeholder="삼성화재"
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-100 placeholder:text-slate-400 focus:border-indigo-400 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-300">
              증권 / 가입 담보 정보 <span className="font-normal text-slate-400">(고객 선택 시 자동 · 수정 가능)</span>
            </label>
            <textarea
              value={policyInfo}
              onChange={(e) => setPolicyInfo(e.target.value)}
              placeholder="예: 실손의료비, 상해입원일당 3만원, 골절진단금 30만원 …"
              className="h-24 w-full resize-y rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm leading-6 text-slate-100 placeholder:text-slate-400 focus:border-indigo-400 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-300">
              사고 / 청구 내용 <span className="text-rose-500">*</span>
            </label>
            <textarea
              value={incident}
              onChange={(e) => setIncident(e.target.value)}
              placeholder="예: 계단에서 낙상하여 우측 발목 골절, 3일 입원 후 통원 5회. 진단명·경위·치료내역·입원일수를 적어주세요."
              className="h-28 w-full resize-y rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm leading-6 text-slate-100 placeholder:text-slate-400 focus:border-indigo-400 focus:outline-none"
            />
          </div>

          {/* Document upload — automatic vision analysis */}
          <div className="rounded-xl border border-dashed border-indigo-300 bg-indigo-50/40 p-4">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-indigo-700">
              <Upload className="h-3.5 w-3.5" />
              서류 자동 분석 (PDF · 사진){' '}
              <span className="font-normal text-indigo-500/80">증권·진단서·영수증</span>
            </div>
            <p className="mt-1 text-[11px] leading-5 text-slate-500">
              PDF나 사진을 올리면 Claude가 서류를 직접 읽어 자동으로 분석합니다. 위 "사고/청구 내용"을 함께 적으면 더
              정확합니다.
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,application/pdf"
              onChange={(e) => void onFile(e)}
              className="hidden"
            />
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={onPickFile}
                disabled={loading}
                className={[
                  'inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition',
                  loading
                    ? 'cursor-not-allowed bg-slate-200 text-slate-400'
                    : 'bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-sm shadow-indigo-500/30 hover:brightness-110'
                ].join(' ')}
              >
                <Upload className="h-4 w-4" />
                서류(PDF·사진) 올리고 자동 분석
              </button>
              {previewUrl ? (
                <img
                  src={previewUrl}
                  alt="업로드한 서류 미리보기"
                  className="h-12 w-12 rounded-lg border border-slate-300 object-cover"
                />
              ) : null}
              {fileName ? <span className="text-[11px] text-slate-500">{fileName}</span> : null}
            </div>
          </div>

          {/* Text analyze + prompt copy */}
          <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 pt-3">
            <button
              type="button"
              onClick={() => void analyzeText()}
              disabled={!canAnalyze}
              className={[
                'inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition',
                canAnalyze
                  ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-sm shadow-indigo-500/30 hover:brightness-110'
                  : 'cursor-not-allowed bg-slate-200 text-slate-400'
              ].join(' ')}
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Calculator className="h-4 w-4" />}
              텍스트로 분석 (사진 없이)
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
          <p className="text-[11px] text-slate-400">* 개인정보(주민번호·연락처 등)는 입력하지 마세요.</p>
        </div>
      </Card>

      {/* Result */}
      {loading ? (
        <Card title="② 분석 결과" icon={<Sparkles className="h-4 w-4 text-indigo-400" />}>
          <div className="flex items-center gap-2 py-6 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            {fileName ? '서류 이미지를 읽고 예상 보험금을 계산하는 중입니다…' : '약관과 사례를 분석하는 중입니다…'}
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
              <div className="whitespace-pre-wrap rounded-xl border border-slate-200 bg-slate-50 p-4 text-[13px] leading-6 text-slate-100">
                {result.answer}
              </div>
              <p className="text-[11px] text-slate-400">
                분석 소스: {result.source} · AI 추정치이며 실제 지급과 다를 수 있습니다.
              </p>
            </div>
          ) : result.disabled ? (
            <div className="flex items-start gap-2 rounded-lg border border-sky-300/60 bg-sky-50 px-3 py-2.5 text-[13px] leading-6 text-sky-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{result.error ?? 'AI 프록시가 꺼져 있습니다.'} 프록시를 켜면 자동 분석이 됩니다.</span>
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
                  onClick={() => void analyzeText()}
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

      {/* Auto claim draft */}
      {result?.ok ? (
        <Card
          title="③ 자동 청구서 초안"
          icon={<FileCheck2 className="h-4 w-4 text-emerald-500" />}
          action={
            <button
              type="button"
              onClick={copyClaimDraft}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50"
            >
              {claimCopied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
              {claimCopied ? '복사됨' : '청구서 복사'}
            </button>
          }
        >
          <p className="mb-2 text-[11px] text-slate-500">
            분석 결과로 자동 작성된 청구서 초안입니다. 복사해서 실제 청구에 사용하기 전 담보·금액·서류를 확인하세요.
          </p>
          <pre className="whitespace-pre-wrap rounded-xl border border-emerald-200 bg-emerald-50/50 p-4 font-sans text-[13px] leading-6 text-slate-100">
            {buildClaimDraft({
              insurer,
              claimant: selectedCustomer?.name ?? '',
              headline: result.headline,
              incident,
              dateStr: today
            })}
          </pre>
        </Card>
      ) : null}
    </div>
  )
}

/** Copy text to the clipboard and flash a "copied" flag for 2s. */
function writeClipboard(text: string, setFlag: (v: boolean) => void): void {
  const done = (): void => {
    setFlag(true)
    window.setTimeout(() => setFlag(false), 2000)
  }
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    void navigator.clipboard.writeText(text).then(done).catch(done)
  } else {
    done()
  }
}
