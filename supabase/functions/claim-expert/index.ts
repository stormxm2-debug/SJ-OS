// SJ INVEST — 보험금 청구 보상전문가 (claim-expert, Claude 기반)
//
// 3가지 모드 (multipart 또는 JSON):
//  - extract   : 서류 묶음(≤6개, PDF/이미지) → 문서별 추출 JSON (분류·보험사·담보·의료사실)
//  - synthesize: 추출 JSON 전체 → 회사별·담보별 예상 보험금 + 약관 근거 + 고객 안내문
//  - appeal    : 분석 결과 + 거절 사유 → 약관 조항 근거 재검토(이의) 요청서
// Claude는 PDF 원본을 그대로 읽는다(document 블록). 키는 ANTHROPIC_API_KEY 시크릿.
// 서류는 메모리에서만 처리되고 저장되지 않는다. 고객의 편에 선 보상 전문가 관점.

import { encodeBase64 } from 'https://deno.land/std@0.224.0/encoding/base64.ts'

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
}

/** Claude 응답 텍스트에서 JSON 오브젝트 파싱 (앞뒤 잡음 제거). */
/** 문자열/이스케이프를 인지하며 괄호 스택을 계산해, 잘린 JSON을 자동으로 닫는다. */
function autoClose(fragment: string): string {
  const stack: string[] = []
  let inStr = false
  let esc = false
  for (const ch of fragment) {
    if (esc) {
      esc = false
      continue
    }
    if (inStr) {
      if (ch === '\\') esc = true
      else if (ch === '"') inStr = false
      continue
    }
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

/**
 * Claude 응답에서 JSON 파싱. max_tokens로 중간에 잘린 응답도 최대한 복구한다:
 * ① 그대로 파싱 → ② 괄호 자동 닫기 → ③ 마지막 완전한 '}'까지 자르고 자동 닫기
 * (잘린 마지막 항목 하나는 버려지지만 나머지 결과는 살아난다).
 */
function parseJson(text: string): Record<string, unknown> | null {
  const start = text.indexOf('{')
  if (start < 0) return null
  const frag = text.slice(start, text.lastIndexOf('}') > start ? text.lastIndexOf('}') + 1 : undefined)
  try {
    return JSON.parse(frag) as Record<string, unknown>
  } catch {
    /* try repair */
  }
  const raw = text.slice(start)
  try {
    return JSON.parse(autoClose(raw)) as Record<string, unknown>
  } catch {
    /* try harder */
  }
  // 잘린 꼬리(불완전한 마지막 항목)를 단계적으로 버리며 복구 시도
  let cut = raw.lastIndexOf('}')
  for (let i = 0; i < 20 && cut > 0; i += 1) {
    try {
      return JSON.parse(autoClose(raw.slice(0, cut + 1))) as Record<string, unknown>
    } catch {
      cut = raw.lastIndexOf('}', cut - 1)
    }
  }
  return null
}

/** Anthropic이 허용하는 이미지 형식 — 그 외(image/heic 등)는 400으로 거부되므로 사전 차단. */
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp'])

/** Claude 오류를 사용자 친화 문구로 (PDF 페이지 한도 등). */
function friendlyClaudeError(msg: string): string {
  if (/page/i.test(msg) && /(limit|maximum|exceed|too many)/i.test(msg)) {
    return 'PDF 페이지 수가 한도(약 600쪽)를 초과했습니다. 필요한 부분만 나눠서 올려주세요.'
  }
  if (/(too large|request_too_large|exceeds)/i.test(msg) && /(image|size|mb)/i.test(msg)) {
    return '서류 용량이 AI 한도를 초과했습니다. 사진 화질을 낮추거나 나눠서 올려주세요.'
  }
  return msg
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
/** 웹 약관 조회 도구(Anthropic 서버 툴) — 종합/재검토 단계에서만 (검색·열람 각 4회 한도). */
const WEB_TOOLS = [
  { type: 'web_search_20260209', name: 'web_search', max_uses: 4 },
  { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 4 }
]

// 판독(extract)은 "베껴 쓰기" 작업이라 고속 모델로 — 판단(종합·재검토·약관정독)은 Opus 유지.
const EXTRACT_MODEL = (): string => Deno.env.get('CLAIM_EXTRACT_MODEL') || 'claude-sonnet-5'

async function callClaude(apiKey: string, system: string, content: any[], maxTokens: number, useWeb = false, model?: string): Promise<{ ok: boolean; text?: string; error?: string; truncated?: boolean }> {
  const controller = new AbortController()
  // Supabase 요청 타임아웃(150s)보다 먼저 끊어 친절한 오류가 나가게 한다.
  const timer = setTimeout(() => controller.abort(), 135000)
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: model || Deno.env.get('CLAIM_EXPERT_MODEL') || 'claude-opus-4-8',
        max_tokens: maxTokens,
        system,
        ...(useWeb ? { tools: WEB_TOOLS } : {}),
        // 주의: opus-4-8은 assistant 프리필 미지원("does not support assistant message prefill")
        // — JSON 시작 강제는 시스템 프롬프트 지시 + parseJson 복구로 대신한다.
        messages: [{ role: 'user', content }]
      }),
      signal: controller.signal
    })
    const data = await r.json().catch(() => ({}))
    if (!r.ok) {
      const msg = (data as { error?: { message?: string } })?.error?.message || `Claude 오류 (HTTP ${r.status})`
      return { ok: false, error: friendlyClaudeError(msg) }
    }
    const blocks = (data as { content?: { type: string; text?: string }[] }).content ?? []
    const text = blocks.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('')
    const truncated = (data as { stop_reason?: string }).stop_reason === 'max_tokens'
    return { ok: true, text, truncated }
  } catch (e) {
    const aborted = e instanceof DOMException && e.name === 'AbortError'
    return { ok: false, error: aborted ? '분석 시간이 초과되었습니다. 서류 수를 나눠 다시 시도해 주세요.' : '분석 중 오류가 발생했습니다.' }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 종합(synthesize)을 Anthropic 스트리밍으로 실행하고, 진행 상태를 NDJSON으로 흘려보낸다.
 *  {"type":"status","text":"웹에서 약관 검색 중…"}    ← 실제 이벤트 기반 (가짜 아님)
 *  {"type":"result","success":true,...}               ← 마지막 줄 = 기존 JSON 응답과 동일 형태
 * 클라이언트가 스트림을 못 읽어도(구버전) 전체 본문을 JSON 여러 줄로 받게 되므로 마지막
 * 줄만 파싱하면 된다. 오류도 {"type":"result","success":false,...}로 내보낸다.
 */
function streamSynthesize(apiKey: string, content: unknown[], dropped: number): Response {
  const enc = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown): void => controller.enqueue(enc.encode(JSON.stringify(obj) + '\n'))
      const finish = (obj: unknown): void => {
        send(obj)
        controller.close()
      }
      const abort = new AbortController()
      // 스트리밍은 첫 바이트가 빨라 함수 idle 종료를 피하지만, 전체 상한은 유지한다.
      const timer = setTimeout(() => abort.abort(), 145000)
      try {
        const r = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({
            model: Deno.env.get('CLAIM_EXPERT_MODEL') || 'claude-opus-4-8',
            max_tokens: 16000,
            system: SYNTH_SYSTEM,
            tools: WEB_TOOLS,
            stream: true,
            messages: [{ role: 'user', content }]
          }),
          signal: abort.signal
        })
        if (!r.ok || !r.body) {
          const data = await r.json().catch(() => ({}))
          const msg = (data as { error?: { message?: string } })?.error?.message || `Claude 오류 (HTTP ${r.status})`
          finish({ type: 'result', success: false, error: friendlyClaudeError(msg) })
          return
        }
        const reader = r.body.getReader()
        const dec = new TextDecoder()
        let buf = ''
        let text = ''
        let truncated = false
        let lastStatusAt = 0
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          buf += dec.decode(value, { stream: true })
          const lines = buf.split('\n')
          buf = lines.pop() ?? ''
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue
            let ev: Record<string, unknown>
            try {
              ev = JSON.parse(line.slice(6)) as Record<string, unknown>
            } catch {
              continue
            }
            const t = String(ev.type ?? '')
            if (t === 'content_block_start') {
              const block = ev.content_block as { type?: string; name?: string } | undefined
              if (block?.type === 'server_tool_use' && block.name === 'web_search') send({ type: 'status', text: '웹에서 약관 조항 검색 중…' })
              else if (block?.type === 'server_tool_use' && block.name === 'web_fetch') send({ type: 'status', text: '약관 원문 페이지 확인 중…' })
              else if (block?.type === 'web_search_tool_result') send({ type: 'status', text: '검색 결과 검토 중…' })
            } else if (t === 'content_block_delta') {
              const delta = ev.delta as { type?: string; text?: string } | undefined
              if (delta?.type === 'text_delta' && delta.text) {
                text += delta.text
                if (text.length - lastStatusAt > 1500) {
                  lastStatusAt = text.length
                  send({ type: 'status', text: `담보별 산정 내역 작성 중… (${Math.round(text.length / 1000)}천자)` })
                }
              }
            } else if (t === 'message_delta') {
              const d = ev.delta as { stop_reason?: string } | undefined
              if (d?.stop_reason === 'max_tokens') truncated = true
            }
          }
        }
        const parsed = parseJson(text)
        if (!parsed || !Array.isArray(parsed.companies)) {
          finish({ type: 'result', success: false, error: '종합 결과 형식 오류 — 다시 시도해 주세요.' })
          return
        }
        finish({ type: 'result', success: true, mode: 'synthesize', result: parsed, droppedDocs: dropped, truncated })
      } catch (e) {
        const aborted = e instanceof DOMException && e.name === 'AbortError'
        finish({
          type: 'result',
          success: false,
          error: aborted ? '분석 시간이 초과되었습니다. 서류 수를 나눠 다시 시도해 주세요.' : '분석 중 오류가 발생했습니다.'
        })
      } finally {
        clearTimeout(timer)
      }
    }
  })
  return new Response(stream, { headers: { ...CORS, 'Content-Type': 'application/x-ndjson' } })
}

