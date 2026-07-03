import { useMemo, useState, type ReactNode } from 'react'
import {
  Users,
  CalendarClock,
  AlertCircle,
  Target,
  Stethoscope,
  Search,
  Phone,
  UserRound,
  ArrowRight,
  Bot,
  PhoneCall,
  ClipboardList,
  FileText,
  Activity,
  CheckCircle2
} from 'lucide-react'
import Card from '@renderer/components/ui/Card'
import { jarvisService } from '@renderer/services/jarvis/JarvisService'

/**
 * Staff Customer Board — a bright, staff-facing overview prepended to the
 * customer workspace. UI/local-state only: safe mock preview data, local
 * search/filter/select state, and Jarvis suggestion chips that use the existing
 * jarvisService.openWithDraft(). No backend, no data-architecture changes, no
 * overlays, no listeners/timers, no command-engine changes.
 */

type StaffStatus = '상담 예정' | '미처리' | '클로징 예정' | '보험분석 필요' | '계약 완료' | '재상담 필요'

const STATUS_TONE: Record<StaffStatus, string> = {
  '상담 예정': 'border-indigo-500/30 bg-indigo-500/10 text-indigo-300',
  미처리: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  '클로징 예정': 'border-rose-500/30 bg-rose-500/10 text-rose-300',
  '보험분석 필요': 'border-sky-500/30 bg-sky-500/10 text-sky-300',
  '계약 완료': 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  '재상담 필요': 'border-violet-500/30 bg-violet-500/10 text-violet-300'
}

interface StaffCustomer {
  id: string
  name: string
  phone: string
  status: StaffStatus
  nextSchedule: string
  owner: string
  priority: 'high' | 'medium' | 'low'
  nextAction: string
  product: string
  note: string
}

// Safe local preview data (no backend / external API).
const CUSTOMERS: StaffCustomer[] = [
  { id: 'c1', name: '김민수', phone: '010-1234-5678', status: '클로징 예정', nextSchedule: '오늘 14:00', owner: '박지훈', priority: 'high', nextAction: '클로징 연락', product: '종신보험', note: '보장 분석 후 계약 의사 확인. 배우자 보장 추가 검토 중.' },
  { id: 'c2', name: '이서연', phone: '010-2345-6789', status: '상담 예정', nextSchedule: '오늘 16:30', owner: '박지훈', priority: 'high', nextAction: '상담 준비', product: '실손의료비', note: '기존 실손 갱신 상담. 자녀 보험 관심.' },
  { id: 'c3', name: '정우진', phone: '010-3456-7890', status: '미처리', nextSchedule: '미정', owner: '최유나', priority: 'medium', nextAction: '전화 예정', product: '-', note: '3일 전 문의 후 미응대. 빠른 연락 필요.' },
  { id: 'c4', name: '한지민', phone: '010-4567-8901', status: '보험분석 필요', nextSchedule: '내일 10:00', owner: '최유나', priority: 'medium', nextAction: '보험분석 진행', product: '암보험', note: '증권 3건 보유. 중복/부족 보장 분석 요청.' },
  { id: 'c5', name: '오세훈', phone: '010-5678-9012', status: '재상담 필요', nextSchedule: '이번 주', owner: '박지훈', priority: 'low', nextAction: '서류 확인', product: '연금보험', note: '가입 후 6개월 점검. 추가 납입 상담.' },
  { id: 'c6', name: '배수지', phone: '010-6789-0123', status: '계약 완료', nextSchedule: '완료', owner: '최유나', priority: 'low', nextAction: '감사 인사', product: '어린이보험', note: '계약 완료. 소개 요청 가능 고객.' },
  { id: 'c7', name: '강도현', phone: '010-7890-1234', status: '미처리', nextSchedule: '미정', owner: '박지훈', priority: 'high', nextAction: '전화 예정', product: '-', note: '광고 유입 리드. 관심 상품 미확인.' },
  { id: 'c8', name: '윤아름', phone: '010-8901-2345', status: '클로징 예정', nextSchedule: '오늘 18:00', owner: '최유나', priority: 'high', nextAction: '클로징 연락', product: '종합보험', note: '제안서 발송 완료. 오늘 최종 확인 예정.' }
]

const SUMMARY = [
  { key: 'total', label: '전체 고객', value: '128명', icon: <Users className="h-4 w-4" />, tone: 'text-blue-600' },
  { key: 'today', label: '오늘 상담', value: '5건', icon: <CalendarClock className="h-4 w-4" />, tone: 'text-indigo-600' },
  { key: 'pending', label: '미처리 고객', value: '12명', icon: <AlertCircle className="h-4 w-4" />, tone: 'text-amber-600' },
  { key: 'closing', label: '클로징 예정', value: '4명', icon: <Target className="h-4 w-4" />, tone: 'text-rose-600' },
  { key: 'analysis', label: '보험분석 필요', value: '7명', icon: <Stethoscope className="h-4 w-4" />, tone: 'text-sky-600' }
]

