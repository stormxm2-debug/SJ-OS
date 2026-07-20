import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ShieldCheck, Search, Loader2, RefreshCw, Plus, Pencil, Check, X } from 'lucide-react'
import {
  listUnderwriting,
  upsertRule,
  addDisease,
  subscribeUnderwriting,
  underwritingEnabled,
  ruleFor,
  verifiedCount,
  INSURERS,
  UW_STATUS,
  UW_STATUS_ORDER,
  type UwDisease,
  type UwStatus,
  type UwRule
} from '@renderer/services/commercial/underwritingService'
import { useSession } from '@renderer/navigation/SessionContext'
import { isAdminRole } from '@renderer/navigation/roleAccess'

/**
 * 고지의무(인수기준) 조회·관리.
 * 질병 검색 → 보험사별 인수상태(정상/간편/할증/부담보/거절/확인필요) + 메모.
 * 조회는 전 직원, 수정은 대표·관리자(RLS). 미검증 항목은 배지로 구분(참고용).
 *
 * 색상 주의: 이 앱은 slate 스케일을 반전 리맵(tailwind.config.js) — 어두운 글씨는
 * text-slate-100/200/300, 밝은 면은 bg-white / bg-slate-950.
 */

const TONE_CHIP: Record<string, string> = {
  emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  blue: 'bg-blue-50 text-blue-700 border-blue-200',
  amber: 'bg-amber-50 text-amber-700 border-amber-200',
  orange: 'bg-orange-50 text-orange-700 border-orange-200',
  rose: 'bg-rose-50 text-rose-700 border-rose-200',
  slate: 'bg-slate-950 text-slate-500 border-slate-800'
}

