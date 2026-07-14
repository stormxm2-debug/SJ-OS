import { useEffect, useMemo, useState } from 'react'
import { Stethoscope, Search, ChevronDown, ChevronRight, Loader2, AlertTriangle, Plus, Trash2, X, List, Table2 } from 'lucide-react'
import Card from '@renderer/components/ui/Card'
import { useSession } from '@renderer/navigation/SessionContext'
import { useNavigation } from '@renderer/navigation/NavigationContext'
import { isAdminRole } from '@renderer/navigation/roleAccess'
import {
  listUnderwriting,
  addDisease,
  deleteDisease,
  upsertRule,
  UNDERWRITING_INSURERS,
  UNDERWRITING_STATUS_LABEL,
  UNDERWRITING_STATUS_SHORT,
  type UnderwritingDisease,
  type UnderwritingStatus
} from '@renderer/services/underwriting/underwritingService'
import { getHubCustomer, subscribeHubCustomer } from '@renderer/services/insurance-hub/insuranceHubStore'
import InsuranceHubBar from '@renderer/components/insurance-hub/InsuranceHubBar'

/**
 * 예외질병 인수 가이드 — 질병을 검색하면 12개 보험사별 인수 기준(표준인수/유병자플랜/
 * 부담보/할증/거절)이 색 칩으로 바로 보인다. 전 직원 열람, 관리자만 편집.
 * 관리자가 검수하지 않은 셀(AI 참고용 시드)은 '검수전' 배지가 붙는다.
 */

/** 상태별 색 칩 스타일 — slate 토큰은 반전 리매핑되어 있어 회색 계열만 slate 사용. */
const STATUS_CHIP: Record<UnderwritingStatus, string> = {
  standard: 'bg-emerald-100 text-emerald-700',
  simplified: 'bg-sky-100 text-sky-700',
  exclusion: 'bg-amber-100 text-amber-700',
  loading: 'bg-orange-100 text-orange-700',
  decline: 'bg-rose-100 text-rose-700',
  unknown: 'border border-slate-800 bg-white text-slate-500'
}

const EDITABLE_STATUSES: UnderwritingStatus[] = ['standard', 'simplified', 'exclusion', 'loading', 'decline', 'unknown']

function StatusChip({ status, small }: { status: UnderwritingStatus; small?: boolean }): JSX.Element {
  return (
    <span
      className={[
        'inline-flex items-center rounded-full font-semibold',
        small ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-1 text-[11px]',
        STATUS_CHIP[status]
      ].join(' ')}
    >
      {UNDERWRITING_STATUS_LABEL[status]}
    </span>
  )
}

interface CellEdit {
  diseaseId: string
  insurer: string
  status: UnderwritingStatus
  note: string
}

