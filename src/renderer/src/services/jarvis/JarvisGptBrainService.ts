import { contextBuilder } from './ContextBuilder'
import type { SjOsSnapshot } from './ContextBuilder'

/**
 * Jarvis GPT Brain Service (renderer side).
 *
 * Talks to the SJ OS AI Proxy (POST /ai/chat) — it NEVER holds or sends an
 * OpenAI API key. The key lives only in the backend proxy. This client only
 * knows the proxy URL and whether the CEO has enabled the GPT brain.
 *
 * Responsibilities: build a sanitized local snapshot, call the proxy with a
 * timeout, and degrade gracefully (disabled hint / Korean error + retry).
 */

export type GptMode =
  | 'business-briefing'
  | 'strategy'
  | 'data-question'
  | 'implementation-planning'
  | 'general-assistant'
  | 'unknown-fallback'

export type GptSource = 'gpt' | 'fallback' | 'disabled' | 'error'

export interface GptBrainResult {
  success: boolean
  source: GptSource
  answer: string
  mode: GptMode
  model?: string
  usage?: unknown
  /** True when the proxy/brain is turned off (setup guidance should show). */
  disabled?: boolean
  /** Present on failures. */
  error?: string
  /** True when a retry is safe (network/timeout/proxy errors). */
  canRetry?: boolean
}

interface AiChatResponse {
  success: boolean
  source?: GptSource
  answer?: string
  mode?: string
  model?: string
  usage?: unknown
  disabled?: boolean
  error?: string
}

/** Read renderer config from Vite env (non-secret values only). */
function readEnv(key: string): string | undefined {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env
  return env?.[key]
}

const DEFAULT_PROXY_URL = 'http://localhost:8787'
const REQUEST_TIMEOUT_MS = 20000

export interface GptBrainConfig {
  enabled: boolean
  proxyUrl: string
  modelLabel: string
}

export class JarvisGptBrainService {
  getConfig(): GptBrainConfig {
    return {
      enabled: String(readEnv('VITE_AI_PROXY_ENABLED') ?? 'false').toLowerCase() === 'true',
      proxyUrl: readEnv('VITE_AI_PROXY_URL') ?? DEFAULT_PROXY_URL,
      modelLabel: readEnv('VITE_AI_PROXY_MODEL_LABEL') ?? '서버 설정 (server-side)'
    }
  }

  isEnabled(): boolean {
    return this.getConfig().enabled
  }

  /** Heuristic: pick the GPT mode best suited to a free-form command. */
  selectMode(command: string): GptMode {
    const c = command.toLowerCase()
    const has = (words: string[]): boolean => words.some((w) => command.includes(w) || c.includes(w))
    if (has(['브리핑', '상황', '요약', '정리해'])) return 'business-briefing'
    if (has(['sprint', '스프린트', '구현', '기능 추천', '기능', '나눠', '로드맵', '설계'])) {
      return 'implementation-planning'
    }
    if (has(['전략', '방안', '개선'])) return 'strategy'
    if (has(['실적', '문제', '현황', '분석', '왜'])) return 'data-question'
    return 'general-assistant'
  }

  private disabledResult(mode: GptMode): GptBrainResult {
    return {
      success: false,
      source: 'disabled',
      disabled: true,
      mode,
      canRetry: false,
      answer:
        '[GPT proxy disabled fallback]\n' +
        'GPT 브레인이 아직 활성화되지 않았습니다. 로컬 자비스 명령(일정/실적/출근/네비게이션 등)은 그대로 사용할 수 있습니다.\n' +
        '활성화하려면: (1) 백엔드 프록시에서 OPENAI_ENABLED=true 와 OPENAI_API_KEY 를 설정하고, ' +
        '(2) 렌더러 환경변수 VITE_AI_PROXY_ENABLED=true 및 VITE_AI_PROXY_URL 을 설정하세요.\n' +
        'OpenAI API 키는 반드시 백엔드에만 두세요 — SJ OS 프론트엔드에는 절대 넣지 마세요.'
    }
  }

  /**
   * Ask the GPT brain. Builds a sanitized snapshot, calls the proxy with a
   * timeout, and returns a normalized result. Never throws.
   */
  async ask(command: string, mode?: GptMode): Promise<GptBrainResult> {
    const resolvedMode = mode ?? this.selectMode(command)
    const config = this.getConfig()
    if (!config.enabled) {
      return this.disabledResult(resolvedMode)
    }

    let snapshot: SjOsSnapshot | null = null
    try {
      snapshot = contextBuilder.buildSnapshot()
    } catch {
      // Snapshot is best-effort context; proceed without it if it fails.
      snapshot = null
    }

    const controller = new AbortController()
    const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

    try {
      const response = await fetch(`${config.proxyUrl.replace(/\/$/, '')}/ai/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // GPT prompt contract (Sprint 4): context is an object with app/role/snapshot.
        body: JSON.stringify({
          message: command,
          mode: resolvedMode,
          context: {
            app: 'SJ OS',
            role: 'CEO command center',
            snapshot: snapshot ?? {}
          }
        }),
        signal: controller.signal
      })

      if (!response.ok) {
        return {
          success: false,
          source: 'error',
          mode: resolvedMode,
          canRetry: true,
          error: `GPT 프록시 응답 오류 (HTTP ${response.status}). 잠시 후 다시 시도해 주세요.`,
          answer: 'GPT 응답을 받지 못했습니다.'
        }
      }

      const data = (await response.json()) as AiChatResponse
      const normalizedMode = (data.mode as GptMode) ?? resolvedMode
      if (data.success) {
        return {
          success: true,
          source: (data.source as GptSource) ?? 'gpt',
          mode: normalizedMode,
          model: data.model,
          usage: data.usage,
          disabled: data.disabled,
          answer: data.answer ?? '응답이 비어 있습니다.'
        }
      }
      return {
        success: false,
        source: (data.source as GptSource) ?? 'error',
        mode: normalizedMode,
        canRetry: true,
        error: data.error ?? 'GPT 요청이 실패했습니다.',
        answer: data.answer ?? 'GPT 응답을 받지 못했습니다.'
      }
    } catch (error) {
      const aborted = error instanceof DOMException && error.name === 'AbortError'
      return {
        success: false,
        source: 'error',
        mode: resolvedMode,
        canRetry: true,
        error: aborted
          ? 'GPT 응답이 시간 내에 도착하지 않았습니다 (타임아웃). 다시 시도해 주세요.'
          : 'GPT 프록시에 연결할 수 없습니다. 프록시가 실행 중인지 확인해 주세요.',
        answer: 'GPT 브레인에 연결하지 못했습니다.'
      }
    } finally {
      window.clearTimeout(timer)
    }
  }
}

export const jarvisGptBrainService = new JarvisGptBrainService()
export default JarvisGptBrainService
