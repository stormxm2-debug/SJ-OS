import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Environment loading for the Electron Main AI Gateway.
 *
 * The OpenAI API key and gateway settings come from the SJ OS ROOT `.env`
 * (preferred) or from `process.env`. We read the root `.env` directly with a
 * tiny parser rather than pulling in a dotenv dependency, so `npm run dev` needs
 * no extra install and the main process stays lean.
 *
 * SECURITY: the parsed API key never leaves the main process. `readGatewayEnv`
 * exposes it ONLY inside this module's return value; callers outside must use
 * `getGatewayConfig`, which surfaces booleans/labels but not the key.
 */

/** Defaults mirror sj-ai-proxy so behaviour is identical across transports. */
const DEFAULTS = {
  OPENAI_ENABLED: 'false',
  OPENAI_MODEL: 'gpt-4o-mini',
  OPENAI_STT_MODEL: 'gpt-4o-mini-transcribe',
  MAX_AUDIO_SECONDS: '10',
  MAX_AUDIO_UPLOAD_MB: '10',
  OPENAI_TIMEOUT_MS: '30000'
} as const

/**
 * Parse a minimal `.env` file: `KEY=VALUE` per line, `#` comments and blank
 * lines ignored, surrounding single/double quotes stripped. Never throws — a
 * missing/unreadable file yields an empty map.
 */
function parseEnvFile(filePath: string): Record<string, string> {
  const out: Record<string, string> = {}
  let raw: string
  try {
    raw = readFileSync(filePath, 'utf8')
  } catch {
    return out
  }
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (key) out[key] = value
  }
  return out
}

/** Candidate root directories where the SJ OS `.env` may live, in priority order. */
export function candidateEnvDirs(extraRoots: string[] = []): string[] {
  const dirs = [...extraRoots, process.cwd()]
  return Array.from(new Set(dirs.filter(Boolean)))
}

/** Resolve a value: root `.env` first (if present), then process.env, then default. */
function pick(
  fileEnv: Record<string, string>,
  key: keyof typeof DEFAULTS | 'OPENAI_API_KEY'
): string {
  const fromFile = fileEnv[key]
  if (typeof fromFile === 'string' && fromFile.length > 0) return fromFile
  const fromProcess = process.env[key]
  if (typeof fromProcess === 'string' && fromProcess.length > 0) return fromProcess
  return key in DEFAULTS ? DEFAULTS[key as keyof typeof DEFAULTS] : ''
}

/** Fully-resolved gateway environment (INTERNAL — includes the secret key). */
export interface GatewayEnv {
  enabled: boolean
  apiKey: string
  model: string
  sttModel: string
  maxAudioSeconds: number
  maxAudioUploadMb: number
  timeoutMs: number
}

/**
 * Read and merge gateway env from the SJ OS root `.env` and process.env.
 * `extraRoots` lets the caller pass app-specific roots (e.g. app.getAppPath()).
 * Re-reads on each call so editing root `.env` + restarting `npm run dev` is
 * enough — no build step required.
 */
export function readGatewayEnv(extraRoots: string[] = []): GatewayEnv {
  // Merge candidate .env files, earliest-listed winning (extraRoots before cwd).
  const merged: Record<string, string> = {}
  for (const dir of candidateEnvDirs(extraRoots).reverse()) {
    Object.assign(merged, parseEnvFile(join(dir, '.env')))
  }

  const maxAudioSeconds = Number(pick(merged, 'MAX_AUDIO_SECONDS'))
  const maxAudioUploadMb = Number(pick(merged, 'MAX_AUDIO_UPLOAD_MB'))
  const timeoutMs = Number(pick(merged, 'OPENAI_TIMEOUT_MS'))

  return {
    enabled: pick(merged, 'OPENAI_ENABLED').toLowerCase() === 'true',
    apiKey: pick(merged, 'OPENAI_API_KEY').trim(),
    model: pick(merged, 'OPENAI_MODEL'),
    sttModel: pick(merged, 'OPENAI_STT_MODEL'),
    maxAudioSeconds: Number.isFinite(maxAudioSeconds) && maxAudioSeconds > 0 ? maxAudioSeconds : 10,
    maxAudioUploadMb: Number.isFinite(maxAudioUploadMb) && maxAudioUploadMb > 0 ? maxAudioUploadMb : 10,
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 30000
  }
}