export default function UnderwritingGuidePage(): JSX.Element {
  const { session } = useSession()
  const { route } = useNavigation()
  const admin = isAdminRole(session.role)
  // 고객 병력 매칭 칩에서 넘어올 때 검색어가 프리필된다.
  const prefillQ = route.name === 'underwriting' ? route.q : undefined

  const [items, setItems] = useState<UnderwritingDisease[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | undefined>()
  const [query, setQuery] = useState(prefillQ ?? '')
  const [category, setCategory] = useState('all')
  const [openId, setOpenId] = useState<string | null>(null)
  const [view, setView] = useState<'list' | 'matrix'>('list')

  useEffect(() => {
    if (prefillQ !== undefined) setQuery(prefillQ)
  }, [prefillQ])

  // 보험 허브의 "현재 작업 중 고객" — 병력에서 매칭되는 질병을 칩으로 띄워 원탭 검색
  const [hubCustomer, setHubCustomerState] = useState(() => getHubCustomer())
  useEffect(() => subscribeHubCustomer(setHubCustomerState), [])

  // 관리자 편집 상태
  const [edit, setEdit] = useState<CellEdit | null>(null)
  const [saving, setSaving] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [newCategory, setNewCategory] = useState('')
  const [newAliases, setNewAliases] = useState('')
  const [actionErr, setActionErr] = useState<string | undefined>()

  const reload = async (): Promise<void> => {
    const res = await listUnderwriting()
    if (!res.ok) {
      setError(res.error)
    } else {
      setError(undefined)
      setItems(res.items)
    }
    setLoading(false)
  }

  useEffect(() => {
    void reload()
  }, [])

  const categories = useMemo(() => {
    const set = new Set<string>()
    items.forEach((d) => set.add(d.category))
    return Array.from(set)
  }, [items])

  const q = query.trim().toLowerCase()
  const filtered = useMemo(
    () =>
      items.filter((d) => {
        if (category !== 'all' && d.category !== category) return false
        if (!q) return true
        return (
          d.name.toLowerCase().includes(q) ||
          d.category.toLowerCase().includes(q) ||
          d.aliases.some((a) => a.toLowerCase().includes(q))
        )
      }),
    [items, q, category]
  )

  // 허브 고객 병력 텍스트에 질병명·별칭이 들어 있으면 매칭 칩으로 제안
  const matchedDiseases = useMemo(() => {
    const hist = hubCustomer?.medicalHistory?.toLowerCase()
    if (!hist) return []
    return items.filter(
      (d) =>
        hist.includes(d.name.toLowerCase()) ||
        d.aliases.some((a) => a.trim().length > 1 && hist.includes(a.trim().toLowerCase()))
    )
  }, [items, hubCustomer])

  const hasUnverified = useMemo(
    () => items.some((d) => Object.values(d.rules).some((r) => r.status !== 'unknown' && !r.verified)),
    [items]
  )

  const saveCell = async (): Promise<void> => {
    if (!edit || saving) return
    setSaving(true)
    setActionErr(undefined)
    const res = await upsertRule({ diseaseId: edit.diseaseId, insurer: edit.insurer, status: edit.status, note: edit.note })
    setSaving(false)
    if (!res.ok) {
      setActionErr(res.error)
      return
    }
    setEdit(null)
    await reload()
  }

  const submitAdd = async (): Promise<void> => {
    if (saving) return
    setSaving(true)
    setActionErr(undefined)
    const res = await addDisease({ name: newName, category: newCategory, aliases: newAliases.split(',') })
    setSaving(false)
    if (!res.ok) {
      setActionErr(res.error)
      return
    }
    setNewName('')
    setNewCategory('')
    setNewAliases('')
    setAddOpen(false)
    await reload()
  }

  /** 매트릭스 칸 클릭 → 목록 보기로 전환해 해당 질병을 펼치고(관리자면 에디터까지) 스크롤. */
  const openFromMatrix = (d: UnderwritingDisease, insurer: string): void => {
    setView('list')
    setOpenId(d.id)
    const rule = d.rules[insurer]
    setEdit(admin ? { diseaseId: d.id, insurer, status: rule?.status ?? 'unknown', note: rule?.note ?? '' } : null)
    window.setTimeout(() => {
      document.getElementById(`uw-row-${d.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 60)
  }

  const removeDisease = async (d: UnderwritingDisease): Promise<void> => {
    if (!window.confirm(`'${d.name}' 항목과 회사별 기준을 모두 삭제할까요?`)) return
    setActionErr(undefined)
    const res = await deleteDisease(d.id)
    if (!res.ok) {
      setActionErr(res.error)
      return
    }
    if (openId === d.id) setOpenId(null)
    await reload()
  }

  return (
    <div className="space-y-4">
      <InsuranceHubBar current="underwriting" />
      <Card
        title="예외질병 인수 가이드"
        icon={<Stethoscope className="h-4 w-4 text-[#c6982f]" />}
        action={
          admin ? (
            <button
              type="button"
              onClick={() => setAddOpen((v) => !v)}
              className="flex items-center gap-1 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-3 py-1.5 text-[11px] font-semibold text-white"
            >
              {addOpen ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
              {addOpen ? '닫기' : '질병 추가'}
            </button>
          ) : undefined
        }
      >
        <p className="text-[12px] leading-5 text-slate-500">
          병력 있는 고객 상담 시 질병을 검색하면 <b className="text-slate-300">보험사별 인수 가능 여부</b>가 바로 보입니다.
          <span className="text-slate-600"> (일반 경향 기준 — 실제 인수는 상품·시기·심사 결과에 따라 달라질 수 있습니다)</span>
        </p>

        {hasUnverified && (
          <div className="mt-3 flex items-start gap-2 rounded-xl bg-amber-100 px-3 py-2.5">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <p className="text-[11px] leading-4 text-amber-700">
              <b>검수전</b> 배지가 붙은 기준은 AI가 채운 참고용 초기값입니다. 관리자가 실제 인수 지침으로 수정·저장하면 배지가
              사라집니다.
            </p>
          </div>
        )}

        {/* 관리자: 질병 추가 폼 */}
        {admin && addOpen && (
          <div className="mt-3 space-y-2 rounded-xl border border-slate-800 bg-white p-3">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="질병명 (필수)"
                className="rounded-lg border border-slate-800 bg-white px-3 py-2 text-[12px] text-slate-100 placeholder:text-slate-500"
              />
              <input
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                placeholder="분류 (예: 만성질환)"
                list="uw-categories"
                className="rounded-lg border border-slate-800 bg-white px-3 py-2 text-[12px] text-slate-100 placeholder:text-slate-500"
              />
              <datalist id="uw-categories">
                {categories.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
              <input
                value={newAliases}
                onChange={(e) => setNewAliases(e.target.value)}
                placeholder="검색 별칭 (쉼표 구분)"
                className="rounded-lg border border-slate-800 bg-white px-3 py-2 text-[12px] text-slate-100 placeholder:text-slate-500"
              />
            </div>
            <button
              type="button"
              onClick={() => void submitAdd()}
              disabled={saving || !newName.trim()}
              className="rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-4 py-2 text-[12px] font-semibold text-white disabled:opacity-50"
            >
              {saving ? '저장 중…' : '추가'}
            </button>
          </div>
        )}

        {/* 검색 + 분류 칩 */}
        <div className="mt-3 flex items-center gap-2 rounded-xl border border-slate-800 bg-white px-3">
          <Search className="h-4 w-4 shrink-0 text-slate-500" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="질병명 검색 — 예: 당뇨, 디스크, 대장 용종"
            className="h-10 w-full bg-transparent text-[13px] text-slate-100 outline-none placeholder:text-slate-500"
          />
        </div>
        {/* 허브 고객 병력 매칭 — 칩을 누르면 해당 질병으로 바로 검색 */}
        {hubCustomer && matchedDiseases.length > 0 ? (
          <div className="mt-2 flex flex-wrap items-center gap-1.5 rounded-xl border border-[#c6982f]/30 bg-[#c6982f]/5 px-3 py-2">
            <span className="text-[11px] font-bold text-[#b0821f]">{hubCustomer.name} 고객 병력 매칭</span>
            {matchedDiseases.map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() => setQuery(d.name)}
                className="rounded-full border border-[#c6982f]/40 bg-white px-2.5 py-1 text-[11px] font-semibold text-[#b0821f] transition hover:bg-[#c6982f]/10"
              >
                {d.name}
              </button>
            ))}
          </div>
        ) : null}
        <div className="mt-2 flex flex-wrap gap-1.5">
          {['all', ...categories].map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCategory(c)}
              className={[
                'rounded-full px-3 py-1 text-[11px] font-medium transition',
                category === c
                  ? 'bg-[#0e1e3a] text-[#e6c877]'
                  : 'border border-slate-800 bg-white text-slate-500'
              ].join(' ')}
            >
              {c === 'all' ? '전체' : c}
            </button>
          ))}
        </div>

        {/* 상태 범례 + 보기 전환 */}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-1.5">
            {EDITABLE_STATUSES.map((s) => (
              <StatusChip key={s} status={s} small />
            ))}
          </div>
          <div className="flex overflow-hidden rounded-lg border border-slate-800">
            <button
              type="button"
              onClick={() => setView('list')}
              className={[
                'flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold transition',
                view === 'list' ? 'bg-[#0e1e3a] text-[#e6c877]' : 'bg-white text-slate-500'
              ].join(' ')}
            >
              <List className="h-3.5 w-3.5" /> 목록
            </button>
            <button
              type="button"
              onClick={() => setView('matrix')}
              className={[
                'flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold transition',
                view === 'matrix' ? 'bg-[#0e1e3a] text-[#e6c877]' : 'bg-white text-slate-500'
              ].join(' ')}
            >
              <Table2 className="h-3.5 w-3.5" /> 전체표
            </button>
          </div>
        </div>

        {actionErr && <p className="mt-2 text-[11px] text-rose-600">{actionErr}</p>}

        {/* 질병 목록 */}
        <div className="mt-3 space-y-2">
          {loading && (
            <div className="flex items-center gap-2 py-6 text-[12px] text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" /> 불러오는 중…
            </div>
          )}
          {!loading && error && (
            <div className="flex items-center gap-2 rounded-xl bg-rose-100 px-3 py-2.5 text-[12px] text-rose-700">
              <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
            </div>
          )}
          {!loading && !error && filtered.length === 0 && (
            <p className="py-6 text-center text-[12px] text-slate-500">
              검색 결과가 없습니다{admin ? ' — 우측 상단 [질병 추가]로 등록할 수 있습니다' : ''}.
            </p>
          )}

          {view === 'list' &&
            filtered.map((d) => {
            const open = openId === d.id
            return (
              <div key={d.id} id={`uw-row-${d.id}`} className="rounded-xl border border-slate-800 bg-white">
                <button
                  type="button"
                  onClick={() => {
                    setOpenId(open ? null : d.id)
                    setEdit(null)
                  }}
                  className="flex w-full items-center gap-2 px-3 py-3 text-left"
                >
                  {open ? (
                    <ChevronDown className="h-4 w-4 shrink-0 text-slate-500" />
                  ) : (
                    <ChevronRight className="h-4 w-4 shrink-0 text-slate-500" />
                  )}
                  <span className="text-[13px] font-semibold text-slate-100">{d.name}</span>
                  <span className="rounded-full border border-slate-800 px-2 py-0.5 text-[10px] text-slate-500">{d.category}</span>
                  {admin && open && (
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(e) => {
                        e.stopPropagation()
                        void removeDisease(d)
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.stopPropagation()
                          void removeDisease(d)
                        }
                      }}
                      className="ml-auto rounded-lg p-1.5 text-rose-600 hover:bg-rose-100"
                      aria-label="질병 삭제"
                    >
                      <Trash2 className="h-4 w-4" />
                    </span>
                  )}
                </button>

                {open && (
                  <div className="border-t border-slate-800 px-3 py-3">
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                      {UNDERWRITING_INSURERS.map((insurer) => {
                        const rule = d.rules[insurer]
                        const status: UnderwritingStatus = rule?.status ?? 'unknown'
                        const editing = edit && edit.diseaseId === d.id && edit.insurer === insurer
                        return (
                          <button
                            key={insurer}
                            type="button"
                            disabled={!admin}
                            onClick={() =>
                              setEdit(
                                editing
                                  ? null
                                  : { diseaseId: d.id, insurer, status, note: rule?.note ?? '' }
                              )
                            }
                            className={[
                              'rounded-xl border p-2.5 text-left transition',
                              editing ? 'border-[#c6982f] bg-[#fdf7ea]' : 'border-slate-800 bg-white',
                              admin ? 'cursor-pointer hover:border-[#c6982f]' : 'cursor-default'
                            ].join(' ')}
                          >
                            <div className="flex items-center justify-between gap-1">
                              <span className="truncate text-[11px] font-semibold text-slate-300">{insurer}</span>
                              {rule && status !== 'unknown' && !rule.verified && (
                                <span className="shrink-0 rounded bg-amber-100 px-1 py-0.5 text-[9px] font-semibold text-amber-700">
                                  검수전
                                </span>
                              )}
                            </div>
                            <div className="mt-1.5">
                              <StatusChip status={status} small />
                            </div>
                            {rule?.note && <p className="mt-1 text-[10px] leading-4 text-slate-500">{rule.note}</p>}
                          </button>
                        )
                      })}
                    </div>

                    {/* 관리자: 셀 편집 */}
                    {admin && edit && edit.diseaseId === d.id && (
                      <div className="mt-3 space-y-2 rounded-xl border border-[#c6982f] bg-[#fdf7ea] p-3">
                        <p className="text-[12px] font-semibold text-slate-100">
                          {d.name} × {edit.insurer}
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {EDITABLE_STATUSES.map((s) => (
                            <button
                              key={s}
                              type="button"
                              onClick={() => setEdit({ ...edit, status: s })}
                              className={[
                                'rounded-full px-2.5 py-1 text-[11px] font-semibold transition',
                                edit.status === s ? STATUS_CHIP[s] + ' ring-2 ring-[#c6982f]' : STATUS_CHIP[s] + ' opacity-45'
                              ].join(' ')}
                            >
                              {UNDERWRITING_STATUS_LABEL[s]}
                            </button>
                          ))}
                        </div>
                        <input
                          value={edit.note}
                          onChange={(e) => setEdit({ ...edit, note: e.target.value })}
                          placeholder="조건 메모 — 예: 완치 5년 경과 시, 부담보 3년"
                          className="w-full rounded-lg border border-slate-800 bg-white px-3 py-2 text-[12px] text-slate-100 placeholder:text-slate-500"
                        />
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => void saveCell()}
                            disabled={saving}
                            className="rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-4 py-2 text-[12px] font-semibold text-white disabled:opacity-50"
                          >
                            {saving ? '저장 중…' : '저장 (검수 완료)'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setEdit(null)}
                            className="rounded-xl border border-slate-800 bg-white px-4 py-2 text-[12px] font-medium text-slate-500"
                          >
                            취소
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}

          {/* 전체표(매트릭스) — 질병 × 12개사 한눈에. 칸 클릭 시 목록 상세로 이동 */}
          {view === 'matrix' && !loading && !error && filtered.length > 0 && (
            <>
              <div className="overflow-x-auto rounded-xl border border-slate-800 bg-white">
                <table className="w-full min-w-[880px] border-collapse text-left">
                  <thead>
                    <tr className="border-b border-slate-800 bg-slate-950">
                      <th className="sticky left-0 z-10 whitespace-nowrap bg-slate-950 px-3 py-2 text-[11px] font-bold text-slate-300">
                        질병
                      </th>
                      {UNDERWRITING_INSURERS.map((i) => (
                        <th key={i} className="whitespace-nowrap px-1.5 py-2 text-center text-[10px] font-semibold text-slate-500">
                          {i.replace('손해보험', '손보')}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((d) => (
                      <tr key={d.id} className="border-b border-slate-800 last:border-b-0">
                        <th className="sticky left-0 z-10 whitespace-nowrap bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-100">
                          {d.name}
                        </th>
                        {UNDERWRITING_INSURERS.map((insurer) => {
                          const rule = d.rules[insurer]
                          const status: UnderwritingStatus = rule?.status ?? 'unknown'
                          const unverified = Boolean(rule && status !== 'unknown' && !rule.verified)
                          return (
                            <td key={insurer} className="px-1 py-1 text-center">
                              <button
                                type="button"
                                onClick={() => openFromMatrix(d, insurer)}
                                title={`${d.name} × ${insurer} · ${UNDERWRITING_STATUS_LABEL[status]}${rule?.note ? ` — ${rule.note}` : ''}${unverified ? ' (검수전)' : ''}`}
                                className={['w-full whitespace-nowrap rounded-md px-1 py-1 text-[10px] font-bold', STATUS_CHIP[status]].join(' ')}
                              >
                                {UNDERWRITING_STATUS_SHORT[status]}
                                {unverified ? '*' : ''}
                              </button>
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-[10px] text-slate-500">칸을 누르면 상세(목록 보기)로 이동합니다 · * = 검수전 · 표는 좌우로 스크롤됩니다</p>
            </>
          )}
        </div>
      </Card>
    </div>
  )
}