export default function UnderwritingPage(): JSX.Element {
  const { session } = useSession()
  const enabled = underwritingEnabled()
  const canEdit = enabled && isAdminRole(session.role)

  const [data, setData] = useState<UwDisease[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [cat, setCat] = useState('all')
  const [adding, setAdding] = useState(false)
  const [status, setStatus] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null)

  const reload = useCallback(async (): Promise<void> => {
    if (!enabled) {
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      setData(await listUnderwriting())
    } catch (e) {
      setStatus({ kind: 'err', msg: (e as Error).message })
    } finally {
      setLoading(false)
    }
  }, [enabled])

  useEffect(() => {
    void reload()
    const unsub = subscribeUnderwriting(() => {
      void listUnderwriting().then(setData).catch(() => {})
    })
    return unsub
  }, [reload])

  const categories = useMemo(() => {
    const s = new Set<string>()
    data.forEach((d) => s.add(d.category))
    return Array.from(s)
  }, [data])

  const q = query.trim().toLowerCase()
  const filtered = data.filter((d) => {
    if (cat !== 'all' && d.category !== cat) return false
    if (!q) return true
    const hay = [d.name, d.category, d.generalNote, ...d.aliases].join(' ').toLowerCase()
    return hay.includes(q)
  })

  const totalVerified = useMemo(() => data.reduce((n, d) => n + verifiedCount(d), 0), [data])

  const applyRule = (diseaseId: string, insurer: string, value: UwRule): void => {
    setData((prev) =>
      prev.map((d) => (d.id === diseaseId ? { ...d, rules: { ...d.rules, [insurer]: value } } : d))
    )
  }

  if (!enabled) {
    return (
      <div className="space-y-4">
        <Header count={0} verified={0} loading={false} onReload={() => {}} />
        <div className="rounded-2xl border border-slate-800 bg-white p-8 text-center text-sm text-slate-500">
          팀 공유(Supabase) 설정이 필요한 기능입니다. 배포 환경에서 자동으로 활성화됩니다.
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <Header count={data.length} verified={totalVerified} loading={loading} onReload={() => void reload()} />

      {/* 안전 안내 */}
      <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-[12.5px] font-medium text-amber-700">
        ⚠️ <b>일반 참고용</b>입니다. 실제 인수 가능 여부는 <b>반드시 청약 전 각 보험사 인수심사</b>로 확인하세요.
        ‘확인 필요’·미검증 항목이 포함되어 있으며, 고객에게는 병력을 <b>빠짐없이 고지</b>하도록 안내해야 합니다.
      </div>

      {/* 툴바 */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-800 bg-white p-3 shadow-sm">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="질병명 · 별칭 검색 (예: 고혈압, 혈압약, 당뇨)"
            className="w-full rounded-lg border border-slate-700 bg-white py-2 pl-8 pr-3 text-[13px] text-slate-200 outline-none placeholder:text-slate-500 focus:border-indigo-400"
          />
        </div>
        <div className="flex items-center gap-2">
          <select
            value={cat}
            onChange={(e) => setCat(e.target.value)}
            className="rounded-lg border border-slate-700 bg-white px-2.5 py-2 text-[13px] text-slate-200 outline-none focus:border-indigo-400"
          >
            <option value="all">전체 분류</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          {canEdit ? (
            <button
              type="button"
              onClick={() => setAdding((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-800 bg-white px-2.5 py-2 text-[12px] font-semibold text-slate-200 transition hover:bg-slate-950"
            >
              <Plus className="h-3.5 w-3.5" /> 질병 추가
            </button>
          ) : null}
        </div>
      </div>

      {status ? (
        <div
          className={[
            'rounded-xl px-3 py-2.5 text-[13px] font-medium',
            status.kind === 'ok'
              ? 'border border-emerald-200 bg-emerald-50 text-emerald-700'
              : 'border border-rose-200 bg-rose-50 text-rose-600'
          ].join(' ')}
        >
          {status.msg}
        </div>
      ) : null}

      {adding && canEdit ? (
        <AddDiseaseForm
          onCancel={() => setAdding(false)}
          onAdded={async () => {
            setAdding(false)
            setStatus({ kind: 'ok', msg: '질병이 추가되었습니다.' })
            await reload()
          }}
          onError={(m) => setStatus({ kind: 'err', msg: m })}
        />
      ) : null}

      {loading ? (
        <div className="flex items-center gap-2 rounded-2xl border border-slate-800 bg-white p-8 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" /> 고지의무 데이터를 불러오는 중…
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-slate-800 bg-white p-10 text-center text-sm text-slate-500">
          검색 결과가 없습니다.
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((d) => (
            <DiseaseCard
              key={d.id}
              disease={d}
              canEdit={canEdit}
              onSaved={applyRule}
              onError={(m) => setStatus({ kind: 'err', msg: m })}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function Header({
  count,
  verified,
  loading,
  onReload
}: {
  count: number
  verified: number
  loading: boolean
  onReload: () => void
}): JSX.Element {
  return (
    <div className="flex items-center justify-between rounded-2xl border border-slate-800 bg-[#0e1e3a] px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-[#e6c877]" />
        <h1 className="text-sm font-extrabold text-white">고지의무 조회 (인수기준)</h1>
        <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-bold text-white/80">
          질병 {count} · 검증 {verified}건
        </span>
        <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-bold text-emerald-200">팀 공유 · 실시간</span>
      </div>
      <button
        type="button"
        onClick={onReload}
        className="inline-flex items-center gap-1.5 rounded-lg border border-white/20 px-2.5 py-1.5 text-[11px] font-semibold text-white transition hover:bg-white/10"
      >
        <RefreshCw className={['h-3.5 w-3.5', loading ? 'animate-spin' : ''].join(' ')} /> 새로고침
      </button>
    </div>
  )
}

function StatusChip({ status, small }: { status: UwStatus; small?: boolean }): JSX.Element {
  const meta = UW_STATUS[status]
  return (
    <span
      className={[
        'inline-flex items-center rounded-full border font-semibold',
        small ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-0.5 text-[11px]',
        TONE_CHIP[meta.tone]
      ].join(' ')}
    >
      {meta.label}
    </span>
  )
}

function DiseaseCard({
  disease,
  canEdit,
  onSaved,
  onError
}: {
  disease: UwDisease
  canEdit: boolean
  onSaved: (diseaseId: string, insurer: string, value: UwRule) => void
  onError: (msg: string) => void
}): JSX.Element {
  const [editing, setEditing] = useState(false)
  const vc = verifiedCount(disease)

  return (
    <div className="rounded-2xl border border-slate-800 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-slate-950 px-2 py-0.5 text-[10px] font-bold text-slate-500">{disease.category}</span>
            <h3 className="text-[15px] font-bold text-slate-100">{disease.name}</h3>
            {disease.aliases.length ? (
              <span className="text-[11px] text-slate-500">별칭: {disease.aliases.join(', ')}</span>
            ) : null}
            <span
              className={[
                'rounded-full px-2 py-0.5 text-[10px] font-bold',
                vc > 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-950 text-slate-500'
              ].join(' ')}
            >
              검증 {vc}/{INSURERS.length}
            </span>
          </div>
          {disease.generalNote ? (
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-slate-400">{disease.generalNote}</p>
          ) : null}
        </div>
        {canEdit ? (
          <button
            type="button"
            onClick={() => setEditing((v) => !v)}
            className={[
              'inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] font-semibold transition',
              editing
                ? 'border-slate-800 bg-slate-950 text-slate-300'
                : 'border-slate-800 bg-white text-slate-200 hover:bg-slate-950'
            ].join(' ')}
          >
            {editing ? <X className="h-3.5 w-3.5" /> : <Pencil className="h-3.5 w-3.5" />}
            {editing ? '닫기' : '수정'}
          </button>
        ) : null}
      </div>

      {!editing ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {INSURERS.map((ins) => {
            const r = ruleFor(disease, ins)
            return (
              <span
                key={ins}
                title={r.note || undefined}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-800 bg-white px-2 py-1"
              >
                <span className="text-[11px] font-semibold text-slate-300">{ins}</span>
                <StatusChip status={r.status} small />
                {r.verified ? <Check className="h-3 w-3 text-emerald-600" /> : null}
              </span>
            )
          })}
        </div>
      ) : (
        <RuleEditor disease={disease} onSaved={onSaved} onError={onError} />
      )}
    </div>
  )
}

function RuleEditor({
  disease,
  onSaved,
  onError
}: {
  disease: UwDisease
  onSaved: (diseaseId: string, insurer: string, value: UwRule) => void
  onError: (msg: string) => void
}): JSX.Element {
  const [savingKey, setSavingKey] = useState<string | null>(null)

  const save = async (insurer: string, value: UwRule): Promise<void> => {
    setSavingKey(insurer)
    try {
      await upsertRule(disease.id, insurer, value)
      onSaved(disease.id, insurer, value)
    } catch (e) {
      onError((e as Error).message)
    } finally {
      setSavingKey(null)
    }
  }

  return (
    <div className="mt-3 overflow-x-auto rounded-xl border border-slate-800">
      <table className="w-full min-w-[560px] text-left text-[12.5px]">
        <thead>
          <tr className="border-b border-slate-800 bg-slate-950 text-[11px] text-slate-500">
            <th className="px-3 py-2 font-semibold">보험사</th>
            <th className="px-3 py-2 font-semibold">상태</th>
            <th className="px-3 py-2 font-semibold">메모</th>
            <th className="px-3 py-2 font-semibold">검증</th>
            <th className="px-3 py-2 font-semibold"></th>
          </tr>
        </thead>
        <tbody>
          {INSURERS.map((ins) => (
            <EditorRow
              key={ins}
              insurer={ins}
              initial={ruleFor(disease, ins)}
              saving={savingKey === ins}
              onSave={(v) => save(ins, v)}
            />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function EditorRow({
  insurer,
  initial,
  saving,
  onSave
}: {
  insurer: string
  initial: UwRule
  saving: boolean
  onSave: (value: UwRule) => void
}): JSX.Element {
  const [statusV, setStatusV] = useState<UwStatus>(initial.status)
  const [note, setNote] = useState(initial.note)
  const [verified, setVerified] = useState(initial.verified)
  const dirty = statusV !== initial.status || note !== initial.note || verified !== initial.verified

  return (
    <tr className="border-b border-slate-800 last:border-0">
      <td className="px-3 py-2 font-semibold text-slate-200 whitespace-nowrap">{insurer}</td>
      <td className="px-3 py-2">
        <select
          value={statusV}
          onChange={(e) => setStatusV(e.target.value as UwStatus)}
          className="rounded-md border border-slate-700 bg-white px-2 py-1 text-[12px] text-slate-200 outline-none focus:border-indigo-400"
        >
          {UW_STATUS_ORDER.map((s) => (
            <option key={s} value={s}>
              {UW_STATUS[s].label}
            </option>
          ))}
        </select>
      </td>
      <td className="px-3 py-2">
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="예: 조절 양호 시 간편심사 가능"
          className="w-full min-w-[180px] rounded-md border border-slate-700 bg-white px-2 py-1 text-[12px] text-slate-200 outline-none placeholder:text-slate-500 focus:border-indigo-400"
        />
      </td>
      <td className="px-3 py-2">
        <label className="inline-flex cursor-pointer items-center gap-1.5 text-[11px] text-slate-400">
          <input
            type="checkbox"
            checked={verified}
            onChange={(e) => setVerified(e.target.checked)}
            className="h-3.5 w-3.5 accent-emerald-600"
          />
          검증
        </label>
      </td>
      <td className="px-3 py-2">
        <button
          type="button"
          disabled={!dirty || saving}
          onClick={() => onSave({ status: statusV, note, verified })}
          className={[
            'inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[12px] font-semibold transition',
            dirty && !saving
              ? 'bg-blue-600 text-white hover:opacity-90'
              : 'cursor-not-allowed bg-slate-950 text-slate-500'
          ].join(' ')}
        >
          {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
          저장
        </button>
      </td>
    </tr>
  )
}

function AddDiseaseForm({
  onCancel,
  onAdded,
  onError
}: {
  onCancel: () => void
  onAdded: () => void
  onError: (msg: string) => void
}): JSX.Element {
  const [name, setName] = useState('')
  const [category, setCategory] = useState('')
  const [aliases, setAliases] = useState('')
  const [generalNote, setGeneralNote] = useState('')
  const [saving, setSaving] = useState(false)
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => {
    ref.current?.focus()
  }, [])

  const submit = async (): Promise<void> => {
    if (!name.trim()) {
      onError('질병명을 입력하세요.')
      return
    }
    setSaving(true)
    try {
      await addDisease({
        name,
        category,
        aliases: aliases
          .split(/[,·]/)
          .map((s) => s.trim())
          .filter(Boolean),
        generalNote
      })
      onAdded()
    } catch (e) {
      onError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-2xl border border-slate-800 bg-white p-4 shadow-sm">
      <div className="mb-2 text-sm font-semibold text-slate-100">질병 추가</div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <input
          ref={ref}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="질병명 (예: 자궁근종)"
          className="rounded-md border border-slate-700 bg-white px-2.5 py-2 text-[13px] text-slate-200 outline-none placeholder:text-slate-500 focus:border-indigo-400"
        />
        <input
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          placeholder="분류 (예: 여성질환)"
          className="rounded-md border border-slate-700 bg-white px-2.5 py-2 text-[13px] text-slate-200 outline-none placeholder:text-slate-500 focus:border-indigo-400"
        />
        <input
          value={aliases}
          onChange={(e) => setAliases(e.target.value)}
          placeholder="별칭 (쉼표로 구분: 근종, 자궁근종)"
          className="rounded-md border border-slate-700 bg-white px-2.5 py-2 text-[13px] text-slate-200 outline-none placeholder:text-slate-500 focus:border-indigo-400"
        />
        <input
          value={generalNote}
          onChange={(e) => setGeneralNote(e.target.value)}
          placeholder="일반 안내 (선택)"
          className="rounded-md border border-slate-700 bg-white px-2.5 py-2 text-[13px] text-slate-200 outline-none placeholder:text-slate-500 focus:border-indigo-400"
        />
      </div>
      <div className="mt-2.5 flex items-center gap-2">
        <button
          type="button"
          disabled={saving}
          onClick={() => void submit()}
          className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-[13px] font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
          추가
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-slate-800 bg-white px-3 py-2 text-[13px] font-semibold text-slate-400 transition hover:bg-slate-950"
        >
          취소
        </button>
      </div>
    </div>
  )
}
