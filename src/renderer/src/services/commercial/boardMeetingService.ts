/**
 * 경영 회의실 서비스 — 주간 경영 자문 리포트 (관리자/대표 전용).
 *
 * 사내 데이터 스냅샷을 board-meeting 엣지함수(Claude)로 보내 4개 팀 관점의
 * 리포트를 생성하고, board_meeting_reports 테이블에 주차별로 저장/조회한다.
 * 서버 미배포/키 미설정이면 disabled로 알리고, 데이터 기반 기본 리포트로 폴백한다.
 */
import {
  getFunctionsBaseUrl,
  getSupabaseAnonKey,
  getSupabaseClient,
  initSupabaseClient
} from './supabaseClient'
import { getBackendConfig } from './backendConfig'

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface BoardTeam {
  key: string
  name: string
  insights: string[]
  proposals: string[]
}
export interface BoardReport {
  overview: string
  teams: BoardTeam[]
  decisions: string[]
}
export interface SavedReport {
  id: string
  week: string
  title: string
  report: BoardReport
  createdAt: string
}
export interface GenerateResult {
  ok: boolean
  report?: BoardReport
  error?: string
  /** 서버 미배포/키 미설정 — 기본(데이터 기반) 리포트로 폴백하라는 신호. */
  disabled?: boolean
}

const TEAM_META: { key: string; name: string }[] = [
  { key: 'plan', name: '기획팀' },
  { key: 'ops', name: '운영팀' },
  { key: 'sales', name: '영업·성장팀' },
  { key: 'dev', name: '개발팀' }
]

export function isSupabaseMode(): boolean {
  return getBackendConfig().mode === 'supabase'
}

/** 'YYYY-MM N주차' 형태의 이번 주 표기. */
export function currentWeekLabel(d = new Date()): string {
  const y = d.getFullYear()
  const m = d.getMonth() + 1
  const weekOfMonth = Math.ceil((d.getDate() + new Date(y, d.getMonth(), 1).getDay()) / 7)
  return `${y}-${String(m).padStart(2, '0')} ${weekOfMonth}주차`
}

async function bearer(): Promise<string | undefined> {
  const anon = getSupabaseAnonKey()
  try {
    await initSupabaseClient()
    const client = getSupabaseClient() as {
      auth?: { getSession: () => Promise<{ data?: { session?: { access_token?: string } } }> }
    } | null
    const { data } = (await client?.auth?.getSession()) ?? {}
    return data?.session?.access_token ?? anon
  } catch {
    return anon
  }
}

/** AI 리포트 생성 (board-meeting 엣지함수). */
export async function generateReport(week: string, context: string): Promise<GenerateResult> {
  const base = getFunctionsBaseUrl()
  const anon = getSupabaseAnonKey()
  if (!base || !anon) return { ok: false, disabled: true, error: '서버 미설정' }

  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), 60000)
  try {
    const token = (await bearer()) ?? anon
    const res = await fetch(`${base}/board-meeting`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: anon, Authorization: `Bearer ${token}` },
      body: JSON.stringify({ week, context: context.slice(0, 4000) })
    })
    const data = (await res.json().catch(() => null)) as Record<string, unknown> | null
    if (!res.ok || !data?.success) {
      const disabled = res.status === 404 || data?.code === 'ANTHROPIC_API_KEY_MISSING'
      return { ok: false, disabled, error: String(data?.error ?? `리포트 요청 실패 (HTTP ${res.status})`) }
    }
    const result = (data.result ?? {}) as Record<string, unknown>
    const report = normalizeReport(result)
    return { ok: true, report }
  } catch (e) {
    const aborted = e instanceof DOMException && e.name === 'AbortError'
    return { ok: false, error: aborted ? '응답 시간이 초과되었습니다. 다시 시도해 주세요.' : '서버에 연결할 수 없습니다.' }
  } finally {
    window.clearTimeout(timer)
  }
}

function normalizeReport(raw: Record<string, unknown>): BoardReport {
  const teamsRaw = Array.isArray(raw.teams) ? (raw.teams as any[]) : []
  const byKey = new Map<string, any>()
  for (const t of teamsRaw) if (t && typeof t.key === 'string') byKey.set(t.key, t)
  const teams = TEAM_META.map((m) => {
    const o = byKey.get(m.key) ?? {}
    return {
      key: m.key,
      name: typeof o.name === 'string' && o.name ? o.name : m.name,
      insights: (Array.isArray(o.insights) ? o.insights : []).map(String).filter(Boolean),
      proposals: (Array.isArray(o.proposals) ? o.proposals : []).map(String).filter(Boolean)
    }
  })
  return {
    overview: String(raw.overview ?? '').trim(),
    teams,
    decisions: (Array.isArray(raw.decisions) ? raw.decisions : []).map(String).filter(Boolean)
  }
}

/** 서버가 비활성일 때의 폴백 — 데이터 스냅샷을 그대로 요약해 보여준다(AI 자문 없음). */
export function buildBasicReport(week: string, context: string): BoardReport {
  const lines = context.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 12)
  return {
    overview: `${week} 현황 스냅샷입니다. (AI 자문 서버가 꺼져 있어 데이터 요약만 제공합니다. 설정 후 다시 생성하면 4개 팀 자문이 채워집니다.)`,
    teams: TEAM_META.map((m) => ({ key: m.key, name: m.name, insights: [], proposals: [] })),
    decisions: lines.length ? lines : ['표시할 데이터가 없습니다.']
  }
}

// ─────────────────────────── 저장/조회 ───────────────────────────
async function sb(): Promise<any | null> {
  if (getBackendConfig().mode !== 'supabase') return null
  await initSupabaseClient()
  return (getSupabaseClient() as any) ?? null
}

function mapSaved(r: any): SavedReport {
  return {
    id: r.id,
    week: r.week,
    title: r.title ?? '',
    report: normalizeReport((r.report ?? {}) as Record<string, unknown>),
    createdAt: r.created_at
  }
}

export async function saveReport(week: string, title: string, report: BoardReport): Promise<SavedReport | null> {
  const c = await sb()
  if (!c) return null
  const { data, error } = await c
    .from('board_meeting_reports')
    .insert({ week, title, report })
    .select('*')
    .single()
  if (error) throw new Error(error.message)
  return mapSaved(data)
}

export async function listReports(): Promise<SavedReport[]> {
  const c = await sb()
  if (!c) return []
  const { data, error } = await c
    .from('board_meeting_reports')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50)
  if (error) throw new Error(error.message)
  return (data || []).map(mapSaved)
}

export async function deleteReport(id: string): Promise<void> {
  const c = await sb()
  if (!c) return
  const { error } = await c.from('board_meeting_reports').delete().eq('id', id)
  if (error) throw new Error(error.message)
}
