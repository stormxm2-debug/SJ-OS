/**
 * Jarvis External Action Mode — opens APPROVED external links only.
 *
 * SECURITY: the renderer holds no URLs. It sends an approved *key* to the main
 * process via the preload bridge (window.sj.external.open), which validates the
 * key against its whitelist and calls shell.openExternal. There is no path here
 * for arbitrary URL opening, shell execution, or filesystem access.
 */

export type ExternalKey = 'youtube' | 'naver' | 'google' | 'github'

/** Display labels (Korean) for the approved keys — UI + 음성 확인 문구에 사용. */
export const EXTERNAL_LABELS: Record<ExternalKey, string> = {
  youtube: '유튜브',
  naver: '네이버',
  google: '구글',
  github: 'SJ OS 깃허브'
}

/**
 * WEB/모바일 폴백용 공개 URL 화이트리스트. Electron에서는 메인 프로세스가
 * 화이트리스트를 검증(URL은 렌더러에 없음)하지만, 웹 앱에는 메인 프로세스가
 * 없으므로 이 공개·무해 URL 목록으로 새 탭에서 연다. 임의 URL 열기 경로는 없다.
 */
const WEB_URLS: Record<ExternalKey, string> = {
  youtube: 'https://www.youtube.com',
  naver: 'https://www.naver.com',
  google: 'https://www.google.com',
  github: 'https://github.com'
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

  /**
   * 승인된 링크를 연다. 데스크톱(Electron)은 메인 프로세스 브리지(화이트리스트
   * 검증)로, 웹/모바일은 공개 URL을 새 탭으로 여는 폴백을 쓴다.
   */
  async open(key: string): Promise<ExternalOpenResult> {
    if (typeof window === 'undefined') {
      return { ok: false, error: '외부 링크를 열 수 없습니다.' }
    }
    // ① Electron 브리지 (메인 프로세스가 URL 화이트리스트 검증).
    if (window.sj?.external?.open) {
      try {
        return await window.sj.external.open(key)
      } catch (error) {
        const message = error instanceof Error ? error.message : '외부 링크 열기에 실패했습니다.'
        return { ok: false, error: message }
      }
    }
    // ② 웹/모바일 폴백 — 공개·무해 URL만 새 탭으로.
    const url = WEB_URLS[key as ExternalKey]
    if (!url) return { ok: false, error: '지원하지 않는 링크입니다.' }
    try {
      window.open(url, '_blank', 'noopener,noreferrer')
      // 팝업 차단 여부와 무관하게 시도는 완료 — 사용자에게 명확히 확인해 준다.
      return { ok: true, key, url }
    } catch {
      return { ok: false, error: '브라우저에서 링크를 열지 못했습니다.', key, url }
    }
  }
}
