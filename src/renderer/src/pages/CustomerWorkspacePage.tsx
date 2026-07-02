import { type ReactNode, useMemo, useState } from 'react'
import {
  Users,
  Search,
  UserRound,
  Phone,
  Star,
  ShieldAlert,
  FileText,
  CircleDollarSign,
  Activity,
  StickyNote,
  CalendarClock,
  ListChecks,
  Download,
  RotateCcw,
  Send,
  CheckCircle2,
  Circle,
  Moon,
  ArrowRightLeft,
  Plus,
  Sparkles,
  BrainCircuit,
  ChevronRight
} from 'lucide-react'
import Card from '@renderer/components/ui/Card'
import ProgressBar from '@renderer/components/ui/ProgressBar'
import { useCustomer } from '@renderer/services/customer/useCustomer'
import { customerRepository, isDueForContact } from '@renderer/services/customer/CustomerRepository'
import { fcRepository, formatKrw } from '@renderer/services/fc/FcRepository'
import type {
  ConsultationStage,
  CustomerPriority,
  CustomerRecord,
  CustomerStatus
} from '@renderer/services/customer/types'

// --- label + tone maps -----------------------------------------------------

const STATUS_LABEL: Record<CustomerStatus, string> = {
  lead: '리드',
  active: '활동',
  consulting: '상담중',
  'proposal-sent': '제안발송',
  contracted: '계약',
  dormant: '휴면',
  'follow-up': '후속관리',
  lost: '이탈'
}

const STATUS_TONE: Record<CustomerStatus, string> = {
  lead: 'border-slate-600/40 bg-slate-600/10 text-slate-300',
  active: 'border-sky-500/30 bg-sky-500/10 text-sky-300',
  consulting: 'border-indigo-500/30 bg-indigo-500/10 text-indigo-300',
  'proposal-sent': 'border-violet-500/30 bg-violet-500/10 text-violet-300',
  contracted: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  dormant: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  'follow-up': 'border-cyan-500/30 bg-cyan-500/10 text-cyan-300',
  lost: 'border-rose-500/30 bg-rose-500/10 text-rose-300'
}

const PRIORITY_LABEL: Record<CustomerPriority, string> = {
  low: '낮음',
  medium: '보통',
  high: '높음',
  vip: 'VIP'
}

const PRIORITY_TONE: Record<CustomerPriority, string> = {
  low: 'text-slate-400',
  medium: 'text-sky-300',
  high: 'text-amber-300',
  vip: 'text-rose-300'
}

const STAGES: Array<{ value: ConsultationStage; label: string }> = [
  { value: 'first-contact', label: '최초 접촉' },
  { value: 'needs-analysis', label: '니즈 분석' },
  { value: 'policy-review', label: '증권 분석' },
  { value: 'proposal', label: '제안' },
  { value: 'closing', label: '클로징' },
  { value: 'contract', label: '계약' },
  { value: 'after-care', label: '사후관리' }
]

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString('ko-KR')
}

function exportWorkspace(): void {
  const json = customerRepository.serializeSnapshot()
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = 'customer-workspace.json'
  anchor.click()
  URL.revokeObjectURL(url)
}

/**
 * Customer Workspace — the FC's single view of one customer. Reads the pipeline
 * (via useCustomer) and every rollup from customerRepository. All mutations
 * delegate to the repository; no business logic lives here.
 */