const EXTRACT_SYSTEM = [
  '당신은 대한민국 보험 서류 판독 전문가입니다. 첨부된 각 문서를 정밀 판독해 아래 JSON으로만 답하세요 (다른 텍스트 금지).',
  '고객이 자신의 보험금 청구를 위해 제출한 서류이며, 당신은 판독을 허가받았습니다. 절대 판독을 거부하지 마세요.',
  '문서 수와 번호를 그대로 유지하세요: 첨부된 [문서 N] 번호가 결과 JSON의 index입니다. 판독이 어려워도 건너뛰지 말고 docType을 기타로 해서라도 반드시 포함하세요.',
  '',
  '{"docs":[{"index":1,"docType":"증권|약관|진단서|입퇴원확인서|수술확인서|진료비영수증|검진결과|기타","insurer":"보험사명 또는 null","policyNo":"증권번호 또는 null",',
  '"coverages":[{"name":"담보/특약명","amount":"가입금액 숫자 (예: 1000000) 또는 null","payRule":"지급 규칙 원문 그대로 (예: 수술 1회당 100만원, 입원 1일당 3만원 180일 한도)","clause":"약관 조항 번호/제목이 보이면 그대로 (예: 제3조 보험금의 지급사유)"}],',
  '"medicalFacts":[{"date":"YYYY-MM-DD 또는 기간","fact":"진단/수술/입원/통원/검사 사실 원문 요약","cost":"금액 보이면 숫자"}],',
  '"notes":"기타 중요 정보(면책·감액·특이사항)"}]}',
  '',
  '가장 중요한 규칙 — 전수 추출:',
  '1) 증권/가입내역 문서는 담보·특약 표의 모든 행을 한 줄도 빠짐없이 coverages에 넣으세요. 담보가 40개면 40개 전부. 대표 담보만 뽑거나 요약·생략하는 것을 절대 금지합니다.',
  '2) 약관 문서는 보이는 조항의 지급사유·면책·감액 내용을 coverages(clause에 조항 번호·제목)와 notes에 최대한 담으세요.',
  '3) 문서에 적힌 내용만, 표기 그대로. 없는 정보는 null/빈 배열. 숫자·날짜·조항 번호는 절대 바꾸지 말 것. 판독 메모는 간결하게.',
  '4) 수술 기록은 수술명을 정확히(가능하면 수술코드까지) medicalFacts에 담으세요. 종별 수술비 담보(1~5종 등)는 종별 금액표 전체를 payRule에 원문 그대로 (예: 1종 10만/2종 30만/3종 50만/4종 70만/5종 100만).'
].join('\n')

