/**
 * Jarvis External Action Mode — opens APPROVED external links only.
 *
 * SECURITY: the renderer holds no URLs. It sends an approved *key* to the main
 * process via the preload bridge (window.sj.external.open), which validates the
 * key against its whitelist and calls shell.openExternal. There is no path here
 * for arbitrary URL opening, shell execution, or filesystem access.
 */

export type ExternalKey = 'youtube' | 'naver' | 'google' | 'github'

/** Display labels for the approved keys (URLs live only in the main process). */
export const EXTERNAL_LABELS: Record<ExternalKey, string> = {
  youtube: 'YouTube',
  naver: 'Naver',
  google: 'Google',
  github: 'SJ OS GitHub'
}

export interface ExternalOpenResult {
  ok: boolean
  key?: string
  url?: string
  error?: string
}

export default class ExternalActionService {
  labelFor(key: string): string {
    return (EXTERNAL_LABELS as Record<string, string>)[key] ?? key
  }

  /** Ask the main process to open an approved link by key. */
  async open(key: string): Promise<ExternalOpenResult> {
    if (typeof window === 'undefined' || !window.sj?.external?.open) {
      return { ok: false, error: '외부 링크 브리지를 사용할 수 없습니다 (데스크톱 앱에서만 지원).' }
    }
    try {
      return await window.sj.external.open(key)
    } catch (error) {
      const message = error instanceof Error ? error.message : '외부 링크 열기에 실패했습니다.'
      return { ok: false, error: message }
    }
  }
}
