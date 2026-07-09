// SJ INVEST — 보험서류 자동청구 팩스 발송 (send-claim-fax)
//
// POST { submissionId, files:[{path,name,mediaType,data(base64)}], targets:[{insurer,filePaths[]}] }
//   - 로그인한 FC 본인(제출 소유자) 또는 owner/admin만 호출.
//   - 최대 3개 보험사에 동시 청구 접수(팩스). 회사별 filePaths = 그 회사에 보낼 서류만.
//   - 목적지 팩스번호는 서버가 insurer_fax에서 조회한다(클라이언트가 번호를 보내지 않음).
//   - 이미 발송(sent)된 대상은 재발송하지 않는다(중복 청구/이중 과금 차단).
//
// ⚠ 서버는 파일을 base64 인코딩하지 않는다 — 클라이언트가 보낸 base64를 솔라피에
//    그대로 패스스루한다(청구비서 '546' CPU 한도 사건 교훈). 감사용 원본은 클라이언트가
//    claim-fax 버킷에 별도 저장한다(이 함수는 전송만 담당).
//
// 솔라피(SOLAPI) 팩스 API — 필요한 시크릿:
//   SOLAPI_API_KEY / SOLAPI_API_SECRET   솔라피 콘솔 > API Key (알림톡과 동일 계정)
//   SOLAPI_FAX_SENDER                    팩스 발신번호 (솔라피에 사전등록된 팩스번호)
// 시크릿이 없으면 503 CLAIM_FAX_NOT_CONFIGURED — 앱은 "설정 전" 안내만 표시.
//
// ⚠ 배포 전 확인: 솔라피 팩스 업로드/발송 엔드포인트·파라미터를 현재 솔라피 문서와
//    대조할 것(아래 storage/v1/files + messages/v4/send FAX 옵션 형태 기준으로 작성).

import { createClient } from 'jsr:@supabase/supabase-js@2'

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}

const MAX_TARGETS = 3
/** 요청 전체 base64 합계 상한(~9MB) — 초과 시 서류를 줄이라고 안내. */
const MAX_TOTAL_B64 = 9_500_000

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
}

function faxDigits(s: string): string {
  return (s ?? '').replace(/\D/g, '')
}

/** 솔라피 HMAC-SHA256 인증 헤더. */
async function solapiAuthHeader(apiKey: string, apiSecret: string): Promise<string> {
  const date = new Date().toISOString()
  const salt = crypto.randomUUID().replaceAll('-', '')
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(apiSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(date + salt))
  const signature = Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('')
  return `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`
}

/** 솔라피 스토리지에 팩스용 파일 업로드 → fileId. base64는 그대로 전달(서버 인코딩 없음). */
async function solapiUploadFax(auth: string, name: string, base64: string): Promise<{ ok: boolean; fileId?: string; error?: string }> {
  const res = await fetch('https://api.solapi.com/storage/v1/files', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: auth },
    body: JSON.stringify({ file: base64, name, type: 'FAX' })
  })
  const data = (await res.json().catch(() => ({}))) as { fileId?: string; errorMessage?: string; message?: string }
  if (!res.ok || !data.fileId) return { ok: false, error: data.errorMessage || data.message || `파일 업로드 실패 (HTTP ${res.status})` }
  return { ok: true, fileId: data.fileId }
}

/** 솔라피 팩스 발송 (한 회사 = 한 건, 여러 fileId = 여러 장). */
async function solapiSendFax(auth: string, from: string, to: string, fileIds: string[]): Promise<{ ok: boolean; providerId?: string; error?: string }> {
  const res = await fetch('https://api.solapi.com/messages/v4/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: auth },
    body: JSON.stringify({ message: { to, from, type: 'FAX', faxOptions: { fileIds } } })
  })
  const data = (await res.json().catch(() => ({}))) as { groupId?: string; messageId?: string; errorMessage?: string; message?: string }
  if (!res.ok) return { ok: false, error: data.errorMessage || data.message || `솔라피 팩스 오류 (HTTP ${res.status})` }
  return { ok: true, providerId: data.messageId ?? data.groupId }
}

