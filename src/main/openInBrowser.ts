import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'

/**
 * 특정 브라우저(크롬/엣지)로 https URL 열기 — 보험사 전산처럼 "이 브라우저에서만
 * 도는" 사이트용 (2026-08-05 대표 지시: 크롬 전용 전산은 누르면 크롬으로).
 *
 * SECURITY: https URL만 허용하고, 셸을 거치지 않고 브라우저 실행 파일을
 * spawn(exe, [url])로 직접 실행한다(인자 주입 불가). 위험도는 기존
 * setWindowOpenHandler의 shell.openExternal(안전 URL)과 동급이다.
 * 브라우저가 설치돼 있지 않으면 ok:false — 렌더러가 기본 브라우저로 폴백한다.
 */

export type TargetBrowser = 'chrome' | 'edge'

const CHROME_PATHS = [
  join(process.env['PROGRAMFILES'] ?? 'C:\\Program Files', 'Google\\Chrome\\Application\\chrome.exe'),
  join(process.env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)', 'Google\\Chrome\\Application\\chrome.exe'),
  join(process.env['LOCALAPPDATA'] ?? '', 'Google\\Chrome\\Application\\chrome.exe')
]
const EDGE_PATHS = [
  join(process.env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)', 'Microsoft\\Edge\\Application\\msedge.exe'),
  join(process.env['PROGRAMFILES'] ?? 'C:\\Program Files', 'Microsoft\\Edge\\Application\\msedge.exe')
]

export function openInBrowser(url: unknown, browser: unknown): { ok: boolean } {
  if (typeof url !== 'string' || !/^https:\/\/[^\s]+$/.test(url)) return { ok: false }
  const candidates = browser === 'chrome' ? CHROME_PATHS : browser === 'edge' ? EDGE_PATHS : []
  const exe = candidates.find((p) => p && existsSync(p))
  if (!exe) return { ok: false }
  try {
    const child = spawn(exe, [url], { detached: true, stdio: 'ignore' })
    child.unref()
    return { ok: true }
  } catch {
    return { ok: false }
  }
}
