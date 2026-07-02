/**
 * proxy:kill — free port 8787 by stopping ONLY the process listening on it.
 *
 * This is intentionally surgical: it finds the single PID bound to the proxy
 * port and stops just that one. It never kills all node processes and never
 * touches unrelated ports. If nothing is listening, it exits cleanly.
 */

import { execSync } from 'node:child_process'

const PORT = 8787
const isWindows = process.platform === 'win32'

/** Find PIDs listening on PORT. Returns [] when none / on error. */
function findListenerPids() {
  const pids = new Set()
  try {
    if (isWindows) {
      const out = execSync('netstat -ano -p tcp', { encoding: 'utf8' })
      for (const line of out.split(/\r?\n/)) {
        const parts = line.trim().split(/\s+/)
        // Columns: Proto  LocalAddress  ForeignAddress  State  PID
        if (parts.length < 5 || !/LISTENING/i.test(parts[3])) continue
        if (parts[1].endsWith(`:${PORT}`)) pids.add(parts[4])
      }
    } else {
      const out = execSync(`lsof -ti tcp:${PORT} -sTCP:LISTEN`, { encoding: 'utf8' })
      for (const pid of out.split(/\r?\n/)) {
        if (pid.trim()) pids.add(pid.trim())
      }
    }
  } catch {
    // netstat/lsof found nothing (or is unavailable) → no PIDs.
  }
  return [...pids].filter((p) => p && p !== '0')
}

/** Stop a single PID (targeted; never a broad/system kill). */
function killPid(pid) {
  try {
    if (isWindows) {
      execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' })
    } else {
      process.kill(Number(pid), 'SIGTERM')
    }
    return true
  } catch {
    return false
  }
}

const pids = findListenerPids()
if (pids.length === 0) {
  console.log(`Port ${PORT} is free — no listener to stop.`)
  process.exit(0)
}

for (const pid of pids) {
  const ok = killPid(pid)
  console.log(ok ? `Stopped PID ${pid} on port ${PORT}.` : `Could not stop PID ${pid} (already gone?).`)
}
console.log('Done.')
