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

const SERVICE_NAME = 'SJ OS AI Proxy'
const ENVIRONMENT = process.env.NODE_ENV ?? 'development'
const PORT = Number(process.env.PORT ?? 8787)
const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? ''
const OPENAI_MODEL = process.env.OPENAI_MODEL ?? 'gpt-4o-mini'
const OPENAI_ENABLED = String(process.env.OPENAI_ENABLED ?? 'false').toLowerCase() === 'true'
const REQUEST_TIMEOUT_MS = Number(process.env.OPENAI_TIMEOUT_MS ?? 30000)

// Whether a real key is present (never expose the key itself, anywhere).
const API_KEY_CONFIGURED = OPENAI_API_KEY.trim().length > 0
// GPT is truly ready only when explicitly enabled AND a key is configured.
const GPT_READY = OPENAI_ENABLED && API_KEY_CONFIGURED

/**
 * Allowed CORS origins. Prefer ALLOWED_ORIGINS (comma-separated); fall back to
 * the legacy CORS_ORIGIN; default to local dev ports. '*' allows any (dev only).
 */
const ALLOWED_ORIGINS = (
  process.env.ALLOWED_ORIGINS ??
  process.env.CORS_ORIGIN ??
  'http://localhost:5173,http://localhost:5174'
)
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean)

/**
 * Shared instruction applied to every mode (Sprint 4 GPT prompt contract).
 * Jarvis answers in Korean, concise but useful, from a CEO/operator viewpoint,
 * action-oriented, grounded ONLY in the provided SJ OS context — and says when
 * data is missing instead of inventing real-world numbers.
 */
const BASE_INSTRUCTION =
  '당신은 SJ Invest의 CEO 커맨드 센터를 돕는 AI 비서 "자비스"입니다. ' +
  '반드시 한국어로, 간결하지만 실질적으로 답하세요. CEO/운영자 관점에서 실행 가능한 조언을 제시하고, ' +
  '가능하면 마지막에 "권장 다음 액션:" 한 줄을 덧붙이세요. ' +
  '반드시 제공된 SJ OS 컨텍스트(snapshot)에 근거해서만 답하고, 컨텍스트에 없는 정보는 "데이터가 없습니다"라고 명확히 말하세요. ' +
  '실제 세계의 수치나 사실을 지어내지 마세요.'

/** GPT modes the Jarvis brain can request. Each maps to a Korean system prompt. */
const MODE_SYSTEM_PROMPTS = {
  'business-briefing':
    '제공된 로컬 SJ OS 요약 데이터만 근거로 간결한 경영 브리핑을 작성합니다. 핵심 지표와 리스크, 우선순위를 정리하세요.',
  strategy:
    '제공된 SJ OS 컨텍스트를 근거로 운영/영업 전략을 제안합니다. 문제를 진단하고 구체적이고 실행 가능한 전략 옵션을 제시하세요.',
  'data-question':
    '제공된 로컬 SJ OS 요약 데이터만 근거로 질문에 답합니다. 데이터에 없는 내용은 모른다고 말하세요.',
  'implementation-planning':
    'SJ OS의 제품/개발 기획을 돕습니다. 요청받은 기능을 안전하고 점진적인 스프린트 단위로 분해해 제안합니다. 실제 코드 실행이나 배포는 하지 않으며, 계획과 권장 다음 액션만 제시합니다.',
  'general-assistant': 'CEO를 돕는 실용적이고 간결한 어시스턴트로서 답하세요.',
  'unknown-fallback': '명령이 모호하면 무엇을 도와줄 수 있는지 간단히 안내하세요.'
}

/** Compose the full system prompt for a mode. */
function systemPromptFor(mode) {
  const modePrompt = MODE_SYSTEM_PROMPTS[mode] ?? MODE_SYSTEM_PROMPTS['general-assistant']
  return `${BASE_INSTRUCTION}\n\n[모드: ${mode ?? 'general-assistant'}] ${modePrompt}`
}

const app = express()
app.use(express.json({ limit: '256kb' }))

// Explicit CORS: reflect only allow-listed origins (no wildcard unless set).
app.use((req, res, next) => {
  const origin = req.headers.origin
  if (ALLOWED_ORIGINS.includes('*')) {
    res.setHeader('Access-Control-Allow-Origin', '*')
  } else if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
  }
  res.setHeader('Vary', 'Origin')
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
    service: SERVICE_NAME,
    status: 'ok',
    openaiEnabled: OPENAI_ENABLED,
    apiKeyConfigured: API_KEY_CONFIGURED,
    model: OPENAI_MODEL,
    environment: ENVIRONMENT,
    timestamp: new Date().toISOString()
  })
})

/**
 * Diagnostic status — does NOT call OpenAI and NEVER exposes the key. Reports
 * whether the brain is enabled, whether a key is configured, and readiness.
 */
