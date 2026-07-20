import { useEffect, useMemo, useState } from 'react'
import {
  Users,
  UploadCloud,
  Loader2,
  AlertTriangle,
  PhoneCall,
  PhoneOff,
  Clock,
  CheckCircle2,
  ArrowRightLeft,
  ListChecks,
  Flame,
  UserRound,
  Tag,
  Plus,
  X,
  UserPlus,
  ShieldQuestion,
  FileSearch
} from 'lucide-react'
import { useSession } from '@renderer/navigation/SessionContext'
import { useNavigation } from '@renderer/navigation/NavigationContext'
import type { View } from '@renderer/navigation/types'
import { isAdminRole } from '@renderer/navigation/roleAccess'
import { createCustomer, listCustomers } from '@renderer/services/commercial/customerService'
import { setHubCustomer } from '@renderer/services/insurance-hub/insuranceHubStore'
import InsuranceHubBar from '@renderer/components/insurance-hub/InsuranceHubBar'
import type { CustomerRecord } from '@shared/commercial/models'
import { useRealtimeSync } from '@renderer/services/commercial/useRealtimeSync'
import {
  distributeLeads,
  assignLeadsTo,
  listAllLeads,
  listMyLeads,
  listSalesStaff,
  markCalled,
  reassignLead,
  updateLeadStatus,
  isOverdue,
  callDeadlineRemainingMs,
  listDbTypes,
  addDbType,
  deleteDbType,
  LEAD_STATUS_LABEL,
  LEAD_STATUS_FLOW,
  type Lead,
  type LeadInput,
  type LeadStatus,
  type LeadDbType,
  type SalesStaff
} from '@renderer/services/commercial/leadService'
import { parseLeadFile } from '@renderer/services/commercial/leadImport'
import FileDropZone from '@renderer/components/ui/FileDropZone'

const RT_TABLES = ['leads', 'lead_db_types']

const STATUS_CHIP: Record<LeadStatus, string> = {
  new: 'bg-slate-800 text-slate-300',
  absent: 'bg-amber-50 text-amber-700',
  recall: 'bg-indigo-50 text-indigo-600',
  called: 'bg-sky-50 text-sky-700',
  appointment: 'bg-violet-50 text-violet-700',
  consulting: 'bg-cyan-50 text-cyan-700',
  contracted: 'bg-emerald-50 text-emerald-700',
  rejected: 'bg-rose-50 text-rose-700',
  invalid: 'bg-slate-100 text-slate-500',
  fail: 'bg-rose-50 text-rose-700'
}

/** FC가 진행하며 체크하는 카테고리 칩 (미콜은 초기 상태라 제외). */
const PROGRESS_STATUSES: LeadStatus[] = LEAD_STATUS_FLOW.filter((s) => s !== 'new')

/** 고객 전환을 제안할 상태 (통화가 성사된 이후 단계). */
const CONVERTIBLE = new Set<LeadStatus>(['called', 'appointment', 'consulting', 'contracted'])

/** 남은 콜 시간 표시 문구. */
function remainLabel(lead: Lead): { text: string; tone: string } {
  if (lead.status !== 'new') return { text: LEAD_STATUS_LABEL[lead.status], tone: 'text-slate-500' }
  const ms = callDeadlineRemainingMs(lead)
  if (ms === null) return { text: '배정 대기', tone: 'text-slate-500' }
  if (ms <= 0) return { text: `미콜 ${Math.floor(-ms / 3_600_000)}시간 초과`, tone: 'text-rose-600 font-bold' }
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  return { text: `콜 마감 ${h}시간 ${m}분 남음`, tone: h < 3 ? 'text-amber-600 font-semibold' : 'text-slate-500' }
}

/** "이름, 전화, 유입경로" 줄(엑셀 탭 또는 콤마) → LeadInput[]. */
function parsePaste(text: string): LeadInput[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(/\t|,|\|/).map((p) => p.trim())
      return { name: parts[0] ?? '', phone: parts[1] || undefined, source: parts[2] || undefined, memo: parts[3] || undefined }
    })
    .filter((l) => l.name)
}

