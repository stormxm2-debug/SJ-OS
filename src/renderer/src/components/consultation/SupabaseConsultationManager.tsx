import { useEffect, useMemo, useState } from 'react'
import {
  ClipboardList,
  Plus,
  Search,
  RefreshCw,
  Loader2,
  AlertTriangle,
  Save,
  X,
  Database,
  HardDrive,
  CheckCircle2,
  Sparkles,
  CalendarPlus,
  ArrowDownToLine,
  Trash2,
  Zap,
  Pencil,
  ChevronRight
} from 'lucide-react'
import { useSession } from '@renderer/navigation/SessionContext'
import { useNavigation } from '@renderer/navigation/NavigationContext'
import type { CustomerRecord } from '@shared/commercial/models'
import { listCustomers } from '@renderer/services/commercial/customerService'
import { parseRrn } from '@renderer/services/commercial/customerValidation'
import { setSchedulePrefill } from '@renderer/services/commercial/schedulePrefillStore'
import { deleteConsultationRecord } from '@renderer/services/commercial/recordDeleteService'
import type { ScheduleType } from '@renderer/services/commercial/scheduleValidation'
import { SCHEDULE_TYPE_LABEL } from '@renderer/services/commercial/scheduleValidation'
import { listScheduleEvents, type ScheduleWithCustomer } from '@renderer/services/commercial/scheduleService'
import {
  createConsultation,
  filterPendingNextActions,
  listConsultations,
  requestConsultCoach,
  searchConsultations,
  updateConsultation,
  type ConsultCoach,
  type ConsultationDataMode,
  type ConsultationWithCustomer
} from '@renderer/services/commercial/consultationService'
import {
  CONSULTATION_CHANNEL_LABEL,
  CONSULTATION_CHANNELS,
  CONSULTATION_STATUS_LABEL,
  CONSULTATION_STATUSES,
  CONSULTATION_TYPE_LABEL,
  CONSULTATION_TYPES,
  normalizeCompletion,
  normalizeConsultationType,
  validateConsultationInput,
  type ConsultationChannel,
  type ConsultationInput,
  type ConsultationStatus,
  type ConsultationType
} from '@renderer/services/commercial/consultationValidation'
import { useRealtimeSync } from '@renderer/services/commercial/useRealtimeSync'

/**
 * 상담 v2 — 고객 타임라인형 (2026-07-12 대표 승인 시안 A).
 *
 *  - 카드 목록(모바일 우선): 고객명 + 【퍼널 단계】【채널】 + 요약 + ⚡다음 액션.
 *  - 카드 탭 → 고객 타임라인 시트: 그 고객과의 상담 + 미팅 메모(일정) + 다가오는
 *    일정을 한 줄기로. [+상담] [일정 잡기] 바로가기.
 *  - 카테고리 = 일정의 영업 퍼널과 통일 (AP→1·2·3차→클로징→증권전달, 사후관리·소개확보).
 *    구버전 유형(첫 상담/후속/제안)은 1·2·3차로 매핑해 표시/집계.
 *  - RLS가 실제 접근 경계 — 화면 필터는 UX. 요약/PII는 로그에 남기지 않는다.
 */

const RT_TABLES = ['consultations']

const emptyForm = (): ConsultationInput => ({
  customerId: '',
  consultationType: 'ap',
  status: 'completed',
  channel: undefined,
  summary: '',
  nextAction: '',
  scheduledAt: '',
  completedAt: ''
})

/** 퍼널 단계 칩 색 (일정 배지 톤과 유사 계열). */
const TYPE_CHIP: Record<string, string> = {
  ap: 'bg-slate-950 text-slate-300',
  'meeting-1': 'bg-sky-50 text-sky-700',
  'meeting-2': 'bg-indigo-50 text-indigo-700',
  'meeting-3': 'bg-violet-50 text-violet-700',
  closing: 'bg-amber-50 text-amber-700',
  delivery: 'bg-emerald-50 text-emerald-700',
  aftercare: 'bg-teal-50 text-teal-700',
  referral: 'bg-pink-50 text-pink-700'
}

function typeChipClass(t: ConsultationType): string {
  return TYPE_CHIP[normalizeConsultationType(t)] ?? 'bg-slate-950 text-slate-300'
}

function mondayOf(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const dow = (x.getDay() + 6) % 7
  x.setDate(x.getDate() - dow)
  return x
}

function dateLabel(iso?: string): string {
  if (!iso) return ''
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return ''
  const d = new Date(t)
  return `${d.getMonth() + 1}/${d.getDate()}`
}