app.get('/ai/status', (_req, res) => {
  const message = !OPENAI_ENABLED
    ? 'GPT 프록시가 비활성화되어 있습니다 (OPENAI_ENABLED=false).'
    : !API_KEY_CONFIGURED
      ? 'OPENAI_ENABLED=true 이지만 OPENAI_API_KEY 가 설정되지 않았습니다.'
      : 'GPT 프록시가 준비되었습니다.'
  res.json({
    service: SERVICE_NAME,
    enabled: OPENAI_ENABLED,
    apiKeyConfigured: API_KEY_CONFIGURED,
    model: OPENAI_MODEL,
    ready: GPT_READY,
    environment: ENVIRONMENT,
    timestamp: new Date().toISOString(),
    message
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

  // Disabled → safe fallback (never fail hard, never leak config).
  if (!OPENAI_ENABLED) {
    res.json(fallbackResponse(mode, 'disabled'))
    return
  }

  // Enabled but no key → explicit setup error (safe, no secret exposure).
  if (!API_KEY_CONFIGURED) {
    res.status(503).json({
      success: false,
      source: 'backend',
      code: 'OPENAI_API_KEY_MISSING',
      error:
        'OPENAI_ENABLED=true 이지만 OPENAI_API_KEY 가 설정되지 않았습니다. ' +
        '백엔드 환경변수에 API 키를 설정하세요 (프론트엔드에는 절대 입력하지 마세요).',
      mode: mode ?? 'unknown-fallback',
      model: OPENAI_MODEL
    })
    return
  }

  const systemPrompt = systemPromptFor(mode)

  // Sprint 4 contract: context = { app, role, snapshot }. Accept a plain object,
  // a JSON/string context, and the legacy top-level localSnapshot for back-compat.
  let app = 'SJ OS'
  let role = 'CEO command center'
  let snapshot = localSnapshot
  if (context && typeof context === 'object') {
    app = context.app ?? app
    role = context.role ?? role
    snapshot = context.snapshot ?? snapshot
  } else if (typeof context === 'string' && context.trim()) {
    snapshot = snapshot ?? context
  }

  const contextBlock = [
    `앱: ${app} · 역할: ${role}`,
    snapshot
      ? `SJ OS 컨텍스트(민감정보 제외, 집계/상태만):\n${
          typeof snapshot === 'string' ? snapshot : JSON.stringify(snapshot, null, 2)
        }`
      : 'SJ OS 컨텍스트: (제공되지 않음)'
  ].join('\n\n')

  const userContent = `${contextBlock}\n\n질문/명령:\n${message}`

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
      source: 'openai',
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
      source: 'openai',
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

/**
 * POST /ai/transcribe — safe, disabled-by-default STT (speech-to-text) endpoint.
 *
 * SAFETY
 *  - We do NOT parse, read, log, or store the uploaded audio body in this stub.
 *    express.json only parses application/json, so a multipart audio upload is
 *    ignored entirely here — nothing is buffered to disk or memory beyond the
 *    request lifecycle, and no audio content is logged.
 *  - Disabled by default (OPENAI_ENABLED=false) → returns a clear fallback.
 *  - Enabled but no key → explicit OPENAI_API_KEY_MISSING (no secret exposure).
 *  - Enabled + key → real Whisper transcription is intentionally deferred to a
 *    future sprint (needs multipart upload handling); we report that honestly
 *    instead of adding upload dependencies now.
 */
app.post('/ai/transcribe', (_req, res) => {
  if (!OPENAI_ENABLED) {
    res.json({
      success: false,
      source: 'disabled',
      code: 'STT_DISABLED',
      text: '',
      error:
        'STT 프록시가 아직 활성화되지 않았습니다. OpenAI API 키는 백엔드에서만 설정해야 합니다.'
    })
    return
  }

  if (!API_KEY_CONFIGURED) {
    res.status(503).json({
      success: false,
      source: 'backend',
      code: 'OPENAI_API_KEY_MISSING',
      text: '',
      error:
        'OPENAI_ENABLED=true 이지만 OPENAI_API_KEY 가 설정되지 않았습니다. ' +
        '백엔드 환경변수에 API 키를 설정하세요 (프론트엔드에는 절대 입력하지 마세요).'
    })
    return
  }

  // Enabled + key present, but transcription is not wired up yet.
  res.status(501).json({
    success: false,
    source: 'backend',
    code: 'STT_NOT_IMPLEMENTED',
    text: '',
    error:
      'STT 전사(transcription)는 아직 구현되지 않았습니다. ' +
      '다음 스프린트에서 안전한 파일 업로드 처리와 Whisper 연동을 추가할 예정입니다.'
  })
})

app.listen(PORT, () => {
  // Log only booleans/labels — NEVER the API key.
  // eslint-disable-next-line no-console
  console.log(
    `[${SERVICE_NAME}] :${PORT} · env=${ENVIRONMENT} · enabled=${OPENAI_ENABLED} · keyConfigured=${API_KEY_CONFIGURED} · ready=${GPT_READY} · model=${OPENAI_MODEL} · origins=${ALLOWED_ORIGINS.join(',')}`
  )
})
