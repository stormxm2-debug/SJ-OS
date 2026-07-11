import { getSupabaseClient, initSupabaseClient } from './supabaseClient'
import { listOverviewStaff, type OverviewStaff } from './staffOverviewService'

/**
 * 사내 직원 메신저 서비스 (카톡형). 1:1 및 그룹 대화.
 * 보안: 참여자 기반 RLS(chat_participants)로 자기가 낀 대화만 조회/발신 가능.
 * 무거운 인프라 없이 Supabase 실시간(useRealtimeSync)으로 새 메시지를 받는다.
 * 테이블 미적용(42P01)이면 configured=false 로 조용히 '설정 전' 처리.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface ChatConversation {
  id: string
  isGroup: boolean
  title?: string
  displayName: string
  memberNames: string[]
  lastMessageAt: string
  lastMessagePreview?: string
  hasUnread: boolean
}

export interface ChatMessage {
  id: string
  conversationId: string
  senderId: string | null
  senderName: string
  body: string
  createdAt: string
  mine: boolean
}

async function getClient(): Promise<any | null> {
  await initSupabaseClient()
  return (getSupabaseClient() as any) ?? null
}
async function uid(client: any): Promise<string | null> {
  try {
    const { data } = await client.auth.getSession()
    return data?.session?.user?.id ?? null
  } catch {
    return null
  }
}
function isMissingSetup(err: any): boolean {
  const code = String(err?.code ?? '')
  const msg = String(err?.message ?? '')
  return code === '42P01' || /relation .* does not exist|could not find the table/i.test(msg)
}

/** 채팅 상대로 고를 수 있는 직원 목록 (본인 제외). */
export async function listChatStaff(): Promise<OverviewStaff[]> {
  const me = await currentUserId()
  const all = await listOverviewStaff()
  return all.filter((s) => s.id !== me)
}

async function currentUserId(): Promise<string | null> {
  const client = await getClient()
  if (!client) return null
  return uid(client)
}

/** 내 대화방 목록 (최근 메시지 순, 안읽음 표시). */
export async function listConversations(): Promise<{ items: ChatConversation[]; configured: boolean }> {
  const client = await getClient()
  if (!client) return { items: [], configured: false }
  const me = await uid(client)
  if (!me) return { items: [], configured: true }

  const { data: convs, error } = await client
    .from('chat_conversations')
    .select('*')
    .order('last_message_at', { ascending: false })
  if (error) {
    if (isMissingSetup(error)) return { items: [], configured: false }
    return { items: [], configured: true }
  }
  const convRows = (convs ?? []) as Record<string, any>[]
  if (convRows.length === 0) return { items: [], configured: true }

  const ids = convRows.map((c) => String(c.id))
  const { data: parts } = await client
    .from('chat_participants')
    .select('conversation_id, profile_id, last_read_at, profile:profiles(id, name)')
    .in('conversation_id', ids)
  const partRows = (parts ?? []) as Record<string, any>[]

  const byConv = new Map<string, Record<string, any>[]>()
  for (const p of partRows) {
    const cid = String(p.conversation_id)
    const arr = byConv.get(cid) ?? []
    arr.push(p)
    byConv.set(cid, arr)
  }

  const items: ChatConversation[] = convRows.map((c) => {
    const cid = String(c.id)
    const members = byConv.get(cid) ?? []
    const others = members.filter((m) => String(m.profile_id) !== me)
    const memberNames = others.map((m) => String(m.profile?.name ?? '직원'))
    const mineRow = members.find((m) => String(m.profile_id) === me)
    const myRead = mineRow?.last_read_at ? Date.parse(mineRow.last_read_at) : 0
    const lastAt = c.last_message_at ? Date.parse(c.last_message_at) : 0
    const isGroup = Boolean(c.is_group)
    return {
      id: cid,
      isGroup,
      title: (c.title as string | null) ?? undefined,
      displayName: isGroup ? (c.title || memberNames.join(', ') || '그룹') : memberNames[0] ?? '(나와의 대화)',
      memberNames,
      lastMessageAt: String(c.last_message_at ?? ''),
      lastMessagePreview: (c.last_message_preview as string | null) ?? undefined,
      hasUnread: lastAt > myRead
    }
  })
  return { items, configured: true }
}

/** 특정 대화의 메시지 (오래된→최신). */
export async function listMessages(conversationId: string): Promise<ChatMessage[]> {
  const client = await getClient()
  if (!client) return []
  const me = await uid(client)
  const { data, error } = await client
    .from('chat_messages')
    .select('id, conversation_id, sender_id, body, created_at, sender:profiles(name)')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
    .limit(500)
  if (error) return []
  return ((data ?? []) as Record<string, any>[]).map((m) => ({
    id: String(m.id),
    conversationId: String(m.conversation_id),
    senderId: (m.sender_id as string | null) ?? null,
    senderName: String(m.sender?.name ?? '직원'),
    body: String(m.body ?? ''),
    createdAt: String(m.created_at ?? ''),
    mine: String(m.sender_id ?? '') === me
  }))
}

