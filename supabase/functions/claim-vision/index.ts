// SJ INVEST — 보험금 청구비서 Edge Function (claim-vision)
//
// Runs on Supabase so the DEPLOYED web/app can analyze claim documents without a
// local proxy. Accepts multipart/form-data: `message` (text) + `images` (one or more
// image files; the client rasterizes PDFs to images first) and calls OpenAI gpt-4o
// vision. The OpenAI key is read from the Supabase secret OPENAI_API_KEY and is NEVER
// exposed to the client. Images are processed in memory and never stored.
//
// Deploy: supabase functions deploy claim-vision   (or via the SJ OS tooling)
// Secret: supabase secrets set OPENAI_API_KEY=sk-...   (or Dashboard → Edge Functions → Secrets)

import { encodeBase64 } from 'https://deno.land/std@0.224.0/encoding/base64.ts'

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}

const SYSTEM_PROMPT = [
  '당신은 대한민국 손해보험·생명보험 보험금 청구 전문가이자 손해사정 실무자입니다.',
  '첨부된 보험 서류(증권·약관·진단서·영수증 등, 여러 장일 수 있음)를 종합해 이 고객이 받을 수 있는 보험금을 분석합니다.',
  '항상 한국어로, 아래 형식(제목·순서 그대로)으로만 답하세요.',
  '',
  '1) 맨 첫 줄: "예상 총 보험금: 약 OOO원 (범위 OOO원 ~ OOO원)"',
  '2) "■ 해당 보장 항목" — 지급 가능한 담보/특약마다 [담보명 / 근거 약관 조항 / 예상 금액] 표',
  '3) "■ 지급 근거" — 왜 받을 수 있는지, 서류에서 확인된 사실(진단·치료·입원·가입담보)과 약관 근거를 연결',
  '4) "■ 고객 안내 요약" — 고객에게 그대로 읽어줄 3~5줄(총액·핵심 담보·필요 서류·다음 절차)',
  '5) "■ 주의·리스크" — 부지급/삭감 가능성, 면책, 자기부담금, 추가 확인 필요',
  '',
  '서류에서 확인되지 않는 값은 "추정"임을 명시하고, 모든 금액은 한국 원(₩) 기준으로 제시하세요.',
  '마지막 줄에 "실제 지급액은 약관 심사·손해사정 결과에 따라 달라질 수 있습니다."를 넣으세요.'
].join('\n')

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ success: false, error: 'POST 요청만 지원합니다.' }, 405)

  const apiKey = Deno.env.get('OPENAI_API_KEY')
  if (!apiKey) {
    return json(
      { success: false, code: 'OPENAI_API_KEY_MISSING', error: 'OPENAI_API_KEY 시크릿이 설정되지 않았습니다. Supabase Edge Functions Secrets에 추가하세요.' },
      503
    )
  }

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return json({ success: false, error: '요청 형식이 올바르지 않습니다 (multipart 필요).' }, 400)
  }

  const message = (form.get('message') as string | null)?.toString().trim() || '첨부한 보험 서류들을 모두 읽고 예상 지급 보험금을 분석하세요.'
  const files = form.getAll('images').filter((f): f is File => f instanceof File)
  if (files.length === 0) return json({ success: false, code: 'IMAGE_MISSING', error: '분석할 이미지가 없습니다.' }, 400)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const content: any[] = [{ type: 'text', text: message }]
  for (const f of files.slice(0, 15)) {
    const buf = new Uint8Array(await f.arrayBuffer())
    if (buf.length === 0) continue
    const mime = f.type && f.type.startsWith('image/') ? f.type : 'image/jpeg'
    content.push({ type: 'image_url', image_url: { url: `data:${mime};base64,${encodeBase64(buf)}` } })
  }

  const model = Deno.env.get('CLAIM_VISION_MODEL') || 'gpt-4o'
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 130000)
  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        temperature: 0.3,
        max_tokens: 4096,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content }
        ]
      }),
      signal: controller.signal
    })
    const data = await r.json().catch(() => ({}))
    if (!r.ok) {
      return json({ success: false, source: 'openai', error: data?.error?.message || `OpenAI 오류 (HTTP ${r.status}).` }, 502)
    }
    const answer = (data?.choices?.[0]?.message?.content ?? '').toString().trim()
    return json({ success: true, source: 'openai', answer: answer || '서류에서 분석 결과를 생성하지 못했습니다.', model: data?.model || model })
  } catch (e) {
    const aborted = e instanceof DOMException && e.name === 'AbortError'
    return json(
      { success: false, source: 'openai', error: aborted ? '분석이 시간 내에 완료되지 않았습니다. 다시 시도해 주세요.' : '분석 중 오류가 발생했습니다.' },
      aborted ? 504 : 502
    )
  } finally {
    clearTimeout(timer)
  }
})
