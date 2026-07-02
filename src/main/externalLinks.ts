import { shell } from 'electron'

/**
 * Approved external-link whitelist for Jarvis external actions.
 *
 * SECURITY: the renderer never sends a raw URL. It sends an approved *key*
 * only; this module maps the key to a hard-coded, vetted URL and opens it with
 * Electron's shell.openExternal. There is no path for arbitrary URL opening,
 * shell execution, or filesystem access — an unknown key is rejected.
 */

export type ExternalLinkKey = 'youtube' | 'naver' | 'google' | 'github'

/** The only URLs Jarvis is ever allowed to open. */
const WHITELIST: Record<ExternalLinkKey, string> = {
  youtube: 'https://www.youtube.com',
  naver: 'https://www.naver.com',
  google: 'https://www.google.com',
  github: 'https://github.com/stormxm2-debug/SJ-OS'
}

export interface ExternalOpenResult {
  ok: boolean
  key?: string
  url?: string
  error?: string
}

function isApprovedKey(value: unknown): value is ExternalLinkKey {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(WHITELIST, value)
}

/**
 * Validate an approved key and open its whitelisted URL in the system browser.
 * Rejects anything that is not an exact whitelist key — including full URLs.
 */
export async function openApprovedExternal(key: unknown): Promise<ExternalOpenResult> {
  if (!isApprovedKey(key)) {
    return { ok: false, error: 'not an approved external link' }
  }
  const url = WHITELIST[key]
  try {
    await shell.openExternal(url)
    return { ok: true, key, url }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'failed to open external URL'
    return { ok: false, key, url, error: message }
  }
}