export default function CustomerWorkspacePage(): JSX.Element {
  const snapshot = useCustomer()
  const [query, setQuery] = useState('')
  const summary = customerRepository.getSummary()

  const results = useMemo(
    () => customerRepository.searchCustomers(query),
    // snapshot in deps so search re-runs when the pipeline changes
    [query, snapshot]
  )
  const selected = snapshot.selectedCustomerId
    ? customerRepository.getCustomer(snapshot.selectedCustomerId)
    : null

  const handleReset = (): void => {
    if (typeof window !== 'undefined' && !window.confirm('고객 워크스페이스 데모 데이터를 초기화할까요?')) {
      return
    }
    customerRepository.resetDemoState()
  }

  return (
    <div className="space-y-5">
      {/* Header + org summary */}
      <Card
        title="Customer Workspace — SJ Invest 영업 파이프라인"
        icon={<Users className="h-4 w-4" />}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <ActionButton icon={<Download className="h-4 w-4" />} onClick={exportWorkspace}>
              Export workspace
            </ActionButton>
            <ActionButton variant="danger" icon={<RotateCcw className="h-4 w-4" />} onClick={handleReset}>
              Reset demo state
            </ActionButton>
          </div>
        }
      >
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Metric label="전체 고객" value={`${summary.total}명`} />
          <Metric label="활동 고객" value={`${summary.active}명`} tone="text-sky-300" />
          <Metric label="후속 연락" value={`${summary.followUpNeeded}명`} tone="text-amber-300" />
          <Metric label="제안 필요" value={`${summary.proposalReady}명`} tone="text-violet-300" />
          <Metric label="휴면" value={`${summary.dormant}명`} tone="text-rose-300" />
          <Metric label="월 보험료" value={formatKrw(summary.monthlyPremiumTotal)} />
        </div>
      </Card>

      <div className="grid gap-5 lg:grid-cols-[340px_1fr]">
        {/* Customer list */}
        <Card title="고객 검색 / 목록" icon={<Search className="h-4 w-4" />} action={<span className="text-xs text-slate-500">{results.length}명</span>}>
          <div className="space-y-3">
            <div className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-950/60 px-2.5 py-1.5">
              <Search className="h-3.5 w-3.5 text-slate-500" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="이름, 전화, FC, 태그 검색"
                className="w-full bg-transparent text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none"
              />
            </div>
            <ol className="max-h-[32rem] space-y-1.5 overflow-y-auto pr-1">
              {results.map((c) => (
                <CustomerListRow
                  key={c.customerId}
                  customer={c}
                  selected={c.customerId === snapshot.selectedCustomerId}
                  onSelect={() => customerRepository.selectCustomer(c.customerId)}
                />
              ))}
              {results.length === 0 ? <li className="px-2 py-4 text-sm text-slate-500">검색 결과가 없습니다.</li> : null}
            </ol>
          </div>
        </Card>

        {/* Selected customer detail */}
        {selected ? <CustomerDetail customer={selected} /> : <EmptyDetail />}
      </div>
    </div>
  )
}

// --- customer list row -----------------------------------------------------

function CustomerListRow({
  customer,
  selected,
  onSelect
}: {
  customer: CustomerRecord
  selected: boolean
  onSelect: () => void
}): JSX.Element {
  const due = isDueForContact(customer)
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        className={[
          'flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition',
          selected ? 'border-indigo-500/40 bg-indigo-500/10' : 'border-slate-800 bg-slate-900/40 hover:bg-slate-800/60'
        ].join(' ')}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-medium text-slate-100">{customer.name}</span>
            {customer.priority === 'vip' || customer.priority === 'high' ? (
              <Star className={['h-3 w-3 shrink-0', PRIORITY_TONE[customer.priority]].join(' ')} />
            ) : null}
          </div>
          <div className="truncate text-[11px] text-slate-500">
            {customer.assignedFcName} · {customer.team}
          </div>
        </div>
        <span className={['shrink-0 rounded-full border px-1.5 py-0.5 text-[10px]', STATUS_TONE[customer.status]].join(' ')}>
          {STATUS_LABEL[customer.status]}
        </span>
        {due ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" title="오늘 연락 필요" /> : null}
      </button>
    </li>
  )
}

// --- selected customer detail ----------------------------------------------

