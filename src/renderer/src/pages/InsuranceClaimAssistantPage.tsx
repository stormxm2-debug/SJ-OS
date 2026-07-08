import { useRef, useState, type ChangeEvent, type DragEvent } from 'react'
import {
  ShieldCheck,
  Loader2,
  AlertTriangle,
  Copy,
  Check,
  Sparkles,
  ReceiptText,
  UploadCloud,
  FileText,
  Image as ImageIcon,
  X
} from 'lucide-react'
import Card from '@renderer/components/ui/Card'
import { analyzeClaim, type ClaimEstimate } from '@renderer/services/insurance-claim/insuranceClaimService'

/**
 * 보험금 청구비서 (Insurance Claim Assistant) — document-only.
 *
 * Flow: drag & drop (or pick) ONE OR MORE documents (PDF·이미지: 증권·약관·진단서·
 * 영수증) → Claude reads them all and returns a customer-ready summary: 예상 총 보험금,
 * 해당 보장 항목, 지급 근거(왜 받는지), 고객 안내 요약, 주의사항. No manual info entry.
 * Documents are sent to the backend proxy (Anthropic key stays server-side), analyzed
 * in memory, and never stored.
 */
export default function InsuranceClaimAssistantPage(): JSX.Element {
  const [files, setFiles] = useState<File[]>([])
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<ClaimEstimate | null>(null)
  const [copied, setCopied] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const supported = (f: File): boolean => f.type === 'application/pdf' || f.type.startsWith('image/')

  const addFiles = (incoming: FileList | File[]): void => {
    const list = Array.from(incoming)
    const ok = list.filter(supported)
    setFiles((prev) => {
      const seen = new Set(prev.map((f) => `${f.name}:${f.size}`))
      const merged = [...prev]
      for (const f of ok) {
        const key = `${f.name}:${f.size}`
        if (!seen.has(key)) {
          seen.add(key)
          merged.push(f)
        }
      }
      return merged.slice(0, 10)
    })
  }

  const removeFile = (idx: number): void => setFiles((prev) => prev.filter((_, i) => i !== idx))

  const onPick = (e: ChangeEvent<HTMLInputElement>): void => {
    if (e.target.files) addFiles(e.target.files)
    e.target.value = ''
  }
  const onDrop = (e: DragEvent<HTMLDivElement>): void => {
    e.preventDefault()
    setDragOver(false)
    if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files)
  }

  const analyze = async (): Promise<void> => {
    if (files.length === 0) return
    setLoading(true)
    setResult(null)
    try {
      setResult(await analyzeClaim({ files }))
    } finally {
      setLoading(false)
    }
  }

  const copyResult = (): void => {
    if (!result?.answer) return
    writeClipboard(result.answer, setCopied)
  }

  const totalMb = Math.round(files.reduce((s, f) => s + f.size, 0) / 1024 / 1024)

  return (
    <div className="space-y-5">
      {/* Intro */}
      <Card title="보험금 청구비서" icon={<ShieldCheck className="h-4 w-4 text-indigo-600" />}>
        <p className="text-sm leading-6 text-slate-300">
          고객 서류(<span className="font-semibold text-slate-100">증권·약관·진단서·영수증</span>)를{' '}
          <span className="font-semibold text-slate-100">여러 장 한꺼번에</span> 올리면, Claude가 모두 읽어{' '}
          <span className="font-semibold text-indigo-600">총 얼마를 받는지 · 어떤 보장에 해당하는지 · 왜 받는지</span>를
          고객 안내용 요약으로 만들어 드립니다. 별도 입력은 필요 없습니다.
        </p>
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] leading-5 text-amber-800">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            결과는 AI 추정치이며 실제 지급액은 약관 심사·손해사정 결과에 따라 달라질 수 있습니다. 서류는 서버에 저장되지
            않고 분석 후 즉시 폐기됩니다. 주민번호 등 민감정보가 보이는 서류는 주의해서 사용하세요.
          </span>
        </div>
      </Card>

      {/* Upload — drag & drop, multiple */}
      <Card title="서류 올리기" icon={<UploadCloud className="h-4 w-4 text-indigo-600" />}>
        <div
          role="button"
          tabIndex={0}
          onClick={() => fileInputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click()
          }}
          onDragOver={(e) => {
            e.preventDefault()
            setDragOver(true)
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          className={[
            'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-6 py-10 text-center transition',
            dragOver
              ? 'border-indigo-500 bg-indigo-50'
              : 'border-slate-700 bg-slate-950 hover:border-indigo-400 hover:bg-indigo-50/40'
          ].join(' ')}
        >
          <UploadCloud className={['h-9 w-9', dragOver ? 'text-indigo-600' : 'text-slate-500'].join(' ')} />
          <div className="text-sm font-semibold text-slate-100">
            여기로 서류를 드래그하거나 <span className="text-indigo-600">클릭해서 선택</span>
          </div>
          <div className="text-[11px] text-slate-500">
            PDF · 이미지(JPG/PNG) · <span className="font-medium">여러 개 동시 업로드</span> (최대 10개)
          </div>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf,image/*"
          multiple
          onChange={onPick}
          className="hidden"
        />

        {/* File chips */}
        {files.length > 0 ? (
          <div className="mt-4 space-y-2">
            <div className="flex items-center justify-between text-[11px] font-medium text-slate-500">
              <span>업로드된 서류 {files.length}개 · {totalMb}MB</span>
              <button type="button" onClick={() => setFiles([])} className="text-slate-400 hover:text-rose-600">
                모두 지우기
              </button>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {files.map((f, i) => {
                const isPdf = f.type === 'application/pdf'
                return (
                  <div
                    key={`${f.name}:${f.size}:${i}`}
                    className="flex items-center gap-2 rounded-lg border border-slate-800 bg-white px-3 py-2"
                  >
                    <span className={['flex h-8 w-8 shrink-0 items-center justify-center rounded-md', isPdf ? 'bg-rose-50 text-rose-600' : 'bg-sky-50 text-sky-600'].join(' ')}>
                      {isPdf ? <FileText className="h-4 w-4" /> : <ImageIcon className="h-4 w-4" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[12px] font-medium text-slate-200">{f.name}</div>
                      <div className="text-[10px] text-slate-500">{Math.round(f.size / 1024)}KB · {isPdf ? 'PDF' : '이미지'}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeFile(i)}
                      aria-label="삭제"
                      className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-rose-600"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        ) : null}

        {/* Analyze */}
        <div className="mt-4">
          <button
            type="button"
            onClick={() => void analyze()}
            disabled={files.length === 0 || loading}
            className={[
              'inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-bold transition sm:w-auto',
              files.length > 0 && !loading
                ? 'bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-sm shadow-indigo-500/30 hover:brightness-110'
                : 'cursor-not-allowed bg-slate-200 text-slate-400'
            ].join(' ')}
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {loading ? '분석 중…' : `${files.length > 0 ? files.length + '개 ' : ''}서류 분석하기`}
          </button>
        </div>
      </Card>

      {/* Result */}
      {loading ? (
        <Card title="분석 결과" icon={<Sparkles className="h-4 w-4 text-indigo-600" />}>
          <div className="flex items-center gap-2 py-6 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            서류 {files.length}개를 읽고 예상 보험금·보장 항목·지급 근거를 정리하는 중입니다…
          </div>
        </Card>
      ) : result ? (
        <Card
          title="분석 결과"
          icon={<Sparkles className="h-4 w-4 text-indigo-600" />}
          action={
            result.ok ? (
              <button
                type="button"
                onClick={copyResult}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-800 bg-white px-3 py-1.5 text-xs font-medium text-slate-300 transition hover:bg-slate-950"
              >
                {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? '복사됨' : '요약 복사'}
              </button>
            ) : undefined
          }
        >
          {result.ok ? (
            <div className="space-y-4">
              {result.headline ? (
                <div className="flex items-center gap-3 rounded-xl border border-indigo-200 bg-gradient-to-r from-indigo-50 to-violet-50 px-4 py-3">
                  <ReceiptText className="h-6 w-6 shrink-0 text-indigo-600" />
                  <div className="text-base font-bold text-indigo-800">{result.headline}</div>
                </div>
              ) : null}
              <div className="whitespace-pre-wrap rounded-xl border border-slate-800 bg-slate-950 p-4 text-[13px] leading-6 text-slate-100">
                {result.answer}
              </div>
              <p className="text-[11px] text-slate-500">
                분석 소스: {result.source} · AI 추정치이며 실제 지급과 다를 수 있습니다.
              </p>
            </div>
          ) : result.disabled ? (
            <div className="flex items-start gap-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2.5 text-[13px] leading-6 text-sky-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{result.error ?? 'AI 분석이 비활성화되어 있습니다.'} 관리자에게 Claude(ANTHROPIC) 키 설정을 요청하면 자동 분석이 켜집니다.</span>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-[13px] leading-6 text-rose-700">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{result.error ?? '분석에 실패했습니다.'}</span>
              </div>
              {result.canRetry ? (
                <button
                  type="button"
                  onClick={() => void analyze()}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-indigo-500"
                >
                  <Loader2 className="h-3.5 w-3.5" /> 다시 시도
                </button>
              ) : null}
            </div>
          )}
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