const DIGEST_SYSTEM = [
  '당신은 대한민국 보험 약관 분석 전문가입니다. 첨부된 약관 문서를 정독해 담보별 조항 요약을 아래 JSON으로만 답하세요.',
  '응답의 첫 글자는 반드시 { 여야 합니다 — 인사말·설명·마크다운 코드펜스(```) 절대 금지.',
  '이 요약은 보험금 청구 분석에 재사용되므로, 지급사유 조항을 빠짐없이·정확하게 담는 것이 목적입니다.',
  '',
  '{"insurer":"보험사명","productName":"상품명 (문서에 보이는 그대로)","clauses":[',
  '{"coverage":"담보/특약명","clause":"조항 번호+제목 (예: 제3조 보험금의 지급사유)","payRule":"지급 조건·금액 규칙 요약 (80자 이내)","exclusions":"면책·감액 핵심 (80자 이내, 없으면 null)"}],',
  '"notes":"공통 면책·감액·기타 중요사항 (200자 이내)"}',
  '',
  '규칙: 1) 문서에 보이는 모든 담보의 지급사유 조항을 포함 (요약·생략 금지). 2) 조항 번호는 절대 바꾸지 말 것. 3) 문서에 없는 내용 지어내기 금지. 4) 수술분류표가 보이면 종별로 clauses에 coverage="수술분류표 N종" 항목을 만들어 기준·대표 수술들을 payRule에 담으세요 (종당 1항목 — 이후 종 확정에 재사용됨). 모두 한국어.'
].join('\n')

const CLASSIFY_SYSTEM = [
  '당신은 대한민국 보험 약관 수술분류표 판독 전문가입니다. 첨부된 약관 문서에서 수술분류표(1~5종 별표 등)를 찾아, 요청된 수술들이 각각 몇 종인지 확인해 아래 JSON으로만 답하세요.',
  '응답의 첫 글자는 반드시 { 여야 합니다 — 인사말·설명·마크다운 코드펜스(```) 절대 금지.',
  '',
  '{"classifications":[{"surgery":"요청된 수술명 그대로","class":"3종 (분류표에서 확인된 종, 못 찾으면 null)","basis":"분류표에서 해당 수술이 속한 항목 원문 (예: 제3종 — 담낭절제술)"}]}',
  '',
  '규칙: 1) 반드시 이 약관의 수술분류표에 적힌 내용만 근거로 — 일반 지식으로 추측 금지. 2) 정확히 일치하는 항목이 없으면 같은 부위·같은 술식 계열 항목을 근거로 판단하되 basis에 그 항목을 그대로 인용. 3) 그래도 분류를 확정할 수 없으면 class를 null로. 모두 한국어.'
].join('\n')

