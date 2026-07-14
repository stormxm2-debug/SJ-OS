import { useEffect, useMemo, useState } from 'react'
import {
  HeartPulse,
  Search,
  AlertTriangle,
  CheckCircle2,
  Info,
  Plus,
  Pencil,
  Trash2,
  X,
  Loader2,
  ShieldCheck
} from 'lucide-react'
import Card from '@renderer/components/ui/Card'
import { useSession } from '@renderer/navigation/SessionContext'
import {
  addException,
  deleteException,
  distinctProductClasses,
  EXCEPTION_INSURERS,
  filterRules,
  insurersCoveringAllTerms,
  listExceptions,
  MAX_SEARCH_TERMS,
  parseSearchTerms,
  PRODUCT_CLASS_SUGGESTIONS,
  updateException,
  type ExceptionRule,
  type ExceptionRuleInput
} from '@renderer/services/underwriting/exceptionDiseaseService'

/**
 * 유병자 인수예외질환 검색 — 질환명(& 조합, 최대 4개)으로 검색하면 보험사별
 * 예외질환 인수기준(최소경과·치료기간·수술여부)과 가능상품구분을 표로 보여준다.
 *
 * - 전 직원 검색·열람. 관리자(owner/admin)만 기준 추가/수정/삭제 (RLS 강제).
 * - 검수전 배지: AI 참고용 시드(verified=false). 관리자가 저장하면 검수 완료.
 * - 2개 이상 질환 검색 시 "모든 질환을 예외 인정하는 보험사" 요약을 함께 표시
 *   (복수 병력 고객이 실제로 가입 가능한 회사).
 */

const GOLD = '#b0821f'
const PAGE_SIZE = 30

const EMPTY_FORM: ExceptionRuleInput = {
  insurer: '',
  disease: '',
  searchTerms: [],
  minElapsed: '',
  treatmentPeriod: '',
  surgery: '',
  productClass: '',
  note: ''
}

function dash(v?: string): string {
  return v && v.trim() ? v : '-'
}

