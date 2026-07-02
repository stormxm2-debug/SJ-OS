/**
 * SJ OS AI Proxy — a minimal, secure backend for the Jarvis GPT brain.
 *
 * SECURITY MODEL
 *  - The OpenAI API key lives ONLY in this backend process, read from the
 *    OPENAI_API_KEY environment variable. It is NEVER sent to, stored in, or
 *    readable by the SJ OS renderer/frontend.
 *  - The renderer calls POST /ai/chat with a message + a small, already
 *    sanitized local snapshot. This proxy adds the key and talks to OpenAI.
 *  - Disabled by default (OPENAI_ENABLED=false). When disabled or when no key
 *    is present, /ai/chat returns a safe fallback instead of failing hard.
 *
 * Endpoints
 *  - GET  /health   → liveness + whether the GPT brain is enabled
 *  - POST /ai/chat  → { message, mode, context, localSnapshot, conversationId? }
 *
 * The OpenAI SDK is imported lazily so the server (and /health, and the
 * disabled fallback path) run with zero external calls even before deps are
 * installed. Install deps with:  cd sj-ai-proxy && npm install
 */

import express from 'express'

const PORT = Number(process.env.PORT ?? 8787)
const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? ''
const OPENAI_MODEL = process.env.OPENAI_MODEL ?? 'gpt-4o-mini'
const OPENAI_ENABLED = String(process.env.OPENAI_ENABLED ?? 'false').toLowerCase() === 'true'
// Comma-separated allowlist of renderer origins; '*' allows any (dev only).
const CORS_ORIGIN = process.env.CORS_ORIGIN ?? '*'
const REQUEST_TIMEOUT_MS = Number(process.env.OPENAI_TIMEOUT_MS ?? 20000)

/** GPT modes the Jarvis brain can request. Each maps to a Korean system prompt. */
const MODE_SYSTEM_PROMPTS = {
  'business-briefing':
    '당신은 SJ Invest의 AI 비서 "자비스"입니다. 제공된 로컬 SJ OS 요약 데이터만 근거로 간결한 경영 브리핑을 작성합니다. 추측하지 말고, 핵심 지표와 리스크, 권장 다음 액션을 한국어로 정리하세요.',
  'data-question':
    '당신은 SJ Invest의 AI 비서 "자비스"입니다. 제공된 로컬 SJ OS 요약 데이터만 근거로 질문에 답합니다. 데이터에 없는 내용은 모른다고 말하고, 한국어로 간결하게 답하세요.',
  'implementation-planning':
    '당신은 SJ OS의 제품/개발 기획 보조입니다. 요청받은 기능을 안전하고 점진적인 스프린트 단위로 분해해 한국어로 제안합니다. 실제 코드 실행이나 배포는 하지 않으며, 계획과 권장 다음 액션만 제시합니다.',
  'general-assistant':
    '당신은 SJ Invest의 AI 비서 "자비스"입니다. CEO를 돕는 실용적이고 간결한 한국어 어시스턴트로서 답하세요.',
  'unknown-fallback':
    '당신은 SJ Invest의 AI 비서 "자비스"입니다. 명령이 모호하면 무엇을 도와줄 수 있는지 한국어로 간단히 안내하세요.'
}

const app = express()
app.use(express.json({ limit: '256kb' }))

// Minimal, explicit CORS for the Electron renderer.
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', CORS_ORIGIN)
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') {
    res.sendStatus(204)
    return
  }
  next()
})

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'sj-ai-proxy',
    enabled: OPENAI_ENABLED && Boolean(OPENAI_API_KEY),
    model: OPENAI_MODEL
  })
})

/** Build the disabled/fallback answer (no OpenAI call). */
function fallbackResponse(mode, reason) {
  return {
    success: true,
    source: 'fallback',
    answer:
      'GPT 브레인이 비활성화되어 있어 로컬 자비스 기능만 사용할 수 있습니다. ' +
      'OpenAI 프록시를 사용하려면 백엔드에서 OPENAI_ENABLED=true 와 OPENAI_API_KEY 를 설정하세요.',
    mode: mode ?? 'unknown-fallback',
    model: OPENAI_MODEL,
    disabled: true,
    reason
  }
}

let cachedClient = null
async function getOpenAiClient() {
  if (cachedClient) return cachedClient
  // Lazy import so the server runs even before `openai` is installed.
  const mod = await import('openai')
  const OpenAI = mod.default ?? mod.OpenAI
  cachedClient = new OpenAI({ apiKey: OPENAI_API_KEY })
  return cachedClient
}

app.post('/ai/chat', async (req, res) => {
  const { message, mode, context, localSnapshot, conversationId } = req.body ?? {}

  if (typeof message !== 'string' || message.trim().length === 0) {
    res.status(400).json({
      success: false,
      error: 'message 필드는 비어 있을 수 없습니다.',
      mode: mode ?? 'unknown-fallback',
      model: OPENAI_MODEL
    })
    return
  }

  // Disabled or no key → safe fallback (never fail hard, never leak config).
  if (!OPENAI_ENABLED || !OPENAI_API_KEY) {
    res.json(fallbackResponse(mode, !OPENAI_ENABLED ? 'disabled' : 'missing-api-key'))
    return
  }

  const systemPrompt = MODE_SYSTEM_PROMPTS[mode] ?? MODE_SYSTEM_PROMPTS['general-assistant']
  const contextBlock = [
    context ? `요청 맥락:\n${typeof context === 'string' ? context : JSON.stringify(context)}` : '',
    localSnapshot
      ? `로컬 SJ OS 요약(민감정보 제외):\n${
          typeof localSnapshot === 'string' ? localSnapshot : JSON.stringify(localSnapshot)
        }`
      : ''
  ]
    .filter(Boolean)
    .join('\n\n')

  const userContent = contextBlock ? `${contextBlock}\n\n질문/명령:\n${message}` : message

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const client = await getOpenAiClient()
    const completion = await client.chat.completions.create(
      {
        model: OPENAI_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent }
        ],
        temperature: 0.4
      },
      { signal: controller.signal }
    )

    const answer = completion.choices?.[0]?.message?.content?.trim() ?? ''
    res.json({
      success: true,
      source: 'gpt',
      answer: answer || '응답을 생성하지 못했습니다.',
      mode: mode ?? 'general-assistant',
      model: completion.model ?? OPENAI_MODEL,
      usage: completion.usage ?? undefined,
      conversationId: conversationId ?? undefined
    })
  } catch (error) {
    const aborted = error?.name === 'AbortError'
    res.status(aborted ? 504 : 502).json({
      success: false,
      source: 'gpt',
      error: aborted
        ? 'GPT 응답이 시간 내에 도착하지 않았습니다. 잠시 후 다시 시도해 주세요.'
        : 'GPT 요청 처리 중 오류가 발생했습니다.',
      detail: error?.message ?? String(error),
      mode: mode ?? 'general-assistant',
      model: OPENAI_MODEL
    })
  } finally {
    clearTimeout(timer)
  }
})

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(
    `[sj-ai-proxy] listening on :${PORT} · enabled=${OPENAI_ENABLED && Boolean(OPENAI_API_KEY)} · model=${OPENAI_MODEL}`
  )
})