interface ReqFile { path: string; name: string; mediaType: string; data: string }
interface ReqTarget { insurer: string; filePaths: string[] }

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ success: false, error: 'POST 요청만 지원합니다.' }, 405)

  const url = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
  if (!url || !serviceKey) return json({ success: false, error: '서버 설정 오류.' }, 500)

  const apiKey = Deno.env.get('SOLAPI_API_KEY') ?? ''
  const apiSecret = Deno.env.get('SOLAPI_API_SECRET') ?? ''
  const faxFrom = faxDigits(Deno.env.get('SOLAPI_FAX_SENDER') ?? '')
  if (!apiKey || !apiSecret || !faxFrom) {
    return json({ success: false, code: 'CLAIM_FAX_NOT_CONFIGURED', error: '자동청구(팩스) 설정 전입니다 (솔라피 팩스 발신번호·키 미등록).' }, 503)
  }

  let body: { submissionId?: unknown; files?: unknown; targets?: unknown }
  try {
    body = await req.json()
  } catch {
    return json({ success: false, error: '요청 형식이 올바르지 않습니다.' }, 400)
  }

  const submissionId = String(body.submissionId ?? '').trim()
  const files = Array.isArray(body.files) ? (body.files as ReqFile[]) : []
  const targets = Array.isArray(body.targets) ? (body.targets as ReqTarget[]) : []
  if (!submissionId) return json({ success: false, error: 'submissionId가 필요합니다.' }, 400)
  if (targets.length === 0) return json({ success: false, error: '발송할 보험사를 1개 이상 선택해주세요.' }, 400)
  if (targets.length > MAX_TARGETS) return json({ success: false, error: `한 번에 최대 ${MAX_TARGETS}개 보험사까지 발송할 수 있습니다.` }, 400)

  const totalB64 = files.reduce((n, f) => n + (typeof f.data === 'string' ? f.data.length : 0), 0)
  if (totalB64 > MAX_TOTAL_B64) {
    return json({ success: false, error: '서류 용량이 큽니다. 장수를 줄이거나 페이지를 나눠 다시 시도해주세요.' }, 413)
  }

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } })
  const bearer = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')

  // 호출자 확인
  const caller = createClient(url, anonKey, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${bearer}` } } })
  const { data: userData } = await caller.auth.getUser()
  const callerId = userData?.user?.id
  if (!callerId) return json({ success: false, error: '로그인 후 사용할 수 있습니다.' }, 401)

  // 제출 소유자/관리자 확인
  const { data: sub, error: subErr } = await admin
    .from('claim_fax_submissions')
    .select('id, staff_id')
    .eq('id', submissionId)
    .maybeSingle()
  if (subErr || !sub) return json({ success: false, error: '청구 건을 찾을 수 없습니다.' }, 404)
  if ((sub as { staff_id: string }).staff_id !== callerId) {
    const { data: prof } = await admin.from('profiles').select('role').eq('id', callerId).maybeSingle()
    const role = String((prof as { role?: string } | null)?.role ?? '')
    if (role !== 'owner' && role !== 'admin') return json({ success: false, error: '본인이 접수한 청구만 발송할 수 있습니다.' }, 403)
  }

  // 이미 큐잉된 대상 로드(재발송 방지: sent 는 건너뛴다)
  const { data: tgtRows } = await admin
    .from('claim_fax_targets')
    .select('id, insurer, status')
    .eq('submission_id', submissionId)
  const existing = new Map<string, { id: string; status: string }>()
  for (const r of (tgtRows ?? []) as { id: string; insurer: string; status: string }[]) existing.set(r.insurer, { id: r.id, status: r.status })

  const auth = await solapiAuthHeader(apiKey, apiSecret)

  // 파일 경로 → 솔라피 fileId (중복 업로드 방지: 파일은 한 번만 업로드하고 여러 회사가 공유)
  const fileById = new Map<string, ReqFile>()
  for (const f of files) if (f && typeof f.path === 'string') fileById.set(f.path, f)
  const uploadedId = new Map<string, string>()

  async function fileIdFor(path: string): Promise<{ ok: boolean; fileId?: string; error?: string }> {
    const cached = uploadedId.get(path)
    if (cached) return { ok: true, fileId: cached }
    const f = fileById.get(path)
    if (!f || !f.data) return { ok: false, error: `서류 데이터 누락: ${path}` }
    const up = await solapiUploadFax(auth, f.name || 'claim.pdf', f.data)
    if (!up.ok || !up.fileId) return { ok: false, error: up.error }
    uploadedId.set(path, up.fileId)
    return { ok: true, fileId: up.fileId }
  }

  const results: { insurer: string; ok: boolean; error?: string }[] = []

  for (const t of targets.slice(0, MAX_TARGETS)) {
    const insurer = String(t.insurer ?? '').trim()
    const paths = Array.isArray(t.filePaths) ? t.filePaths.filter((p) => typeof p === 'string') : []
    const ex = existing.get(insurer)

    // 이미 발송 완료면 건너뛴다(중복 차단)
    if (ex?.status === 'sent') {
      results.push({ insurer, ok: true })
      continue
    }
    if (paths.length === 0) {
      results.push({ insurer, ok: false, error: '보낼 서류가 없습니다.' })
      if (ex) await admin.from('claim_fax_targets').update({ status: 'failed', error: '보낼 서류 없음' }).eq('id', ex.id)
      continue
    }

    // 목적지 팩스번호 = 서버가 insurer_fax 에서 조회(클라이언트 신뢰 금지)
    const { data: faxRow } = await admin.from('insurer_fax').select('fax').eq('insurer', insurer).maybeSingle()
    const to = faxDigits(String((faxRow as { fax?: string } | null)?.fax ?? ''))
    if (!to) {
      results.push({ insurer, ok: false, error: '등록된 청구 팩스번호가 없습니다.' })
      if (ex) await admin.from('claim_fax_targets').update({ status: 'failed', error: '팩스번호 미등록' }).eq('id', ex.id)
      continue
    }

    if (ex) await admin.from('claim_fax_targets').update({ status: 'sending', fax: to }).eq('id', ex.id)

    // 이 회사의 서류들 업로드 → fileIds
    const ids: string[] = []
    let uploadErr = ''
    for (const p of paths) {
      const r = await fileIdFor(p)
      if (!r.ok || !r.fileId) {
        uploadErr = r.error ?? '업로드 실패'
        break
      }
      ids.push(r.fileId)
    }
    if (uploadErr) {
      results.push({ insurer, ok: false, error: uploadErr })
      if (ex) await admin.from('claim_fax_targets').update({ status: 'failed', error: uploadErr }).eq('id', ex.id)
      continue
    }

    const sent = await solapiSendFax(auth, faxFrom, to, ids)
    if (sent.ok) {
      results.push({ insurer, ok: true })
      if (ex) await admin.from('claim_fax_targets').update({ status: 'sent', provider_group_id: sent.providerId ?? null, error: null, sent_at: new Date().toISOString() }).eq('id', ex.id)
    } else {
      results.push({ insurer, ok: false, error: sent.error })
      if (ex) await admin.from('claim_fax_targets').update({ status: 'failed', error: sent.error ?? '발송 실패' }).eq('id', ex.id)
    }
  }

  const okCount = results.filter((r) => r.ok).length
  return json({ success: okCount > 0, sent: okCount, total: results.length, results })
})
