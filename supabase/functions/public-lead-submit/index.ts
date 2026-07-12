// Supabase Edge Function: public-lead-submit (Deno runtime)
//
// 셀프 유입 퍼널(자체생산 3단계): FC 개인 QR/링크로 들어온 비로그인 방문자의
// "무료 보장분석 신청"을 접수해 leads 테이블에 넣는다.
// - fcCode(프로필 uuid)가 유효하면 그 FC에게 귀속, 없으면 최소부하 자동배정.
// - 스팸 방어: 허니팟 필드 + 전화번호 형식 검증 + 같은 번호 24시간 중복 차단.
// - service_role 키는 이 함수 env에만 존재한다(렌더러에 절대 없음). 이 파일에 비밀 없음.
//
// Deploy: supabase functions deploy public-lead-submit
// Secrets: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (다른 함수와 동일하게 자동 주입)
//
// This file is Deno/TS and is NOT part of the app's tsconfig/vite build.
// deno-lint-ignore-file no-explicit-any
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
}

/** 010 휴대폰만 허용 — 표시용 010-XXXX-XXXX로 정규화. 실패 시 null. */
function normalizePhone(input: string): string | null {
  const digits = (input ?? '').replace(/\D/g, '')
  if (!/^010\d{7,8}$/.test(digits)) return null
  return digits.length === 11
    ? `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`
    : `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ success: false, error: '잘못된 요청입니다.' }, 405)

  let body: any
  try {
    body = await req.json()
  } catch {
    return json({ success: false, error: '잘못된 요청입니다.' }, 400)
  }

  // 허니팟: 봇이 채우는 숨김 필드 — 채워져 있으면 조용히 성공으로 응답(봇에게 힌트 X).
  if (typeof body?.website === 'string' && body.website.trim() !== '') {
    return json({ success: true })
  }

  const name = String(body?.name ?? '').trim()
  if (name.length < 2 || name.length > 30) return json({ success: false, error: '성함을 확인해 주세요.' }, 400)
  const phone = normalizePhone(String(body?.phone ?? ''))
  if (!phone) return json({ success: false, error: '휴대폰 번호(010)를 확인해 주세요.' }, 400)
  if (body?.consent !== true) return json({ success: false, error: '개인정보 수집·이용 동의가 필요합니다.' }, 400)
  const interest = String(body?.interest ?? '').trim().slice(0, 40)
  const memo = String(body?.memo ?? '').trim().slice(0, 300)
  const fcCode = String(body?.fcCode ?? '').trim()

  const url = Deno.env.get('SUPABASE_URL')
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !serviceRole) return json({ success: false, error: '서버 설정 오류입니다.' }, 500)
  const admin = createClient(url, serviceRole, { auth: { persistSession: false, autoRefreshToken: false } })

  try {
    // 같은 번호 24시간 중복 접수 차단 (재신청 폭탄/실수 방지).
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const { data: dup } = await admin.from('leads').select('id').eq('phone', phone).gte('created_at', since).limit(1)
    if (dup && dup.length > 0) {
      return json({ success: true, message: '이미 접수되어 있습니다. 곧 연락드리겠습니다.' })
    }

    // 배정 대상 결정: FC 개인 링크 → 그 직원, 아니면 최소부하 자동배정.
    let assignedId: string | null = null
    let assignedName: string | null = null
    let via = '공용 링크'

    if (fcCode && UUID_RE.test(fcCode)) {
      const { data: fc } = await admin.from('profiles').select('id, name, status').eq('id', fcCode).maybeSingle()
      if (fc && fc.status === 'active') {
        assignedId = String(fc.id)
        assignedName = fc.name ?? null
        via = 'FC 개인 링크'
      }
    }

    if (!assignedId) {
      // 최소부하 자동배정 — 활성 영업직원(관리자/대표 제외) 중 미콜(new)이 가장 적은 사람.
      const { data: staff } = await admin.from('profiles').select('id, name, role, status').eq('status', 'active')
      const sales = ((staff as any[]) ?? []).filter((p) => p.role !== 'owner' && p.role !== 'admin')
      if (sales.length > 0) {
        const load: Record<string, number> = {}
        sales.forEach((s) => (load[String(s.id)] = 0))
        const { data: open } = await admin.from('leads').select('assigned_fc_id').eq('status', 'new')
        for (const row of (open as any[]) ?? []) {
          const id = row.assigned_fc_id
          if (id && id in load) load[id] += 1
        }
        let pick = sales[0]
        for (const s of sales) if (load[String(s.id)] < load[String(pick.id)]) pick = s
        assignedId = String(pick.id)
        assignedName = pick.name ?? null
      }
    }

    const memoParts = [`[셀프퍼널·${via}]`]
    if (interest) memoParts.push(`관심: ${interest}`)
    if (memo) memoParts.push(memo)

    const { error: insErr } = await admin.from('leads').insert({
      name,
      phone,
      source: '셀프퍼널(QR)',
      memo: memoParts.join(' / '),
      status: 'new',
      assigned_fc_id: assignedId,
      assigned_fc_name: assignedName,
      assigned_at: assignedId ? new Date().toISOString() : null
    })
    if (insErr) return json({ success: false, error: '접수 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.' }, 500)

    return json({ success: true, message: '신청이 접수되었습니다. 담당 설계사가 곧 연락드립니다.' })
  } catch {
    return json({ success: false, error: '접수 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.' }, 500)
  }
})
