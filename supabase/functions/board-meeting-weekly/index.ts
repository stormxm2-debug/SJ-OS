// SJ INVEST — 경영 회의실 주간 자동 소집 (board-meeting-weekly)
//
// pg_cron이 매주 월요일 오전 8시(KST)에 x-cron-secret 헤더로 호출한다.
//  1) board_meeting_snapshot() 로 사내 데이터 스냅샷(서버 집계)
//  2) Claude로 4개 팀 관점 리포트 생성
//  3) board_meeting_reports 에 저장(대표 소유)
//  4) 대표(owner)의 등록 기기로 웹 푸시 알림
// 사용자 JWT가 없으므로 verify_jwt=false + Vault의 cron 비밀값(check_cron_secret)으로 보호한다.

import { createClient } from 'jsr:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'

function autoClose(fragment: string): string {
  const stack: string[] = []
  let inStr = false
  let esc = false
  for (const ch of fragment) {
    if (esc) { esc = false; continue }
    if (inStr) { if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue }
    if (ch === '"') inStr = true
    else if (ch === '{') stack.push('}')
    else if (ch === '[') stack.push(']')
    else if (ch === '}' || ch === ']') stack.pop()
  }
  let out = fragment
  if (inStr) out += '"'
  while (stack.length > 0) out += stack.pop()
  return out
}
function parseJson(text: string): Record<string, unknown> | null {
  const start = text.indexOf('{')
  if (start < 0) return null
  const frag = text.slice(start, text.lastIndexOf('}') > start ? text.lastIndexOf('}') + 1 : undefined)
  try { return JSON.parse(frag) as Record<string, unknown> } catch { /* repair */ }
  try { return JSON.parse(autoClose(text.slice(start))) as Record<string, unknown> } catch { return null }
}

const TEAMS = [
  { key: 'plan', name: '기획팀', focus: '다음에 무엇을 만들어야 하는가 — 제품·기능 우선순위' },
  { key: 'ops', name: '운영팀', focus: '어떻게 더 잘 굴릴까 — 프로세스·규정·직원 운영 개선' },
  { key: 'sales', name: '영업·성장팀', focus: '매출·리쿠르팅·고객 — 성장을 위한 실행 액션' },
  { key: 'dev', name: '개발팀', focus: '기술·자동화 — 앱으로 더 줄일 수 있는 수작업' }
]
function buildSystem(week: string): string {
  const teamList = TEAMS.map((t) => `${t.key}(${t.name}: ${t.focus})`).join(', ')
  return [
    '당신은 SJ INVEST(보험 영업 조직, GA)의 "AI 경영 관리자"입니다. 대표님을 보좌해 주간 경영 회의를 주재하고, 그 결과를 한 장의 리포트로 올립니다. 한국어 존댓말, 간결하고 실질적으로.',
    `이번 회의 주차: ${week}.`,
    `아래 네 팀의 관점에서 각각 분석합니다: ${teamList}.`,
    '제공되는 "사내 데이터 스냅샷"의 실제 수치에 근거해 작성하고, 데이터에 없는 세부는 지어내지 말고 "확인 필요"로 표시하세요. 각 제안은 구체적이고 실행 가능해야 합니다.',
    '반드시 아래 JSON으로만 답하세요. 응답의 첫 글자는 { 여야 합니다 — 인사말·코드펜스 금지.',
    '{"overview":"이번 주 현황 2~3문장(핵심 수치 포함)","teams":[{"key":"plan","name":"기획팀","insights":["1~3개"],"proposals":["1~3개"]}, ...네 팀],"decisions":["대표 결정 안건 2~4개"]}',
    '규칙: teams는 plan, ops, sales, dev 순서로 네 팀 모두. 각 문장 80자 이내. 숫자는 스냅샷 기준으로만.'
  ].join('\n')
}
function coerceTeams(raw: unknown) {
  const arr = Array.isArray(raw) ? raw : []
  const byKey = new Map<string, any>()
  for (const t of arr) { const o = t as any; if (o && typeof o.key === 'string') byKey.set(o.key, o) }
  return TEAMS.map((t) => {
    const o = byKey.get(t.key) ?? {}
    return {
      key: t.key,
      name: typeof o.name === 'string' && o.name ? o.name : t.name,
      insights: (Array.isArray(o.insights) ? o.insights : []).map(String).filter(Boolean).slice(0, 4),
      proposals: (Array.isArray(o.proposals) ? o.proposals : []).map(String).filter(Boolean).slice(0, 4)
    }
  })
}

