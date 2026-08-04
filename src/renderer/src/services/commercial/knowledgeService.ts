import {
  getFunctionsBaseUrl,
  getSupabaseAnonKey,
  getSupabaseClient,
  initSupabaseClient
} from './supabaseClient'

/**
 * 자료 브리핑 (knowledge_posts + knowledge-files 버킷).
 *
 * 카톡 방·네이버 카페에서 받은 사내 자료(시책·상품개정·인수지침·교육·공지)를
 * 관리자가 텍스트로 붙여넣거나 이미지/PDF로 올리면, AI(knowledge-digest)가
 * 제목·분류·요약·핵심 포인트·태그·FC 할 일을 뽑아준다. 전 직원이 검색·열람.
 *
 * - 열람: 전 직원 / 등록·수정·삭제: 대표·관리자 (RLS가 실제 경계)
 * - 원본 파일은 비공개 버킷 → 열람은 1시간 서명 URL (자료실과 같은 방식)
 * - 테이블 미적용(42P01)이면 configured:false 로 조용히 안내 (화면은 깨지지 않음)
 *
 * SECURITY: anon 공개 클라이언트만 사용 (service_role 절대 금지).
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

const BUCKET = 'knowledge-files'

export const KNOWLEDGE_CATEGORIES = ['시책', '상품개정', '인수지침', '교육', '공지', '기타'] as const
export type KnowledgeCategory = (typeof KNOWLEDGE_CATEGORIES)[number]

/** 등록 출처 — AI 프롬프트 힌트 + 목록 배지 */
export const KNOWLEDGE_SOURCES = [
  { key: 'kakao', label: '카톡방' },
  { key: 'cafe', label: '네이버 카페' },
  { key: 'manual', label: '직접 입력' }
] as const
export type KnowledgeSource = (typeof KNOWLEDGE_SOURCES)[number]['key']

export interface KnowledgePost {
  id: string
  createdBy: string
  creatorName: string
  source: KnowledgeSource
  sourceUrl?: string | null
  title: string
  category: KnowledgeCategory
  summary?: string | null
  keyPoints: string[]
  tags: string[]
  actionForFc?: string | null
  bodyText?: string | null
  filePath?: string | null
  fileName?: string | null
  fileMime?: string | null
  aiStatus: 'pending' | 'done' | 'failed'
  createdAt: string
}

export interface KnowledgeDigest {
  title: string
  category: KnowledgeCategory
  summary: string
  keyPoints: string[]
  tags: string[]
  actionForFc: string
}

/** 원본 파일 한도 — AI 비전 판독 + base64 전송을 고려해 자료실보다 작게 잡는다. */
export const KNOWLEDGE_FILE_MAX_BYTES = 8 * 1024 * 1024
const ALLOWED_MIME_PREFIX = ['image/']
const ALLOWED_MIME = ['application/pdf']

export function isAllowedKnowledgeFile(file: File): boolean {
  return ALLOWED_MIME_PREFIX.some((p) => file.type.startsWith(p)) || ALLOWED_MIME.includes(file.type)
}

async function getClient(): Promise<any | null> {
  await initSupabaseClient()
  return (getSupabaseClient() as any) ?? null
}

async function currentUid(client: any): Promise<string | null> {
  try {
    const { data } = await client.auth.getSession()
    return data?.session?.user?.id ?? null
  } catch {
    return null
  }
}

async function bearer(): Promise<string | null> {
  const client = await getClient()
  if (!client) return null
  try {
    const { data } = await client.auth.getSession()
    return data?.session?.access_token ?? null
  } catch {
    return null
  }
}

/** 스키마 미적용(테이블/버킷 없음) 판정 — 화면이 '준비 전' 안내로 빠지게 한다. */
function isMissingSetup(error: any): boolean {
  const code = String(error?.code ?? '')
  const msg = String(error?.message ?? '')
  return code === '42P01' || /does not exist|not found/i.test(msg)
}

function toArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x)).filter(Boolean)
  if (typeof v === 'string') {
    try {
      const parsed = JSON.parse(v)
      return Array.isArray(parsed) ? parsed.map((x) => String(x)).filter(Boolean) : []
    } catch {
      return []
    }
  }
  return []
}

