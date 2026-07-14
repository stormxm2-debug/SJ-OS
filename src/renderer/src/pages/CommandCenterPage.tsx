import { useEffect, useMemo, useRef, useState } from 'react'
import { Sparkles, Send, Loader2, ArrowRight, Check, X, CalendarPlus, Megaphone, Info } from 'lucide-react'
import { useSession } from '@renderer/navigation/SessionContext'
import { useNavigation } from '@renderer/navigation/NavigationContext'
import { isAdminRole } from '@renderer/navigation/roleAccess'
import type { ViewName } from '@renderer/navigation/types'
import { jarvisBrainService } from '@renderer/services/jarvis/JarvisBrainService'
import type { ConversationEntry } from '@renderer/services/jarvis/types'
import { buildAssistantContext } from '@renderer/services/assistant/assistantContext'
import {
  isScheduleIntent,
  parseAnnouncementIntent,
  localNavFallback,
  type AnnouncementDraft
} from '@renderer/services/assistant/assistantCommands'
import { requestScheduleParse, createScheduleEvent } from '@renderer/services/commercial/scheduleService'
import {
  SCHEDULE_TYPES,
  SCHEDULE_TYPE_LABEL,
  buildScheduleTitle,
  type ScheduleType
} from '@renderer/services/commercial/scheduleValidation'
import { listCustomers } from '@renderer/services/commercial/customerService'
import type { CustomerRecord } from '@shared/commercial/models'
import { createAnnouncement } from '@renderer/services/commercial/announcementService'

/**
 * 경영 비서 — 명령이 실제로 실행되는 AI 비서 콘솔.
 *
 * 예전의 Chief-of-Staff 데모(모의 파이프라인 연출)를 대체한다. 이제:
 * ① 대화: jarvis-brain(실제 Claude)에 사내 실시간 데이터 스냅샷(일정·실적·리드·
 *    소개·접촉)을 함께 보내 진짜 숫자로 답한다.
 * ② 실행: 화면 이동 버튼, 자연어 일정 등록(parse-schedule → 확인 카드 → 실제 저장),
 *    공지 발행(관리자, '공지: …' → 확인 카드 → 공지사항 발행).
 * ③ 서버 미연결(데모)에서는 키워드 화면 이동 폴백으로 동작한다.
 *
 * 데이터 경계는 RLS — 직원은 본인 범위, 관리자는 전체 스냅샷.
 */

interface FeedEntry {
  id: string
  role: 'user' | 'assistant'
  content: string
  navView?: ViewName
  navLabel?: string
  suggested?: string[]
}

interface ScheduleDraft {
  type: ScheduleType
  customerName: string
  customerId?: string
  date: string // YYYY-MM-DD
  time: string // HH:mm
  location: string
}

/** 브레인 navigate 키 → 현재 존재하는 라우트만 허용 (구버전 키 무시). */
const VALID_NAV: ViewName[] = [
  'staff-home', 'attendance', 'customer', 'consultation', 'schedule', 'shared-schedule',
  'performance', 'sales-activity', 'insurance-analysis', 'claim-assistant', 'wiki',
  'underwriting', 'pre-underwriting', 'contacts', 'notice', 'dashboard', 'team-leader',
  'referrals', 'today-contacts', 'birthdays', 'stats-report', 'leads', 'files'
]
const VALID_NAV_SET = new Set<string>(VALID_NAV)

const NAV_LABEL: Partial<Record<ViewName, string>> = {
  'today-contacts': '오늘의 접촉',
  referrals: '소개 영업',
  schedule: '일정',
  performance: '실적',
  customer: '고객 관리',
  notice: '공지사항'
}

let seq = 0
function nextId(): string {
  seq += 1
  return `fe-${Date.now().toString(36)}-${seq}`
}

