import { useMemo, useState } from 'react'
import { BookOpen, Search, Sparkles, Loader2, AlertTriangle, ChevronDown, Lightbulb, MessageCircle } from 'lucide-react'
import Card from '@renderer/components/ui/Card'
import { WIKI_CATEGORIES } from '@renderer/services/wiki/insuranceWiki'
import { getFunctionsBaseUrl, getSupabaseAnonKey, getSupabaseClient, initSupabaseClient } from '@renderer/services/commercial/supabaseClient'

/**
 * 보험 백과사전 — 신입 학습 센터.
 *  - 내장 콘텐츠: 기초 용어 / 상품 종류 / 영업 프로세스 / 실전 화법 / 청구·심사
 *  - AI 선생님: 검색창에 질문 → insurance-tutor edge function이 신입 눈높이 설명 +
 *    실전 화법 팁으로 답변.
 * 검색어는 내장 항목을 즉시 필터링하고, 없거나 더 궁금하면 AI에게 물어본다.
 */

interface TutorAnswer {
  explanation: string
  salesTip: string
}

async function tutorBearer(): Promise<string | undefined> {
  const anon = getSupabaseAnonKey()
  try {
    await initSupabaseClient()
    const client = getSupabaseClient() as {
      auth?: { getSession: () => Promise<{ data?: { session?: { access_token?: string } } }> }
    } | null
    const { data } = (await client?.auth?.getSession()) ?? {}
    return data?.session?.access_token ?? anon
  } catch {
    return anon
  }
}

async function askTutor(question: string): Promise<{ ok: boolean; answer?: TutorAnswer; error?: string }> {
  const base = getFunctionsBaseUrl()
  const anon = getSupabaseAnonKey()
  if (!base || !anon) return { ok: false, error: 'AI 선생님은 서버 연결 후 사용할 수 있습니다.' }
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), 40000)
  try {
    const token = (await tutorBearer()) ?? anon
    const res = await fetch(`${base}/insurance-tutor`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: anon, Authorization: `Bearer ${token}` },
      body: JSON.stringify({ question }),
      signal: controller.signal
    })
    const data = (await res.json().catch(() => null)) as {
      success?: boolean
      error?: string
      answer?: { explanation?: unknown; salesTip?: unknown }
    } | null
    if (!res.ok || !data?.success || !data.answer) return { ok: false, error: data?.error ?? '답변을 받지 못했습니다.' }
    return {
      ok: true,
      answer: { explanation: String(data.answer.explanation ?? ''), salesTip: String(data.answer.salesTip ?? '') }
    }
  } catch {
    return { ok: false, error: '답변 중 오류가 발생했습니다. 다시 시도해 주세요.' }
  } finally {
    window.clearTimeout(timer)
  }
}