export default function SupabaseConsultationManager(): JSX.Element {
  const { session } = useSession()
  const { navigate } = useNavigation()
  const [list, setList] = useState<ConsultationWithCustomer[]>([])
  const [customers, setCustomers] = useState<CustomerRecord[]>([])
  const [schedules, setSchedules] = useState<ScheduleWithCustomer[]>([])
  const [mode, setMode] = useState<ConsultationDataMode>('local-mock')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | undefined>()

  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState<ConsultationType | 'all'>('all')
  const [pendingOnly, setPendingOnly] = useState(false)

  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<ConsultationInput>(emptyForm)
  const [formErrors, setFormErrors] = useState<string[]>([])
  const [saving, setSaving] = useState(false)

  // 고객 타임라인 시트 + 시트 안 수정 대상
  const [sheetCustomerId, setSheetCustomerId] = useState<string | null>(null)
  const [selected, setSelected] = useState<ConsultationWithCustomer | null>(null)

  // 대표/관리자/팀장: 내 상담과 직원 상담을 분리해 표시 (대표 지시: 섞이지 않게)
  const elevated = session.role !== 'fc'
  const [scope, setScope] = useState<'mine' | 'staff'>('mine')

  const removeConsultation = async (id: string, who?: string): Promise<void> => {
    if (typeof window !== 'undefined' && !window.confirm(`${who ?? '이'} 상담기록을 완전히 삭제할까요?\n삭제하면 되돌릴 수 없습니다.`)) return
    const res = await deleteConsultationRecord(id)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setSelected(null)
    await load()
  }

  const load = async (): Promise<void> => {
    setLoading(true)
    const [cRes, custRes, sRes] = await Promise.all([listConsultations(), listCustomers(), listScheduleEvents()])
    setMode(cRes.mode)
    setList(cRes.consultations)
    setCustomers(custRes.customers)
    setSchedules(sRes.events)
    setError(cRes.ok ? undefined : cRes.error)
    setLoading(false)
  }
  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useRealtimeSync(RT_TABLES, load)

  const mineList = useMemo(() => list.filter((c) => c.staffId === session.id), [list, session.id])
  const staffOnly = useMemo(() => list.filter((c) => c.staffId !== session.id), [list, session.id])
  const scoped = !elevated ? list : scope === 'mine' ? mineList : staffOnly

  // 새 상담 작성은 "내 고객"만 대상 — 이름 표시/AI 컨텍스트는 전체 목록 유지.
  const myCustomers = useMemo(() => customers.filter((c) => c.ownerStaffId === session.id), [customers, session.id])
  const noCustomers = myCustomers.length === 0

  const visible = useMemo(() => {
    let v = searchConsultations(scoped, query, 'all', 'all')
    if (typeFilter !== 'all') v = v.filter((c) => normalizeConsultationType(c.consultationType) === typeFilter)
    if (pendingOnly) v = filterPendingNextActions(v)
    return v
  }, [scoped, query, typeFilter, pendingOnly])

  // 헤더 통계: 이번 주 작성 건수 + 다음 액션 대기
  const stats = useMemo(() => {
    const weekStart = mondayOf(new Date()).getTime()
    const thisWeek = scoped.filter((c) => Date.parse(c.createdAt) >= weekStart).length
    return { thisWeek, pending: filterPendingNextActions(scoped).length }
  }, [scoped])

  const custName = (id: string): string => customers.find((c) => c.id === id)?.name ?? '-'

  const openCreate = (prefillCustomerId?: string): void => {
    setForm({ ...emptyForm(), customerId: prefillCustomerId ?? '' })
    setFormErrors([])
    setSelected(null)
    setSheetCustomerId(null)
    setShowForm(true)
  }

  const submitCreate = async (): Promise<void> => {
    const normalized = normalizeCompletion(form)
    const v = validateConsultationInput(normalized)
    setFormErrors(v.errors)
    if (!v.ok) return
    setSaving(true)
    const res = await createConsultation(normalized)
    setSaving(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setShowForm(false)
    setForm(emptyForm())
    void load()
  }

  const saveEdit = async (): Promise<void> => {
    if (!selected) return
    const input: ConsultationInput = {
      customerId: selected.customerId,
      consultationType: selected.consultationType,
      status: selected.status,
      channel: selected.channel,
      summary: selected.summary,
      nextAction: selected.nextAction,
      scheduledAt: selected.scheduledAt,
      completedAt: selected.completedAt
    }
    const normalized = normalizeCompletion(input)
    const v = validateConsultationInput(normalized)
    setFormErrors(v.errors)
    if (!v.ok) return
    setSaving(true)
    const res = await updateConsultation(selected.id, normalized)
    setSaving(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setSelected(null)
    void load()
  }

  const sheetCustomer = sheetCustomerId ? customers.find((c) => c.id === sheetCustomerId) : undefined

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      {/* 헤더: 제목 + 통계 + 작성 */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ClipboardList className="h-5 w-5 text-indigo-500" />
          <h2 className="text-base font-bold text-slate-100">상담</h2>
          <ModeBadge mode={mode} />
        </div>
        <div className="flex items-center gap-1.5">
          <button type="button" onClick={() => void load()} aria-label="새로고침" className="rounded-lg border border-slate-800 bg-white p-2 text-slate-400 transition hover:text-slate-200">
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => (showForm ? setShowForm(false) : openCreate())}
            disabled={noCustomers && !showForm}
            className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 px-3 py-2 text-xs font-bold text-white shadow-sm disabled:opacity-50"
          >
            {showForm ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />} {showForm ? '닫기' : '상담 작성'}
          </button>
        </div>
      </div>

      {/* 통계 칩 */}
      <div className="mb-3 flex flex-wrap gap-1.5 text-[11px]">
        <span className="rounded-full bg-slate-950 px-2.5 py-1 font-bold text-slate-300">이번 주 {stats.thisWeek}건</span>
        <span className={['rounded-full px-2.5 py-1 font-bold', stats.pending > 0 ? 'bg-amber-100 text-amber-700' : 'bg-slate-950 text-slate-400'].join(' ')}>
          <Zap className="mr-0.5 inline h-3 w-3" />
          액션 대기 {stats.pending}건
        </span>
      </div>

      {mode === 'not-configured' ? <Notice text="Supabase가 아직 연결되지 않아 로컬 MVP 데이터로 표시됩니다." /> : null}
      {mode === 'no-session' ? <Notice text="Supabase 로그인 후 상담기록 DB를 사용할 수 있습니다." /> : null}
      {error ? (
        <div className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] text-rose-600">
          <AlertTriangle className="mr-1 inline h-3 w-3" />
          {error}
        </div>
      ) : null}

      {noCustomers ? (
        <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-700">
          내 고객이 없어 상담을 작성할 수 없습니다. 고객을 먼저 등록해주세요.
          <button type="button" onClick={() => navigate({ name: 'customer' })} className="ml-2 rounded border border-amber-300 bg-white px-2 py-0.5 text-[10px] font-semibold text-amber-700">
            고객관리로 이동
          </button>
        </div>
      ) : null}

      {/* 대표/관리자/팀장: 내 상담 ↔ 직원 상담 분리 */}
      {elevated ? (
        <div className="mb-3 flex overflow-hidden rounded-xl border border-slate-800">
          <button type="button" onClick={() => setScope('mine')} className={['flex-1 px-3 py-2 text-xs font-bold transition', scope === 'mine' ? 'bg-[#0e1e3a] text-[#e6c877]' : 'bg-white text-slate-500'].join(' ')}>
            내 상담 {mineList.length}
          </button>
          <button type="button" onClick={() => setScope('staff')} className={['flex-1 px-3 py-2 text-xs font-bold transition', scope === 'staff' ? 'bg-[#0e1e3a] text-[#e6c877]' : 'bg-white text-slate-500'].join(' ')}>
            직원 상담 {staffOnly.length}
          </button>
        </div>
      ) : null}

      {/* 검색 + 퍼널 칩 필터 */}
      <div className="mb-2 flex items-center gap-2 rounded-xl border border-slate-800 bg-white px-3">
        <Search className="h-4 w-4 shrink-0 text-slate-500" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="고객명 검색" className="w-full py-2.5 text-sm text-slate-100 focus:outline-none" />
      </div>
      <div className="mb-3 flex gap-1.5 overflow-x-auto pb-1 [-webkit-overflow-scrolling:touch]">
        <FilterChip label="전체" on={typeFilter === 'all'} onClick={() => setTypeFilter('all')} />
        {CONSULTATION_TYPES.map((t) => (
          <FilterChip key={t} label={CONSULTATION_TYPE_LABEL[t]} on={typeFilter === t} onClick={() => setTypeFilter(typeFilter === t ? 'all' : t)} />
        ))}
        <FilterChip label="⚡액션 대기" on={pendingOnly} onClick={() => setPendingOnly((v) => !v)} />
      </div>

      {/* 작성 폼 */}
      {showForm && !noCustomers ? (
        <div className="mb-3 rounded-xl border border-indigo-200 bg-indigo-50/40 p-3">
          <div className="mb-2 text-[12px] font-bold text-slate-200">새 상담</div>
          <ConsultForm input={form} onChange={setForm} customers={myCustomers} />
          <AiCoachBlock
            summary={form.summary ?? ''}
            typeLabel={CONSULTATION_TYPE_LABEL[form.consultationType]}
            customerId={form.customerId}
            customers={customers}
            allConsults={list}
            onApply={(text) => setForm((f) => ({ ...f, nextAction: text }))}
            onSchedule={(type, customerId, hint) => {
              setSchedulePrefill({ type, customerId, hint })
              navigate({ name: 'schedule' })
            }}
          />
          {formErrors.length > 0 ? (
            <ul className="mt-2 space-y-0.5 text-[10px] text-rose-600">
              {formErrors.map((e) => (
                <li key={e}>• {e}</li>
              ))}
            </ul>
          ) : null}
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={() => void submitCreate()} disabled={saving} className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-60">
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} 저장
            </button>
            <button type="button" onClick={() => { setShowForm(false); setFormErrors([]) }} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-800 bg-white px-3 py-2 text-xs font-bold text-slate-400">
              <X className="h-3.5 w-3.5" /> 취소
            </button>
          </div>
        </div>
      ) : null}

      {/* 카드 목록 */}
      {loading ? (
        <div className="flex items-center justify-center gap-2 py-6 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" /> 상담기록을 불러오는 중입니다.
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-700 py-7 text-center text-sm text-slate-500">
          <div>{query || typeFilter !== 'all' || pendingOnly ? '조건에 맞는 상담이 없습니다.' : '등록된 상담이 없습니다.'}</div>
          <div className="mt-0.5 text-[11px] text-slate-400">우상단 [상담 작성]으로 첫 기록을 남겨보세요.</div>
        </div>
      ) : (
        <div className="space-y-1.5">
          {visible.map((c) => (
            <div
              key={c.id}
              role="button"
              tabIndex={0}
              onClick={() => {
                setSheetCustomerId(c.customerId)
                setSelected(null)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  setSheetCustomerId(c.customerId)
                  setSelected(null)
                }
              }}
              className="cursor-pointer rounded-xl border border-slate-800 bg-white p-3 transition hover:border-indigo-300"
            >
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[13px] font-bold text-slate-100">{c.customerName ?? custName(c.customerId)}</span>
                <span className={['rounded-full px-2 py-0.5 text-[10px] font-bold', typeChipClass(c.consultationType)].join(' ')}>{CONSULTATION_TYPE_LABEL[c.consultationType]}</span>
                {c.channel ? <span className="rounded-full border border-slate-800 bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-400">{CONSULTATION_CHANNEL_LABEL[c.channel]}</span> : null}
                {c.status !== 'completed' ? <StatusChip status={c.status} /> : null}
                {elevated && scope === 'staff' && c.staffName ? (
                  <span className="rounded-full bg-[#0e1e3a] px-1.5 py-0.5 text-[9px] font-bold text-[#e6c877]">담당 {c.staffName}</span>
                ) : null}
                <span className="ml-auto flex items-center gap-0.5 text-[11px] tabular-nums text-slate-500">
                  {dateLabel(c.completedAt ?? c.scheduledAt ?? c.createdAt)}
                  <ChevronRight className="h-3.5 w-3.5 text-slate-600" />
                </span>
              </div>
              {c.summary?.trim() ? <p className="mt-1 line-clamp-2 text-[12px] leading-5 text-slate-300">{c.summary}</p> : null}
              {c.nextAction?.trim() ? (
                <p className="mt-1 truncate text-[11px] font-semibold text-amber-700">
                  <Zap className="mr-0.5 inline h-3 w-3" />
                  다음: {c.nextAction}
                </p>
              ) : null}
            </div>
          ))}
        </div>
      )}

      {/* 고객 타임라인 시트 */}
      {sheetCustomerId ? (
        <CustomerTimelineSheet
          customerId={sheetCustomerId}
          customerName={sheetCustomer?.name ?? custName(sheetCustomerId)}
          consults={list.filter((c) => c.customerId === sheetCustomerId)}
          events={schedules.filter((ev) => ev.customerId === sheetCustomerId)}
          canWrite={myCustomers.some((c) => c.id === sheetCustomerId)}
          selected={selected}
          setSelected={setSelected}
          formErrors={formErrors}
          saving={saving}
          customers={customers}
          allConsults={list}
          onSaveEdit={() => void saveEdit()}
          onDelete={(id, who) => void removeConsultation(id, who)}
          onAddConsult={() => openCreate(sheetCustomerId)}
          onSchedule={() => {
            setSchedulePrefill({ type: 'meeting', customerId: sheetCustomerId, hint: '' })
            navigate({ name: 'schedule' })
          }}
          onCoachApply={(text) => setSelected((s) => (s ? { ...s, nextAction: text } : s))}
          onCoachSchedule={(type, customerId, hint) => {
            setSchedulePrefill({ type, customerId, hint })
            navigate({ name: 'schedule' })
          }}
          onClose={() => {
            setSheetCustomerId(null)
            setSelected(null)
            setFormErrors([])
          }}
        />
      ) : null}
    </div>
  )
}