export default function ExceptionDiseasePage(): JSX.Element {
  const { session } = useSession()
  const isAdmin = session.role === 'owner' || session.role === 'admin'

  const [rules, setRules] = useState<ExceptionRule[]>([])
  const [loading, setLoading] = useState(true)
  const [loadErr, setLoadErr] = useState<string | undefined>()

  // 검색·필터
  const [query, setQuery] = useState('')
  const [insurer, setInsurer] = useState('all')
  const [productClass, setProductClass] = useState('all')
  const [limit, setLimit] = useState(PAGE_SIZE)

  // 관리자 폼 (추가/수정 겸용 — editId가 있으면 수정 모드)
  const [formOpen, setFormOpen] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState<ExceptionRuleInput>(EMPTY_FORM)
  const [aliasText, setAliasText] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | undefined>()

  const load = async (): Promise<void> => {
    setLoading(true)
    const r = await listExceptions()
    if (r.ok) {
      setRules(r.data)
      setLoadErr(undefined)
    } else {
      setRules([])
      setLoadErr(r.message)
    }
    setLoading(false)
  }
  useEffect(() => {
    void load()
  }, [])

  const terms = useMemo(() => parseSearchTerms(query), [query])
  const filtered = useMemo(
    () => filterRules(rules, { terms, insurer, productClass }),
    [rules, terms, insurer, productClass]
  )
  const coveringAll = useMemo(() => insurersCoveringAllTerms(filtered, terms), [filtered, terms])
  const productClasses = useMemo(() => distinctProductClasses(rules), [rules])
  const visible = filtered.slice(0, limit)
  const unverifiedCount = useMemo(() => rules.filter((r) => !r.verified).length, [rules])

  useEffect(() => {
    setLimit(PAGE_SIZE) // 검색 조건이 바뀌면 페이지 초기화
  }, [query, insurer, productClass])

  const openAdd = (): void => {
    setEditId(null)
    setForm(EMPTY_FORM)
    setAliasText('')
    setFormOpen(true)
    setMsg(undefined)
  }

  const openEdit = (r: ExceptionRule): void => {
    setEditId(r.id)
    setForm({
      insurer: r.insurer,
      disease: r.disease,
      searchTerms: r.searchTerms,
      minElapsed: r.minElapsed ?? '',
      treatmentPeriod: r.treatmentPeriod ?? '',
      surgery: r.surgery ?? '',
      productClass: r.productClass,
      note: r.note ?? ''
    })
    setAliasText(r.searchTerms.join(', '))
    setFormOpen(true)
    setMsg(undefined)
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const save = async (): Promise<void> => {
    const input: ExceptionRuleInput = {
      ...form,
      searchTerms: aliasText.split(',').map((s) => s.trim()).filter(Boolean)
    }
    setBusy(true)
    setMsg(undefined)
    const r = editId ? await updateException(editId, input) : await addException(input)
    setBusy(false)
    if (r.ok) {
      setFormOpen(false)
      setEditId(null)
      setForm(EMPTY_FORM)
      setAliasText('')
      setMsg({ ok: true, text: editId ? '기준이 수정되었습니다 (검수 완료 처리).' : '기준 1건이 추가되었습니다.' })
      void load()
    } else {
      setMsg({ ok: false, text: r.message })
    }
  }

  const remove = async (r: ExceptionRule): Promise<void> => {
    if (typeof window !== 'undefined' && !window.confirm(`${r.insurer} · ${r.disease} (${r.productClass}) 기준을 삭제할까요?`)) return
    setBusy(true)
    const res = await deleteException(r.id)
    setBusy(false)
    if (res.ok) {
      setMsg({ ok: true, text: '삭제되었습니다.' })
      void load()
    } else {
      setMsg({ ok: false, text: res.message })
    }
  }

  return (
    <div className="space-y-5">
      {/* 검색 */}
      <Card title="유병자 인수예외질환 검색" icon={<HeartPulse className="h-4 w-4 text-rose-600" />}>
        {loadErr ? (
          <div className="mb-3 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-700">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {loadErr}
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_170px_170px]">
          <label className="relative block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="질환명 입력 — 예: 고혈압 (여러 개는 &로: 충수염&복막염)"
              className="w-full rounded-xl border border-slate-800 bg-white py-2.5 pl-9 pr-3 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none"
            />
          </label>
          <select
            value={insurer}
            onChange={(e) => setInsurer(e.target.value)}
            className="rounded-xl border border-slate-800 bg-white px-2.5 py-2.5 text-xs font-medium text-slate-200 focus:outline-none"
          >
            <option value="all">보험사 전체</option>
            <option value="N">손보 전체</option>
            <option value="L">생보 전체</option>
            {EXCEPTION_INSURERS.map((i) => (
              <option key={i.name} value={i.name}>
                {i.name}
              </option>
            ))}
          </select>
          <select
            value={productClass}
            onChange={(e) => setProductClass(e.target.value)}
            className="rounded-xl border border-slate-800 bg-white px-2.5 py-2.5 text-xs font-medium text-slate-200 focus:outline-none"
          >
            <option value="all">가능상품구분 전체</option>
            {productClasses.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>

        <p className="mt-2 flex items-center gap-1.5 text-[11px] text-slate-500">
          <Info className="h-3 w-3 shrink-0" />
          질환 2개 이상은 &apos;&amp;&apos;로 검색 (예: 충수염&amp;복막염, 최대 {MAX_SEARCH_TERMS}개) · 별칭도 검색됩니다 (혈압약 → 고혈압)
        </p>

        {/* 복수 질환: 모두 인정하는 보험사 요약 */}
        {terms.length >= 2 ? (
          <div
            className="mt-3 flex flex-wrap items-center gap-1.5 rounded-xl border px-3 py-2 text-[12px]"
            style={{ backgroundColor: '#0e1e3a', borderColor: '#c6982f' }}
          >
            <span className="font-bold" style={{ color: '#e6c877' }}>
              {terms.join(' + ')} 모두 예외 인정:
            </span>
            {coveringAll.length === 0 ? (
              <span className="text-white/70">해당 보험사 없음 (질환별 개별 확인 필요)</span>
            ) : (
              coveringAll.map((name) => (
                <span key={name} className="rounded-full bg-white/15 px-2 py-0.5 font-semibold text-white">
                  {name}
                </span>
              ))
            )}
          </div>
        ) : null}
      </Card>

      {/* 관리자: 기준 추가/수정 */}
      {isAdmin ? (
        <Card title={editId ? '기준 수정 (저장 시 검수 완료)' : '기준 관리 (관리자)'} icon={<ShieldCheck className="h-4 w-4 text-indigo-600" />}>
          {!formOpen ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[12px] text-slate-500">
                검수전 {unverifiedCount}건 — AI 참고용 시드는 <b className="text-slate-300">검수전</b> 배지가 붙습니다. 수정·저장하면 검수
                완료로 바뀝니다.
              </p>
              <button
                type="button"
                onClick={openAdd}
                className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 px-3.5 py-2 text-xs font-bold text-white shadow-sm transition hover:brightness-110"
              >
                <Plus className="h-3.5 w-3.5" /> 기준 추가
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <label className="block">
                  <span className="mb-1 block text-[10px] font-medium text-slate-500">보험사 *</span>
                  <select
                    value={form.insurer}
                    onChange={(e) => setForm((f) => ({ ...f, insurer: e.target.value }))}
                    className="w-full rounded-lg border border-slate-800 bg-white px-2 py-2 text-xs font-medium text-slate-200 focus:outline-none"
                  >
                    <option value="">선택</option>
                    {EXCEPTION_INSURERS.map((i) => (
                      <option key={i.name} value={i.name}>
                        {i.name} ({i.kind === 'N' ? '손보' : '생보'})
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-[10px] font-medium text-slate-500">예외질환명 *</span>
                  <input
                    value={form.disease}
                    onChange={(e) => setForm((f) => ({ ...f, disease: e.target.value }))}
                    placeholder="예: 고혈압(본태성)"
                    className="w-full rounded-lg border border-slate-800 bg-white px-2 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[10px] font-medium text-slate-500">가능상품구분 *</span>
                  <input
                    value={form.productClass}
                    onChange={(e) => setForm((f) => ({ ...f, productClass: e.target.value }))}
                    placeholder="예: 355, 3N5, 간편 공통"
                    list="product-class-options"
                    className="w-full rounded-lg border border-slate-800 bg-white px-2 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none"
                  />
                  <datalist id="product-class-options">
                    {[...new Set([...PRODUCT_CLASS_SUGGESTIONS, ...productClasses])].map((p) => (
                      <option key={p} value={p} />
                    ))}
                  </datalist>
                </label>
                <label className="block">
                  <span className="mb-1 block text-[10px] font-medium text-slate-500">최소경과</span>
                  <input
                    value={form.minElapsed}
                    onChange={(e) => setForm((f) => ({ ...f, minElapsed: e.target.value }))}
                    placeholder="예: 3개월 / 치료종결 즉시"
                    className="w-full rounded-lg border border-slate-800 bg-white px-2 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[10px] font-medium text-slate-500">치료기간</span>
                  <input
                    value={form.treatmentPeriod}
                    onChange={(e) => setForm((f) => ({ ...f, treatmentPeriod: e.target.value }))}
                    placeholder="예: 입원 14일 이하"
                    className="w-full rounded-lg border border-slate-800 bg-white px-2 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[10px] font-medium text-slate-500">수술여부</span>
                  <input
                    value={form.surgery}
                    onChange={(e) => setForm((f) => ({ ...f, surgery: e.target.value }))}
                    placeholder="예: 무관 / 수술 후 1년"
                    className="w-full rounded-lg border border-slate-800 bg-white px-2 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none"
                  />
                </label>
                <label className="block sm:col-span-2">
                  <span className="mb-1 block text-[10px] font-medium text-slate-500">검색 별칭 (쉼표 구분)</span>
                  <input
                    value={aliasText}
                    onChange={(e) => setAliasText(e.target.value)}
                    placeholder="예: 혈압, 혈압약, 본태성고혈압"
                    className="w-full rounded-lg border border-slate-800 bg-white px-2 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[10px] font-medium text-slate-500">비고</span>
                  <input
                    value={form.note}
                    onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
                    placeholder="부가 조건"
                    className="w-full rounded-lg border border-slate-800 bg-white px-2 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none"
                  />
                </label>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => void save()}
                  disabled={busy}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-2 text-xs font-bold text-white hover:bg-indigo-500 disabled:opacity-60"
                >
                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                  {editId ? '수정 저장' : '추가'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setFormOpen(false)
                    setEditId(null)
                  }}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-800 bg-white px-3 py-2 text-xs font-medium text-slate-400 hover:text-slate-200"
                >
                  <X className="h-3.5 w-3.5" /> 취소
                </button>
              </div>
            </div>
          )}
          {msg ? (
            <p className={['mt-2 flex items-center gap-1.5 text-[12px]', msg.ok ? 'text-emerald-600' : 'text-rose-600'].join(' ')}>
              {msg.ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
              {msg.text}
            </p>
          ) : null}
        </Card>
      ) : null}

      {/* 결과 표 */}
      <Card
        title={`검색 결과 ${filtered.length}건`}
        icon={<Search className="h-4 w-4" style={{ color: GOLD }} />}
      >
        {loading ? (
          <div className="flex items-center gap-2 py-6 text-[12px] text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" /> 불러오는 중…
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-700 py-8 text-center text-[12px] text-slate-500">
            {rules.length === 0
              ? '등록된 기준이 없습니다. 관리자가 기준을 추가하면 여기서 검색됩니다.'
              : '조건에 맞는 예외질환 기준이 없습니다. 검색어나 필터를 바꿔보세요.'}
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead>
                  <tr className="border-b border-slate-800 text-left text-[11px] text-slate-500">
                    <th className="py-2 pr-3 font-medium">보험사</th>
                    <th className="py-2 pr-3 font-medium">예외질환 (질병/상해)</th>
                    <th className="py-2 pr-3 font-medium">최소경과</th>
                    <th className="py-2 pr-3 font-medium">치료기간</th>
                    <th className="py-2 pr-3 font-medium">수술여부</th>
                    <th className="py-2 pr-3 font-medium">가능상품구분</th>
                    <th className="py-2 pr-3 font-medium">비고</th>
                    {isAdmin ? <th className="py-2 pr-0 text-right font-medium">관리</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {visible.map((r) => (
                    <tr key={r.id} className="border-b border-slate-800/60 align-top">
                      <td className="py-2 pr-3 font-semibold text-slate-200">{r.insurer}</td>
                      <td className="py-2 pr-3">
                        <span className="font-medium text-slate-100">{r.disease}</span>
                        {!r.verified ? (
                          <span className="ml-1.5 rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">검수전</span>
                        ) : null}
                      </td>
                      <td className="py-2 pr-3 text-slate-300">{dash(r.minElapsed)}</td>
                      <td className="py-2 pr-3 text-slate-300">{dash(r.treatmentPeriod)}</td>
                      <td className="py-2 pr-3 text-slate-300">{dash(r.surgery)}</td>
                      <td className="py-2 pr-3">
                        <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-bold text-indigo-600">{r.productClass || '-'}</span>
                      </td>
                      <td className="max-w-[240px] py-2 pr-3 text-[12px] text-slate-500">{dash(r.note)}</td>
                      {isAdmin ? (
                        <td className="py-2 pr-0 text-right">
                          <span className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => openEdit(r)}
                              aria-label="수정"
                              className="rounded-lg p-1.5 text-slate-400 transition hover:bg-indigo-50 hover:text-indigo-600"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => void remove(r)}
                              aria-label="삭제"
                              className="rounded-lg p-1.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </span>
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {filtered.length > limit ? (
              <button
                type="button"
                onClick={() => setLimit((n) => n + PAGE_SIZE)}
                className="mt-3 w-full rounded-xl border border-slate-800 bg-white py-2 text-center text-[12px] font-semibold text-indigo-600 hover:bg-indigo-50"
              >
                더보기 ({filtered.length - limit}건 남음)
              </button>
            ) : null}
          </>
        )}
        <p className="mt-3 flex items-start gap-1.5 text-[11px] leading-4 text-slate-500">
          <Info className="mt-0.5 h-3 w-3 shrink-0" />
          <span>
            <b className="text-amber-700">검수전</b> 배지는 AI가 채운 참고용 초기값입니다. 실제 인수 여부는 보험사·시기별로 다르니
            청약 전 각 사 최신 지침을 확인하세요. 관리자가 수정·저장하면 검수 완료로 표시됩니다.
          </span>
        </p>
      </Card>
    </div>
  )
}
