import { getFunctionsBaseUrl, getSupabaseAnonKey, getSupabaseClient, initSupabaseClient } from '@renderer/services/commercial/supabaseClient'

/**
 * AI 이미지 스튜디오 — higgsfield-image edge function 호출.
 *
 * 힉스필드 Z-Image Turbo로 마케팅·안내용 이미지를 생성한다. 키(HIGGSFIELD_API_KEY_ID/SECRET)는
 * Supabase 시크릿에만 두고, 앱은 엣지함수를 통해서만 호출한다(브라우저에 키 노출 금지).
 * 결과 imageUrl은 힉스필드 CDN 주소이며 보관 기간이 있으므로, 필요하면 받는 즉시 저장한다.
 */

export const IMAGE_ASPECT_RATIOS = ['1:1', '3:2', '2:3', '16:9', '9:16', '4:3'] as const
export type ImageAspectRatio = (typeof IMAGE_ASPECT_RATIOS)[number]

export interface ImageStudioInput {
  prompt: string
  aspectRatio?: ImageAspectRatio
  resolution?: '1k' | '2k'
}

export interface ImageStudioResult {
  ok: boolean
  imageUrl?: string
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

export async function generateImage(input: ImageStudioInput): Promise<ImageStudioResult> {
  const base = getFunctionsBaseUrl()
  const anon = getSupabaseAnonKey()
  if (!base || !anon) return { ok: false, notConfigured: true, error: '서버 연결 후 사용할 수 있습니다.' }

  const prompt = input.prompt.trim()
  if (!prompt) return { ok: false, error: '이미지 설명을 입력해주세요.' }

  // 이미지 생성은 폴링 때문에 시간이 더 걸린다 — 넉넉히 대기.
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), 65000)
  try {
    const token = (await functionsBearer()) ?? anon
    const res = await fetch(`${base}/higgsfield-image`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: anon, Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        prompt: prompt.slice(0, 800),
        aspect_ratio: input.aspectRatio ?? '1:1',
        resolution: input.resolution ?? '1k'
      }),
      signal: controller.signal
    })
    const data = (await res.json().catch(() => null)) as { success?: boolean; error?: string; code?: string; imageUrl?: string } | null
    if (!res.ok || !data?.success || !data.imageUrl) {
      const notConfigured = data?.code === 'HIGGSFIELD_KEY_MISSING' || res.status === 404
      return {
        ok: false,
        notConfigured,
        error: notConfigured
          ? '이미지 생성 기능 준비 중입니다 — 총괄 배포·키 등록 후 사용할 수 있습니다.'
          : data?.error || '이미지 생성에 실패했습니다. 다시 시도해 주세요.'
      }
    }
    return { ok: true, imageUrl: data.imageUrl }
  } catch (e) {
    const aborted = e instanceof DOMException && e.name === 'AbortError'
    return { ok: false, error: aborted ? '생성 시간 초과 — 다시 시도해 주세요.' : '생성 중 오류가 발생했습니다.' }
  } finally {
    window.clearTimeout(timer)
  }
}