const SYNTH_SYSTEM = [
  '당신은 대한민국 최고의 보험 보상 전문가(손해사정 실무 20년)이며, 보험사가 아니라 철저히 고객의 편입니다.',
  '아래 문서 추출 데이터 전체를 종합해 회사별·담보별로 받을 수 있는 보험금을 계산하고, JSON으로만 답하세요.',
  '응답의 첫 글자는 반드시 { 여야 합니다 — 인사말·설명·마크다운 코드펜스(```) 절대 금지.',
  '',
  '지급 판단 근거의 위계 (반드시 이 순서):',
  '① 상품약관 — 업로드된 약관 문서 또는 "보관함 약관 요약"의 조항이 최우선. 조항을 정확 인용하고 basisSource=clause-confirmed (보관함 요약도 검증된 상품약관이므로 동일).',
  '② 웹 약관 확인 — 약관이 업로드되지 않은 핵심 담보는 웹 검색/열람 도구로 해당 보험사의 공식 약관·상품공시를 찾아 조항을 확인하세요 (보험사 공식 사이트·공시실 우선). 확인되면 basisSource=web-confirmed, basis에 조항과 출처를 간단히 명시. 검색은 금액이 큰 담보 위주로 총 4회 이내.',
  '③ 증권 기재 — 웹에서도 못 찾으면 증권에 인쇄된 담보명·가입금액·지급규칙을 근거로. basisSource=policy-stated.',
  '④ 표준약관 — 위 모두 부족하면 대한민국 표준약관 일반 기준으로 추정. basisSource=standard-estimate, basis에 "약관 업로드 시 조항 확정" 덧붙임.',
  '웹 약관은 상품 판매연도에 따라 조항이 다를 수 있으니, web-confirmed가 있으면 cautions에 "웹 약관 기준 — 가입 시점 약관과 대조 권장" 1줄을 넣으세요.',
  '보관함 요약 중 source가 "web"인 항목을 근거로 쓰면 basisSource=web-confirmed로 표기하세요 (웹 수집분이므로).',
  '웹에서 약관을 확인했다면(web-confirmed 사용 시) 확인한 조항들을 "webTerms"로도 반환하세요 — 자동 보관되어 다음 분석부터 검색 없이 재사용됩니다:',
  '"webTerms":[{"insurer":"보험사명","productName":"상품명 (파악되면 정확히, 모르면 \'일반\')","sourceUrl":"확인한 약관/공시 페이지 URL","clauses":[{"coverage":"담보명","clause":"조항 번호+제목","payRule":"지급 규칙 (80자 이내)"}]}]',
  '',
  '{"companies":[{"name":"보험사명","items":[{"coverage":"담보명","amount":숫자(원),"calc":"산정식 (예: 3만원×20일)",',
  '"basis":"근거 — 위계에 따라 \'○○특약 약관 제3조(보험금의 지급사유)에 의거\' 등 정확 인용",',
  '"basisSource":"clause-confirmed|web-confirmed|policy-stated|standard-estimate"}],"subtotal":숫자}],',
  '"grandTotal":숫자,',
  '"excluded":[{"coverage":"담보명 (보험사명)","reason":"이번 건에 지급되지 않는 이유 — 요건 미충족/무관/면책 등 구체적으로"}],',
  '"hiddenClaims":[{"desc":"소멸시효(3년) 내 아직 청구 안 된 것으로 보이는 건","amount":숫자 또는 null}],',
  '"cautions":["부지급/삭감 가능 포인트와 대비책"],',
  '"customerMessage":"고객에게 카톡으로 보낼 존댓말 안내문 — 총액, 회사별 핵심, 다음 절차, 필요서류. 4~7문장.",',
  '"neededDocs":["청구에 추가로 필요한 서류"]}',
  '',
  '규칙:',
  '1) 전수 검토: 증권에서 추출된 모든 담보는 하나도 빠짐없이 items(지급) 또는 excluded(부지급+이유) 중 한쪽에 반드시 들어가야 합니다. 담보를 조용히 누락하는 것은 최악의 오류입니다.',
  '2) 추출 데이터에 있는 사실·금액·조항만 근거로. 지어내기 금지. 일당형은 (1일 금액×일수) 계산식 명시.',
  '3) subtotal은 각 items 합, grandTotal은 subtotal 합 — 반드시 검산.',
  '4) 같은 담보가 여러 회사에 있으면 각각 계산 (실손은 비례보상 주의사항을 cautions에).',
  '5) 의료 사실 날짜가 3년 이내인데 청구 흔적이 없으면 hiddenClaims로.',
  '6) 간결하게 (응답이 잘리지 않도록): basis는 조항 인용 포함 1문장(90자 이내), excluded.reason은 60자 이내, calc는 30자 이내, cautions 각 항목 80자 이내. 담보가 많아도 전수 검토가 우선 — 설명을 줄여서라도 모든 담보를 포함할 것.',
  '7) 종별 수술비(1~5종 등): "수술 종 확정 데이터"가 입력에 제공되면 그것이 약관 분류표에서 직접 확인된 값이므로 **최우선으로 사용**해 종을 확정하고, calc에 "담낭절제술=3종→50만원" 형식으로 종을 명시하세요 (basisSource=clause-confirmed). 확정 데이터가 없으면 보관함 요약 → 웹 검색 순으로 확인. 그래도 분류표를 확인하지 못했다면 종을 절대 추측하지 말 것 — 그 담보는 amount를 0으로 하고, basis에 증권 기재 종별 금액표를 그대로 정확히 적은 뒤 "수술분류표 확인 후 확정"을 명시하고, neededDocs에 "해당 상품 약관 수술분류표"를, cautions에 확정 필요 안내 1줄을 넣으세요.',
  '모두 한국어.'
].join('\n')