function weekLabel(): string {
  const now = new Date(Date.now() + 9 * 3600 * 1000) // KST
  const y = now.getUTCFullYear()
  const m = now.getUTCMonth() + 1
  const wom = Math.ceil((now.getUTCDate() + new Date(Date.UTC(y, now.getUTCMonth(), 1)).getUTCDay()) / 7)
  return `${y}-${String(m).padStart(2, '0')} ${wom}주차`
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') return new Response('POST only', { status: 405 })

  const url = Deno.env.get('SUPABASE_URL') ?? ''
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY') ?? ''
  const admin = createClient(url, service, { auth: { persistSession: false } })
  const out = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } })

  // 호출 인증 — Vault에 저장된 cron 비밀값과 대조(보안 정의자 함수). 엣지 시크릿 불필요.
  const token = req.headers.get('x-cron-secret') ?? ''
  const { data: okAuth } = await admin.rpc('check_cron_secret', { s: token })
  if (okAuth !== true) return out({ ok: false, error: 'unauthorized' }, 401)

  if (!apiKey) return out({ ok: false, error: 'ANTHROPIC_API_KEY_MISSING' }, 503)

  // 1) 데이터 스냅샷 (서버 집계)
  const { data: snapData, error: snapErr } = await admin.rpc('board_meeting_snapshot')
  const context = String(snapData ?? '').slice(0, 4000)
  if (snapErr || !context.trim()) return out({ ok: false, error: '스냅샷 생성 실패' }, 500)

  const week = weekLabel()

  // 2) Claude 리포트 생성
  let report: Record<string, unknown> | null = null
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: Deno.env.get('BOARD_MEETING_MODEL') || 'claude-sonnet-5',
        max_tokens: 2600,
        system: `${buildSystem(week)}\n\n--- 사내 데이터 스냅샷 (이 수치에 근거해 작성) ---\n${context}`,
        messages: [{ role: 'user', content: `${week} 경영 회의 리포트를 위 JSON 형식으로 작성해 주세요.` }]
      })
    })
    const data = await r.json().catch(() => ({}))
    if (!r.ok) return out({ ok: false, error: (data as any)?.error?.message || `Claude ${r.status}` }, 502)
    const blocks = (data as any).content ?? []
    const text = blocks.filter((b: any) => b.type === 'text').map((b: any) => b.text ?? '').join('')
    const parsed = parseJson(text)
    if (parsed) {
      report = {
        overview: String(parsed.overview ?? '').trim(),
        teams: coerceTeams(parsed.teams),
        decisions: (Array.isArray(parsed.decisions) ? parsed.decisions : []).map(String).filter(Boolean).slice(0, 5)
      }
    }
  } catch (_e) {
    return out({ ok: false, error: 'Claude 호출 실패' }, 502)
  }
  if (!report) return out({ ok: false, error: '리포트 파싱 실패' }, 502)

  // 3) 대표(owner) 찾기 + 저장
  const { data: owners } = await admin.from('profiles').select('id').eq('role', 'owner')
  const ownerIds = (owners ?? []).map((o: any) => o.id as string)
  if (ownerIds.length === 0) return out({ ok: false, error: '대표(owner) 프로필이 없습니다.' }, 500)

  const { data: inserted, error: insErr } = await admin
    .from('board_meeting_reports')
    .insert({ created_by: ownerIds[0], week, title: `${week} (자동)`, report })
    .select('id')
    .single()
  if (insErr) return out({ ok: false, error: `저장 실패: ${insErr.message}` }, 500)

  // 4) 대표 기기로 푸시
  let pushed = 0
  const pub = Deno.env.get('VAPID_PUBLIC_KEY')
  const priv = Deno.env.get('VAPID_PRIVATE_KEY')
  const subject = Deno.env.get('VAPID_SUBJECT') ?? 'https://sj-invest.pages.dev'
  if (pub && priv) {
    const { data: subs } = await admin
      .from('push_subscriptions')
      .select('id, endpoint, p256dh, auth')
      .in('user_id', ownerIds)
    const list = (subs ?? []) as { id: string; endpoint: string; p256dh: string; auth: string }[]
    if (list.length > 0) {
      webpush.setVapidDetails(subject, pub, priv)
      const payload = JSON.stringify({ title: '📊 이번 주 경영 회의 준비됨', body: `${week} 4개 팀 자문 리포트가 올라왔어요. 경영 회의실에서 확인하세요.`, url: '/', tag: `board-${week}` })
      const gone: string[] = []
      await Promise.all(list.map(async (s) => {
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 3600 })
          pushed++
        } catch (e) {
          const code = (e as { statusCode?: number })?.statusCode
          if (code === 404 || code === 410) gone.push(s.id)
        }
      }))
      if (gone.length > 0) await admin.from('push_subscriptions').delete().in('id', gone)
    }
  }

  return out({ ok: true, reportId: (inserted as any)?.id, week, pushed })
})
