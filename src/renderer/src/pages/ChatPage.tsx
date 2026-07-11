import { useEffect, useMemo, useRef, useState } from 'react'
import {
  MessageCircle,
  Plus,
  Send,
  Search,
  Loader2,
  ChevronLeft,
  Users,
  X,
  Check
} from 'lucide-react'
import { useSession } from '@renderer/navigation/SessionContext'
import { ROLE_LABEL } from '@renderer/navigation/roleAccess'
import { useRealtimeSync } from '@renderer/services/commercial/useRealtimeSync'
import {
  listConversations,
  listMessages,
  sendMessage,
  markConversationRead,
  startConversation,
  listChatStaff,
  type ChatConversation,
  type ChatMessage
} from '@renderer/services/commercial/chatService'
import type { OverviewStaff } from '@renderer/services/commercial/staffOverviewService'

/**
 * 사내 직원 메신저 (카톡형). 좌측 대화 목록 + 우측 말풍선 스레드. 모바일은 2단계
 * (목록 → 대화). 실시간(chat_messages/chat_conversations)으로 새 메시지 즉시 반영.
 */

const RT_TABLES = ['chat_messages', 'chat_conversations']

function hhmm(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export default function ChatPage(): JSX.Element {
  const { session } = useSession()
  const [convs, setConvs] = useState<ChatConversation[]>([])
  const [configured, setConfigured] = useState(true)
  const [selected, setSelected] = useState<ChatConversation | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  const loadConvs = async (): Promise<void> => {
    const r = await listConversations()
    setConvs(r.items)
    setConfigured(r.configured)
  }
  useEffect(() => {
    void loadConvs()
  }, [])

  const loadMessages = async (convId: string): Promise<void> => {
    const msgs = await listMessages(convId)
    setMessages(msgs)
    void markConversationRead(convId).then(loadConvs)
  }

  // 실시간: 열린 대화면 메시지 새로고침 + 목록 갱신
  useRealtimeSync(RT_TABLES, () => {
    void loadConvs()
    if (selected) void listMessages(selected.id).then(setMessages)
  })

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [messages])

  const openConv = (c: ChatConversation): void => {
    setSelected(c)
    void loadMessages(c.id)
  }

  const onSend = async (): Promise<void> => {
    if (!selected || !draft.trim() || sending) return
    setSending(true)
    const text = draft
    setDraft('')
    const r = await sendMessage(selected.id, text)
    setSending(false)
    if (!r.ok) {
      setDraft(text)
      return
    }
    void listMessages(selected.id).then(setMessages)
    void loadConvs()
  }

  const onStarted = async (convId: string): Promise<void> => {
    setPickerOpen(false)
    const r = await listConversations()
    setConvs(r.items)
    setConfigured(r.configured)
    const conv = r.items.find((c) => c.id === convId)
    if (conv) {
      setSelected(conv)
      void loadMessages(convId)
    }
  }

  return (
    <div className="flex h-full min-h-[70vh] gap-4">
      {/* 대화 목록 */}
      <div
        className={[
          'w-full shrink-0 flex-col rounded-2xl border border-slate-800 bg-white shadow-sm lg:flex lg:w-72',
          selected ? 'hidden' : 'flex'
        ].join(' ')}
      >
        <div className="flex items-center justify-between border-b border-slate-800 p-3">
          <h2 className="flex items-center gap-1.5 text-sm font-extrabold text-slate-100">
            <MessageCircle className="h-4 w-4 text-[#b0821f]" /> 메신저
          </h2>
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            className="inline-flex items-center gap-1 rounded-lg bg-[#0e1e3a] px-2.5 py-1 text-[12px] font-bold text-[#e6c877] hover:brightness-125"
          >
            <Plus className="h-3.5 w-3.5" /> 새 대화
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-1.5">
          {!configured ? (
            <p className="p-4 text-center text-[12px] text-amber-600">메신저가 아직 설정되지 않았습니다(테이블 미적용). 설정 후 사용할 수 있습니다.</p>
          ) : convs.length === 0 ? (
            <p className="p-4 text-center text-[12px] text-slate-500">아직 대화가 없습니다. [새 대화]로 시작하세요.</p>
          ) : (
            convs.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => openConv(c)}
                className={[
                  'flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition',
                  selected?.id === c.id ? 'bg-[#0e1e3a] text-white' : 'hover:bg-slate-950'
                ].join(' ')}
              >
                <span
                  className={[
                    'flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[13px] font-bold',
                    c.isGroup ? 'bg-[#c6982f] text-[#0e1e3a]' : selected?.id === c.id ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500'
                  ].join(' ')}
                >
                  {c.isGroup ? <Users className="h-4 w-4" /> : c.displayName.slice(0, 1)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className={['block truncate text-[13px] font-bold', selected?.id === c.id ? 'text-white' : 'text-slate-100'].join(' ')}>
                    {c.displayName}
                  </span>
                  <span className={['block truncate text-[11px]', selected?.id === c.id ? 'text-slate-300' : 'text-slate-500'].join(' ')}>
                    {c.lastMessagePreview ?? '새 대화'}
                  </span>
                </span>
                {c.hasUnread ? <span className="h-2 w-2 shrink-0 rounded-full bg-rose-500" /> : null}
              </button>
            ))
          )}
        </div>
      </div>

      {/* 대화 스레드 */}
      <div className={['min-w-0 flex-1 flex-col', selected ? 'flex' : 'hidden lg:flex'].join(' ')}>
        {!selected ? (
          <div className="flex h-full items-center justify-center rounded-2xl border border-dashed border-slate-700 bg-slate-950/50">
            <div className="text-center">
              <MessageCircle className="mx-auto h-10 w-10 text-slate-400" />
              <p className="mt-2 text-sm font-semibold text-slate-400">대화를 선택하세요</p>
            </div>
          </div>
        ) : (
          <div className="flex h-full flex-col rounded-2xl border border-slate-800 bg-white shadow-sm">
            {/* 스레드 헤더 */}
            <div className="flex items-center gap-2 border-b border-slate-800 px-3 py-2.5">
              <button type="button" onClick={() => setSelected(null)} aria-label="목록으로" className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 hover:bg-slate-950 lg:hidden">
                <ChevronLeft className="h-5 w-5" />
              </button>
              <span className="text-sm font-extrabold text-slate-100">{selected.displayName}</span>
              {selected.isGroup ? <span className="text-[11px] text-slate-500">· {selected.memberNames.length + 1}명</span> : null}
            </div>

            {/* 메시지 */}
            <div className="flex-1 space-y-2 overflow-y-auto bg-slate-950/30 p-3">
              {messages.length === 0 ? (
                <p className="py-8 text-center text-[12px] text-slate-500">첫 메시지를 보내보세요.</p>
              ) : (
                messages.map((m, i) => {
                  const showName = selected.isGroup && !m.mine && messages[i - 1]?.senderId !== m.senderId
                  return (
                    <div key={m.id} className={['flex flex-col', m.mine ? 'items-end' : 'items-start'].join(' ')}>
                      {showName ? <span className="mb-0.5 ml-1 text-[10px] font-semibold text-slate-500">{m.senderName}</span> : null}
                      <div className={['flex items-end gap-1.5', m.mine ? 'flex-row-reverse' : ''].join(' ')}>
                        <span
                          className={[
                            'max-w-[75%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-[13px] leading-5',
                            m.mine ? 'bg-[#c6982f] text-[#201603]' : 'bg-white text-slate-100 ring-1 ring-slate-800'
                          ].join(' ')}
                        >
                          {m.body}
                        </span>
                        <span className="mb-0.5 text-[9px] text-slate-500">{hhmm(m.createdAt)}</span>
                      </div>
                    </div>
                  )
                })
              )}
              <div ref={bottomRef} />
            </div>

            {/* 입력창 */}
            <div className="flex items-end gap-2 border-t border-slate-800 p-2.5">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    void onSend()
                  }
                }}
                rows={1}
                placeholder="메시지 입력…"
                className="max-h-28 flex-1 resize-none rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-[13px] text-slate-100 outline-none placeholder:text-slate-500 focus:border-[#c6982f]"
              />
              <button
                type="button"
                onClick={() => void onSend()}
                disabled={!draft.trim() || sending}
                aria-label="보내기"
                className={['flex h-9 w-9 shrink-0 items-center justify-center rounded-full', draft.trim() && !sending ? 'bg-[#0e1e3a] text-[#e6c877]' : 'bg-slate-200 text-slate-400'].join(' ')}
              >
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </button>
            </div>
          </div>
        )}
      </div>

      {pickerOpen ? <NewChatPicker onClose={() => setPickerOpen(false)} onStarted={onStarted} myRole={ROLE_LABEL[session.role]} /> : null}
    </div>
  )
}

