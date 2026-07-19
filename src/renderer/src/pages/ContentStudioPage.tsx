import { useState } from 'react'
import { Clapperboard, Sparkles, Copy, Check, ExternalLink, Loader2, AlertTriangle, History } from 'lucide-react'
import {
  generateContent,
  listHistory,
  pushHistory,
  contentToText,
  CONTENT_KIND_LABEL,
  type ContentKind,
  type GeneratedContent,
  type ContentHistoryEntry
} from '@renderer/services/content-studio/contentStudioService'
import { copyText } from '@renderer/services/share/clipboard'

/**
 * AI 콘텐츠 스튜디오 — 주제 입력 → 릴스 대본·SNS 문구·블로그·고객 안내문 초안 생성
 * (content-studio edge fn) + 영상 제작 외부 도구 바로가기.
 *
 * 생성물은 초안: 보험 광고물은 게시 전 광고심의가 필요하다는 고지를 항상 표시한다.
 * 이력은 기기별 localStorage 10건 (DB 없음).
 */

const KINDS: ContentKind[] = ['reels', 'sns', 'blog', 'notice']

const TARGETS = ['2030 사회초년생', '3040 자녀 부모', '자영업자', '5060 은퇴 준비']
const TONES = ['친근하게', '전문가답게', '짧고 강렬하게']

const TOPIC_PLACEHOLDER: Record<ContentKind, string> = {
  reels: '예: 실손보험 청구, 이것만 알면 5분 만에 끝',
  sns: '예: 어린이보험, 가입 시기가 왜 중요한지',
  blog: '예: 유병자도 가능한 간편심사 보험 총정리',
  notice: '예: 보험료 납입 유예 제도 안내'
}

/** 영상 제작 파이프라인 외부 도구 (기획→영상→음성→편집 순). */
const TOOLS: { name: string; desc: string; href: string }[] = [
  { name: 'Google Flow (Veo)', desc: 'AI 영상 생성 — 대본 장면을 영상으로', href: 'https://labs.google/flow' },
  { name: 'Kling AI', desc: '인물 중심 AI 영상 생성', href: 'https://klingai.com' },
  { name: 'ElevenLabs', desc: 'AI 음성(내레이션) 생성', href: 'https://elevenlabs.io' },
  { name: 'CapCut', desc: '자막·컷 최종 편집', href: 'https://www.capcut.com/ko-kr' }
]

