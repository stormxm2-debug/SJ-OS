/**
 * proxy:env — preflight check of sj-ai-proxy/.env.
 *
 * SECURITY: reads the backend .env only to report booleans/labels. It NEVER
 * prints the API key (or any part of it) — only whether one is configured and
 * whether it has the expected `sk-` prefix.
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const envPath = path.join(__dirname, '..', 'sj-ai-proxy', '.env')

if (!existsSync(envPath)) {
  console.log('sj-ai-proxy/.env: NOT FOUND')
  console.log('First-time setup:')
  console.log('  cd sj-ai-proxy')
  console.log('  copy .env.example .env   (then set OPENAI_ENABLED=true and OPENAI_API_KEY)')
  process.exit(1)
}

/** Minimal .env parser — KEY=VALUE lines, ignores comments/blanks/quotes. */
function parseEnv(text) {
  const map = {}
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    const value = line.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '')
    map[key] = value
  }
  return map
}

const env = parseEnv(readFileSync(envPath, 'utf8'))

const enabled = (env.OPENAI_ENABLED ?? 'false').toLowerCase() === 'true'
const key = env.OPENAI_API_KEY ?? ''
const keyConfigured = key.startsWith('sk-') && key.length > 12

console.log('sj-ai-proxy/.env preflight:')
console.log(`  OPENAI_ENABLED=${enabled}`)
console.log(`  API key configured: ${keyConfigured ? 'yes' : 'no'}${key && !keyConfigured ? ' (present but not an sk- key)' : ''}`)
console.log(`  OPENAI_MODEL=${env.OPENAI_MODEL ?? '(default gpt-4o-mini)'}`)
console.log(`  OPENAI_STT_MODEL=${env.OPENAI_STT_MODEL ?? '(default gpt-4o-mini-transcribe)'}`)

if (enabled && keyConfigured) {
  console.log('\n✅ Ready: proxy should report ready=true once started.')
} else if (!enabled) {
  console.log('\nℹ️  OPENAI_ENABLED is not true — GPT/STT will use safe fallback.')
} else {
  console.log('\n⚠️  OPENAI_ENABLED=true but no valid API key found in .env.')
}
