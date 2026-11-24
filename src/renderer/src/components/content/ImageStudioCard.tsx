import { useState } from 'react'
import { Image as ImageIcon, Sparkles, Loader2, ExternalLink, Copy, Check, AlertTriangle } from 'lucide-react'
import {
  generateImage,
  IMAGE_ASPECT_RATIOS,
  type ImageAspectRatio
} from '@renderer/services/content-studio/imageStudioService'
import { copyText } from '@renderer/services/share/clipboard'

/**
 * AI 이미지 생성 카드 — 콘텐츠 스튜디오에서 사용.
 * 프롬프트 + 비율 선택 → 힉스필드(higgsfield-image fn)로 이미지 생성 → 미리보기·열기·URL 복사.
 * 생성물은 초안이며, 보험 광고물은 게시 전 광고심의가 필요하다는 고지를 표시한다.
 */

const RATIO_HINT: Record<ImageAspectRatio, string> = {
  '1:1': '정방형 (피드)',
  '3:2': '가로',
  '2:3': '세로',
  '16:9': '와이드 (썸네일)',
  '9:16': '세로 (릴스·스토리)',
  '4:3': '가로'
}

export default function ImageStudioCard(): JSX.Element {
  const [prompt, setPrompt] = useState('')
  const [ratio, setRatio] = useState<ImageAspectRatio>('1:1')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [imageUrl, setImageUrl] = useState<string | undefined>()
  const [copied, setCopied] = useState(false)

  const run = async (): Promise<void> => {
    if (!prompt.trim() || busy) return
    setBusy(true)
    setError(undefined)
    const res = await generateImage({ prompt: prompt.trim(), aspectRatio: ratio })
    setBusy(false)
    if (!res.ok || !res.imageUrl) {
      setError(res.error ?? '이미지 생성에 실패했습니다.')
      return
    }
    setImageUrl(res.imageUrl)
  }

  const copyUrl = async (): Promise<void> => {
    if (!imageUrl) return
    const ok = await copyText(imageUrl)
    if (ok) {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    }
  }

  return (
    <div className="rounded-2xl border border-slate-800 bg-white p-4 shadow-sm">
      <div className="mb-1 flex items-center gap-1.5 text-sm font-extrabold text-slate-100">
        <ImageIcon className="h-4 w-4 text-[#c6982f]" /> AI 이미지 생성
        <span className="rounded-full bg-[#0e1e3a] px-2 py-0.5 text-[10px] font-bold text-[#e6c877]">힉스필드</span>
      </div>
      <p className="mb-3 text-[12px] leading-5 text-slate-500">
        콘텐츠에 넣을 이미지를 설명하면 바로 만들어 드립니다. (예: &ldquo;따뜻한 느낌의 가족 보험 상담 일러스트, 네이비·골드 톤, 글자 없음&rdquo;)
      </p>

      <label className="block">
        <span className="mb-1 block text-[11px] font-semibold text-slate-500">이미지 설명 (프롬프트)</span>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={3}
          maxLength={800}
          placeholder="예: 깔끔한 사무실에서 미소 짓는 보험 설계사, 플랫 일러스트, 네이비·골드 톤, 글자 없음"
          className="w-full rounded-xl border border-slate-800 bg-slate-950 p-2.5 text-[13px] leading-5 text-slate-100 outline-none placeholder:text-slate-500 focus:border-[#c6982f]"
        />
      </label>

      <div className="mt-2">
        <span className="mb-1 block text-[11px] font-semibold text-slate-500">비율</span>
        <div className="flex flex-wrap gap-1.5">
          {IMAGE_ASPECT_RATIOS.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRatio(r)}
              className={[
                'rounded-full px-3 py-1.5 text-[11px] font-bold transition',
                r === ratio ? 'bg-[#0e1e3a] text-[#e6c877]' : 'border border-slate-800 bg-white text-slate-400 hover:text-slate-200'
              ].join(' ')}
            >
              {r} <span className="font-medium text-slate-500">· {RATIO_HINT[r]}</span>
            </button>
          ))}
        </div>
      </div>

      <button
        type="button"
        onClick={() => void run()}
        disabled={busy || !prompt.trim()}
        className={[
          'mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-xl px-3 py-2.5 text-[13px] font-extrabold transition',
          busy || !prompt.trim() ? 'cursor-not-allowed bg-slate-200 text-slate-400' : 'bg-gradient-to-r from-[#0e1e3a] to-[#1b3a6b] text-[#e6c877] hover:brightness-125'
        ].join(' ')}
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
        {busy ? '이미지 생성 중… (최대 1분)' : '이미지 생성'}
      </button>

      {error ? (
        <div className="mt-2 flex items-start gap-1.5 rounded-lg bg-rose-50 px-3 py-2 text-[12px] font-medium text-rose-600">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}
        </div>
      ) : null}

      {imageUrl ? (
        <div className="mt-3">
          <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-950">
            <img src={imageUrl} alt="생성된 이미지" className="h-auto w-full object-contain" />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <a
              href={imageUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-lg bg-[#0e1e3a] px-3 py-1.5 text-[12px] font-bold text-[#e6c877] hover:brightness-125"
            >
              <ExternalLink className="h-3.5 w-3.5" /> 열기 / 저장
            </a>
            <button
              type="button"
              onClick={() => void copyUrl()}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-800 bg-white px-3 py-1.5 text-[12px] font-bold text-slate-300 hover:bg-slate-950"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />} {copied ? '복사됨' : 'URL 복사'}
            </button>
          </div>
          <p className="mt-1.5 text-[11px] text-slate-500">※ 이미지 주소는 보관 기간이 있어요. 필요하면 받는 즉시 저장하세요.</p>
        </div>
      ) : null}

      <p className="mt-3 text-[11px] leading-4 text-slate-500">
        ⚠ 생성물은 초안입니다. 보험 광고·마케팅에 사용할 경우 게시 전 <b className="text-slate-300">광고심의</b>를 거쳐야 하며, 실존 인물·브랜드·상표를 그대로 묘사하지 마세요.
      </p>
    </div>
  )
}
