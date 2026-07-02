/**
 * dev:all — start the SJ AI Proxy and the SJ OS app together, with reliable
 * startup and shutdown on Windows.
 *
 * Why not `concurrently`? On Windows it kills the direct child (the `npm`
 * wrapper) but leaves the nested `node server.mjs` grandchild running, so the
 * proxy orphans on port 8787 after the app closes — the exact pain point this
 * launcher exists to remove.
 *
 * What this does:
 *  1. Preflight: frees port 8787 if a stale proxy is still bound (self-healing,
 *     so `npm run dev:all` "just works" even after a previous crash).
 *  2. Starts the proxy as a DIRECT `node` process (we own its real PID, so it
 *     can be killed cleanly) and the app via the existing `npm run dev`.
 *  3. Prefixes output with [proxy] / [app].
 *  4. If EITHER process exits (e.g. you close the Electron window) OR you press
 *     Ctrl+C, the other's whole process tree is stopped too — no orphans.
 *
 * SECURITY: never reads or prints the API key. The proxy loads its own .env.
 */

import { spawn, execSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const isWindows = process.platform === 'win32'
const PROXY_PORT = 8787
const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const proxyEntry = path.join(repoRoot, 'sj-ai-proxy', 'server.mjs')

/** Find PIDs listening on a port. Returns [] when none / on error. */
function listenerPids(port) {
  const pids = new Set()
  try {
    if (isWindows) {
      const out = execSync('netstat -ano -p tcp', { encoding: 'utf8' })
      for (const line of out.split(/\r?\n/)) {
        const parts = line.trim().split(/\s+/)
        if (parts.length < 5 || !/LISTENING/i.test(parts[3])) continue
        if (parts[1].endsWith(`:${port}`)) pids.add(parts[4])
      }
    } else {
      const out = execSync(`lsof -ti tcp:${port} -sTCP:LISTEN`, { encoding: 'utf8' })
      for (const pid of out.split(/\r?\n/)) if (pid.trim()) pids.add(pid.trim())
    }
  } catch {
    /* nothing listening / tool unavailable */
  }
  return [...pids].filter((p) => p && p !== '0')
}

/** Kill a PID and its whole tree (Windows) or process group (posix). */
function killTreeByPid(pid) {
  if (!pid) return
  try {
    if (isWindows) execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' })
    else {
      try {
        process.kill(-pid, 'SIGTERM')
      } catch {
        process.kill(pid, 'SIGTERM')
      }
    }
  } catch {
    /* already gone */
  }
}

/** Preflight: free the proxy port so the fresh proxy can bind. */
function freeProxyPort() {
  const pids = listenerPids(PROXY_PORT)
  for (const pid of pids) {
    console.log(`[dev:all] freeing port ${PROXY_PORT} (stopping stale PID ${pid})`)
    killTreeByPid(pid)
  }
}

const managed = []
let shuttingDown = false

/** Prefix and forward a child's output stream, line by line. */
function forward(name, stream) {
  if (!stream) return
  let buffer = ''
  stream.on('data', (chunk) => {
    buffer += chunk.toString()
    const lines = buffer.split(/\r?\n/)
    buffer = lines.pop() ?? ''
    for (const line of lines) process.stdout.write(`[${name}] ${line}\n`)
  })
}

function register(name, child) {
  forward(name, child.stdout)
  forward(name, child.stderr)
  child.on('exit', (code, signal) => {
    if (!shuttingDown) {
      console.log(`[dev:all] "${name}" exited (${signal ?? `code ${code}`}). Stopping the other…`)
      shutdown(code ?? 0)
    }
  })
  managed.push({ name, child })
}

function shutdown(exitCode = 0) {
  if (shuttingDown) return
  shuttingDown = true
  for (const { child } of managed) killTreeByPid(child.pid)
  // Backstop: ensure the proxy port is free even if a tree-kill missed.
  setTimeout(() => {
    freeProxyPort()
    process.exit(exitCode)
  }, 300)
}

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))

freeProxyPort()
console.log('[dev:all] starting proxy + app… (Ctrl+C or closing the app stops both)')

// Proxy: spawn node DIRECTLY (no shell) so child.pid is the real server process
// and can be killed cleanly. server.mjs loads sj-ai-proxy/.env relative to its
// own file, so the working directory does not matter.
const proxy = spawn(process.execPath, [proxyEntry], {
  cwd: repoRoot,
  stdio: ['ignore', 'pipe', 'pipe']
})
register('proxy', proxy)

// App: the existing electron-vite dev script, unchanged. Shell so `npm` resolves.
const app = spawn('npm run dev', {
  cwd: repoRoot,
  shell: true,
  stdio: ['ignore', 'pipe', 'pipe']
})
register('app', app)