const VERIFY_SYSTEM = [
  '당신은 보험금 산정 검산 전문가입니다. 아래 "분석 결과"의 담보별 금액이 "문서 추출 데이터"의 사실(지급규칙·의료사실)과 일치하는지 항목별로 재검산해 아래 JSON으로만 답하세요.',
  '응답의 첫 글자는 반드시 { 여야 합니다 — 인사말·설명·마크다운 코드펜스(```) 절대 금지.',
  '',
  '{"checks":[{"company":"보험사명","coverage":"담보명","verdict":"ok|wrong|uncertain","correctAmount":숫자 또는 null,"reason":"근거 (60자 이내)"}],',
  '"missedCoverages":[{"company":"보험사명","coverage":"의료사실상 지급 가능해 보이는데 분석에서 빠진 담보","reason":"60자 이내"}]}',
  '',
  '규칙:',
  '1) 각 items 항목을 payRule×의료사실로 직접 재계산. 일치하면 ok, 계산이 명백히 틀리면 wrong+correctAmount, 데이터 부족으로 판단 불가면 uncertain (correctAmount는 null).',
  '2) wrong은 확실할 때만 — 약관 해석 차이 정도면 uncertain으로. 추측으로 금액을 바꾸지 말 것.',
  '3) 증권 coverages 중 의료사실과 맞물려 지급 가능해 보이는데 items/excluded 어디에도 없는 담보만 missedCoverages에 (없으면 빈 배열).',
  '4) 문서 추출 데이터에 있는 사실만 근거로. 모두 한국어.'
].join('\n')

