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