const FOLLOW_UP = [
  { icon: <PhoneCall className="h-3.5 w-3.5 text-amber-500" />, action: '전화 예정', who: '정우진 · 강도현' },
  { icon: <ClipboardList className="h-3.5 w-3.5 text-indigo-500" />, action: '상담 준비', who: '이서연' },
  { icon: <FileText className="h-3.5 w-3.5 text-slate-400" />, action: '서류 확인', who: '오세훈' },
  { icon: <Activity className="h-3.5 w-3.5 text-sky-500" />, action: '보험분석 진행', who: '한지민' },
  { icon: <Target className="h-3.5 w-3.5 text-rose-500" />, action: '클로징 연락', who: '김민수 · 윤아름' }
]

const FILTERS: Array<'전체' | StaffStatus> = ['전체', '상담 예정', '미처리', '클로징 예정', '보험분석 필요', '계약 완료']

const JARVIS_CHIPS = [
  '김민수 고객 상담 준비해줘',
  '오늘 상담 고객 정리해줘',
  '보험분석 필요한 고객 찾아줘',
  '클로징 예정 고객 알려줘',
  '미처리 고객 follow-up 정리해줘'
]

const PRIORITY_TONE: Record<StaffCustomer['priority'], string> = {
  high: 'text-rose-600',
  medium: 'text-amber-600',
  low: 'text-slate-500'
}
const PRIORITY_LABEL: Record<StaffCustomer['priority'], string> = { high: '높음', medium: '보통', low: '낮음' }

