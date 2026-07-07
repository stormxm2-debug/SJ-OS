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
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { config as loadEnv } from 'dotenv'

// Load sj-ai-proxy/.env explicitly, resolved relative to THIS file (not the
// process cwd), so the proxy reliably picks up OPENAI_* variables regardless of
// where `npm run dev` is launched from. Runs before any process.env read below.
const __dirname = path.dirname(fileURLToPath(import.meta.url))
loadEnv({ path: path.join(__dirname, '.env') })

const SERVICE_NAME = 'SJ OS AI Proxy'
const ENVIRONMENT = process.env.NODE_ENV ?? 'development'
const PORT = Number(process.env.PORT ?? 8787)
const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? ''
const OPENAI_MODEL = process.env.OPENAI_MODEL ?? 'gpt-4o-mini'
const OPENAI_ENABLED = String(process.env.OPENAI_ENABLED ?? 'false').toLowerCase() === 'true'
const REQUEST_TIMEOUT_MS = Number(process.env.OPENAI_TIMEOUT_MS ?? 30000)

// Speech-to-text (Jarvis Voice Mode) — model + upload limits. The renderer
// enforces the recording duration; the byte-size limit is the backend guard.
const OPENAI_STT_MODEL = process.env.OPENAI_STT_MODEL ?? 'gpt-4o-mini-transcribe'
const MAX_AUDIO_SECONDS = Number(process.env.MAX_AUDIO_SECONDS ?? 10)
const MAX_AUDIO_UPLOAD_MB = Number(process.env.MAX_AUDIO_UPLOAD_MB ?? 10)

// Whether a real key is present (never expose the key itself, anywhere).
const API_KEY_CONFIGURED = OPENAI_API_KEY.trim().length > 0
// GPT is truly ready only when explicitly enabled AND a key is configured.
const GPT_READY = OPENAI_ENABLED && API_KEY_CONFIGURED

/**
 * Allowed CORS origins. Prefer ALLOWED_ORIGINS (comma-separated); fall back to
 * the legacy CORS_ORIGIN; default to local dev ports. '*' allows any (dev only).
 */
// Standard local dev renderer origins (Vite on localhost + 127.0.0.1).
const DEV_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:5174',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:5174'
]
const CONFIGURED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? process.env.CORS_ORIGIN ?? '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean)
// In dev, always allow the standard local dev origins PLUS any configured ones,
// so a narrow .env allowlist never blocks localhost/127.0.0.1 during development.
// In production, use only the configured origins (fall back to dev origins if
// none are set, to avoid a fully-closed default).
const ALLOWED_ORIGINS =
  ENVIRONMENT === 'production'
    ? CONFIGURED_ORIGINS.length > 0
      ? CONFIGURED_ORIGINS
      : DEV_ORIGINS
    : Array.from(new Set([...DEV_ORIGINS, ...CONFIGURED_ORIGINS]))

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

/**
 * Expert-domain instructions for modes that must reason from general professional
 * knowledge, NOT the SJ OS snapshot. Kept separate so the snapshot-only
 * BASE_INSTRUCTION never forces "데이터가 없습니다" on a real domain question.
 */
const EXPERT_MODE_INSTRUCTIONS = {
  'insurance-claim':
    '당신은 대한민국 손해보험·생명보험 보험금 청구 및 손해사정 전문가입니다. ' +
    '사용자가 제공한 보험 가입/증권 정보와 사고/청구 내용을 바탕으로, 일반적인 약관 지식과 실무 관행에 근거해 예상 지급 보험금을 분석하세요. ' +
    '반드시 한국어로 답하고, 사용자가 요청한 출력 형식을 지키세요. ' +
    '불확실한 값은 "추정"임을 명시하고, 실제 지급은 약관 심사·손해사정 결과에 따라 달라질 수 있음을 마지막에 안내하세요. ' +
    '확실하지 않은 구체적 약관 조항 번호나 판례 번호를 사실인 것처럼 지어내지 말고, 일반적 담보 유형·관행 수준에서 설명하세요.'
}