function mapRow(r: Record<string, any>): KnowledgePost {
  const cat = String(r.category ?? '기타')
  return {
    id: String(r.id),
    createdBy: String(r.created_by ?? ''),
    creatorName: String(r.creator_name ?? '관리자'),
    source: (['kakao', 'cafe', 'manual'].includes(String(r.source)) ? r.source : 'manual') as KnowledgeSource,
    sourceUrl: r.source_url ?? null,
    title: String(r.title ?? ''),
    category: (KNOWLEDGE_CATEGORIES as readonly string[]).includes(cat)
      ? (cat as KnowledgeCategory)
      : '기타',
    summary: r.summary ?? null,
    keyPoints: toArray(r.key_points),
    tags: toArray(r.tags),
    actionForFc: r.action_for_fc ?? null,
    bodyText: r.body_text ?? null,
    filePath: r.file_path ?? null,
    fileName: r.file_name ?? null,
    fileMime: r.file_mime ?? null,
    aiStatus: (['pending', 'done', 'failed'].includes(String(r.ai_status)) ? r.ai_status : 'done') as KnowledgePost['aiStatus'],
    createdAt: String(r.created_at ?? new Date().toISOString())
  }
}

const COLS =
  'id, created_by, creator_name, source, source_url, title, category, summary, key_points, tags, action_for_fc, body_text, file_path, file_name, file_mime, ai_status, created_at'

/** 자료 목록 (최신순). configured=false 면 스키마 미적용. */
export async function listKnowledgePosts(): Promise<{
  ok: boolean
  configured: boolean
  posts: KnowledgePost[]
  error?: string
}> {
  const client = await getClient()
  if (!client) return { ok: true, configured: false, posts: [] }
  try {
    const { data, error } = await client
      .from('knowledge_posts')
      .select(COLS)
      .order('created_at', { ascending: false })
      .limit(300)
    if (error) {
      if (isMissingSetup(error)) return { ok: true, configured: false, posts: [] }
      return { ok: false, configured: true, posts: [], error: '자료를 불러오지 못했습니다.' }
    }
    return { ok: true, configured: true, posts: ((data as any[]) ?? []).map(mapRow) }
  } catch {
    return { ok: false, configured: true, posts: [], error: '자료를 불러오지 못했습니다.' }
  }
}

/** 파일 → base64 (data URL 접두어 제거). AI 판독용. */
function fileToBase64(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = () => {
      const s = String(reader.result ?? '')
      const i = s.indexOf(',')
      resolve(i >= 0 ? s.slice(i + 1) : null)
    }
    reader.onerror = () => resolve(null)
    reader.readAsDataURL(file)
  })
}

