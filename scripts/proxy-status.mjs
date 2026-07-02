/**
 * proxy:status — probe the local SJ AI Proxy readiness.
 *
 * Tries both localhost and 127.0.0.1 (Windows may resolve `localhost` to IPv6
 * `::1` while the proxy answers on IPv4, or vice versa). Prints the sanitized
 * GET /ai/status result — this endpoint never returns the API key, and this
 * script never reads or prints any secret.
 */

const CANDIDATES = ['http://localhost:8787', 'http://127.0.0.1:8787']

async function probe(base) {
  try {
    const res = await fetch(`${base}/ai/status`, { signal: AbortSignal.timeout(4000) })
    if (!res.ok) {
      console.log(`  ${base} → HTTP ${res.status}`)
      return null
    }
    return await res.json()
  } catch (error) {
    console.log(`  ${base} → unreachable (${error?.code ?? error?.name ?? 'error'})`)
    return null
  }
}

console.log('Checking SJ AI Proxy status…')
for (const base of CANDIDATES) {
  const data = await probe(base)
  if (data) {
    console.log(`\n✅ Proxy reachable at ${base}`)
    console.log(`   enabled=${Boolean(data.enabled)}  apiKeyConfigured=${Boolean(data.apiKeyConfigured)}  ready=${Boolean(data.ready)}`)
    console.log(`   model=${data.model ?? '—'}  sttModel=${data.sttModel ?? '—'}`)
    if (data.message) console.log(`   message: ${data.message}`)
    process.exit(0)
  }
}

console.log('\n❌ Proxy offline. Start it with:  npm run proxy:dev   (or npm run dev:all)')
process.exit(1)