/**
 * Compose the full system prompt for a mode. Expert modes (e.g. insurance-claim)
 * bypass the snapshot-only BASE_INSTRUCTION so they can use general professional
 * knowledge; all other modes stay grounded in the SJ OS snapshot.
 */
function systemPromptFor(mode) {
  const expert = EXPERT_MODE_INSTRUCTIONS[mode]
  if (expert) return expert
  const modePrompt = MODE_SYSTEM_PROMPTS[mode] ?? MODE_SYSTEM_PROMPTS['general-assistant']
  return `${BASE_INSTRUCTION}\n\n[모드: ${mode ?? 'general-assistant'}] ${modePrompt}`
}

const app = express()
app.use(express.json({ limit: '256kb' }))

/**
 * True for any local loopback dev origin (localhost / 127.0.0.1 / [::1]) on ANY
 * port. In development, Vite auto-picks the next free port (5173 → 5174 → 5175…)
 * when earlier ones are taken, so a fixed 5173/5174 allowlist can silently block
 * the renderer. Reflecting any loopback origin in dev keeps the local proxy
 * reachable regardless of the chosen dev port. Never used in production.
 */
function isLoopbackDevOrigin(origin) {
  try {
    const { protocol, hostname } = new URL(origin)
    if (protocol !== 'http:' && protocol !== 'https:') return false
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
  } catch {
    return false
  }
}

// Explicit CORS: reflect only allow-listed origins (no wildcard unless set).
// No credentials are used, so we never combine wildcard with credentials.
app.use((req, res, next) => {
  const origin = req.headers.origin
  const devLoopback = ENVIRONMENT !== 'production' && !!origin && isLoopbackDevOrigin(origin)
  if (ALLOWED_ORIGINS.includes('*')) {
    res.setHeader('Access-Control-Allow-Origin', '*')
  } else if (origin && (ALLOWED_ORIGINS.includes(origin) || devLoopback)) {
    // Allow-listed origin, or (dev only) any localhost/127.0.0.1 port.
    res.setHeader('Access-Control-Allow-Origin', origin)
  } else if (origin === 'null' && ENVIRONMENT !== 'production') {
    // Electron / file:// renderer sends `Origin: null` in local dev. Allowed in
    // dev only (never in production) so the desktop app can reach the proxy.
    res.setHeader('Access-Control-Allow-Origin', 'null')
  }
  // Requests with no Origin header (curl, same-origin, server-to-server) need no
  // CORS header and are allowed through by default.
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
    // STT (Jarvis Voice Mode) capability — same enable/key gates as the brain.
    sttModel: OPENAI_STT_MODEL,
    maxAudioSeconds: MAX_AUDIO_SECONDS,
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

let cachedAudioUpload = null
/**
 * Lazily build the multipart audio upload middleware. In-memory storage only —
 * audio is NEVER written to disk. Lazy import keeps /health and the disabled
 * paths working even before `npm install` adds multer.
 */
async function getAudioUpload() {
  if (cachedAudioUpload) return cachedAudioUpload
  const mod = await import('multer')
  const multer = mod.default ?? mod
  cachedAudioUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_AUDIO_UPLOAD_MB * 1024 * 1024, files: 1 }
  }).single('audio')
  return cachedAudioUpload
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
 * POST /ai/transcribe — Jarvis Voice Mode speech-to-text.
 *
 * Input: multipart/form-data with an `audio` file (webm/ogg/mp4…), optional
 * `lang` (default ko) and `mode`/`context` text fields.
 *
 * SAFETY
 *  - The OpenAI API key is read from the environment ONLY and never exposed.
 *  - Audio is held IN MEMORY only (multer memoryStorage) — never written to
 *    disk — and the buffer reference is dropped after the request. No audio
 *    content is ever logged.
 *  - Enable/key gates run BEFORE the upload is parsed, so when STT is off no
 *    audio is buffered at all.
 *  - Disabled by default (OPENAI_ENABLED=false) → clear Korean fallback.
 */