/** AI 정리 — 저장 전에 미리보기로 보여주고, 관리자가 확인 후 저장한다. */
export async function digestKnowledge(input: {
  titleHint?: string
  bodyText?: string
  file?: File | null
  sourceHint?: string
}): Promise<{ ok: boolean; digest?: KnowledgeDigest; error?: string }> {
  const base = getFunctionsBaseUrl()
  const anon = getSupabaseAnonKey()
  if (!base || !anon) return { ok: false, error: '서버 연결 후 사용할 수 있습니다.' }

  let fileBase64: string | null = null
  let fileMime = ''
  if (input.file) {
    if (!isAllowedKnowledgeFile(input.file)) return { ok: false, error: '이미지 또는 PDF만 올릴 수 있습니다.' }
    if (input.file.size > KNOWLEDGE_FILE_MAX_BYTES) return { ok: false, error: '파일이 너무 큽니다 (8MB 이하).' }
    fileBase64 = await fileToBase64(input.file)
    if (!fileBase64) return { ok: false, error: '파일을 읽지 못했습니다.' }
    fileMime = input.file.type
  }
  if (!input.bodyText?.trim() && !fileBase64) {
    return { ok: false, error: '자료 내용을 붙여넣거나 파일을 올려주세요.' }
  }

  const token = (await bearer()) ?? anon
  try {
    const res = await fetch(`${base}/knowledge-digest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: anon, Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        titleHint: input.titleHint ?? '',
        bodyText: input.bodyText ?? '',
        fileBase64: fileBase64 ?? '',
        fileMime,
        sourceHint: input.sourceHint ?? ''
      })
    })
    const data = (await res.json().catch(() => null)) as any
    if (res.status === 401) return { ok: false, error: '로그인 후 사용할 수 있습니다.' }
    if (res.status === 503) return { ok: false, error: 'AI 정리 설정 전입니다. 관리자에게 문의하세요.' }
    if (!res.ok || !data?.success) return { ok: false, error: String(data?.error ?? `AI 정리 실패 (HTTP ${res.status})`) }
    const d = data.digest ?? {}
    return {
      ok: true,
      digest: {
        title: String(d.title ?? ''),
        category: ((KNOWLEDGE_CATEGORIES as readonly string[]).includes(String(d.category))
          ? d.category
          : '기타') as KnowledgeCategory,
        summary: String(d.summary ?? ''),
        keyPoints: toArray(d.keyPoints),
        tags: toArray(d.tags),
        actionForFc: String(d.actionForFc ?? '')
      }
    }
  } catch {
    return { ok: false, error: '서버에 연결할 수 없습니다. 잠시 후 다시 시도해주세요.' }
  }
}

/** 자료 저장 (관리자). 파일이 있으면 비공개 버킷에 원본도 보관한다. */
export async function createKnowledgePost(input: {
  digest: KnowledgeDigest
  source: KnowledgeSource
  sourceUrl?: string
  bodyText?: string
  file?: File | null
  creatorName: string
}): Promise<{ ok: boolean; error?: string }> {
  const client = await getClient()
  if (!client) return { ok: false, error: '서버 연결 후 사용할 수 있습니다.' }
  const uid = await currentUid(client)
  if (!uid) return { ok: false, error: '로그인 후 사용할 수 있습니다.' }
  if (!input.digest.title.trim()) return { ok: false, error: '제목이 비어 있습니다.' }

  let filePath: string | null = null
  if (input.file) {
    // 경로에 uid를 앞세워 스토리지 정책·감사에 쓰기 좋게 한다.
    const safeName = input.file.name.replace(/[^\w.\-가-힣]/g, '_').slice(-80)
    const path = `${uid}/${Date.now()}_${safeName}`
    const up = await client.storage.from(BUCKET).upload(path, input.file, {
      contentType: input.file.type || 'application/octet-stream',
      upsert: false
    })
    if (up.error) {
      if (isMissingSetup(up.error)) return { ok: false, error: '자료 보관함이 아직 준비되지 않았습니다.' }
      return { ok: false, error: '파일 업로드에 실패했습니다.' }
    }
    filePath = path
  }

  try {
    const { error } = await client.from('knowledge_posts').insert({
      created_by: uid,
      creator_name: input.creatorName || null,
      source: input.source,
      source_url: input.sourceUrl?.trim() || null,
      title: input.digest.title.trim(),
      category: input.digest.category,
      summary: input.digest.summary || null,
      key_points: input.digest.keyPoints,
      tags: input.digest.tags,
      action_for_fc: input.digest.actionForFc || null,
      body_text: input.bodyText?.trim() || null,
      file_path: filePath,
      file_name: input.file?.name ?? null,
      file_mime: input.file?.type ?? null,
      ai_status: 'done'
    })
    if (error) {
      if (isMissingSetup(error)) return { ok: false, error: '자료 브리핑이 아직 준비되지 않았습니다.' }
      return { ok: false, error: error.message || '저장에 실패했습니다.' }
    }
    return { ok: true }
  } catch {
    return { ok: false, error: '저장 중 오류가 발생했습니다.' }
  }
}

export async function deleteKnowledgePost(id: string): Promise<{ ok: boolean; error?: string }> {
  const client = await getClient()
  if (!client) return { ok: false, error: '서버 연결 후 사용할 수 있습니다.' }
  try {
    const { error } = await client.from('knowledge_posts').delete().eq('id', id)
    if (error) return { ok: false, error: '삭제에 실패했습니다. (관리자만 삭제할 수 있습니다)' }
    return { ok: true }
  } catch {
    return { ok: false, error: '삭제 중 오류가 발생했습니다.' }
  }
}

/** 원본 파일 열람용 1시간 서명 URL. */
export async function knowledgeFileUrl(path: string): Promise<{ ok: boolean; url?: string; error?: string }> {
  const client = await getClient()
  if (!client) return { ok: false, error: '서버 연결 후 사용할 수 있습니다.' }
  try {
    const { data, error } = await client.storage.from(BUCKET).createSignedUrl(path, 3600)
    if (error || !data?.signedUrl) return { ok: false, error: '파일을 열지 못했습니다.' }
    return { ok: true, url: data.signedUrl }
  } catch {
    return { ok: false, error: '파일을 열지 못했습니다.' }
  }
}

/** 제목·요약·핵심포인트·태그·작성자 전체를 훑는 검색. */
export function matchesKnowledgeQuery(post: KnowledgePost, q: string): boolean {
  const needle = q.trim().toLowerCase()
  if (!needle) return true
  const hay = [
    post.title,
    post.summary ?? '',
    post.actionForFc ?? '',
    post.creatorName,
    post.keyPoints.join(' '),
    post.tags.join(' ')
  ]
    .join(' ')
    .toLowerCase()
  return hay.includes(needle)
}
