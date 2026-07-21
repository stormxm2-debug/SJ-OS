// SJ INVEST — 자비스 리얼타임 보이스 토큰 (realtime-token)
//
// ChatGPT 보이스급 실시간 음성 대화(B안)를 위해 OpenAI Realtime 세션의
// 에페메럴 토큰을 발급한다. 요금이 분당 과금이므로 **대표(owner) 전용**:
// 로그인 JWT 검증 후 profiles.role='owner'가 아니면 403.
//
// Secrets: OPENAI_API_KEY (기존 claim-vision과 공유), SUPABASE_URL/ANON/SERVICE_ROLE 자동.
// 선택 env: REALTIME_MODEL (기본 gpt-4o-mini-realtime-preview), REALTIME_VOICE (기본 ash).
// 이 파일에 비밀 없음. deno-lint-ignore-file no-explicit-any
import { createClient } from 'jsr:@supabase/supabase-js@2'

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
}

/** 자비스 페르소나 — 리얼타임 모델에 주입하는 지시문 (한국어 음성 대화 전용). */
function buildInstructions(context: string): string {
  const base = [
    '당신은 "자비스" — SJ INVEST(한국 보험 영업 조직)의 AI 음성 비서입니다. 아이언맨의 자비스처럼 유능하고 침착하게, 반드시 한국어 존댓말로 말합니다.',
    '지금 대화 상대는 대표님입니다. 경영·영업·보험 실무 질문에 간결하고 핵심부터 답하세요.',
    '음성 대화이므로 답변은 짧게(2~4문장), 목록 나열 대신 자연스러운 말로. 모르는 것은 모른다고 말하세요.',
    '보험 관련 답변은 일반론임을 필요시 명시하세요 (상품·심사는 보험사별로 다름).'
  ].join('\n')
  if (!context) return base
  return `${base}\n\n--- 사내 실시간 데이터 스냅샷 (이 범위의 질문은 이 데이터로 답하고, 없는 세부는 지어내지 말 것) ---\n${context}`
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ success: false, error: 'POST 요청만 지원합니다.' }, 405)

  // ① 로그인 검증 (JWT) — jarvis-brain과 동일 패턴.
  const su = Deno.env.get('SUPABASE_URL') ?? ''
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
  const bearer = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  const caller = su && anonKey
    ? createClient(su, anonKey, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${bearer}` } } })
    : null
  const uid = caller ? (await caller.auth.getUser()).data?.user?.id : null
  if (!uid) return json({ success: false, error: '로그인 후 사용할 수 있습니다.' }, 401)

  // ② 대표 전용 게이트 — service_role로 역할 확인 (분당 과금 기능이므로 엄격히).
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  const admin = su && serviceKey ? createClient(su, serviceKey, { auth: { persistSession: false } }) : null
  if (!admin) return json({ success: false, error: '서버 설정 오류입니다.' }, 500)
  const { data: profile } = await admin.from('profiles').select('role').eq('id', uid).maybeSingle()
  if (profile?.role !== 'owner') {
    return json({ success: false, code: 'OWNER_ONLY', error: '리얼타임 보이스는 현재 대표님 전용입니다.' }, 403)
  }

  const apiKey = Deno.env.get('OPENAI_API_KEY')
  if (!apiKey) {
    return json({ success: false, code: 'OPENAI_API_KEY_MISSING', error: 'OPENAI_API_KEY 시크릿이 설정되지 않았습니다.' }, 503)
  }

  // ③ 클라이언트가 보낸 사내 스냅샷(선택) → 지시문에 포함.
  let context = ''
  try {
    const body = await req.json()
    context = String(body?.context ?? '').slice(0, 4000)
  } catch {
    /* body 없이 호출해도 동작 */
  }

  const model = Deno.env.get('REALTIME_MODEL') || 'gpt-4o-mini-realtime-preview'
  const voice = Deno.env.get('REALTIME_VOICE') || 'ash'

  // ④ OpenAI Realtime 에페메럴 세션 생성 — 토큰은 짧게 살고 클라이언트 WebRTC
  //    핸드셰이크에만 쓰인다. 실제 API 키는 이 함수 밖으로 절대 나가지 않는다.
  try {
    const r = await fetch('https://api.openai.com/v1/realtime/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        voice,
        modalities: ['audio', 'text'],
        instructions: buildInstructions(context),
        input_audio_transcription: { model: 'whisper-1' },
        turn_detection: { type: 'server_vad', threshold: 0.5, silence_duration_ms: 700 }
      })
    })
    const data = await r.json().catch(() => ({}))
    if (!r.ok) {
      const msg = (data as { error?: { message?: string } })?.error?.message || `OpenAI 오류 (HTTP ${r.status})`
      return json({ success: false, error: msg }, 502)
    }
    const secret = (data as { client_secret?: { value?: string; expires_at?: number } }).client_secret
    if (!secret?.value) return json({ success: false, error: '세션 토큰 발급에 실패했습니다.' }, 502)
    return json({ success: true, token: secret.value, expiresAt: secret.expires_at ?? null, model })
  } catch {
    return json({ success: false, error: '리얼타임 세션 생성 중 오류가 발생했습니다.' }, 502)
  }
})