export default function ContentStudioPage(): JSX.Element {
  const [kind, setKind] = useState<ContentKind>('reels')
  const [topic, setTopic] = useState('')
  const [target, setTarget] = useState<string | undefined>()
  const [tone, setTone] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [result, setResult] = useState<GeneratedContent | undefined>()
  const [resultKind, setResultKind] = useState<ContentKind>('reels')
  const [history, setHistory] = useState<ContentHistoryEntry[]>(() => listHistory())
  const [copied, setCopied] = useState<string | undefined>()

  const run = async (): Promise<void> => {
    if (!topic.trim() || busy) return
    setBusy(true)
    setError(undefined)
    const res = await generateContent({ kind, topic: topic.trim(), target, tone })
    setBusy(false)
    if (!res.ok || !res.content) {
      setError(res.error ?? '생성에 실패했습니다.')
      return
    }
    setResult(res.content)
    setResultKind(kind)
    setHistory(pushHistory({ kind, topic: topic.trim(), content: res.content }))
  }

  /**
   * 복사 — 표준 Clipboard API가 막힌 인앱 브라우저(카톡 등)에서는 execCommand 폴백까지
   * 시도한다(services/share/clipboard). 실제 성공했을 때만 '복사됨'을 표시한다.
   */
  const copy = async (key: string, text: string): Promise<void> => {
    const ok = await copyText(text)
    if (!ok) {
      setError('복사가 차단됐습니다. 카톡 등 앱 안의 브라우저면 우측 상단 메뉴에서 "다른 브라우저로 열기" 후 다시 시도하거나, 아래 글을 길게 눌러 직접 복사해 주세요.')
      return
    }
    setError(undefined)
    setCopied(key)
    window.setTimeout(() => setCopied((c) => (c === key ? undefined : c)), 2500)
  }

  const openHistory = (h: ContentHistoryEntry): void => {
    setResult(h.content)
    setResultKind(h.kind)
    setKind(h.kind)
    setTopic(h.topic)
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      {/* 헤더 — 딥네이비 + 골드 */}
      <div
        className="relative overflow-hidden rounded-2xl p-5 text-white"
        style={{
          background:
            'radial-gradient(480px 180px at 90% -30%, rgba(198,152,47,0.2), rgba(198,152,47,0) 60%), linear-gradient(120deg, #0e1e3a 0%, #16294b 70%, #1d2f57 100%)'
        }}
      >
        <div className="pointer-events-none absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-[#c6982f] to-transparent opacity-80" />
        <div className="flex items-center gap-2">
          <Clapperboard className="h-5 w-5 text-[#e6c877]" />
          <h1 className="text-lg font-bold">AI 콘텐츠 스튜디오</h1>
        </div>
        <p className="mt-1 text-xs text-white/60">
          주제만 넣으면 릴스 대본·SNS 문구·안내문 초안을 AI가 만듭니다. 기획은 여기서, 영상 제작은 아래 도구로.
        </p>
      </div>

      {/* 입력 폼 */}
      <section className="rounded-2xl border border-slate-800 bg-white p-4">
        <div className="mb-1.5 text-[11px] font-medium text-slate-500">콘텐츠 유형</div>
        <div className="mb-3 flex flex-wrap gap-1.5">
          {KINDS.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              className={[
                'rounded-full border px-3 py-1.5 text-[12px] font-semibold transition',
                kind === k ? 'border-[#c6982f] bg-[#fdf7ea] text-[#8a6a1f]' : 'border-slate-800 bg-white text-slate-400 hover:border-[#c6982f]/50'
              ].join(' ')}
            >
              {CONTENT_KIND_LABEL[k]}
            </button>
          ))}
        </div>

        <div className="mb-1.5 text-[11px] font-medium text-slate-500">주제 (구체적일수록 좋아요)</div>
        <input
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void run()
          }}
          placeholder={TOPIC_PLACEHOLDER[kind]}
          className="mb-3 w-full rounded-xl border border-slate-800 bg-white px-3 py-2.5 text-sm text-slate-100 focus:border-[#c6982f] focus:outline-none"
        />

        <div className="mb-1.5 text-[11px] font-medium text-slate-500">타깃 (선택)</div>
        <div className="mb-3 flex flex-wrap gap-1.5">
          {TARGETS.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTarget((cur) => (cur === t ? undefined : t))}
              className={[
                'rounded-full border px-2.5 py-1 text-[11px] font-medium transition',
                target === t ? 'border-indigo-400 bg-indigo-50 font-bold text-indigo-700' : 'border-slate-800 bg-white text-slate-400'
              ].join(' ')}
            >
              {t}
            </button>
          ))}
        </div>

        <div className="mb-1.5 text-[11px] font-medium text-slate-500">톤 (선택)</div>
        <div className="mb-4 flex flex-wrap gap-1.5">
          {TONES.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTone((cur) => (cur === t ? undefined : t))}
              className={[
                'rounded-full border px-2.5 py-1 text-[11px] font-medium transition',
                tone === t ? 'border-indigo-400 bg-indigo-50 font-bold text-indigo-700' : 'border-slate-800 bg-white text-slate-400'
              ].join(' ')}
            >
              {t}
            </button>
          ))}
        </div>

        {error ? <p className="mb-2 text-[12px] text-rose-600">{error}</p> : null}
        <button
          type="button"
          onClick={() => void run()}
          disabled={busy || !topic.trim()}
          className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#0e1e3a] to-[#1b3a6b] px-5 py-2.5 text-sm font-bold text-[#e6c877] shadow-sm transition hover:brightness-110 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {busy ? 'AI가 만드는 중…' : `${CONTENT_KIND_LABEL[kind]} 만들기`}
        </button>
      </section>

      {/* 결과 */}
      {result ? (
        <section className="rounded-2xl border border-[#c6982f]/40 bg-white p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <span className="mr-1.5 rounded-full bg-[#0e1e3a] px-2 py-0.5 text-[10px] font-bold text-[#e6c877]">
                {CONTENT_KIND_LABEL[resultKind]}
              </span>
              <span className="text-sm font-bold text-slate-100">{result.title}</span>
            </div>
            <button
              type="button"
              onClick={() => void copy('all', contentToText(result))}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-[#c6982f] px-3 py-1.5 text-[12px] font-bold text-[#201603] transition hover:brightness-110"
            >
              {copied === 'all' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied === 'all' ? '복사됨' : '전체 복사'}
            </button>
          </div>

          <div className="space-y-2.5">
            {result.sections.map((s, i) => (
              <div key={`${s.label}-${i}`} className="rounded-xl border border-slate-800 bg-white p-3">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="text-[11px] font-bold text-[#8a6a1f]">{s.label}</span>
                  <button
                    type="button"
                    onClick={() => void copy(`s-${i}`, s.text)}
                    className="text-slate-400 transition hover:text-slate-200"
                    aria-label={`${s.label} 복사`}
                  >
                    {copied === `s-${i}` ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                  </button>
                </div>
                <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-slate-100">{s.text}</p>
              </div>
            ))}
          </div>

          {result.hashtags.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {result.hashtags.map((h) => (
                <span key={h} className="rounded-full bg-slate-950 px-2 py-0.5 text-[11px] font-medium text-indigo-600">
                  {h}
                </span>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      {/* 광고심의 고지 */}
      <div className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-[12px] text-amber-800">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          AI가 만든 <b>초안</b>입니다. 보험 관련 광고물은 게시 전 <b>협회 광고심의·준법감시 확인</b>이 필요합니다 — 수치·보장 내용은
          반드시 약관과 대조하세요.
        </span>
      </div>

      {/* 영상 제작 도구 바로가기 */}
      <section className="rounded-2xl border border-slate-800 bg-white p-4">
        <h2 className="mb-3 text-sm font-bold text-slate-100">영상 제작 도구 바로가기</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          {TOOLS.map((t) => (
            <button
              key={t.name}
              type="button"
              onClick={() => window.open(t.href, '_blank', 'noopener')}
              className="flex items-center justify-between gap-2 rounded-xl border border-slate-800 bg-white px-3 py-2.5 text-left transition hover:border-[#c6982f]/60"
            >
              <span className="min-w-0">
                <span className="block text-[13px] font-bold text-slate-100">{t.name}</span>
                <span className="block truncate text-[11px] text-slate-500">{t.desc}</span>
              </span>
              <ExternalLink className="h-4 w-4 shrink-0 text-[#c6982f]" />
            </button>
          ))}
        </div>
        <p className="mt-2 text-[10px] text-slate-500">외부 서비스는 별도 계정·요금이 필요할 수 있습니다. 대본을 복사해 붙여넣어 사용하세요.</p>
      </section>

      {/* 최근 생성 이력 */}
      {history.length > 0 ? (
        <section className="rounded-2xl border border-slate-800 bg-white p-4">
          <h2 className="mb-2 flex items-center gap-1.5 text-sm font-bold text-slate-100">
            <History className="h-4 w-4 text-[#c6982f]" /> 최근 생성 <span className="text-[11px] font-normal text-slate-500">(이 기기, 최대 10건)</span>
          </h2>
          <ul className="space-y-1">
            {history.map((h) => (
              <li key={h.id}>
                <button
                  type="button"
                  onClick={() => openHistory(h)}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition hover:bg-slate-950"
                >
                  <span className="shrink-0 rounded bg-slate-950 px-1.5 py-0.5 text-[10px] font-bold text-slate-400">
                    {CONTENT_KIND_LABEL[h.kind]}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[12px] text-slate-300">{h.topic}</span>
                  <span className="shrink-0 text-[10px] text-slate-500">{h.createdAt.slice(5, 10)}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}