export default function InsuranceWikiPage(): JSX.Element {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<string>('all')
  const [openTerm, setOpenTerm] = useState<string | null>(null)

  const [tutorBusy, setTutorBusy] = useState(false)
  const [tutorQ, setTutorQ] = useState('')
  const [tutorA, setTutorA] = useState<TutorAnswer | undefined>()
  const [tutorErr, setTutorErr] = useState<string | undefined>()

  const q = query.trim().toLowerCase()
  const filtered = useMemo(
    () =>
      WIKI_CATEGORIES.map((cat) => ({
        ...cat,
        entries: cat.entries.filter(
          (e) => !q || e.term.toLowerCase().includes(q) || e.definition.toLowerCase().includes(q) || (e.tip ?? '').toLowerCase().includes(q)
        )
      })).filter((cat) => (category === 'all' || cat.key === category) && cat.entries.length > 0),
    [q, category]
  )
  const totalHits = filtered.reduce((s, c) => s + c.entries.length, 0)

  const ask = async (): Promise<void> => {
    const question = (query || tutorQ).trim()
    if (!question) return
    setTutorQ(question)
    setTutorBusy(true)
    setTutorErr(undefined)
    setTutorA(undefined)
    const res = await askTutor(question)
    setTutorBusy(false)
    if (!res.ok || !res.answer) {
      setTutorErr(res.error)
      return
    }
    setTutorA(res.answer)
  }

  return (
    <div className="space-y-4">
      <Card title="보험 백과사전 — 신입 학습 센터" icon={<BookOpen className="h-4 w-4 text-indigo-600" />}>
        <p className="text-[12px] leading-5 text-slate-500">
          기초 용어부터 실전 화법까지 — 검색하면 바로 찾아지고, 없으면 <b className="text-slate-300">AI 선생님</b>이 신입 눈높이로
          설명해 드립니다. <span className="text-slate-600">(일반적인 실무 기준 개요이며 세부 조건은 상품·약관마다 다릅니다)</span>
        </p>

        {/* 검색 + AI 선생님 */}
        <div className="mt-3 flex gap-2">
          <div className="flex flex-1 items-center gap-2 rounded-xl border border-slate-800 bg-white px-3">
            <Search className="h-4 w-4 shrink-0 text-slate-500" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && totalHits === 0) void ask()
              }}
              placeholder='검색 또는 질문 — 예: "단기납 종신이 뭐예요?"'
              className="w-full py-2.5 text-sm text-slate-100 focus:outline-none"
            />
          </div>
          <button
            type="button"
            onClick={() => void ask()}
            disabled={tutorBusy || !query.trim()}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-3.5 py-2 text-xs font-bold text-white shadow-sm transition hover:brightness-110 disabled:opacity-50"
          >
            {tutorBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />} AI 선생님
          </button>
        </div>
        {tutorErr ? (
          <p className="mt-2 flex items-center gap-1 text-[11px] text-rose-600">
            <AlertTriangle className="h-3 w-3" /> {tutorErr}
          </p>
        ) : null}
        {tutorA ? (
          <div className="mt-3 rounded-xl border border-indigo-200 bg-indigo-50/40 p-3">
            <div className="mb-1 flex items-center gap-1.5 text-[11px] font-bold text-indigo-700">
              <Sparkles className="h-3.5 w-3.5" /> AI 선생님 — “{tutorQ}”
            </div>
            <p className="text-[13px] leading-6 text-slate-200">{tutorA.explanation}</p>
            {tutorA.salesTip ? (
              <div className="mt-2 flex items-start gap-1.5 rounded-lg bg-white px-3 py-2 text-[12px] leading-5 text-slate-300">
                <MessageCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-indigo-500" />
                <span>
                  <b className="text-slate-100">실전 화법</b> — {tutorA.salesTip}
                </span>
              </div>
            ) : null}
          </div>
        ) : null}

        {/* 카테고리 칩 */}
        <div className="mt-3 flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setCategory('all')}
            className={[
              'rounded-full px-3 py-1.5 text-[12px] font-semibold transition',
              category === 'all' ? 'bg-indigo-50 text-indigo-700 ring-2 ring-indigo-400' : 'border border-slate-800 bg-white text-slate-400 hover:text-slate-200'
            ].join(' ')}
          >
            전체
          </button>
          {WIKI_CATEGORIES.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => setCategory(c.key)}
              className={[
                'rounded-full px-3 py-1.5 text-[12px] font-semibold transition',
                category === c.key ? 'bg-indigo-50 text-indigo-700 ring-2 ring-indigo-400' : 'border border-slate-800 bg-white text-slate-400 hover:text-slate-200'
              ].join(' ')}
            >
              {c.emojiLabel} <span className="text-[10px] text-slate-500">{c.entries.length}</span>
            </button>
          ))}
        </div>
      </Card>

      {/* 항목 목록 */}
      {filtered.length === 0 ? (
        <Card title="검색 결과 없음" icon={<Search className="h-4 w-4 text-slate-500" />}>
          <p className="text-[13px] text-slate-400">
            “{query}” 에 해당하는 내장 항목이 없습니다 — 위의 <b className="text-indigo-600">AI 선생님</b> 버튼을 눌러 물어보세요!
          </p>
        </Card>
      ) : (
        filtered.map((cat) => (
          <Card key={cat.key} title={cat.emojiLabel} icon={<BookOpen className="h-4 w-4 text-indigo-600" />}>
            <div className="space-y-1.5">
              {cat.entries.map((e) => {
                const open = openTerm === `${cat.key}:${e.term}`
                return (
                  <div key={e.term} className="overflow-hidden rounded-xl border border-slate-800 bg-white">
                    <button
                      type="button"
                      onClick={() => setOpenTerm(open ? null : `${cat.key}:${e.term}`)}
                      className="flex w-full items-center justify-between px-3.5 py-2.5 text-left"
                    >
                      <span className="text-sm font-semibold text-slate-100">{e.term}</span>
                      <ChevronDown className={['h-4 w-4 text-slate-500 transition', open ? 'rotate-180' : ''].join(' ')} />
                    </button>
                    {open ? (
                      <div className="border-t border-slate-800 px-3.5 py-2.5">
                        <p className="text-[13px] leading-6 text-slate-300">{e.definition}</p>
                        {e.tip ? (
                          <div className="mt-2 flex items-start gap-1.5 rounded-lg bg-indigo-50/60 px-3 py-2 text-[12px] leading-5 text-indigo-800">
                            <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {e.tip}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                )
              })}
            </div>
          </Card>
        ))
      )}
    </div>
  )
}