export default function StaffCustomerBoard(): JSX.Element {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'전체' | StaffStatus>('전체')
  const [selectedId, setSelectedId] = useState<string>('c1')

  const filtered = useMemo(() => {
    const q = query.trim()
    return CUSTOMERS.filter((c) => {
      const matchesFilter = filter === '전체' || c.status === filter
      const matchesQuery = q === '' || c.name.includes(q) || c.phone.includes(q)
      return matchesFilter && matchesQuery
    })
  }, [query, filter])

  const selected = CUSTOMERS.find((c) => c.id === selectedId) ?? null

  return (
    <div className="space-y-5">
      {/* A. Summary cards */}
      <Card title="고객 관리 요약" icon={<Users className="h-4 w-4 text-indigo-300" />} action={<PreviewTag />}>
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {SUMMARY.map((s) => (
            <div key={s.key} className="rounded-xl border border-slate-800 bg-slate-950/40 px-4 py-3">
              <div className="flex items-center gap-1.5 text-xs text-slate-500">
                <span className="text-slate-400">{s.icon}</span>
                {s.label}
              </div>
              <div className={['mt-1 text-2xl font-bold', s.tone].join(' ')}>{s.value}</div>
            </div>
          ))}
        </div>
      </Card>

      <div className="grid gap-5 lg:grid-cols-3">
        {/* B. Priority customer list + search/filter */}
        <div className="lg:col-span-2">
          <Card title="우선 관리 고객" icon={<UserRound className="h-4 w-4 text-indigo-300" />} action={<PreviewTag />}>
            {/* D. Search + filter */}
            <div className="mb-3 space-y-2">
              <div className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2">
                <Search className="h-4 w-4 text-slate-500" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="고객명 · 연락처 검색"
                  className="w-full bg-transparent text-sm text-slate-200 outline-none placeholder:text-slate-500"
                />
              </div>
              <div className="flex flex-wrap gap-1.5">
                {FILTERS.map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setFilter(f)}
                    className={[
                      'rounded-full border px-2.5 py-1 text-xs font-medium transition',
                      filter === f
                        ? 'border-blue-500/40 bg-blue-600 text-white'
                        : 'border-slate-700 bg-slate-800/50 text-slate-400 hover:text-slate-200'
                    ].join(' ')}
                  >
                    {f}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              {filtered.length === 0 ? (
                <p className="py-6 text-center text-sm text-slate-500">검색 결과가 없습니다.</p>
              ) : (
                filtered.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setSelectedId(c.id)}
                    className={[
                      'flex w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border px-3 py-2.5 text-left transition',
                      selectedId === c.id
                        ? 'border-indigo-500/40 bg-indigo-500/5'
                        : 'border-slate-800 bg-white hover:border-indigo-500/30'
                    ].join(' ')}
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 text-xs font-bold text-white">
                      {c.name.slice(0, 1)}
                    </span>
                    <span className="min-w-[64px] text-sm font-semibold text-slate-200">{c.name}</span>
                    <span className="flex items-center gap-1 text-xs text-slate-500"><Phone className="h-3 w-3" />{c.phone}</span>
                    <span className={['rounded-full border px-2 py-0.5 text-[11px] font-medium', STATUS_TONE[c.status]].join(' ')}>{c.status}</span>
                    <span className="ml-auto flex items-center gap-2 text-xs text-slate-500">
                      <span className="flex items-center gap-1"><CalendarClock className="h-3 w-3" />{c.nextSchedule}</span>
                      <span>· {c.owner}</span>
                      <span className={PRIORITY_TONE[c.priority]}>· {PRIORITY_LABEL[c.priority]}</span>
                    </span>
                    <span className="w-full text-xs text-slate-500">다음 액션: <span className="text-slate-300">{c.nextAction}</span></span>
                  </button>
                ))
              )}
            </div>
          </Card>
        </div>

        {/* C + E. Today follow-up + customer detail preview */}
        <div className="space-y-5">
          <Card title="오늘 follow-up" icon={<CalendarClock className="h-4 w-4 text-amber-300" />} action={<PreviewTag />}>
            <ul className="space-y-2">
              {FOLLOW_UP.map((f) => (
                <li key={f.action} className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2 text-sm">
                  <span className="shrink-0">{f.icon}</span>
                  <span className="font-medium text-slate-200">{f.action}</span>
                  <span className="ml-auto text-xs text-slate-500">{f.who}</span>
                </li>
              ))}
            </ul>
          </Card>

          {selected ? (
            <Card title="고객 상세 미리보기" icon={<UserRound className="h-4 w-4 text-indigo-300" />}>
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 text-sm font-bold text-white">
                    {selected.name.slice(0, 1)}
                  </span>
                  <div>
                    <div className="text-sm font-bold text-slate-100">{selected.name}</div>
                    <div className="text-xs text-slate-500">{selected.phone} · {selected.owner}</div>
                  </div>
                  <span className={['ml-auto rounded-full border px-2 py-0.5 text-[11px] font-medium', STATUS_TONE[selected.status]].join(' ')}>{selected.status}</span>
                </div>
                <DetailRow label="관심/가입 상품" value={selected.product} />
                <DetailRow label="다음 일정" value={selected.nextSchedule} />
                <DetailRow label="다음 액션" value={selected.nextAction} />
                <div className="rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2 text-xs text-slate-300">
                  <div className="mb-1 flex items-center gap-1 text-slate-500"><FileText className="h-3 w-3" /> 최근 상담 메모</div>
                  {selected.note}
                </div>
                <button
                  type="button"
                  onClick={() => jarvisService.openWithDraft(`${selected.name} 고객 상담 준비해줘`)}
                  className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-indigo-500/30 bg-indigo-500/10 px-3 py-2 text-xs font-medium text-indigo-300 transition hover:bg-indigo-500/20"
                >
                  <Bot className="h-3.5 w-3.5" />
                  자비스에 “{selected.name} 고객 상담 준비해줘” 요청
                </button>
              </div>
            </Card>
          ) : null}
        </div>
      </div>

      {/* Jarvis suggestion chips */}
      <Card title="자비스에게 고객 상담 준비 요청하기" icon={<Bot className="h-4 w-4 text-indigo-300" />} action={<span className="text-xs text-slate-500">클릭하면 자비스 입력창에 넣기</span>}>
        <div className="flex flex-wrap gap-2">
          {JARVIS_CHIPS.map((cmd) => (
            <button
              key={cmd}
              type="button"
              onClick={() => jarvisService.openWithDraft(cmd)}
              title="자비스 입력창에 넣기"
              className="inline-flex items-center gap-1.5 rounded-full border border-indigo-500/30 bg-indigo-500/10 px-3 py-1.5 text-sm font-medium text-indigo-300 transition hover:bg-indigo-500/20"
            >
              <ArrowRight className="h-3.5 w-3.5" />
              {cmd}
            </button>
          ))}
        </div>
      </Card>

      <p className="text-center text-[10px] text-slate-500">
        <CheckCircle2 className="mr-1 inline h-3 w-3 text-emerald-500" />
        고객 관리 안전 빌드 · 미리보기 데이터
      </p>
    </div>
  )
}

// --- helpers ---------------------------------------------------------------

function PreviewTag(): JSX.Element {
  return <span className="rounded-full border border-slate-700 bg-slate-800/60 px-2 py-0.5 text-[10px] font-medium text-slate-500">미리보기</span>
}

function DetailRow({ label, value }: { label: string; value: ReactNode }): JSX.Element {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-slate-500">{label}</span>
      <span className="font-medium text-slate-200">{value}</span>
    </div>
  )
}