export default function LeadDistributionPage(): JSX.Element {
  const { session } = useSession()
  const { navigate } = useNavigation()
  const admin = isAdminRole(session.role)

  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [staff, setStaff] = useState<SalesStaff[]>([])
  const [, forceTick] = useState(0)

  // DB 종류(태그)
  const [dbTypes, setDbTypes] = useState<LeadDbType[]>([])
  const [selectedType, setSelectedType] = useState('') // 배정 시 태깅할 종류
  const [newType, setNewType] = useState('') // 관리: 새 종류 이름
  const [typeMsg, setTypeMsg] = useState('')
  const [typeFilter, setTypeFilter] = useState('all') // 목록 필터

  // 관리자 입력
  const [paste, setPaste] = useState('')
  const [busy, setBusy] = useState(false)
  const [distMsg, setDistMsg] = useState('')
  // 파일 업로드 판독 결과 (행별 선택 배정)
  const [imported, setImported] = useState<{ row: LeadInput; checked: boolean }[]>([])
  const [importSummary, setImportSummary] = useState('')
  // 배정 방식: 'auto' = 최소부하 자동, 그 외 = 선택한 직원 id
  const [assignMode, setAssignMode] = useState('auto')

  // 콜 완료한 내 리드 → 고객 전환 (보험 허브에 연결해 AI 도구로 직행)
  const [convertBusyId, setConvertBusyId] = useState<string | null>(null)
  const [converted, setConverted] = useState<Record<string, CustomerRecord>>({})

  const load = async (): Promise<void> => {
    const res = admin ? await listAllLeads() : await listMyLeads()
    setLeads(res.leads)
    setError(res.ok ? '' : res.error ?? '리드를 불러오지 못했습니다.')
    setLoading(false)
  }
  const loadTypes = async (): Promise<void> => setDbTypes(await listDbTypes())

  useEffect(() => {
    void load()
    void loadTypes()
    if (admin) void listSalesStaff().then(setStaff)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useRealtimeSync(RT_TABLES, () => {
    void load()
    void loadTypes()
  })

  // 남은 시간 실시간 갱신 (1분마다 리렌더).
  useEffect(() => {
    const t = window.setInterval(() => forceTick((n) => n + 1), 60_000)
    return () => window.clearInterval(t)
  }, [])

  const parsed = useMemo(() => parsePaste(paste), [paste])
  /** 이번에 배정할 리드 = 붙여넣기 + 업로드에서 체크된 행. */
  const pendingRows = useMemo(
    () => [...parsed, ...imported.filter((i) => i.checked).map((i) => i.row)],
    [parsed, imported]
  )
  const overdue = useMemo(() => leads.filter(isOverdue), [leads])
  const byStaff = useMemo(() => {
    const m = new Map<string, { name: string; total: number; uncalled: number; overdue: number }>()
    for (const l of leads) {
      const key = l.assignedFcId ?? 'none'
      const name = l.assignedFcName ?? '미배정'
      const cur = m.get(key) ?? { name, total: 0, uncalled: 0, overdue: 0 }
      cur.total += 1
      if (l.status === 'new') cur.uncalled += 1
      if (isOverdue(l)) cur.overdue += 1
      m.set(key, cur)
    }
    return [...m.values()].sort((a, b) => b.overdue - a.overdue || b.uncalled - a.uncalled)
  }, [leads])

  /** 파일 업로드 → 판독 → 미리보기(전체 체크 상태). */
  const importFile = async (file: File): Promise<void> => {
    setDistMsg('')
    const res = await parseLeadFile(file)
    if (!res.ok) {
      setImportSummary('')
      setImported([])
      setDistMsg(res.error ?? '파일 판독에 실패했습니다.')
      return
    }
    setImported(res.rows.map((row) => ({ row, checked: true })))
    setImportSummary(res.summary ?? `${res.rows.length}건 판독`)
  }

  const distribute = async (): Promise<void> => {
    if (pendingRows.length === 0) {
      setDistMsg('배정할 리드가 없습니다 — 파일을 올리거나 붙여넣어 주세요.')
      return
    }
    setBusy(true)
    setDistMsg('')
    const typeTag = selectedType ? `[${selectedType}] ` : ''
    if (assignMode === 'auto') {
      const res = await distributeLeads(pendingRows, selectedType || undefined)
      setBusy(false)
      if (!res.ok) {
        setDistMsg(res.error ?? '분배에 실패했습니다.')
        return
      }
      const names = Object.entries(res.perStaff)
        .map(([id, n]) => `${staff.find((s) => s.id === id)?.name ?? '직원'} ${n}건`)
        .join(' · ')
      setDistMsg(`✅ ${typeTag}${res.assigned}건을 자동 배정했습니다 — ${names}. 배정된 직원에게 알림이 전송됐어요.`)
    } else {
      const fc = staff.find((s) => s.id === assignMode)
      if (!fc) {
        setBusy(false)
        setDistMsg('배정할 직원을 다시 선택해 주세요.')
        return
      }
      const res = await assignLeadsTo(pendingRows, { id: fc.id, name: fc.name }, selectedType || undefined)
      setBusy(false)
      if (!res.ok) {
        setDistMsg(res.error ?? '배정에 실패했습니다.')
        return
      }
      setDistMsg(`✅ ${typeTag}${res.assigned}건을 ${fc.name}님에게 배정했습니다. 알림이 전송됐어요.`)
    }
    setPaste('')
    setImported([])
    setImportSummary('')
    await load()
  }

  const addType = async (): Promise<void> => {
    setTypeMsg('')
    const res = await addDbType(newType)
    if (!res.ok) {
      setTypeMsg(res.error ?? '추가 실패')
      return
    }
    setNewType('')
    await loadTypes()
  }
  const removeType = async (t: LeadDbType): Promise<void> => {
    if (typeof window !== 'undefined' && !window.confirm(`'${t.name}' 종류를 삭제할까요? (기존 DB의 태그는 남습니다)`)) return
    const res = await deleteDbType(t.id)
    if (res.ok) {
      if (selectedType === t.name) setSelectedType('')
      await loadTypes()
    }
  }

  const filteredLeads = useMemo(
    () => (typeFilter === 'all' ? leads : leads.filter((l) => (l.dbType ?? '') === typeFilter)),
    [leads, typeFilter]
  )

  const doCall = async (lead: Lead): Promise<void> => {
    const res = await markCalled(lead.id)
    if (res.ok) await load()
    else setError(res.error ?? '처리 실패')
  }

  const doStatus = async (lead: Lead, status: LeadStatus): Promise<void> => {
    // 미콜에서 벗어나는 첫 상태 변경이면 첫 접촉 시각도 함께 기록 (24h SLA 판정 근거).
    const res = await updateLeadStatus(lead.id, status, { stampFirstCall: !lead.firstCallAt && status !== 'new' })
    if (res.ok) await load()
    else setError(res.error ?? '상태 변경에 실패했습니다. 다시 시도해 주세요.')
  }

  const doReassign = async (lead: Lead, fcId: string): Promise<void> => {
    const s = staff.find((x) => x.id === fcId)
    if (!s) return
    const res = await reassignLead(lead.id, s.id, s.name)
    // 실패 시에도 load()로 셀렉트를 원래 담당자로 되돌린다 — 화면이 성공한 척하지 않게.
    await load()
    if (!res.ok) setError(res.error ?? '재배정에 실패했습니다. 다시 시도해 주세요.')
  }

  /** 리드 → 고객 전환. 같은 전화번호 고객이 이미 있으면 새로 만들지 않고 연결만 한다. */
  const convertLead = async (lead: Lead): Promise<void> => {
    if (convertBusyId) return
    setConvertBusyId(lead.id)
    setError('')
    const digits = (lead.phone ?? '').replace(/[^0-9]/g, '')
    if (digits) {
      const existing = await listCustomers()
      const dup = existing.ok
        ? existing.customers.find((c) => (c.phone ?? '').replace(/[^0-9]/g, '') === digits)
        : undefined
      if (dup) {
        setConverted((m) => ({ ...m, [lead.id]: dup }))
        setHubCustomer(dup)
        setConvertBusyId(null)
        return
      }
    }
    const res = await createCustomer({
      name: lead.name,
      phone: lead.phone ?? undefined,
      source: lead.source ?? (lead.dbType ? `DB배정(${lead.dbType})` : 'DB배정'),
      status: lead.status === 'contracted' ? 'contracted' : 'contacted',
      tags: [],
      memo: lead.memo ?? undefined
    })
    setConvertBusyId(null)
    if (!res.ok || !res.customer) {
      setError(res.error ?? '고객 전환에 실패했습니다.')
      return
    }
    const c = res.customer
    setConverted((m) => ({ ...m, [lead.id]: c }))
    setHubCustomer(c)
  }

  /** 전환된 고객을 보험 허브에 태워 AI 도구로 바로 이동. */
  const goTool = (c: CustomerRecord, view: View): void => {
    setHubCustomer(c)
    navigate(view)
  }

  return (
    <div className="space-y-5">
      <InsuranceHubBar current="leads" />
      {/* 히어로 */}
      <div className="overflow-hidden rounded-2xl border border-slate-800 bg-[#0e1e3a] shadow-sm">
        <div className="relative px-5 py-6 sm:px-7">
          <div className="pointer-events-none absolute -right-10 -top-16 h-48 w-48 rounded-full bg-[#c6982f]/15 blur-2xl" />
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[#e6c877]/40 bg-[#c6982f]/15 px-2.5 py-1 text-[11px] font-bold tracking-wide text-[#e6c877]">
              <ListChecks className="h-3 w-3" /> DB 배정
            </span>
            {overdue.length > 0 ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-rose-300/40 bg-rose-400/15 px-2.5 py-1 text-[11px] font-bold text-rose-300">
                <Flame className="h-3 w-3" /> 미콜 {overdue.length}건
              </span>
            ) : null}
          </div>
          <h1 className="mt-3 text-xl font-extrabold text-white sm:text-2xl">DB 배정</h1>
          <p className="mt-1.5 max-w-2xl text-[13px] leading-6" style={{ color: 'rgba(203,213,225,0.92)' }}>
            {admin
              ? 'DB종류를 고르고 붙여넣으면 활성 직원에게 공평하게 자동 배정되고, 배정된 직원에게 알림이 갑니다. 24시간 내 콜하지 않으면 미콜로 경고됩니다.'
              : '나에게 배정된 DB입니다. 24시간 안에 콜하고 "콜 완료"를 눌러 주세요.'}
          </p>
        </div>
      </div>

      {error ? (
        <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] leading-6 text-rose-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}

      {/* ── 관리자: 입력 + 분배 ─────────────────────────────────── */}
      {admin ? (
        <div className="rounded-2xl border border-slate-800 bg-white p-4 shadow-sm sm:p-5">
          <div className="mb-3 flex items-center gap-2">
            <UploadCloud className="h-4 w-4 text-[#b0821f]" />
            <h2 className="text-sm font-bold text-slate-100">DB 입력 — 종류 고르고 붙여넣으면 자동 배정</h2>
          </div>

          {/* DB 종류 관리 + 이번 배정에 적용할 종류 */}
          <div className="mb-3 rounded-xl border border-slate-800 bg-slate-950/60 p-3">
            <div className="mb-2 flex items-center gap-1.5 text-[12px] font-bold text-slate-200">
              <Tag className="h-3.5 w-3.5 text-[#c6982f]" /> DB 종류 관리
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {dbTypes.length === 0 ? (
                <span className="text-[11px] text-slate-500">등록된 종류가 없습니다. 아래에서 추가하세요 (예: 소상공인DB · 여성일반DB · 실버DB).</span>
              ) : (
                dbTypes.map((t) => (
                  <span key={t.id} className="inline-flex items-center gap-1 rounded-full border border-slate-700 bg-slate-900 px-2 py-0.5 text-[11px] text-slate-200">
                    {t.name}
                    <button type="button" onClick={() => void removeType(t)} className="text-slate-500 hover:text-rose-400" aria-label={`${t.name} 삭제`}>
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))
              )}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <input
                value={newType}
                onChange={(e) => setNewType(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    void addType()
                  }
                }}
                placeholder="새 DB종류 입력 (예: 여성일반DB)"
                className="w-52 rounded-lg border border-slate-800 bg-slate-950 px-2 py-1 text-[12px] text-slate-100 outline-none placeholder:text-slate-500 focus:border-[#c6982f]"
              />
              <button type="button" onClick={() => void addType()} className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-2 py-1 text-[11px] font-semibold text-slate-200 hover:bg-slate-700">
                <Plus className="h-3 w-3" /> 추가
              </button>
              {typeMsg ? <span className="text-[11px] text-rose-400">{typeMsg}</span> : null}
            </div>
          </div>

          {/* 파일 업로드 → 판독 → 행 선택 */}
          <FileDropZone
            accept=".xlsx,.xls,.csv"
            multiple={false}
            dropLabel="놓으면 DB 파일을 판독합니다"
            onFiles={(fs) => void importFile(fs[0])}
          >
            <label className="mb-3 flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-slate-700 bg-slate-950 px-4 py-5 text-center transition hover:border-[#c6982f]/60 hover:bg-[#c6982f]/5">
              <UploadCloud className="h-6 w-6 text-[#b0821f]" />
              <span className="text-[13px] font-semibold text-slate-200">DB 파일을 드래그하거나 클릭해서 선택 (.xlsx · .xls · .csv)</span>
              <span className="text-[11px] text-slate-500">이름·전화 열을 자동으로 찾고, 나머지 열은 메모로 보존됩니다</span>
              <input
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) void importFile(f)
                  e.target.value = ''
                }}
              />
            </label>
          </FileDropZone>

          {imported.length > 0 ? (
            <div className="mb-3 rounded-xl border border-[#c6982f]/40 bg-slate-950/60 p-3">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <span className="text-[12px] font-bold text-slate-200">
                  📄 {importSummary} · 배정할 행 <b className="text-[#e6c877]">{imported.filter((i) => i.checked).length}</b>/{imported.length}
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setImported((prev) => prev.map((i) => ({ ...i, checked: true })))}
                    className="rounded-lg border border-slate-700 px-2 py-1 text-[11px] text-slate-300 hover:bg-slate-800"
                  >
                    전체 선택
                  </button>
                  <button
                    type="button"
                    onClick={() => setImported((prev) => prev.map((i) => ({ ...i, checked: false })))}
                    className="rounded-lg border border-slate-700 px-2 py-1 text-[11px] text-slate-300 hover:bg-slate-800"
                  >
                    전체 해제
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setImported([])
                      setImportSummary('')
                    }}
                    className="rounded-lg border border-rose-300/40 px-2 py-1 text-[11px] text-rose-400 hover:bg-rose-500/10"
                  >
                    비우기
                  </button>
                </div>
              </div>
              <div className="max-h-56 overflow-y-auto rounded-lg border border-slate-800">
                <table className="w-full text-left text-[12px]">
                  <thead className="sticky top-0 bg-slate-900">
                    <tr className="text-[11px] text-slate-500">
                      <th className="w-8 px-2 py-1.5"></th>
                      <th className="px-2 py-1.5">이름</th>
                      <th className="px-2 py-1.5">전화</th>
                      <th className="px-2 py-1.5">메모</th>
                    </tr>
                  </thead>
                  <tbody>
                    {imported.map((item, idx) => (
                      <tr key={idx} className={['border-t border-slate-800/60', item.checked ? '' : 'opacity-40'].join(' ')}>
                        <td className="px-2 py-1.5">
                          <input
                            type="checkbox"
                            checked={item.checked}
                            onChange={() =>
                              setImported((prev) => prev.map((it, i) => (i === idx ? { ...it, checked: !it.checked } : it)))
                            }
                            className="h-3.5 w-3.5 accent-[#c6982f]"
                            aria-label={`${item.row.name} 배정 포함`}
                          />
                        </td>
                        <td className="px-2 py-1.5 font-semibold text-slate-100">{item.row.name}</td>
                        <td className="px-2 py-1.5 text-slate-300">{item.row.phone ?? ''}</td>
                        <td className="max-w-[280px] truncate px-2 py-1.5 text-slate-500">{item.row.memo ?? ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          <textarea
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            rows={3}
            placeholder={'또는 직접 붙여넣기 — 한 줄에 한 명씩:  이름, 전화번호, 유입경로\n예) 홍길동, 010-1234-5678, 페북광고'}
            className="w-full rounded-xl border border-slate-800 bg-slate-950 p-3 font-mono text-[12px] leading-5 text-slate-100 outline-none placeholder:text-slate-500 focus:border-[#c6982f]"
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <select
              value={selectedType}
              onChange={(e) => setSelectedType(e.target.value)}
              className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-[#c6982f]"
              title="이번에 배정할 DB종류"
            >
              <option value="">DB종류 선택(선택 안 함)</option>
              {dbTypes.map((t) => (
                <option key={t.id} value={t.name}>{t.name}</option>
              ))}
            </select>
            <select
              value={assignMode}
              onChange={(e) => setAssignMode(e.target.value)}
              className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-[#c6982f]"
              title="배정 방식 — 자동 또는 직원 직접 선택"
            >
              <option value="auto">자동 배정 (최소부하 균등)</option>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}에게 배정
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => void distribute()}
              disabled={busy || pendingRows.length === 0}
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#0e1e3a] to-[#1b3a6b] px-4 py-2.5 text-sm font-bold text-[#e6c877] shadow-md transition hover:brightness-125 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRightLeft className="h-4 w-4" />}
              {pendingRows.length > 0 ? `${pendingRows.length}건 배정` : '배정'}
            </button>
            <span className="text-[12px] text-slate-500">
              {assignMode === 'auto'
                ? `활성 직원 ${staff.length}명에게 최소부하 순으로 균등 배정`
                : `${staff.find((s) => s.id === assignMode)?.name ?? '선택 직원'}에게 전량 배정`}
              {selectedType ? ` · [${selectedType}]` : ''}
            </span>
          </div>
          {distMsg ? <p className="mt-2 text-[12px] leading-5 text-slate-300">{distMsg}</p> : null}
        </div>
      ) : null}

      {/* ── 관리자: 미콜 경고 ───────────────────────────────────── */}
      {admin && overdue.length > 0 ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 shadow-sm">
          <h3 className="mb-2 flex items-center gap-1.5 text-sm font-bold text-rose-800">
            <PhoneOff className="h-4 w-4" /> 24시간 초과 미콜 {overdue.length}건 — 즉시 확인 필요
          </h3>
          <div className="space-y-1.5">
            {overdue.slice(0, 12).map((l) => (
              <div key={l.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-rose-200 bg-white px-3 py-2 text-[12px]">
                <span className="font-semibold text-slate-100">
                  {l.name} <span className="font-normal text-slate-500">· {l.assignedFcName ?? '미배정'}</span>
                </span>
                <span className={remainLabel(l).tone}>{remainLabel(l).text}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* ── 관리자: 직원별 현황 ─────────────────────────────────── */}
      {admin && byStaff.length > 0 ? (
        <div className="rounded-2xl border border-slate-800 bg-white p-4 shadow-sm sm:p-5">
          <h3 className="mb-3 flex items-center gap-1.5 text-sm font-bold text-slate-100">
            <Users className="h-4 w-4 text-[#b0821f]" /> 직원별 배정 현황
          </h3>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
            {byStaff.map((s) => (
              <div key={s.name} className="rounded-xl border border-slate-800 bg-slate-950 p-3">
                <div className="flex items-center gap-1.5 text-[13px] font-bold text-slate-100">
                  <UserRound className="h-3.5 w-3.5 text-slate-500" /> {s.name}
                </div>
                <div className="mt-1.5 flex items-center gap-3 text-[12px]">
                  <span className="text-slate-500">배정 {s.total}</span>
                  <span className="text-sky-600">미콜 {s.uncalled}</span>
                  {s.overdue > 0 ? <span className="font-bold text-rose-600">초과 {s.overdue}</span> : null}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* ── 리드 목록 (관리자=전체 / 직원=내 것) ─────────────────── */}
      <div className="rounded-2xl border border-slate-800 bg-white p-4 shadow-sm sm:p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-bold text-slate-100">{admin ? '전체 DB' : '내 배정 DB'}</h3>
          <div className="flex items-center gap-2">
            {dbTypes.length > 0 ? (
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                className="rounded-lg border border-slate-800 bg-slate-950 px-2 py-1 text-[11px] text-slate-200 outline-none"
                title="DB종류 필터"
              >
                <option value="all">종류 전체</option>
                {dbTypes.map((t) => (
                  <option key={t.id} value={t.name}>{t.name}</option>
                ))}
              </select>
            ) : null}
            <span className="text-[12px] text-slate-500">{filteredLeads.length}건</span>
          </div>
        </div>
        {/* 상태별 현황 요약 — 지금 DB들이 어느 단계에 있는지 한눈에 */}
        {filteredLeads.length > 0 ? (
          <div className="mb-3 flex flex-wrap gap-1.5">
            {LEAD_STATUS_FLOW.map((s) => {
              const n = filteredLeads.filter((l) => l.status === s).length
              if (n === 0) return null
              return (
                <span key={s} className={['rounded-full px-2 py-0.5 text-[10px] font-bold', STATUS_CHIP[s]].join(' ')}>
                  {LEAD_STATUS_LABEL[s]} {n}
                </span>
              )
            })}
          </div>
        ) : null}
        {loading ? (
          <div className="flex items-center gap-2 py-8 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" /> 불러오는 중…
          </div>
        ) : filteredLeads.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-700 py-8 text-center text-[12px] text-slate-500">
            {leads.length > 0
              ? '해당 DB종류의 DB가 없습니다.'
              : admin
                ? '아직 등록된 DB가 없습니다. 위에서 종류를 고르고 붙여넣어 배정해 보세요.'
                : '아직 배정된 DB가 없습니다.'}
          </div>
        ) : (
          <div className="space-y-2">
            {filteredLeads.map((l) => {
              const r = remainLabel(l)
              return (
                <div key={l.id} className={['rounded-xl border p-3', isOverdue(l) ? 'border-rose-300 bg-rose-50/40' : 'border-slate-800 bg-slate-950'].join(' ')}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[13px] font-bold text-slate-100">{l.name}</span>
                    {l.phone ? <span className="text-[12px] text-slate-400">{l.phone}</span> : null}
                    {l.dbType ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-[#c6982f]/15 px-2 py-0.5 text-[10px] font-bold text-[#b0821f]">
                        <Tag className="h-2.5 w-2.5" /> {l.dbType}
                      </span>
                    ) : null}
                    {l.source ? <span className="rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-bold text-violet-700">{l.source}</span> : null}
                    <span className={['rounded-full px-2 py-0.5 text-[10px] font-bold', STATUS_CHIP[l.status]].join(' ')}>{LEAD_STATUS_LABEL[l.status]}</span>
                    {admin ? <span className="text-[11px] text-slate-500">· {l.assignedFcName ?? '미배정'}</span> : null}
                    <span className={['ml-auto inline-flex items-center gap-1 text-[11px]', r.tone].join(' ')}>
                      <Clock className="h-3 w-3" /> {r.text}
                    </span>
                  </div>
                  {/* 진행 상태 카테고리 — 본인 리드(또는 관리자)가 체크 */}
                  {admin || l.assignedFcId === session.id ? (
                    <div className="mt-2 flex flex-wrap items-center gap-1">
                      {PROGRESS_STATUSES.map((s) => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => void doStatus(l, s)}
                          className={[
                            'rounded-full px-2 py-1 text-[10px] font-bold transition',
                            l.status === s
                              ? STATUS_CHIP[s] + ' ring-1 ring-current'
                              : 'border border-slate-700 bg-white text-slate-500 hover:border-[#c6982f]/50 hover:text-[#8a6a1e]'
                          ].join(' ')}
                        >
                          {LEAD_STATUS_LABEL[s]}
                        </button>
                      ))}
                    </div>
                  ) : null}
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {l.status === 'new' ? (
                      <button
                        type="button"
                        onClick={() => void doCall(l)}
                        className="inline-flex items-center gap-1 rounded-lg bg-[#0e1e3a] px-2.5 py-1 text-[11px] font-bold text-[#e6c877] hover:brightness-125"
                      >
                        <PhoneCall className="h-3 w-3" /> 콜 완료
                      </button>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600">
                        <CheckCircle2 className="h-3 w-3" /> 첫 콜{l.firstCallAt ? ` · ${new Date(l.firstCallAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}` : ''}
                      </span>
                    )}
                    {/* 내 리드 통화 성사 후: 고객으로 전환 → 보험 허브 태워 AI 도구 직행 */}
                    {CONVERTIBLE.has(l.status) && l.assignedFcId === session.id ? (
                      converted[l.id] ? (
                        <>
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#b0821f]">
                            <CheckCircle2 className="h-3 w-3" /> 고객 연결됨
                          </span>
                          <button
                            type="button"
                            onClick={() => goTool(converted[l.id], { name: 'pre-underwriting' })}
                            className="inline-flex items-center gap-1 rounded-lg border border-[#c6982f]/40 bg-white px-2 py-1 text-[11px] font-semibold text-[#b0821f] hover:bg-[#c6982f]/10"
                          >
                            <ShieldQuestion className="h-3 w-3" /> 사전심사
                          </button>
                          <button
                            type="button"
                            onClick={() => goTool(converted[l.id], { name: 'insurance-analysis' })}
                            className="inline-flex items-center gap-1 rounded-lg border border-[#c6982f]/40 bg-white px-2 py-1 text-[11px] font-semibold text-[#b0821f] hover:bg-[#c6982f]/10"
                          >
                            <FileSearch className="h-3 w-3" /> 보장분석
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          disabled={convertBusyId === l.id}
                          onClick={() => void convertLead(l)}
                          className="inline-flex items-center gap-1 rounded-lg border border-[#c6982f]/40 bg-white px-2 py-1 text-[11px] font-semibold text-[#b0821f] hover:bg-[#c6982f]/10 disabled:opacity-50"
                        >
                          {convertBusyId === l.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <UserPlus className="h-3 w-3" />} 고객 전환
                        </button>
                      )
                    ) : null}
                    {admin && staff.length > 0 ? (
                      <select
                        value={l.assignedFcId ?? ''}
                        onChange={(e) => void doReassign(l, e.target.value)}
                        className="ml-auto rounded-lg border border-slate-800 bg-white px-2 py-1 text-[11px] text-slate-600 outline-none"
                        title="재배정"
                      >
                        <option value="" disabled>재배정…</option>
                        {staff.map((s) => (
                          <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                      </select>
                    ) : null}
                  </div>
                  {l.memo ? <div className="mt-1.5 text-[11px] text-slate-500">{l.memo}</div> : null}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
