import {
  getFunctionsBaseUrl,
  getSupabaseAnonKey,
  getSupabaseClient,
  initSupabaseClient
} from '@renderer/services/commercial/supabaseClient'
import type { ConversationEntry } from './types'

/**
 * 자비스 브레인 (jarvis-brain edge function) 클라이언트 — Claude 기반 자유 대화.
 *
 * 규칙 기반 로컬 라우터가 못 알아듣는 명령의 1순위 폴백. 최근 대화 맥락을 함께
 * 보내 챗GPT처럼 이어지는 대화가 되고, 응답에 실행 액션(화면 이동)과 후속 추천이
 * 붙는다. Anthropic 키는 서버 시크릿에만 존재하며 대화는 서버에 저장되지 않는다.
 */

export interface JarvisBrainReply {
  ok: boolean
  reply?: string
  /** 검증된 이동 대상 라우트 (허용 목록 밖이면 null). */
  navigate?: string | null
  suggested?: string[]
  error?: string
  /** 서버 미배포/미설정 — 다음 폴백(GPT 프록시/로컬 안내)으로 넘어가라는 신호. */
  disabled?: boolean
}

/** 클라이언트 측 이동 허용 목록 — 서버 화이트리스트와 이중 게이트. */
const ALLOWED_NAV = new Set([
  'staff-home', 'attendance', 'customer', 'consultation', 'schedule', 'shared-schedule',
  'performance', 'sales-activity', 'insurance-analysis', 'claim-assistant', 'wiki',
  'underwriting', 'pre-underwriting', 'contacts', 'notice',
  'dashboard', 'autopilot', 'cto', 'qa', 'release', 'devops',
  'pm', 'backlog', 'workers', 'projects', 'approvals',
  'app-builder', 'devprompt', 'staff-overview', 'staff-table', 'registration-admin'
])

async function bearer(): Promise<string | undefined> {
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

export class JarvisBrainService {
  /** Supabase 미설정(로컬 데모 등)이면 브레인은 조용히 비활성. */
  isConfigured(): boolean {
    return Boolean(getFunctionsBaseUrl() && getSupabaseAnonKey())
  }

  /**
   * 최근 대화(현재 명령 포함)를 브레인에 보낸다. 어떤 실패에서도 throw하지
   * 않는다 — 미배포(404)/미설정은 disabled로 표시해 폴백 체인이 이어지게 한다.
   */
  async chat(history: ConversationEntry[], mode: 'staff' | 'ceo', context = ''): Promise<JarvisBrainReply> {
    const base = getFunctionsBaseUrl()
    const anon = getSupabaseAnonKey()
    if (!base || !anon) return { ok: false, disabled: true, error: '서버 미설정' }

    const messages = history
      .slice(-12)
      .map((e) => ({ role: e.role, content: e.content }))
      .filter((m) => m.content.trim().length > 0)

    const controller = new AbortController()
    const timer = window.setTimeout(() => controller.abort(), 60000)
    try {
      const token = (await bearer()) ?? anon
      const res = await fetch(`${base}/jarvis-brain`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: anon, Authorization: `Bearer ${token}` },
        body: JSON.stringify({ messages, mode, context: context.slice(0, 4000) }),
        signal: controller.signal
      })
      const data = (await res.json().catch(() => null)) as Record<string, unknown> | null
      if (!res.ok || !data?.success) {
        const disabled = res.status === 404 || data?.code === 'ANTHROPIC_API_KEY_MISSING'
        return { ok: false, disabled, error: String(data?.error ?? `브레인 요청 실패 (HTTP ${res.status})`) }
      }
      const result = (data.result ?? {}) as Record<string, unknown>
      const reply = String(result.reply ?? '').trim()
      if (!reply) return { ok: false, error: '브레인 응답이 비어 있습니다.' }
      const navRaw = typeof result.navigate === 'string' ? result.navigate : null
      return {
        ok: true,
        reply,
        navigate: navRaw && ALLOWED_NAV.has(navRaw) ? navRaw : null,
        suggested: (Array.isArray(result.suggested) ? result.suggested : []).map(String).filter(Boolean).slice(0, 4)
      }
    } catch (e) {
      const aborted = e instanceof DOMException && e.name === 'AbortError'
      return { ok: false, error: aborted ? '응답 시간이 초과되었습니다.' : '브레인 서버에 연결할 수 없습니다.' }
    } finally {
      window.clearTimeout(timer)
    }
  }
}

export const jarvisBrainService = new JarvisBrainService()
export default JarvisBrainService