function CustomerDetail({ customer }: { customer: CustomerRecord }): JSX.Element {
  const id = customer.customerId
  const checklist = customerRepository.getConsultationChecklist(id)
  const nextAction = customerRepository.getNextActionLabel(customer)

  const promptMemo = (): void => {
    const text = window.prompt(`${customer.name} 메모 추가`)
    if (text) customerRepository.addMemo(id, text, customer.assignedFcName)
  }
  const promptActivity = (): void => {
    const summary = window.prompt(`${customer.name} 활동 기록 (예: 통화 상담)`)
    if (summary) customerRepository.addActivity(id, 'note', summary)
  }
  const promptNextContact = (): void => {
    const raw = window.prompt(`${customer.name} 다음 연락일 (YYYY-MM-DD)`, '')
    if (!raw) return
    const iso = new Date(raw).toISOString()
    customerRepository.setNextContact(id, iso)
  }
  const promptAssign = (): void => {
    const roster = fcRepository
      .listMembers()
      .map((m) => `${m.fcId} · ${m.name} (${m.team})`)
      .join('\n')
    const fcId = window.prompt(`FC 배정 — FC ID 입력\n\n${roster}`, customer.assignedFcId)
    if (fcId) customerRepository.assignToFc(id, fcId.trim())
  }

  return (
    <div className="space-y-5">
      {/* Profile */}
      <Card title="고객 프로필" icon={<UserRound className="h-4 w-4" />} action={<StatusBadge status={customer.status} />}>
        <div className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-lg font-semibold text-slate-100">{customer.name}</span>
                <span className={['flex items-center gap-1 text-xs font-medium', PRIORITY_TONE[customer.priority]].join(' ')}>
                  <Star className="h-3.5 w-3.5" /> {PRIORITY_LABEL[customer.priority]}
                </span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                <span>{customer.age}세 · {customer.gender === 'male' ? '남' : '여'}</span>
                <span className="flex items-center gap-1"><Phone className="h-3 w-3" /> {customer.phone}</span>
                <span>유입: {customer.source}</span>
              </div>
            </div>
            <div className="text-right text-xs text-slate-500">
              <div>담당 FC · <span className="text-slate-300">{customer.assignedFcName}</span></div>
              <div>{customer.team}</div>
            </div>
          </div>

          {/* Risk tags */}
          <div className="flex flex-wrap items-center gap-1.5">
            <ShieldAlert className="h-3.5 w-3.5 text-amber-400" />
            {customer.riskTags.length === 0 ? (
              <span className="text-xs text-slate-500">리스크 태그 없음</span>
            ) : (
              customer.riskTags.map((t) => (
                <span key={t} className="rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-200">
                  {t}
                </span>
              ))
            )}
          </div>

          {/* Premium summary */}
          <div className="grid gap-3 sm:grid-cols-3">
            <Metric label="월 보험료" value={formatKrw(customer.monthlyPremium)} />
            <Metric label="누적 보험료" value={formatKrw(customer.totalPremium)} />
            <Metric label="보유 증권" value={`${customer.policyCount}건`} />
          </div>
        </div>
      </Card>

      {/* Consultation stage + checklist + next action */}
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="상담 진행" icon={<ListChecks className="h-4 w-4" />}>
          <div className="space-y-3">
            <label className="block text-xs text-slate-500">
              상담 단계
              <select
                value={customer.consultationStage}
                onChange={(e) => customerRepository.updateConsultationStage(id, e.target.value as ConsultationStage)}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950/60 px-2.5 py-1.5 text-sm text-slate-200 focus:outline-none"
              >
                {STAGES.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </label>
            <ol className="space-y-1">
              {checklist.map((step) => (
                <li key={step.stage} className="flex items-center gap-2 text-sm">
                  {step.done ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                  ) : step.current ? (
                    <ChevronRight className="h-3.5 w-3.5 text-indigo-300" />
                  ) : (
                    <Circle className="h-3.5 w-3.5 text-slate-600" />
                  )}
                  <span className={step.current ? 'text-slate-100' : step.done ? 'text-slate-400' : 'text-slate-600'}>
                    {step.label}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        </Card>

        <Card title="다음 예정 액션" icon={<CalendarClock className="h-4 w-4" />}>
          <div className="space-y-2 text-sm">
            <div className="rounded-lg border border-indigo-500/20 bg-indigo-500/10 px-3 py-2 text-indigo-200">{nextAction}</div>
            <Field label="마지막 접촉" value={formatDate(customer.lastContactedAt)} />
            <Field label="다음 연락 예정" value={formatDate(customer.nextContactAt)} />
          </div>
        </Card>
      </div>

      {/* Quick actions */}
      <Card title="빠른 작업" icon={<Sparkles className="h-4 w-4" />}>
        <div className="flex flex-wrap items-center gap-2">
          <ActionButton icon={<Send className="h-4 w-4" />} variant="primary" onClick={() => customerRepository.markProposalSent(id)}>
            제안서 발송
          </ActionButton>
          <ActionButton icon={<CheckCircle2 className="h-4 w-4" />} onClick={() => customerRepository.markContracted(id)}>
            계약 체결
          </ActionButton>
          <ActionButton icon={<Star className="h-4 w-4" />} onClick={() => customerRepository.markPriority(id, 'high')}>
            우선순위 지정
          </ActionButton>
          <ActionButton icon={<Moon className="h-4 w-4" />} onClick={() => customerRepository.markDormant(id)}>
            휴면 처리
          </ActionButton>
          <ActionButton icon={<StickyNote className="h-4 w-4" />} onClick={promptMemo}>
            메모 추가
          </ActionButton>
          <ActionButton icon={<Plus className="h-4 w-4" />} onClick={promptActivity}>
            활동 기록
          </ActionButton>
          <ActionButton icon={<CalendarClock className="h-4 w-4" />} onClick={promptNextContact}>
            다음 연락일
          </ActionButton>
          <ActionButton icon={<ArrowRightLeft className="h-4 w-4" />} onClick={promptAssign}>
            FC 배정
          </ActionButton>
        </div>
      </Card>

      {/* Policies */}
      <Card title="보유 / 제안 증권" icon={<FileText className="h-4 w-4" />} action={<span className="text-xs text-slate-500">{customer.policies.length}건</span>}>
        {customer.policies.length === 0 ? (
          <p className="text-sm text-slate-500">등록된 증권이 없습니다.</p>
        ) : (
          <ul className="space-y-2">
            {customer.policies.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2">
                <div className="min-w-0">
                  <div className="truncate text-sm text-slate-200">{p.name} <span className="text-xs text-slate-500">· {p.type}</span></div>
                  <div className="text-[11px] text-slate-500">{p.coverage}</div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-sm text-slate-200">{formatKrw(p.premium)}/월</div>
                  <div className="text-[11px] text-slate-500">{p.status}</div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Activity timeline + memos */}
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="활동 타임라인" icon={<Activity className="h-4 w-4" />} action={<span className="text-xs text-slate-500">{customer.activities.length}건</span>}>
          {customer.activities.length === 0 ? (
            <p className="text-sm text-slate-500">기록된 활동이 없습니다.</p>
          ) : (
            <ol className="space-y-2">
              {customer.activities.map((a) => (
                <li key={a.id} className="rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-indigo-300">{a.type}</span>
                    <span className="text-[11px] text-slate-600">{formatDate(a.createdAt)}</span>
                  </div>
                  <div className="mt-0.5 text-sm text-slate-300">{a.summary}</div>
                </li>
              ))}
            </ol>
          )}
        </Card>

        <Card title="메모" icon={<StickyNote className="h-4 w-4" />} action={<span className="text-xs text-slate-500">{customer.memos.length}건</span>}>
          {customer.memos.length === 0 ? (
            <p className="text-sm text-slate-500">메모가 없습니다.</p>
          ) : (
            <ul className="space-y-2">
              {customer.memos.map((m) => (
                <li key={m.id} className="rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2">
                  <div className="text-sm text-slate-300">{m.text}</div>
                  <div className="mt-0.5 text-[11px] text-slate-600">{m.author} · {formatDate(m.createdAt)}</div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* Future AI analysis entry points */}
      <Card title="AI 보험 분석 (예정)" icon={<BrainCircuit className="h-4 w-4" />} action={<span className="text-xs text-slate-500">다음 스프린트</span>}>
        <div className="flex flex-wrap items-center gap-2">
          <FutureButton label="보험 니즈 분석" />
          <FutureButton label="보장 갭 분석" />
          <FutureButton label="상품 추천" />
          <FutureButton label="리스크 스코어링" />
        </div>
        <p className="mt-2 text-xs text-slate-500">
          고객 워크플로우가 준비되었습니다. AI 보험 분석은 다음 단계 · Sales Activity Workspace 이후 연결됩니다.
        </p>
      </Card>
    </div>
  )
}

function EmptyDetail(): JSX.Element {
  return (
    <Card title="고객 선택" icon={<UserRound className="h-4 w-4" />}>
      <p className="text-sm text-slate-500">왼쪽 목록에서 고객을 선택하면 프로필과 상담 현황이 표시됩니다.</p>
    </Card>
  )
}

// --- presentational helpers ------------------------------------------------

function StatusBadge({ status }: { status: CustomerStatus }): JSX.Element {
  return (
    <span className={['rounded-full border px-2 py-0.5 text-[11px] font-medium', STATUS_TONE[status]].join(' ')}>
      {STATUS_LABEL[status]}
    </span>
  )
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: string }): JSX.Element {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2.5">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={['mt-1 truncate text-sm font-medium', tone ?? 'text-slate-200'].join(' ')}>{value}</div>
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs text-slate-500">{label}</span>
      <span className="text-sm text-slate-300">{value}</span>
    </div>
  )
}

function FutureButton({ label }: { label: string }): JSX.Element {
  return (
    <button
      type="button"
      disabled
      title="다음 스프린트에서 제공됩니다"
      className="inline-flex cursor-not-allowed items-center gap-2 rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-1.5 text-xs font-medium text-slate-500 opacity-70"
    >
      <BrainCircuit className="h-3.5 w-3.5" />
      {label}
    </button>
  )
}

type ButtonVariant = 'default' | 'primary' | 'danger'

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  default: 'border-slate-700 bg-slate-800/60 text-slate-200 hover:bg-slate-700/60',
  primary: 'border-indigo-500/30 bg-indigo-500/15 text-indigo-200 hover:bg-indigo-500/25',
  danger: 'border-rose-500/30 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20'
}

function ActionButton({
  children,
  onClick,
  icon,
  variant = 'default'
}: {
  children: ReactNode
  onClick: () => void
  icon?: ReactNode
  variant?: ButtonVariant
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={['inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium transition', BUTTON_VARIANTS[variant]].join(' ')}
    >
      {icon}
      {children}
    </button>
  )
}