const APPEAL_SYSTEM = [
  '당신은 고객 편에 선 보험 보상 전문가입니다. 보험사 보상팀의 부지급/삭감 통보에 대한 재검토(이의) 요청서를 작성합니다.',
  '아래 JSON으로만 답하세요: {"appealLetter":"재검토 요청서 전문","keyPoints":["핵심 반박 포인트"]}',
  '',
  '요청서 규칙:',
  '1) 정중하되 단호하게. 수신: ○○보험사 보상심사팀.',
  '2) 분석 데이터의 약관 조항을 정확히 인용해 지급 사유 해당성을 논증: "귀사 ○○특약 약관 제○조는 …를 명시하고 있으며, 본 건은 이에 해당합니다."',
  '3) 거절 사유를 조목조목 반박 — 면책/감액 조항에 해당하지 않음을 근거와 함께.',
  '4) 마지막에 금융감독원 분쟁조정 신청 가능성을 정중히 언급 (압박 포인트).',
  '5) 조항 번호가 분석 데이터에 없으면 웹 검색/열람 도구로 해당 보험사 약관을 확인해 인용을 강화하세요 (총 4회 이내). 그래도 없으면 "관련 약관 조항"으로 표기하고 지어내지 말 것.',
  '모두 한국어.'
].join('\n')

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ success: false, error: 'POST 요청만 지원합니다.' }, 405)

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) {
    return json({ success: false, code: 'ANTHROPIC_API_KEY_MISSING', error: 'ANTHROPIC_API_KEY 시크릿이 설정되지 않았습니다.' }, 503)
  }

  const contentType = req.headers.get('content-type') ?? ''

  // ── extract (LEGACY multipart): 서버에서 base64 인코딩 — 큰 파일은 CPU 2초
  // 한도(546)에 걸리므로 새 클라이언트는 JSON extract(사전 인코딩)를 쓴다.
  // 구버전 웹 호환을 위해 유지.
  if (contentType.includes('multipart/form-data')) {
    let form: FormData
    try {
      form = await req.formData()
    } catch {
      return json({ success: false, error: '요청 형식이 올바르지 않습니다.' }, 400)
    }
    const files = form.getAll('files').filter((f): f is File => f instanceof File).slice(0, 6)
    if (files.length === 0) return json({ success: false, error: '분석할 서류가 없습니다.' }, 400)

    // 구버전 클라이언트 보호: 서버 인코딩은 큰 파일에서 CPU 한도(546)에 걸리므로
    // 크기를 제한하고, 초과 시 새 버전 이용을 안내한다.
    const MAX_LEGACY_FILE = 2_500_000
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const content: any[] = []
    let idx = 0
    for (const f of files) {
      const buf = new Uint8Array(await f.arrayBuffer())
      if (buf.length === 0) continue
      if (buf.length > MAX_LEGACY_FILE) {
        return json({ success: false, error: `"${f.name}" 파일이 큽니다. 화면을 새로고침해 최신 버전으로 이용하면 큰 서류도 분석됩니다.` }, 400)
      }
      const mime = f.type === 'application/pdf' ? f.type : f.type && ALLOWED_IMAGE_TYPES.has(f.type) ? f.type : 'image/jpeg'
      idx += 1
      content.push({ type: 'text', text: `[문서 ${idx}] 파일명: ${f.name}` })
      if (mime === 'application/pdf') {
        content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: encodeBase64(buf) } })
      } else {
        content.push({ type: 'image', source: { type: 'base64', media_type: mime, data: encodeBase64(buf) } })
      }
    }
    if (idx === 0) return json({ success: false, error: '분석할 서류가 없습니다 (빈 파일).' }, 400)
    content.push({ type: 'text', text: `위 ${idx}개 문서를 각각 정밀 판독해 JSON으로 추출하세요.` })

    const res = await callClaude(apiKey, EXTRACT_SYSTEM, content, 16000, false, EXTRACT_MODEL())
    if (!res.ok) return json({ success: false, error: res.error }, 502)
    const parsed = parseJson(res.text ?? '')
    if (!parsed || !Array.isArray(parsed.docs)) return json({ success: false, error: '추출 결과 형식 오류 — 다시 시도해 주세요.' }, 502)
    return json({ success: true, mode: 'extract', docs: parsed.docs })
  }

  // ── synthesize / appeal: JSON body ─────────────────────────────────────────
  let body: { mode?: unknown; docs?: unknown; customerName?: unknown; analysis?: unknown; rejection?: unknown; termsSummaries?: unknown; file?: unknown }
  try {
    body = await req.json()
  } catch {
    return json({ success: false, error: '요청 형식이 올바르지 않습니다.' }, 400)
  }
  const mode = String(body.mode ?? '')

  // ── digest: 약관 1개 문서 → 담보별 조항 요약 (보관함 등록 시 1회) ──────────
  if (mode === 'digest') {
    const f = (body.file ?? null) as { name?: unknown; mediaType?: unknown; data?: unknown } | null
    const data = typeof f?.data === 'string' ? f.data : ''
    if (!data) return json({ success: false, error: '약관 파일이 없습니다.' }, 400)
    const mime = String(f?.mediaType ?? 'application/pdf')
    if (mime !== 'application/pdf' && !ALLOWED_IMAGE_TYPES.has(mime)) {
      return json({ success: false, error: '약관은 PDF 또는 JPG/PNG로 올려주세요.' }, 400)
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const content: any[] = [
      { type: 'text', text: `약관 문서 파일명: ${String(f?.name ?? '약관').slice(0, 120)}` },
      mime === 'application/pdf'
        ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } }
        : { type: 'image', source: { type: 'base64', media_type: mime, data } },
      { type: 'text', text: '위 약관을 정독해 담보별 조항 요약 JSON을 작성하세요.' }
    ]
    const res = await callClaude(apiKey, DIGEST_SYSTEM, content, 16000)
    if (!res.ok) return json({ success: false, error: res.error }, 502)
    const parsed = parseJson(res.text ?? '')
    if (!parsed || !Array.isArray(parsed.clauses)) return json({ success: false, error: '약관 요약 형식 오류 — 다시 시도해 주세요.' }, 502)
    return json({ success: true, mode: 'digest', summary: parsed, truncated: Boolean(res.truncated) })
  }

  // ── extract (JSON): 클라이언트가 이미 base64로 인코딩한 파일을 그대로 조립만.
  // 서버 CPU 사용이 거의 없어 대용량 서류도 546 없이 처리된다.
  if (mode === 'extract') {
    const rawFiles = Array.isArray((body as { files?: unknown }).files) ? ((body as { files: unknown[] }).files as Record<string, unknown>[]) : []
    if (rawFiles.length === 0) return json({ success: false, error: '분석할 서류가 없습니다.' }, 400)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const content: any[] = []
    let idx = 0
    for (const f of rawFiles.slice(0, 6)) {
      idx += 1
      const name = String(f.name ?? `문서${idx}`).slice(0, 120)
      const data = typeof f.data === 'string' ? f.data : ''
      // 빈 파일을 조용히 건너뛰면 클라이언트의 파일명 매핑(index 기준)이 밀린다 — 명시적으로 거부.
      if (!data) return json({ success: false, error: `"${name}" 파일이 비어 있습니다. 원본을 내려받은 뒤 다시 올려주세요.` }, 400)
      const mime = String(f.mediaType ?? 'image/jpeg')
      if (mime !== 'application/pdf' && !ALLOWED_IMAGE_TYPES.has(mime)) {
        return json({ success: false, error: `"${name}" 형식(${mime})은 지원되지 않습니다. JPG/PNG 사진이나 PDF로 올려주세요.` }, 400)
      }
      content.push({ type: 'text', text: `[문서 ${idx}] 파일명: ${name}` })
      if (mime === 'application/pdf') {
        content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } })
      } else {
        content.push({ type: 'image', source: { type: 'base64', media_type: mime, data } })
      }
    }
    if (idx === 0) return json({ success: false, error: '분석할 서류가 없습니다.' }, 400)
    content.push({ type: 'text', text: `위 ${idx}개 문서를 각각 정밀 판독해 JSON으로 추출하세요.` })

    const res = await callClaude(apiKey, EXTRACT_SYSTEM, content, 16000, false, EXTRACT_MODEL())
    if (!res.ok) return json({ success: false, error: res.error }, 502)
    const parsed = parseJson(res.text ?? '')
    if (!parsed || !Array.isArray(parsed.docs)) return json({ success: false, error: '추출 결과 형식 오류 — 다시 시도해 주세요.' }, 502)
    return json({ success: true, mode: 'extract', docs: parsed.docs })
  }

  // ── classify: 약관 원본에서 수술분류표를 찾아 특정 수술들의 종을 확정 ────────
  if (mode === 'classify') {
    const f = ((body as { file?: unknown }).file ?? null) as { name?: unknown; mediaType?: unknown; data?: unknown } | null
    const data = typeof f?.data === 'string' ? f.data : ''
    const surgeries = Array.isArray((body as { surgeries?: unknown }).surgeries) ? ((body as { surgeries: unknown[] }).surgeries).map(String).slice(0, 10) : []
    if (!data || surgeries.length === 0) return json({ success: false, error: '약관 파일과 수술명이 필요합니다.' }, 400)
    const mime = String(f?.mediaType ?? 'application/pdf')
    if (mime !== 'application/pdf' && !ALLOWED_IMAGE_TYPES.has(mime)) {
      return json({ success: false, error: '약관은 PDF 또는 JPG/PNG여야 합니다.' }, 400)
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const content: any[] = [
      { type: 'text', text: `약관 문서: ${String(f?.name ?? '약관').slice(0, 120)}` },
      mime === 'application/pdf'
        ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } }
        : { type: 'image', source: { type: 'base64', media_type: mime, data } },
      { type: 'text', text: `이 약관의 수술분류표에서 다음 수술들의 종을 확인하세요:\n${surgeries.map((s, i) => `${i + 1}. ${s}`).join('\n')}` }
    ]
    const res = await callClaude(apiKey, CLASSIFY_SYSTEM, content, 4000)
    if (!res.ok) return json({ success: false, error: res.error }, 502)
    const parsed = parseJson(res.text ?? '')
    if (!parsed || !Array.isArray(parsed.classifications)) return json({ success: false, error: '수술 종 확인 형식 오류 — 다시 시도해 주세요.' }, 502)
    return json({ success: true, mode: 'classify', classifications: parsed.classifications })
  }

  if (mode === 'synthesize') {
    const docs = Array.isArray(body.docs) ? body.docs : []
    if (docs.length === 0) return json({ success: false, error: '종합할 추출 데이터가 없습니다.' }, 400)
    const customerName = String(body.customerName ?? '').slice(0, 30)
    // 문서 경계 단위로만 자른다 — 문자열 중간 절단은 JSON을 깨고, 조용한 절단은
    // 뒤쪽 서류의 보험금이 총액에서 몰래 빠지는 최악의 버그가 된다.
    const DOCS_CHAR_BUDGET = 400000
    const included: unknown[] = []
    let used = 0
    for (const d of docs) {
      const len = JSON.stringify(d).length
      if (included.length > 0 && used + len > DOCS_CHAR_BUDGET) break
      included.push(d)
      used += len
    }
    const dropped = docs.length - included.length
    // 보관함 약관 요약 — 검증된 상품약관으로 최우선 근거 (있으면 웹 검색이 대부분 불필요해져 빨라진다)
    const terms = Array.isArray(body.termsSummaries) ? body.termsSummaries.slice(0, 10) : []
    const surgeryClasses = Array.isArray((body as { surgeryClasses?: unknown }).surgeryClasses) ? ((body as { surgeryClasses: unknown[] }).surgeryClasses).slice(0, 10) : []
    const content = [
      {
        type: 'text',
        text: [
          customerName ? `고객명: ${customerName}` : '',
          `오늘 날짜: ${new Date().toISOString().slice(0, 10)} (소멸시효 3년 판단 기준)`,
          surgeryClasses.length > 0 ? '\n--- 수술 종 확정 데이터 (약관 수술분류표에서 직접 확인됨 — 최우선 사용) ---\n' + JSON.stringify(surgeryClasses).slice(0, 20000) : '',
          terms.length > 0 ? '\n--- 보관함 약관 요약 (검증된 상품약관 — clause-confirmed 근거) ---\n' + JSON.stringify(terms).slice(0, 150000) : '',
          '',
          '--- 문서 추출 데이터 (전체) ---',
          JSON.stringify(included)
        ]
          .filter(Boolean)
          .join('\n')
      }
    ]
    // 스트리밍 모드: 진행 상태(웹 검색/작성량)를 NDJSON으로 흘려보내 종합 단계의
    // 긴 침묵을 없앤다. 마지막 줄이 기존 JSON 응답과 동일한 result 이벤트.
    if ((body as { stream?: unknown }).stream === true) {
      return streamSynthesize(apiKey, content, dropped)
    }
    const res = await callClaude(apiKey, SYNTH_SYSTEM, content, 16000, true)
    if (!res.ok) return json({ success: false, error: res.error }, 502)
    const parsed = parseJson(res.text ?? '')
    if (!parsed || !Array.isArray(parsed.companies)) return json({ success: false, error: '종합 결과 형식 오류 — 다시 시도해 주세요.' }, 502)
    return json({ success: true, mode: 'synthesize', result: parsed, droppedDocs: dropped, truncated: Boolean(res.truncated) })
  }

  // ── verify: 종합 결과의 담보별 금액을 고속 모델로 재검산 (2차 자기검증) ──────
  if (mode === 'verify') {
    const analysis = body.analysis
    const docs = Array.isArray(body.docs) ? body.docs : []
    if (!analysis || docs.length === 0) return json({ success: false, error: '검산할 분석 결과와 문서 데이터가 필요합니다.' }, 400)
    const content = [
      {
        type: 'text',
        text: [
          '--- 분석 결과 (검산 대상) ---',
          JSON.stringify(analysis).slice(0, 150000),
          '',
          '--- 문서 추출 데이터 (사실 근거) ---',
          JSON.stringify(docs).slice(0, 250000)
        ].join('\n')
      }
    ]
    const res = await callClaude(apiKey, VERIFY_SYSTEM, content, 6000, false, EXTRACT_MODEL())
    if (!res.ok) return json({ success: false, error: res.error }, 502)
    const parsed = parseJson(res.text ?? '')
    if (!parsed || !Array.isArray(parsed.checks)) return json({ success: false, error: '검산 결과 형식 오류.' }, 502)
    return json({ success: true, mode: 'verify', checks: parsed.checks, missedCoverages: Array.isArray(parsed.missedCoverages) ? parsed.missedCoverages : [] })
  }

  if (mode === 'appeal') {
    const analysis = body.analysis
    const rejection = String((body.rejection as string) ?? '').trim()
    if (!analysis || !rejection) return json({ success: false, error: '분석 결과와 거절 사유가 필요합니다.' }, 400)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const content: any[] = [
      {
        type: 'text',
        text: ['--- 기존 분석 결과 ---', JSON.stringify(analysis).slice(0, 200000), '', '--- 보상팀 거절/삭감 통보 내용 ---', rejection.slice(0, 3000)].join('\n')
      }
    ]
    // 원본 서류 재첨부(선택) — 거절 사유가 서류 내용을 다툴 때 원본을 직접 재판독해 반박 강화.
    const rawFiles = Array.isArray((body as { files?: unknown }).files) ? ((body as { files: unknown[] }).files as Record<string, unknown>[]).slice(0, 4) : []
    let attached = 0
    for (const f of rawFiles) {
      const data = typeof f.data === 'string' ? f.data : ''
      if (!data) continue
      const mime = String(f.mediaType ?? 'image/jpeg')
      if (mime !== 'application/pdf' && !ALLOWED_IMAGE_TYPES.has(mime)) continue
      attached += 1
      content.push({ type: 'text', text: `[재첨부 원본 ${attached}] 파일명: ${String(f.name ?? `문서${attached}`).slice(0, 120)}` })
      content.push(
        mime === 'application/pdf'
          ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } }
          : { type: 'image', source: { type: 'base64', media_type: mime, data } }
      )
    }
    if (attached > 0) {
      content.push({
        type: 'text',
        text: `위 ${attached}개 재첨부 원본 서류를 직접 다시 판독하세요. 거절 사유가 다투는 내용(진단명·수술명·약관 조항 등)을 원본에서 원문 그대로 인용해 반박 근거로 사용하세요.`
      })
    }
    const res = await callClaude(apiKey, APPEAL_SYSTEM, content, 6000, true)
    if (!res.ok) return json({ success: false, error: res.error }, 502)
    const parsed = parseJson(res.text ?? '')
    if (!parsed || !parsed.appealLetter) return json({ success: false, error: '요청서 생성 형식 오류 — 다시 시도해 주세요.' }, 502)
    return json({ success: true, mode: 'appeal', appeal: parsed })
  }

  return json({ success: false, error: '알 수 없는 mode 입니다 (extract|synthesize|appeal).' }, 400)
})