/** 새 대화 상대 선택 (다중 선택 시 그룹). */
function NewChatPicker({ onClose, onStarted, myRole }: { onClose: () => void; onStarted: (convId: string) => void; myRole: string }): JSX.Element {
  const [staff, setStaff] = useState<OverviewStaff[]>([])
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    void listChatStaff().then(setStaff)
  }, [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? staff.filter((s) => s.name.toLowerCase().includes(q)) : staff
  }, [staff, query])
  const isGroup = picked.length > 1

  const toggle = (id: string): void => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))

  const start = async (): Promise<void> => {
    if (picked.length === 0) return
    setBusy(true)
    setErr('')
    const r = await startConversation(picked, { group: isGroup, title: title.trim() || undefined })
    setBusy(false)
    if (!r.ok || !r.conversationId) {
      setErr(r.error ?? '대화 시작에 실패했습니다.')
      return
    }
    onStarted(r.conversationId)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div className="max-h-[85vh] w-full max-w-md overflow-hidden rounded-t-2xl border border-slate-800 bg-white sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-800 p-3">
          <h3 className="text-sm font-extrabold text-slate-100">새 대화 <span className="text-[11px] font-normal text-slate-500">({myRole})</span></h3>
          <button type="button" onClick={onClose} aria-label="닫기" className="rounded-lg p-1 text-slate-400 hover:text-slate-100">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="border-b border-slate-800 p-3">
          <div className="flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-950 px-2 py-1.5">
            <Search className="h-3.5 w-3.5 text-slate-500" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="직원 이름 검색" className="w-full bg-transparent text-[12px] text-slate-100 outline-none placeholder:text-slate-500" />
          </div>
          {isGroup ? (
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="그룹 이름(선택)" className="mt-2 w-full rounded-lg border border-slate-800 bg-slate-950 px-2.5 py-1.5 text-[12px] text-slate-100 outline-none placeholder:text-slate-500 focus:border-[#c6982f]" />
          ) : null}
        </div>
        <div className="max-h-[46vh] overflow-y-auto p-1.5">
          {filtered.map((s) => {
            const on = picked.includes(s.id)
            return (
              <button key={s.id} type="button" onClick={() => toggle(s.id)} className={['flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left', on ? 'bg-[#faf6ec]' : 'hover:bg-slate-950'].join(' ')}>
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[12px] font-bold text-slate-500">{s.name.slice(0, 1)}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-bold text-slate-100">{s.name}</span>
                  <span className="block text-[10px] text-slate-500">{ROLE_LABEL[s.role as keyof typeof ROLE_LABEL] ?? s.role}</span>
                </span>
                <span className={['flex h-5 w-5 items-center justify-center rounded-full border', on ? 'border-[#c6982f] bg-[#c6982f] text-white' : 'border-slate-300'].join(' ')}>
                  {on ? <Check className="h-3 w-3" /> : null}
                </span>
              </button>
            )
          })}
          {filtered.length === 0 ? <p className="p-4 text-center text-[12px] text-slate-500">직원이 없습니다.</p> : null}
        </div>
        <div className="border-t border-slate-800 p-3">
          {err ? <div className="mb-2 text-[12px] font-medium text-rose-600">{err}</div> : null}
          <button
            type="button"
            onClick={() => void start()}
            disabled={picked.length === 0 || busy}
            className={['inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-extrabold', picked.length > 0 && !busy ? 'bg-gradient-to-r from-[#0e1e3a] to-[#1b3a6b] text-[#e6c877]' : 'cursor-not-allowed bg-slate-200 text-slate-400'].join(' ')}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageCircle className="h-4 w-4" />}
            {isGroup ? `그룹 대화 시작 (${picked.length}명)` : '대화 시작'}
          </button>
        </div>
      </div>
    </div>
  )
}