/** 메시지 전송 + 대화방 최근메시지 갱신. */
export async function sendMessage(conversationId: string, body: string): Promise<{ ok: boolean; error?: string }> {
  const text = body.trim()
  if (!text) return { ok: false, error: '내용을 입력해주세요.' }
  const client = await getClient()
  if (!client) return { ok: false, error: '서버 연결 후 사용할 수 있습니다.' }
  const me = await uid(client)
  if (!me) return { ok: false, error: '로그인 후 사용할 수 있습니다.' }
  const { error } = await client.from('chat_messages').insert({ conversation_id: conversationId, sender_id: me, body: text })
  if (error) return { ok: false, error: error.message ?? '전송에 실패했습니다.' }
  await client
    .from('chat_conversations')
    .update({ last_message_at: new Date().toISOString(), last_message_preview: text.slice(0, 80) })
    .eq('id', conversationId)
  return { ok: true }
}

/** 읽음 처리(안읽음 뱃지 제거). */
export async function markConversationRead(conversationId: string): Promise<void> {
  const client = await getClient()
  if (!client) return
  const me = await uid(client)
  if (!me) return
  await client
    .from('chat_participants')
    .update({ last_read_at: new Date().toISOString() })
    .eq('conversation_id', conversationId)
    .eq('profile_id', me)
}

/**
 * 대화 시작/재사용. otherIds 길이 1 + 그룹아님이면 기존 1:1 방을 재사용한다.
 * 성공 시 conversationId 반환.
 */
export async function startConversation(
  otherIds: string[],
  opts?: { title?: string; group?: boolean }
): Promise<{ ok: boolean; conversationId?: string; error?: string }> {
  const client = await getClient()
  if (!client) return { ok: false, error: '서버 연결 후 사용할 수 있습니다.' }
  const me = await uid(client)
  if (!me) return { ok: false, error: '로그인 후 사용할 수 있습니다.' }
  const others = [...new Set(otherIds.filter((x) => x && x !== me))]
  if (others.length === 0) return { ok: false, error: '대화 상대를 선택해주세요.' }
  const group = Boolean(opts?.group) || others.length > 1

  // 1:1 기존 방 재사용
  if (!group && others.length === 1) {
    const existing = await find1to1(client, me, others[0])
    if (existing) return { ok: true, conversationId: existing }
  }

  const { data: conv, error: convErr } = await client
    .from('chat_conversations')
    .insert({ is_group: group, title: group ? opts?.title?.trim() || null : null, created_by: me })
    .select('id')
    .single()
  if (convErr || !conv) {
    if (isMissingSetup(convErr)) return { ok: false, error: '메신저가 아직 설정되지 않았습니다(테이블 미적용).' }
    return { ok: false, error: convErr?.message ?? '대화 생성에 실패했습니다.' }
  }
  const conversationId = String((conv as { id: string }).id)
  const rows = [me, ...others].map((pid) => ({ conversation_id: conversationId, profile_id: pid }))
  const { error: partErr } = await client.from('chat_participants').insert(rows)
  if (partErr) return { ok: false, conversationId, error: partErr.message ?? '참여자 추가에 실패했습니다.' }
  return { ok: true, conversationId }
}

/** 나와 상대만 있는 기존 1:1 방 찾기 (없으면 null). */
async function find1to1(client: any, me: string, other: string): Promise<string | null> {
  // 내가 참여한 방들
  const { data: mine } = await client.from('chat_participants').select('conversation_id').eq('profile_id', me)
  const myConvIds = ((mine ?? []) as Record<string, any>[]).map((r) => String(r.conversation_id))
  if (myConvIds.length === 0) return null
  // 그 방들의 참여자 전체 + 그룹 여부
  const { data: parts } = await client.from('chat_participants').select('conversation_id, profile_id').in('conversation_id', myConvIds)
  const { data: convs } = await client.from('chat_conversations').select('id, is_group').in('id', myConvIds)
  const groupById = new Map<string, boolean>(((convs ?? []) as Record<string, any>[]).map((c) => [String(c.id), Boolean(c.is_group)]))
  const membersByConv = new Map<string, Set<string>>()
  for (const p of (parts ?? []) as Record<string, any>[]) {
    const cid = String(p.conversation_id)
    const set = membersByConv.get(cid) ?? new Set<string>()
    set.add(String(p.profile_id))
    membersByConv.set(cid, set)
  }
  for (const cid of myConvIds) {
    if (groupById.get(cid)) continue
    const set = membersByConv.get(cid)
    if (set && set.size === 2 && set.has(me) && set.has(other)) return cid
  }
  return null
}
