import type { TeamRecord } from '@shared/commercial/teamOps'

/**
 * Local-mock teams registry (localStorage). In production this mirrors public.teams.
 * Never logs sensitive data. Used only when Supabase is not configured.
 */

const KEY = 'sj.teams'
let teams: TeamRecord[] = load()
const listeners = new Set<() => void>()

function load(): TeamRecord[] {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as TeamRecord[]) : []
  } catch {
    return []
  }
}
function persist(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(teams.slice(0, 500)))
  } catch {
    /* best effort */
  }
  listeners.forEach((l) => l())
}
function nowIso(): string {
  return new Date().toISOString()
}
function rid(): string {
  return `team-${teams.length}-${Math.floor(performance.now())}`
}

export function listLocalTeams(): TeamRecord[] {
  return teams
}
export function createLocalTeam(name: string): { ok: boolean; error?: string } {
  if (!name.trim()) return { ok: false, error: '팀명을 입력해주세요.' }
  if (teams.some((t) => t.name === name.trim())) return { ok: false, error: '이미 존재하는 팀명입니다.' }
  teams = [{ id: rid(), name: name.trim(), status: 'active', createdAt: nowIso(), updatedAt: nowIso() }, ...teams]
  persist()
  return { ok: true }
}
function patch(id: string, fn: (t: TeamRecord) => TeamRecord): void {
  teams = teams.map((t) => (t.id === id ? { ...fn(t), updatedAt: nowIso() } : t))
  persist()
}
export function renameLocalTeam(id: string, name: string): void {
  if (name.trim()) patch(id, (t) => ({ ...t, name: name.trim() }))
}
export function setLocalTeamLeader(id: string, leaderId?: string, leaderName?: string): void {
  patch(id, (t) => ({ ...t, leaderId, leaderName }))
}
export function setLocalTeamStatus(id: string, status: TeamRecord['status']): void {
  patch(id, (t) => ({ ...t, status }))
}

export function subscribeTeams(l: () => void): () => void {
  listeners.add(l)
  return () => listeners.delete(l)
}