/* ─── 고객 타임라인 시트 ───────────────────────────────────────────────── */

function CustomerTimelineSheet({
  customerId,
  customerName,
  consults,
  events,
  canWrite,
  selected,
  setSelected,
  formErrors,
  saving,
  customers,
  allConsults,
  onSaveEdit,
  onDelete,
  onAddConsult,
  onSchedule,
  onCoachApply,
  onCoachSchedule,
  onClose
}: {
  customerId: string
  customerName: string
  consults: ConsultationWithCustomer[]
  events: ScheduleWithCustomer[]
  canWrite: boolean
  selected: ConsultationWithCustomer | null
  setSelected: (v: ConsultationWithCustomer | null) => void
  formErrors: string[]
  saving: boolean
  customers: CustomerRecord[]
  allConsults: ConsultationWithCustomer[]
  onSaveEdit: () => void
  onDelete: (id: string, who?: string) => void
  onAddConsult: () => void
  onSchedule: () => void
  onCoachApply: (text: string) => void
  onCoachSchedule: (type: ScheduleType, customerId: string | undefined, hint: string) => void
  onClose: () => void
}): JSX.Element {
  const now = Date.now()

  // 다가오는 일정 (예정 상태 + 미래)
  const upcoming = events
    .filter((ev) => ev.status === 'planned' && Date.parse(ev.startsAt) >= now)
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))
    .slice(0, 3)

  // 타임라인: 상담 + 완료 미팅 메모를 시간 역순 한 줄기로
  const entries = useMemo(() => {
    const out: { at: number; kind: 'consult' | 'memo'; consult?: ConsultationWithCustomer; event?: ScheduleWithCustomer }[] = []
    for (const c of consults) {
      const at = Date.parse(c.completedAt ?? c.scheduledAt ?? c.createdAt)
      out.push({ at: Number.isNaN(at) ? 0 : at, kind: 'consult', consult: c })
    }
    for (const ev of events) {
      if (ev.status === 'done' && (ev.memo?.trim() || ev.aiBrief?.summary)) {
        const at = Date.parse(ev.startsAt)
        out.push({ at: Number.isNaN(at) ? 0 : at, kind: 'memo', event: ev })
      }
    }
    return out.sort((a, b) => b.at - a.at)
  }, [consults, events])

  const scheduleTypeLabel = (t: string): string => (SCHEDULE_TYPE_LABEL as Record<string, string>)[t] ?? '만남'

  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-black/50" onClick={onClose}>
      <div className="mt-auto flex max-h-[88vh] flex-col rounded-t-3xl border-t border-slate-800 bg-slate-950 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {/* 시트 헤더 */}
        <div className="flex items-center justify-between gap-2 rounded-t-3xl border-b border-slate-800 bg-white px-4 py-3">
          <div>
            <div className="text-sm font-bold text-slate-100">{customerName} 님 히스토리</div>
            <div className="text-[10px] text-slate-500">상담 {consults.length}건 · 미팅 메모 {entries.filter((e) => e.kind === 'memo').length}건</div>
          </div>
          <button type="button" onClick={onClose} aria-label="닫기" className="rounded-lg border border-slate-800 bg-white p-1.5 text-slate-400">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3">
          {/* 다가오는 일정 */}
          {upcoming.length > 0 ? (
            <div className="mb-3 rounded-xl border border-[#c6982f] bg-[#fdf7ea] p-2.5">
              <div className="mb-1 text-[10px] font-bold text-[#8a6a1f]">📅 다가오는 일정</div>
              {upcoming.map((ev) => (
                <div key={ev.id} className="flex items-center gap-2 text-[12px] text-slate-200">
                  <span className="font-semibold">{new Date(Date.parse(ev.startsAt)).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
                  <span>{scheduleTypeLabel(ev.type)}</span>
                  {ev.location ? <span className="truncate text-slate-500">{ev.location}</span> : null}
                </div>
              ))}
            </div>
          ) : null}

          {/* 타임라인 */}
          {entries.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-700 py-6 text-center text-[12px] text-slate-500">아직 기록이 없습니다 — 아래 [+ 상담]으로 시작하세요.</div>
          ) : (
            <div className="space-y-2">
              {entries.map((e) =>
                e.kind === 'consult' && e.consult ? (
                  <div key={`c-${e.consult.id}`} className="rounded-xl border border-slate-800 bg-white p-3">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className={['rounded-full px-2 py-0.5 text-[10px] font-bold', typeChipClass(e.consult.consultationType)].join(' ')}>
                        상담 · {CONSULTATION_TYPE_LABEL[e.consult.consultationType]}
                      </span>
                      {e.consult.channel ? <span className="rounded-full border border-slate-800 px-2 py-0.5 text-[10px] text-slate-400">{CONSULTATION_CHANNEL_LABEL[e.consult.channel]}</span> : null}
                      {e.consult.status !== 'completed' ? <StatusChip status={e.consult.status} /> : null}
                      <span className="ml-auto text-[11px] tabular-nums text-slate-500">{dateLabel(e.consult.completedAt ?? e.consult.scheduledAt ?? e.consult.createdAt)}</span>
                    </div>
                    {e.consult.summary?.trim() ? <p className="mt-1 whitespace-pre-wrap text-[12px] leading-5 text-slate-300">{e.consult.summary}</p> : null}
                    {e.consult.nextAction?.trim() ? (
                      <p className="mt-1 text-[11px] font-semibold text-amber-700">
                        <Zap className="mr-0.5 inline h-3 w-3" />
                        다음: {e.consult.nextAction}
                      </p>
                    ) : null}
                    <div className="mt-1.5 flex gap-1.5">
                      <button type="button" onClick={() => setSelected({ ...e.consult! })} className="inline-flex items-center gap-1 rounded-lg border border-slate-800 bg-white px-2 py-1 text-[10px] font-bold text-slate-400">
                        <Pencil className="h-3 w-3" /> 수정
                      </button>
                      <button
                        type="button"
                        onClick={() => onDelete(e.consult!.id, customerName)}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-800 bg-white px-2 py-1 text-[10px] font-bold text-slate-400 hover:border-rose-300 hover:text-rose-600"
                      >
                        <Trash2 className="h-3 w-3" /> 삭제
                      </button>
                    </div>

                    {/* 시트 안 수정 폼 */}
                    {selected?.id === e.consult.id ? (
                      <div className="mt-2 rounded-xl border border-indigo-200 bg-indigo-50/40 p-2.5">
                        <ConsultForm
                          input={{
                            customerId: selected.customerId,
                            consultationType: selected.consultationType,
                            status: selected.status,
                            channel: selected.channel,
                            summary: selected.summary,
                            nextAction: selected.nextAction ?? '',
                            scheduledAt: selected.scheduledAt ?? '',
                            completedAt: selected.completedAt ?? ''
                          }}
                          onChange={(v) =>
                            setSelected({
                              ...selected,
                              consultationType: v.consultationType,
                              status: v.status,
                              channel: v.channel,
                              summary: v.summary ?? '',
                              nextAction: v.nextAction,
                              scheduledAt: v.scheduledAt,
                              completedAt: v.completedAt
                            })
                          }
                          customers={customers}
                          lockCustomer
                        />
                        <AiCoachBlock
                          summary={selected.summary ?? ''}
                          typeLabel={CONSULTATION_TYPE_LABEL[selected.consultationType]}
                          customerId={selected.customerId}
                          customers={customers}
                          allConsults={allConsults}
                          excludeId={selected.id}
                          onApply={onCoachApply}
                          onSchedule={onCoachSchedule}
                        />
                        {formErrors.length > 0 ? (
                          <ul className="mt-2 space-y-0.5 text-[10px] text-rose-600">
                            {formErrors.map((er) => (
                              <li key={er}>• {er}</li>
                            ))}
                          </ul>
                        ) : null}
                        <div className="mt-2 flex gap-1.5">
                          <button type="button" onClick={onSaveEdit} disabled={saving} className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-[11px] font-bold text-white disabled:opacity-60">
                            {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />} 저장
                          </button>
                          {selected.status !== 'completed' ? (
                            <button
                              type="button"
                              onClick={() => setSelected({ ...selected, status: 'completed', completedAt: selected.completedAt || new Date().toISOString() })}
                              className="inline-flex items-center gap-1 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-[11px] font-bold text-emerald-700"
                            >
                              <CheckCircle2 className="h-3 w-3" /> 완료 처리
                            </button>
                          ) : null}
                          <button type="button" onClick={() => setSelected(null)} className="inline-flex items-center gap-1 rounded-lg border border-slate-800 bg-white px-3 py-1.5 text-[11px] font-bold text-slate-400">
                            <X className="h-3 w-3" /> 취소
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : e.event ? (
                  <div key={`m-${e.event.id}`} className="rounded-xl border border-slate-800 bg-slate-950 p-3">
                    <div className="flex items-center gap-1.5">
                      <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-bold text-slate-400">미팅 메모 · {scheduleTypeLabel(e.event.type)}</span>
                      <span className="ml-auto text-[11px] tabular-nums text-slate-500">{dateLabel(e.event.startsAt)}</span>
                    </div>
                    {e.event.aiBrief?.summary ? <p className="mt-1 text-[12px] leading-5 text-slate-300">{e.event.aiBrief.summary}</p> : null}
                    {e.event.memo?.trim() ? <p className="mt-1 whitespace-pre-wrap text-[11px] leading-5 text-slate-500">{e.event.memo}</p> : null}
                  </div>
                ) : null
              )}
            </div>
          )}
        </div>

        {/* 시트 하단 액션 */}
        <div className="flex gap-2 border-t border-slate-800 bg-white px-4 py-3">
          {canWrite ? (
            <button type="button" onClick={onAddConsult} className="inline-flex flex-1 items-center justify-center gap-1 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-3 py-2.5 text-xs font-bold text-white">
              <Plus className="h-3.5 w-3.5" /> 상담 작성
            </button>
          ) : null}
          {canWrite ? (
            <button type="button" onClick={onSchedule} className="inline-flex flex-1 items-center justify-center gap-1 rounded-xl border border-slate-800 bg-white px-3 py-2.5 text-xs font-bold text-slate-300">
              <CalendarPlus className="h-3.5 w-3.5" /> 일정 잡기
            </button>
          ) : (
            <div className="flex-1 py-2 text-center text-[11px] text-slate-500">직원 고객 — 열람만 가능합니다</div>
          )}
        </div>
      </div>
    </div>
  )
}

/* ─── 작성/수정 폼 (퍼널 칩 + 채널 칩) ─────────────────────────────────── */

function ConsultForm({
  input,
  onChange,
  customers,
  lockCustomer
}: {
  input: ConsultationInput
  onChange: (v: ConsultationInput) => void
  customers: CustomerRecord[]
  lockCustomer?: boolean
}): JSX.Element {
  const set = (patch: Partial<ConsultationInput>): void => onChange({ ...input, ...patch })
  return (
    <div className="space-y-2">
      {!lockCustomer ? (
        <label className="block text-[10px] font-semibold text-slate-500">
          고객 *
          <select value={input.customerId} onChange={(e) => set({ customerId: e.target.value })} className="mt-0.5 w-full rounded-lg border border-slate-800 bg-white px-2 py-2 text-[13px] text-slate-200">
            <option value="">고객 선택</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <div>
        <div className="mb-1 text-[10px] font-semibold text-slate-500">단계</div>
        <div className="flex flex-wrap gap-1">
          {CONSULTATION_TYPES.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => set({ consultationType: t })}
              className={[
                'rounded-full px-2.5 py-1.5 text-[11px] font-bold transition',
                normalizeConsultationType(input.consultationType) === t ? 'bg-[#0e1e3a] text-[#e6c877]' : 'border border-slate-800 bg-white text-slate-500'
              ].join(' ')}
            >
              {CONSULTATION_TYPE_LABEL[t]}
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="mb-1 text-[10px] font-semibold text-slate-500">접촉 방식</div>
        <div className="flex flex-wrap gap-1">
          {CONSULTATION_CHANNELS.map((ch) => (
            <button
              key={ch}
              type="button"
              onClick={() => set({ channel: input.channel === ch ? undefined : ch })}
              className={['rounded-full px-2.5 py-1.5 text-[11px] font-bold transition', input.channel === ch ? 'bg-[#0e1e3a] text-[#e6c877]' : 'border border-slate-800 bg-white text-slate-500'].join(' ')}
            >
              {CONSULTATION_CHANNEL_LABEL[ch]}
            </button>
          ))}
        </div>
      </div>

      <label className="block text-[10px] font-semibold text-slate-500">
        상담 요약
        <textarea
          value={input.summary ?? ''}
          onChange={(e) => set({ summary: e.target.value })}
          placeholder="무슨 얘기를 나눴나요? (AI 코치가 니즈·다음 액션을 뽑아줍니다)"
          className="mt-0.5 h-24 w-full rounded-lg border border-slate-800 bg-white px-2.5 py-2 text-[13px] leading-6 text-slate-100"
        />
      </label>

      <label className="block text-[10px] font-semibold text-slate-500">
        다음 액션
        <input value={input.nextAction ?? ''} onChange={(e) => set({ nextAction: e.target.value })} placeholder="예: 설계안 준비해서 다음 주 화요일 전화" className="mt-0.5 w-full rounded-lg border border-slate-800 bg-white px-2.5 py-2 text-[13px] text-slate-100" />
      </label>

      <div className="grid grid-cols-2 gap-2">
        <label className="block text-[10px] font-semibold text-slate-500">
          상태
          <select value={input.status} onChange={(e) => set({ status: e.target.value as ConsultationStatus })} className="mt-0.5 w-full rounded-lg border border-slate-800 bg-white px-2 py-2 text-[12px] text-slate-300">
            {CONSULTATION_STATUSES.map((s) => (
              <option key={s} value={s}>
                {CONSULTATION_STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-[10px] font-semibold text-slate-500">
          상담 예정일 (예정일 때)
          <input type="datetime-local" value={toLocalInput(input.scheduledAt)} onChange={(e) => set({ scheduledAt: fromLocalInput(e.target.value) })} className="mt-0.5 w-full rounded-lg border border-slate-800 bg-white px-2 py-2 text-[12px] text-slate-300" />
        </label>
      </div>
    </div>
  )
}

/* ─── AI 상담 코치 (기존 그대로) ───────────────────────────────────────── */

function AiCoachBlock({
  summary,
  typeLabel,
  customerId,
  customers,
  allConsults,
  excludeId,
  onApply,
  onSchedule
}: {
  summary: string
  typeLabel: string
  customerId: string
  customers: CustomerRecord[]
  allConsults: ConsultationWithCustomer[]
  excludeId?: string
  onApply: (nextAction: string) => void
  onSchedule: (type: ScheduleType, customerId: string | undefined, hint: string) => void
}): JSX.Element {
  const [busy, setBusy] = useState(false)
  const [coach, setCoach] = useState<ConsultCoach | undefined>()
  const [err, setErr] = useState<string | undefined>()

  const run = async (): Promise<void> => {
    setBusy(true)
    setErr(undefined)
    setCoach(undefined)
    const cust = customers.find((c) => c.id === customerId)
    const rrn = cust ? parseRrn(cust.rrn) : null
    const familyCount = cust?.householdId ? customers.filter((c) => c.householdId === cust.householdId).length : undefined
    const history = allConsults
      .filter((c) => c.customerId === customerId && c.id !== excludeId && (c.summary ?? '').trim())
      .sort((a, b) => Date.parse(b.updatedAt ?? '') - Date.parse(a.updatedAt ?? ''))
      .slice(0, 3)
      .map((c) => `${CONSULTATION_TYPE_LABEL[c.consultationType]} — ${c.summary}`)
    const res = await requestConsultCoach({
      summary,
      typeLabel,
      customer: cust
        ? {
            name: cust.name,
            age: rrn?.age,
            gender: rrn?.gender,
            medicalHistory: cust.medicalHistory,
            familyCount
          }
        : undefined,
      history
    })
    setBusy(false)
    if (!res.ok || !res.coach) {
      setErr(res.error)
      return
    }
    setCoach(res.coach)
  }

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => void run()}
        disabled={busy || !summary.trim()}
        className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-indigo-600 to-violet-600 px-3 py-1.5 text-[11px] font-bold text-white shadow-sm transition hover:brightness-110 disabled:opacity-50"
      >
        {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />} AI 코치 분석
        {!summary.trim() ? <span className="font-medium opacity-80">(요약 먼저 입력)</span> : null}
      </button>
      {err ? <p className="mt-1.5 text-[11px] text-rose-600">{err}</p> : null}
      {coach ? (
        <div className="mt-2 rounded-xl border border-indigo-200 bg-indigo-50/40 p-3">
          <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold text-indigo-700">
            <Sparkles className="h-3.5 w-3.5" /> AI 상담 코치
          </div>
          <div className="space-y-1.5 text-[12px] leading-6 text-slate-200">
            <div>
              <b className="text-slate-100">니즈</b> — {coach.needs}
            </div>
            <div>
              <b className="text-slate-100">추천 접근</b> — {coach.approach}
            </div>
            <div>
              <b className="text-slate-100">다음 액션</b> — {coach.nextAction}
            </div>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => onApply(coach.nextAction)}
              className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-1.5 text-[11px] font-bold text-white transition hover:bg-indigo-500"
            >
              <ArrowDownToLine className="h-3 w-3" /> 다음 액션에 적용
            </button>
            {coach.next ? (
              <button
                type="button"
                onClick={() => onSchedule(coach.next!.type as ScheduleType, customerId || undefined, coach.next!.suggestion)}
                className="inline-flex items-center gap-1 rounded-lg border border-indigo-300 bg-white px-3 py-1.5 text-[11px] font-bold text-indigo-600 transition hover:bg-indigo-50"
              >
                <CalendarPlus className="h-3 w-3" /> {coach.next.suggestion} → 일정 등록
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}

/* ─── 공용 소품 ────────────────────────────────────────────────────────── */

function toLocalInput(iso?: string): string {
  if (!iso) return ''
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return ''
  const d = new Date(t)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
function fromLocalInput(v: string): string {
  if (!v) return ''
  const t = Date.parse(v)
  return Number.isNaN(t) ? '' : new Date(t).toISOString()
}

function FilterChip({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={['shrink-0 rounded-full px-3 py-1.5 text-[11px] font-bold transition', on ? 'bg-[#0e1e3a] text-[#e6c877]' : 'border border-slate-800 bg-white text-slate-500'].join(' ')}
    >
      {label}
    </button>
  )
}

function StatusChip({ status }: { status: ConsultationStatus }): JSX.Element {
  const tone =
    status === 'completed'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-600'
      : status === 'cancelled'
        ? 'border-slate-200 bg-slate-100 text-slate-500'
        : 'border-indigo-200 bg-indigo-50 text-indigo-600'
  return <span className={['rounded-full border px-2 py-0.5 text-[10px] font-semibold', tone].join(' ')}>{CONSULTATION_STATUS_LABEL[status]}</span>
}

function ModeBadge({ mode }: { mode: ConsultationDataMode }): JSX.Element {
  const supa = mode === 'supabase'
  return (
    <span className={['inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold', supa ? 'border-emerald-200 bg-emerald-50 text-emerald-600' : 'border-blue-200 bg-blue-50 text-blue-600'].join(' ')}>
      {supa ? <Database className="h-3 w-3" /> : <HardDrive className="h-3 w-3" />}
      {supa ? 'Supabase 공용 DB' : '로컬 MVP 데이터'}
    </span>
  )
}

function Notice({ text }: { text: string }): JSX.Element {
  return <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-700">{text}</div>
}