app.post('/ai/transcribe', async (req, res) => {
  // Gate before reading any audio — never buffer audio we won't use.
  if (!OPENAI_ENABLED) {
    res.json({
      success: false,
      source: 'disabled',
      code: 'OPENAI_DISABLED',
      text: '',
      error:
        'STT 프록시가 비활성화되어 있습니다 (OPENAI_ENABLED=false). ' +
        '백엔드 환경변수에서 OPENAI_ENABLED=true 로 설정하세요. API 키는 백엔드에만 두세요.'
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

  let upload
  try {
    upload = await getAudioUpload()
  } catch {
    res.status(503).json({
      success: false,
      source: 'backend',
      code: 'STT_DEPENDENCY_MISSING',
      text: '',
      error: 'STT 업로드 처리를 위한 서버 의존성이 없습니다. sj-ai-proxy 에서 npm install 을 실행하세요.'
    })
    return
  }

  upload(req, res, async (uploadErr) => {
    if (uploadErr) {
      const tooLarge = uploadErr.code === 'LIMIT_FILE_SIZE'
      res.status(tooLarge ? 413 : 400).json({
        success: false,
        source: 'backend',
        code: tooLarge ? 'AUDIO_TOO_LARGE' : 'AUDIO_UPLOAD_ERROR',
        text: '',
        error: tooLarge
          ? `오디오 파일이 너무 큽니다 (최대 ${MAX_AUDIO_UPLOAD_MB}MB).`
          : '오디오 업로드 처리 중 오류가 발생했습니다.'
      })
      return
    }

    const file = req.file
    if (!file || !file.buffer || file.buffer.length === 0) {
      res.status(400).json({
        success: false,
        source: 'backend',
        code: 'AUDIO_MISSING',
        text: '',
        error: '오디오 데이터가 전송되지 않았습니다. audio 필드로 녹음을 업로드하세요.'
      })
      return
    }

    const language =
      typeof req.body?.lang === 'string' && req.body.lang.trim() ? req.body.lang.trim() : 'ko'

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    const startedAt = Date.now()

    try {
      const mod = await import('openai')
      const toFile = mod.toFile ?? mod.default?.toFile
      const client = await getOpenAiClient()
      const audioFile = await toFile(file.buffer, file.originalname || 'audio.webm', {
        type: file.mimetype || 'audio/webm'
      })
      const result = await client.audio.transcriptions.create(
        { file: audioFile, model: OPENAI_STT_MODEL, language },
        { signal: controller.signal }
      )
      const text = (typeof result?.text === 'string' ? result.text : '').trim()
      res.json({
        success: true,
        source: 'openai',
        text,
        model: OPENAI_STT_MODEL,
        durationMs: Date.now() - startedAt
      })
    } catch (error) {
      const aborted = error?.name === 'AbortError'
      res.status(aborted ? 504 : 502).json({
        success: false,
        source: 'openai',
        code: aborted ? 'STT_TIMEOUT' : 'STT_FAILED',
        text: '',
        error: aborted
          ? 'STT 응답이 시간 내에 도착하지 않았습니다. 다시 시도해 주세요.'
          : 'STT 전사 처리 중 오류가 발생했습니다.',
        // OpenAI error message only — never audio content.
        detail: error?.message ?? String(error)
      })
    } finally {
      clearTimeout(timer)
      // Drop the in-memory audio buffer promptly (never stored, never logged).
      if (req.file) req.file.buffer = null
    }
  })
})

app.listen(PORT, () => {
  // Log only booleans/labels — NEVER the API key.
  // eslint-disable-next-line no-console
  console.log(
    `[${SERVICE_NAME}] :${PORT} · env=${ENVIRONMENT} · enabled=${OPENAI_ENABLED} · keyConfigured=${API_KEY_CONFIGURED} · ready=${GPT_READY} · model=${OPENAI_MODEL} · origins=${ALLOWED_ORIGINS.join(',')}`
  )
})
