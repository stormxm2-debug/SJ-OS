import { useState } from 'react'
import { Send, Info } from 'lucide-react'
import type { Worker, ChatMessage } from '@shared/types'
import Avatar from '@renderer/components/ui/Avatar'
import { getChat } from '@renderer/data/mockManagement'

interface WorkerChatProps {
  worker: Worker
}

const CANNED_REPLIES = [
  'Understood — I’ll factor that into the current task.',
  'Noted. I’ll update my plan and report back at the next checkpoint.',
  'Got it. I’ll raise an approval request if anything sensitive comes up.',
  'Thanks — queuing that now. It won’t block the active work.'
]

export default function WorkerChat({ worker }: WorkerChatProps): JSX.Element {
  const [messages, setMessages] = useState<ChatMessage[]>(() => getChat(worker.id))
  const [draft, setDraft] = useState('')

  function send(): void {
    const text = draft.trim()
    if (!text) return
    setMessages((prev) => {
      const ceoMsg: ChatMessage = {
        id: `local-${prev.length}-ceo`,
        workerId: worker.id,
        author: 'ceo',
        content: text,
        createdAt: 'just now'
      }
      const reply: ChatMessage = {
        id: `local-${prev.length}-worker`,
        workerId: worker.id,
        author: 'worker',
        content: CANNED_REPLIES[prev.length % CANNED_REPLIES.length],
        createdAt: 'just now'
      }
      return [...prev, ceoMsg, reply]
    })
    setDraft('')
  }

  return (
    <div className="flex flex-col rounded-xl border border-slate-800 bg-slate-900/40">
      <div className="flex items-center gap-2 border-b border-slate-800 px-4 py-2.5 text-xs text-slate-500">
        <Info className="h-3.5 w-3.5" />
        Mock conversation — no AI is connected.
      </div>

      <div className="flex min-h-[22rem] flex-col gap-4 overflow-y-auto p-4">
        {messages.length === 0 && (
          <p className="text-sm text-slate-600">
            No messages yet. Say something to {worker.name}.
          </p>
        )}
        {messages.map((m) => {
          const fromCeo = m.author === 'ceo'
          return (
            <div
              key={m.id}
              className={['flex gap-2', fromCeo ? 'justify-end' : 'justify-start'].join(
                ' '
              )}
            >
              {!fromCeo && <Avatar role={worker.role} label={worker.avatar} />}
              <div
                className={[
                  'max-w-[75%] rounded-xl px-3 py-2 text-sm',
                  fromCeo
                    ? 'bg-indigo-600 text-white'
                    : 'border border-slate-800 bg-slate-900/70 text-slate-200'
                ].join(' ')}
              >
                <p>{m.content}</p>
                <p
                  className={[
                    'mt-1 text-[10px]',
                    fromCeo ? 'text-indigo-200' : 'text-slate-600'
                  ].join(' ')}
                >
                  {fromCeo ? 'CEO' : worker.name} · {m.createdAt}
                </p>
              </div>
            </div>
          )
        })}
      </div>

      <div className="flex items-center gap-2 border-t border-slate-800 p-3">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') send()
          }}
          placeholder={`Message ${worker.name}…`}
          className="flex-1 rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-200 outline-none placeholder:text-slate-600 focus:border-indigo-500"
        />
        <button
          type="button"
          onClick={send}
          className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-indigo-500"
        >
          <Send className="h-4 w-4" />
          Send
        </button>
      </div>
    </div>
  )
}
