/**
 * Shared contract for the approved deployment runner.
 *
 * Deployment runs ONLY the existing `npm run deploy` script (if package.json
 * defines one), from the Electron MAIN process, after explicit user approval and
 * a passing preflight. The renderer never runs shell commands and never supplies a
 * command/script/cwd/args — only a release item id. No platform settings, no .env,
 * no secrets are touched.
 */

import type { VerificationStatus } from './claudeAutoBuild'

export type DeploymentStatus =
  | 'not-ready'
  | 'approval-required'
  | 'approved'
  | 'preflight-running'
  | 'preflight-passed'
  | 'preflight-failed'
  | 'deploying'
  | 'deployed'
  | 'failed'
  | 'cancelled'
  | 'blocked'

export interface DeployPreflight {
  typecheckStatus: VerificationStatus
  buildStatus: VerificationStatus
  gitStatusShort: string
  packageDeployScriptExists: boolean
}

export interface DeploymentRun {
  id: string
  releaseItemId: string
  sourceJobId?: string
  title: string
  status: DeploymentStatus
  workspacePath: string
  deployScriptName: 'deploy'
  startedAt?: string
  finishedAt?: string
  exitCode?: number
  logLines: string[]
  preflight?: DeployPreflight
  errorMessage?: string
}

export interface DeploymentRunUpdate {
  run: DeploymentRun
}

/**
 * Mask secret-looking values in a log line so they are never shown. Covers
 * `sk-…`, `sk-ant-…`, and `OPENAI_API_KEY=…` / `ANTHROPIC_API_KEY=…`.
 */
export function maskSecrets(text: string): string {
  return text
    .replace(/sk-ant-[A-Za-z0-9_-]{6,}/g, 'sk-ant-***')
    .replace(/sk-[A-Za-z0-9_-]{6,}/g, 'sk-***')
    .replace(/((?:OPENAI|ANTHROPIC)_API_KEY\s*[=:]\s*)['"]?[^\s'"]+/gi, '$1***')
}

// --- deployment profile / deploy-script manager ----------------------------

export type DeployTarget =
  | 'local-build'
  | 'netlify'
  | 'render'
  | 'vercel'
  | 'cloudflare'
  | 'custom-existing-script'
  | 'unknown'

export type DeployProfileStatus =
  | 'not-configured'
  | 'draft'
  | 'approval-required'
  | 'approved'
  | 'applied'
  | 'blocked'
  | 'failed'

/** Read-only snapshot of package.json's relevant scripts. */
export interface PackageScriptsInfo {
  deployScript?: string
  buildScript?: string
  typecheckScript?: string
  hasDeploy: boolean
  hasBuild: boolean
  hasTypecheck: boolean
  detectedTool: DeployTarget
}

export interface DeployScriptValidation {
  safe: boolean
  reasons: string[]
}

export interface ApplyDeployScriptResult {
  applied: boolean
  scripts: PackageScriptsInfo
  validation: DeployScriptValidation
  errorMessage?: string
}

/** Detect the deploy tool a script appears to use (display/planning only). */
export function detectDeployTool(script?: string): DeployTarget {
  const s = (script ?? '').toLowerCase()
  if (!s) return 'unknown'
  if (s.includes('netlify')) return 'netlify'
  if (s.includes('vercel')) return 'vercel'
  if (s.includes('render')) return 'render'
  if (s.includes('wrangler') || s.includes('cloudflare')) return 'cloudflare'
  if (s === 'npm run build' || s.includes('electron-vite build') || s.includes('electron-builder')) return 'local-build'
  return 'custom-existing-script'
}

/** Destructive / secret patterns that block a deploy script from being applied. */
const UNSAFE_SCRIPT_PATTERNS: { re: RegExp; why: string }[] = [
  { re: /\brm\s+-rf?\b/i, why: 'rm 삭제 명령' },
  { re: /\brmdir\b/i, why: 'rmdir 삭제 명령' },
  { re: /\bdel\s+\/[sq]/i, why: 'del /s 삭제 명령' },
  { re: /\bformat\b/i, why: 'format 명령' },
  { re: /git\s+reset\s+--hard/i, why: 'git reset --hard' },
  { re: /git\s+clean\s+-[a-z]*f/i, why: 'git clean -fd' },
  { re: /push\s+(--force|-f)\b/i, why: '강제 푸시' },
  { re: /Remove-Item/i, why: 'Remove-Item' },
  { re: /-Recurse/i, why: '-Recurse 삭제' },
  { re: /\.env(\.local)?\b/i, why: '.env 편집 시도' },
  { re: /sk-[A-Za-z0-9_-]{6,}/, why: '비밀 키 값(sk-)' },
  { re: /(OPENAI|ANTHROPIC)_API_KEY\s*=/i, why: 'API 키 값' },
  { re: /curl[^\n]*sk-/i, why: '시크릿을 포함한 curl' }
]

/** Validate a candidate deploy script before applying it to package.json. */
export function validateDeployScript(script: string): DeployScriptValidation {
  const s = (script ?? '').trim()
  const reasons: string[] = []
  if (!s) reasons.push('빈 스크립트')
  if (s.length > 400) reasons.push('스크립트가 너무 깁니다.')
  for (const p of UNSAFE_SCRIPT_PATTERNS) if (p.re.test(s)) reasons.push(`차단: ${p.why}`)
  return { safe: reasons.length === 0, reasons }
}
