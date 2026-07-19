import { getFunctionsBaseUrl, getSupabaseAnonKey, getSupabaseClient, initSupabaseClient } from '@renderer/services/commercial/supabaseClient'

/**
 * AI 콘텐츠 스튜디오 — content-studio edge function 호출.
 *
 * FC의 보험 마케팅 콘텐츠 초안(릴스 대본·SNS 문구·블로그·고객 안내문)을 생성한다.
 * 생성물은 초안일 뿐이며, 보험 광고물은 게시 전 광고심의 절차가 필요하다(화면에 고지).
 * 최근 생성 이력은 기기별 localStorage에만 보관 (DB 없음).
 */

export type ContentKind = 'reels' | 'sns' | 'blog' | 'notice'

export const CONTENT_KIND_LABEL: Record<ContentKind, string> = {
  reels: '릴스 대본',
  sns: '인스타 문구',
  blog: '블로그 초안',
  notice: '고객 안내문'
}

export interface ContentSection {
  label: string
  text: string
}

export interface GeneratedContent {
  title: string
  sections: ContentSection[]
  hashtags: string[]
}

export interface ContentStudioInput {
  kind: ContentKind
  topic: string
  target?: string
  tone?: string
}

export interface ContentStudioResult {
  ok: boolean
  content?: GeneratedContent
  /** 사용자에게 그대로 보여줄 한국어 메시지. */
  error?: string
  notConfigured?: boolean
}

/** Edge Function 인증: 로그인 세션 토큰(없으면 anon). 값은 절대 로깅하지 않음. */
async function functionsBearer(): Promise<string | undefined> {
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

export async function generateContent(input: ContentStudioInput): Promise<ContentStudioResult> {
  const base = getFunctionsBaseUrl()
  const anon = getSupabaseAnonKey()
  if (!base || !anon) return { ok: false, notConfigured: true, error: '서버 연결 후 사용할 수 있습니다.' }

  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), 60000)
  try {
    const token = (await functionsBearer()) ?? anon
    const res = await fetch(`${base}/content-studio`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: anon, Authorization: `Bearer ${token}` },
      body: JSON.stringify(input),
      signal: controller.signal
    })
    const data = (await res.json().catch(() => null)) as {
      success?: boolean
      error?: string
      code?: string
      content?: { title?: unknown; sections?: unknown; hashtags?: unknown }
    } | null
    if (!res.ok || !data?.success || !data.content) {
      const notConfigured = data?.code === 'ANTHROPIC_API_KEY_MISSING' || res.status === 404
      return {
        ok: false,
        notConfigured,
        error: notConfigured ? 'AI 기능 배포 전입니다 — 총괄 배포 후 사용할 수 있습니다.' : data?.error || '생성에 실패했습니다. 다시 시도해 주세요.'
      }
    }
    const c = data.content
    return {
      ok: true,
      content: {
        title: String(c.title ?? ''),
        sections: Array.isArray(c.sections)
          ? c.sections
              .map((s) => ({ label: String((s as ContentSection).label ?? ''), text: String((s as ContentSection).text ?? '') }))
              .filter((s) => s.label && s.text)
          : [],
        hashtags: Array.isArray(c.hashtags) ? c.hashtags.map((h) => String(h)) : []
      }
    }
  } catch (e) {
    const aborted = e instanceof DOMException && e.name === 'AbortError'
    return { ok: false, error: aborted ? '생성 시간 초과 — 다시 시도해 주세요.' : '생성 중 오류가 발생했습니다.' }
  } finally {
    window.clearTimeout(timer)
  }
}

// ---------- 최근 생성 이력 (기기별 localStorage, 최대 10건) ----------

export interface ContentHistoryEntry {
  id: string
  kind: ContentKind
  topic: string
  content: GeneratedContent
  createdAt: string
}

const HISTORY_KEY = 'sj-content-studio-history-v1'
const HISTORY_MAX = 10

export function listHistory(): ContentHistoryEntry[] {
  try {
    const raw = window.localStorage.getItem(HISTORY_KEY)
    const arr: unknown = raw ? JSON.parse(raw) : []
    if (!Array.isArray(arr)) return []
    return arr.filter((e): e is ContentHistoryEntry => Boolean(e && typeof e === 'object' && (e as ContentHistoryEntry).content))
  } catch {
    return []
  }
}

export function pushHistory(entry: Omit<ContentHistoryEntry, 'id' | 'createdAt'>): ContentHistoryEntry[] {
  const next: ContentHistoryEntry[] = [
    { ...entry, id: `ch-${Date.now()}-${Math.floor(Math.random() * 1000)}`, createdAt: new Date().toISOString() },
    ...listHistory()
  ].slice(0, HISTORY_MAX)
  try {
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(next))
  } catch {
    /* 저장 실패해도 생성 결과 표시는 계속 */
  }
  return next
}

/** 생성 결과 → 복사용 일반 텍스트. */
export function contentToText(c: GeneratedContent): string {
  const lines: string[] = [c.title, '']
  for (const s of c.sections) lines.push(`[${s.label}]`, s.text, '')
  if (c.hashtags.length > 0) lines.push(c.hashtags.join(' '))
  return lines.join('\n').trim()
}