export default function CommandCenterPage(): JSX.Element {
  const { session } = useSession()
  const { navigate } = useNavigation()
  const admin = isAdminRole(session.role)

  const [entries, setEntries] = useState<FeedEntry[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [customers, setCustomers] = useState<CustomerRecord[]>([])
  const [scheduleDraft, setScheduleDraft] = useState<ScheduleDraft | null>(null)
  const [annDraft, setAnnDraft] = useState<AnnouncementDraft | null>(null)
  const feedEndRef = useRef<HTMLDivElement | null>(null)

  const examples = useMemo(() => {
    const base = ['오늘 브리핑해줘', '이번 달 실적 어때?', '내일 오후 2시 김민준 클로징 일정 잡아줘', '오늘의 접촉 열어줘']
    return admin ? [...base, '공지: 내일 오전 9시 전체 회의'] : base
  }, [admin])

  useEffect(() => {
    void (async () => {
      const res = await listCustomers()
      setCustomers(res.ok ? res.customers : [])
    })()
  }, [session.id])

  useEffect(() => {
    feedEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [entries, scheduleDraft, annDraft, busy])

  const push = (entry: Omit<FeedEntry, 'id'>): void => {
    setEntries((prev) => [...prev, { ...entry, id: nextId() }])
  }

  const submit = async (raw?: string): Promise<void> => {
    const text = (raw ?? input).trim()
    if (!text || busy) return
    setInput('')
    push({ role: 'user', content: text })
    setBusy(true)
    try {
      // ① 공지 발행 (관리자, '공지: …')
      const ann = parseAnnouncementIntent(text)
      if (ann) {
        if (!admin) {
          push({ role: 'assistant', content: '공지 등록은 관리자만 할 수 있습니다. 필요하시면 관리자에게 요청해 주세요.' })
          return
        }
        setAnnDraft(ann)
        push({ role: 'assistant', content: '공지 초안을 만들었습니다. 아래 카드에서 내용을 확인하고 발행해 주세요.' })
        return
      }

      // ② 자연어 일정 등록
      if (isScheduleIntent(text)) {
        const parsed = await requestScheduleParse(text, customers.map((c) => c.name))
        if (parsed.ok && parsed.parsed) {
          const p = parsed.parsed
          const type = (SCHEDULE_TYPES as string[]).includes(p.type) ? (p.type as ScheduleType) : 'meeting-1'
          const matched = p.customerName ? customers.find((c) => c.name === p.customerName) : undefined
          setScheduleDraft({
            type,
            customerName: p.customerName ?? '',
            customerId: matched?.id,
            date: p.date,
            time: p.time,
            location: p.location ?? ''
          })
          push({ role: 'assistant', content: '일정 초안을 만들었습니다. 아래 카드에서 확인·수정 후 등록해 주세요.' })
          return
        }
        push({
          role: 'assistant',
          content: `일정 해석에 실패했습니다 — ${parsed.error ?? '다시 시도해 주세요.'}\n예: "내일 오후 2시 김민준 클로징 잡아줘"`
        })
        return
      }

      // ③ 브레인 대화 (실데이터 스냅샷 동봉)
      const history: ConversationEntry[] = [...entries, { id: 'now', role: 'user' as const, content: text, timestamp: '' }]
        .filter((e) => e.role === 'user' || e.role === 'assistant')
        .slice(-12)
        .map((e) => ({ id: e.id, role: e.role, content: e.content, timestamp: '' }))
      const context = await buildAssistantContext(admin, session.id)
      const res = await jarvisBrainService.chat(history, admin ? 'ceo' : 'staff', context)
      if (res.ok && res.reply) {
        const nav = res.navigate && VALID_NAV_SET.has(res.navigate) ? (res.navigate as ViewName) : undefined
        push({
          role: 'assistant',
          content: res.reply,
          navView: nav,
          navLabel: nav ? (NAV_LABEL[nav] ?? '화면 열기') : undefined,
          suggested: res.suggested
        })
        return
      }

      // ④ 서버 미연결/실패 폴백 — 키워드 화면 이동
      const fallback = localNavFallback(text)
      if (fallback) {
        push({
          role: 'assistant',
          content: `지금은 AI 서버에 연결되어 있지 않아 화면 이동만 도와드릴 수 있어요. '${fallback.label}' 화면을 열까요?`,
          navView: fallback.view,
          navLabel: fallback.label
        })
        return
      }
      push({
        role: 'assistant',
        content: res.error
          ? `처리하지 못했습니다 — ${res.error}`
          : '지금은 처리할 수 없습니다. 서버 연결 상태를 확인하거나 잠시 후 다시 시도해 주세요.'
      })
    } finally {
      setBusy(false)
    }
  }

  const confirmSchedule = async (): Promise<void> => {
    if (!scheduleDraft || busy) return
    setBusy(true)
    try {
      const d = scheduleDraft
      const matched = d.customerId ? customers.find((c) => c.id === d.customerId) : customers.find((c) => c.name === d.customerName.trim())
      const res = await createScheduleEvent({
        title: buildScheduleTitle(d.type, d.customerName || undefined),
        type: d.type,
        status: 'planned',
        customerId: matched?.id,
        manualCustomerName: matched ? undefined : d.customerName.trim() || undefined,
        startsAt: `${d.date}T${d.time}:00`,
        location: d.location.trim() || undefined
      })
      if (res.ok) {
        setScheduleDraft(null)
        push({
          role: 'assistant',
          content: `일정을 등록했습니다 ✅\n${d.date} ${d.time} · ${SCHEDULE_TYPE_LABEL[d.type]}${d.customerName ? ` · ${d.customerName}` : ''}${d.location ? ` @ ${d.location}` : ''}`,
          navView: 'schedule',
          navLabel: '일정 보기'
        })
      } else {
        push({ role: 'assistant', content: `일정 등록에 실패했습니다 — ${res.error ?? '잠시 후 다시 시도해 주세요.'}` })
      }
    } finally {
      setBusy(false)
    }
  }

  const confirmAnnouncement = async (): Promise<void> => {
    if (!annDraft || busy) return
    setBusy(true)
    try {
      const res = await createAnnouncement({
        title: annDraft.title,
        body: annDraft.body,
        priority: 'normal',
        targetType: 'all',
        pinned: false,
        status: 'published',
        createdBy: session.id,
        createdByName: session.name
      })
      if (res.ok) {
        setAnnDraft(null)
        push({ role: 'assistant', content: `공지를 발행했습니다 ✅\n"${annDraft.title}"`, navView: 'notice', navLabel: '공지사항 보기' })
      } else {
        push({ role: 'assistant', content: `공지 발행에 실패했습니다 — ${res.error ?? '잠시 후 다시 시도해 주세요.'}` })
      }
    } finally {
      setBusy(false)
    }
  }

  const input_cls =
    'w-full rounded-xl border border-slate-800 bg-white px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-[#c6982f] focus:outline-none'

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col gap-4">
      {/* 헤더 — 딥네이비 + 골드 */}
      <div
        className="relative overflow-hidden rounded-2xl p-5 text-white"
        style={{
          background:
            'radial-gradient(480px 180px at 90% -30%, rgba(198,152,47,0.2), rgba(198,152,47,0) 60%), linear-gradient(120deg, #0e1e3a 0%, #16294b 70%, #1d2f57 100%)'
        }}
      >
        <div className="pointer-events-none absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-[#c6982f] to-transparent opacity-80" />
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-[#e6c877]" />
          <h1 className="text-lg font-bold">경영 비서</h1>
        </div>
        <p className="mt-1 text-xs text-white/60">
          말하면 실행됩니다 — 사내 실시간 데이터로 답하고, 일정 등록·공지 발행·화면 이동까지 처리합니다.
        </p>
      </div>

      {/* 대화 피드 */}
      <div className="min-h-[320px] flex-1 space-y-3 overflow-y-auto rounded-2xl border border-slate-800 bg-white p-4">
        {entries.length === 0 ? (
          <div className="py-8 text-center">
            <Sparkles className="mx-auto mb-2 h-8 w-8 text-[#c6982f]" />
            <p className="text-sm font-semibold text-slate-300">
              {session.name ? `${session.name}님, ` : ''}무엇을 도와드릴까요?
            </p>
            <p className="mt-1 text-xs text-slate-500">아래 예시를 눌러보시거나, 자유롭게 명령해 주세요.</p>
            <div className="mx-auto mt-4 flex max-w-md flex-wrap justify-center gap-1.5">
              {examples.map((ex) => (
                <button
                  key={ex}
                  type="button"
                  onClick={() => void submit(ex)}
                  className="rounded-full bg-slate-950 px-3 py-1.5 text-[12px] font-bold text-slate-300 ring-1 ring-slate-800 transition hover:text-[#8a6a1e] hover:ring-[#c6982f]/50"
                >
                  {ex}
                </button>
              ))}
            </div>
          </div>
        ) : (
          entries.map((e) => (
            <div key={e.id} className={e.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
              <div
                className={[
                  'max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm whitespace-pre-wrap',
                  e.role === 'user' ? 'text-[#e6c877]' : 'bg-slate-950 text-slate-200'
                ].join(' ')}
                style={e.role === 'user' ? { background: 'linear-gradient(120deg, #0e1e3a, #1d2f57)' } : undefined}
              >
                {e.content}
                {e.navView ? (
                  <button
                    type="button"
                    onClick={() => navigate({ name: e.navView } as never)}
                    className="mt-2 flex items-center gap-1 rounded-xl bg-[#c6982f] px-3 py-1.5 text-xs font-bold text-[#201603] transition hover:brightness-105"
                  >
                    {e.navLabel ?? '화면 열기'} <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                ) : null}
                {e.suggested && e.suggested.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {e.suggested.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => void submit(s)}
                        className="rounded-full bg-white px-2.5 py-1 text-[11px] font-bold text-slate-400 ring-1 ring-slate-800 transition hover:text-[#8a6a1e] hover:ring-[#c6982f]/50"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          ))
        )}

        {/* 일정 등록 확인 카드 */}
        {scheduleDraft ? (
          <div className="rounded-2xl border border-[#c6982f]/40 bg-white p-4">
            <div className="flex items-center justify-between">
              <h2 className="flex items-center gap-1.5 text-sm font-bold text-slate-100">
                <CalendarPlus className="h-4 w-4 text-[#c6982f]" /> 일정 등록 확인
              </h2>
              <button type="button" onClick={() => setScheduleDraft(null)} className="rounded-lg p-1 text-slate-400 hover:text-slate-200">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
              <div>
                <span className="mb-1 block text-[11px] font-bold text-slate-500">유형</span>
                <select
                  value={scheduleDraft.type}
                  onChange={(e) => setScheduleDraft((d) => (d ? { ...d, type: e.target.value as ScheduleType } : d))}
                  className={input_cls}
                >
                  {SCHEDULE_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {SCHEDULE_TYPE_LABEL[t]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <span className="mb-1 block text-[11px] font-bold text-slate-500">고객</span>
                <input
                  value={scheduleDraft.customerName}
                  onChange={(e) => setScheduleDraft((d) => (d ? { ...d, customerName: e.target.value, customerId: undefined } : d))}
                  placeholder="고객명"
                  className={input_cls}
                />
              </div>
              <div>
                <span className="mb-1 block text-[11px] font-bold text-slate-500">날짜</span>
                <input
                  type="date"
                  value={scheduleDraft.date}
                  onChange={(e) => setScheduleDraft((d) => (d ? { ...d, date: e.target.value } : d))}
                  className={input_cls}
                />
              </div>
              <div>
                <span className="mb-1 block text-[11px] font-bold text-slate-500">시간</span>
                <input
                  type="time"
                  value={scheduleDraft.time}
                  onChange={(e) => setScheduleDraft((d) => (d ? { ...d, time: e.target.value } : d))}
                  className={input_cls}
                />
              </div>
              <div className="col-span-2">
                <span className="mb-1 block text-[11px] font-bold text-slate-500">장소 (선택)</span>
                <input
                  value={scheduleDraft.location}
                  onChange={(e) => setScheduleDraft((d) => (d ? { ...d, location: e.target.value } : d))}
                  placeholder="예: 강남역 2번 출구 카페"
                  className={input_cls}
                />
              </div>
            </div>
            <button
              type="button"
              onClick={() => void confirmSchedule()}
              disabled={busy || !scheduleDraft.date || !scheduleDraft.time}
              className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl bg-[#c6982f] px-4 py-2.5 text-sm font-bold text-[#201603] transition hover:brightness-105 disabled:opacity-40"
            >
              <Check className="h-4 w-4" /> {busy ? '등록 중…' : '이대로 일정 등록'}
            </button>
          </div>
        ) : null}

        {/* 공지 발행 확인 카드 */}
        {annDraft ? (
          <div className="rounded-2xl border border-[#c6982f]/40 bg-white p-4">
            <div className="flex items-center justify-between">
              <h2 className="flex items-center gap-1.5 text-sm font-bold text-slate-100">
                <Megaphone className="h-4 w-4 text-[#c6982f]" /> 공지 발행 확인 <span className="text-[11px] font-normal text-slate-500">(전 직원)</span>
              </h2>
              <button type="button" onClick={() => setAnnDraft(null)} className="rounded-lg p-1 text-slate-400 hover:text-slate-200">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-3 space-y-2.5">
              <input
                value={annDraft.title}
                onChange={(e) => setAnnDraft((d) => (d ? { ...d, title: e.target.value } : d))}
                placeholder="공지 제목"
                className={input_cls}
              />
              <textarea
                value={annDraft.body}
                onChange={(e) => setAnnDraft((d) => (d ? { ...d, body: e.target.value } : d))}
                rows={4}
                placeholder="공지 내용"
                className={input_cls}
              />
            </div>
            <button
              type="button"
              onClick={() => void confirmAnnouncement()}
              disabled={busy || !annDraft.title.trim() || !annDraft.body.trim()}
              className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl bg-[#c6982f] px-4 py-2.5 text-sm font-bold text-[#201603] transition hover:brightness-105 disabled:opacity-40"
            >
              <Check className="h-4 w-4" /> {busy ? '발행 중…' : '전 직원에게 발행'}
            </button>
          </div>
        ) : null}

        {busy && !scheduleDraft && !annDraft ? (
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-[#c6982f]" /> 처리 중…
          </div>
        ) : null}
        <div ref={feedEndRef} />
      </div>

      {/* 입력창 */}
      <div className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) void submit()
          }}
          placeholder={admin ? '명령을 입력하세요 — 예: 이번 달 실적 어때? / 공지: 내용' : '명령을 입력하세요 — 예: 오늘 브리핑해줘'}
          className="flex-1 rounded-2xl border border-slate-800 bg-white px-4 py-3 text-sm text-slate-100 placeholder:text-slate-500 focus:border-[#c6982f] focus:outline-none"
        />
        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy || !input.trim()}
          className="flex items-center gap-1.5 rounded-2xl bg-[#c6982f] px-5 py-3 text-sm font-bold text-[#201603] transition hover:brightness-105 disabled:opacity-40"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </button>
      </div>

      <div className="flex items-start gap-2 rounded-xl border border-dashed border-slate-700 bg-white/60 px-4 py-3 text-[12px] text-slate-500">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          할 수 있는 일: <b className="text-slate-300">사내 데이터 질문</b>(오늘 일정·이번 달 실적·리드·소개 현황),{' '}
          <b className="text-slate-300">자연어 일정 등록</b>(&quot;내일 2시 OOO 클로징 잡아줘&quot;),{' '}
          {admin ? (
            <>
              <b className="text-slate-300">공지 발행</b>(&quot;공지: 내용&quot;),{' '}
            </>
          ) : null}
          <b className="text-slate-300">화면 이동</b>, 보험 지식·화법 상담. 일정·공지는 확인 카드에서 승인해야 실제로 저장됩니다.
        </span>
      </div>
    </div>
  )
}
