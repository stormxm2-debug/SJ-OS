import { useEffect, useMemo, useState } from 'react'
import {
  UsersRound,
  Phone,
  MessageSquare,
  UserPlus,
  Plus,
  Pencil,
  Trash2,
  X,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  Search
} from 'lucide-react'
import { useSession } from '@renderer/navigation/SessionContext'
import { isAdminRole } from '@renderer/navigation/roleAccess'
import { INSURERS } from '@renderer/services/commercial/registrationService'
import {
  listCompanyContacts,
  saveCompanyContact,
  deleteCompanyContact,
  markSavedToPhone,
  isStaleOnPhone,
  getSavedAt,
  type CompanyContact,
  type CompanyContactDraft
} from '@renderer/services/commercial/companyContactsService'
import { saveVcfToPhone, contactDisplayName } from '@renderer/services/commercial/vcard'
import { useRealtimeSync } from '@renderer/services/commercial/useRealtimeSync'

/** Tables whose changes should live-refresh this screen (stable ref for the hook). */
const RT_TABLES = ['company_contacts']

type InsurerSector = '생보' | '손보' | '기타'

/**
 * 보험사명 → 생보/손보 구분.
 * 실제 등록 데이터가 축약 이름(삼성·라이나·DB·교보 …)이라 키워드 + 회사명 매핑을 함께 쓴다.
 * 우선순위: ①명시 키워드(생명/라이프, 화재/해상/손보/손해) ②알려진 회사명.
 * 중의적 축약명은 사내 취급사 기준: 한화=한화생명(생보), 흥국=흥국화재(손보),
 * 농협=NH농협손해(손보), 삼성=삼성화재(손보 — 삼성생명 담당자는 이름을 '삼성생명'으로).
 */
const LIFE_NAMES = ['라이나', '동양', '메트', '신한', 'ABL', 'KDB', '교보', '미래', '카디프', '한화', 'AIA', '푸본', '처브', 'iM']
const NONLIFE_NAMES = ['삼성', 'DB', 'KB', '롯데', '하나', '현대', '흥국', '농협', 'NH', '메리츠', 'MG', '캐롯', 'AXA', 'AIG']

function insurerSector(insurer: string): InsurerSector {
  if (insurer.includes('생명') || insurer.includes('라이프')) return '생보'
  if (insurer.includes('화재') || insurer.includes('해상') || insurer.includes('손보') || insurer.includes('손해')) return '손보'
  if (LIFE_NAMES.some((n) => insurer.includes(n))) return '생보'
  if (NONLIFE_NAMES.some((n) => insurer.includes(n))) return '손보'
  return '기타'
}

/** 직급 정렬 — 높은 직급 먼저. '부지점장'이 '지점장'에 오매칭되지 않게 목록 순서로 검사. */
const TITLE_RANKS: [string, number][] = [
  ['본부장', 0],
  ['센터장', 1],
  ['부지점장', 3],
  ['지점장', 2],
  ['팀장', 4],
  ['매니저', 5]
]
function titleRank(title: string): number {
  for (const [t, r] of TITLE_RANKS) if (title.includes(t)) return r
  return 6
}

/**
 * 매니저 연락처 — 각 보험사 담당 매니저 연락처를 서버에서 중앙 관리한다.
 * 직원: 목록 조회 + 앱에서 바로 통화/문자 + vCard로 내 폰 주소록 저장(단건/전체).
 * 번호가 서버에서 바뀌면 (이 기기에서 저장한 적 있는 연락처에) '번호 변경됨' 뱃지를
 * 띄워 다시 저장하도록 유도한다. 관리자(owner/admin)만 등록/수정/삭제 — RLS로 강제.
 */
export default function ManagerContactsPage(): JSX.Element {
  const { session } = useSession()
  const admin = isAdminRole(session.role)
  const [items, setItems] = useState<CompanyContact[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | undefined>()
  const [notice, setNotice] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null)
  // localStorage 저장 이력이 바뀔 때 뱃지를 다시 그리기 위한 tick
  const [, setSavedTick] = useState(0)
  const [editing, setEditing] = useState<CompanyContact | null>(null)
  const [creating, setCreating] = useState(false)
  const [q, setQ] = useState('')
  const [sector, setSector] = useState<InsurerSector>('손보')
  /** 2단계 탐색: 탭에서 보험사를 먼저 고르고 → 그 회사 매니저만 본다. */
  const [selectedInsurer, setSelectedInsurer] = useState<string | null>(null)

  const load = async (): Promise<void> => {
    const res = await listCompanyContacts()
    setItems(res.items)
    setError(res.ok ? undefined : res.error)
    setLoading(false)
  }
  useEffect(() => {
    void load()
  }, [])
  useRealtimeSync(RT_TABLES, load)

  // 안내 배너는 4초 뒤 자동으로 사라진다
  useEffect(() => {
    if (!notice) return
    const id = window.setTimeout(() => setNotice(null), 4000)
    return () => window.clearTimeout(id)
  }, [notice])

  const staleCount = useMemo(() => items.filter(isStaleOnPhone).length, [items])

  const sectorCounts = useMemo(() => {
    const n: Record<InsurerSector, number> = { 생보: 0, 손보: 0, 기타: 0 }
    for (const c of items) n[insurerSector(c.insurer)]++
    return n
  }, [items])

  const searching = q.trim().length > 0

  /**
   * 보험사별 그룹 목록 — 검색 중이면 생·손 구분 없이 전체에서 찾고,
   * 아니면 선택한 구분(생보/손보/기타)만. 회사 안에서는 직급 순 정렬.
   */
  const groups = useMemo(() => {
    const t = q.trim().toLowerCase()
    const base = t
      ? items.filter((c) =>
          [c.insurer, c.managerName, c.title, c.phone, c.officePhone ?? '', c.email ?? '', c.memo ?? ''].some((v) =>
            v.toLowerCase().includes(t)
          )
        )
      : items.filter((c) => insurerSector(c.insurer) === sector)
    const out: { insurer: string; list: CompanyContact[] }[] = []
    for (const c of base) {
      const g = out[out.length - 1]
      if (g && g.insurer === c.insurer) g.list.push(c)
      else out.push({ insurer: c.insurer, list: [c] })
    }
    for (const g of out) {
      g.list.sort((a, b) => titleRank(a.title) - titleRank(b.title) || a.managerName.localeCompare(b.managerName, 'ko'))
    }
    return out
  }, [items, q, sector])

  const sectorTabs: InsurerSector[] = sectorCounts.기타 > 0 ? ['생보', '손보', '기타'] : ['생보', '손보']

  const saveToPhone = async (targets: CompanyContact[], filename: string): Promise<void> => {
    const res = await saveVcfToPhone(targets, filename)
    if (res.cancelled) return
    if (!res.ok) {
      setNotice({ tone: 'err', text: res.error ?? '저장에 실패했습니다.' })
      return
    }
    markSavedToPhone(targets.map((c) => c.id))
    setSavedTick((v) => v + 1)
    setNotice({
      tone: 'ok',
      text: targets.length > 1 ? `연락처 ${targets.length}건 파일이 열립니다 — 폰에서 '저장'을 누르면 완료돼요.` : `${contactDisplayName(targets[0])} — 폰에서 '저장'을 누르면 완료돼요.`
    })
  }

  const remove = async (c: CompanyContact): Promise<void> => {
    if (!window.confirm(`${contactDisplayName(c)} 연락처를 삭제할까요?`)) return
    const res = await deleteCompanyContact(c.id)
    if (!res.ok) setNotice({ tone: 'err', text: res.error ?? '삭제에 실패했습니다.' })
    else void load()
  }

  return (
    <div className="mx-auto max-w-2xl space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <UsersRound className="h-6 w-6 text-indigo-500" />
        <h1 className="text-xl font-bold text-slate-100">매니저 연락처</h1>
        {items.length > 0 ? <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-bold text-slate-600">{items.length}명</span> : null}
        {staleCount > 0 ? <span className="rounded-full bg-amber-500 px-2 py-0.5 text-[10px] font-bold text-white">변경 {staleCount}</span> : null}
      </div>

      {/* 전체 저장 — 딥네이비+골드 (이 화면의 대표 액션) */}
      {items.length > 0 ? (
        <button
          type="button"
          onClick={() => void saveToPhone(items, 'sj-managers.vcf')}
          className="flex w-full items-center justify-center gap-2 rounded-2xl border p-3.5 text-sm font-bold shadow-sm active:opacity-90"
          style={{ backgroundColor: '#0e1e3a', borderColor: '#c6982f', color: '#e6c877' }}
        >
          <UserPlus className="h-4 w-4" /> 전체 {items.length}명 내 폰에 저장
        </button>
      ) : null}

      <p className="px-1 text-[11px] leading-4 text-slate-500">
        버튼을 누르면 폰 연락처 앱이 열려요 — &lsquo;저장&rsquo; 한 번이면 등록 완료. 번호가 바뀌면 <span className="font-bold text-amber-600">번호 변경됨</span> 뱃지가 떠요. 다시 저장해 주세요.
      </p>

      {notice ? (
        <div className={['flex items-center gap-1.5 rounded-lg border px-3 py-2 text-[11px]', notice.tone === 'ok' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-rose-200 bg-rose-50 text-rose-600'].join(' ')}>
          {notice.tone === 'ok' ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> : <AlertTriangle className="h-3.5 w-3.5 shrink-0" />}
          {notice.text}
        </div>
      ) : null}
      {error ? <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] text-rose-600"><AlertTriangle className="mr-1 inline h-3 w-3" />{error}</div> : null}

      {/* 검색 — 이름·보험사·직급·번호·메모 (검색 중엔 생/손 구분 없이 전체에서 찾음) */}
      <div className="flex items-center gap-1.5 rounded-2xl border border-slate-200 bg-white px-3 shadow-sm">
        <Search className="h-4 w-4 shrink-0 text-slate-400" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="이름 · 보험사 · 직급 · 번호 검색"
          className="w-full bg-transparent py-2.5 text-sm text-slate-100 outline-none placeholder:text-slate-400"
        />
        {searching ? (
          <button type="button" onClick={() => setQ('')} aria-label="검색 지우기" className="rounded-lg p-1 text-slate-400 active:bg-slate-50">
            <X className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>

      {/* 생보/손보 탭 (검색 중에는 숨김 — 전체 검색) */}
      {!searching ? (
        <div className="flex overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          {sectorTabs.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => {
                setSector(s)
                setSelectedInsurer(null)
              }}
              className="flex-1 py-2.5 text-sm font-bold transition"
              style={
                sector === s
                  ? { backgroundColor: '#0e1e3a', color: '#e6c877' }
                  : { backgroundColor: 'transparent', color: '#94a3b8' }
              }
            >
              {s === '생보' ? '생명보험사' : s === '손보' ? '손해보험사' : '기타'} {sectorCounts[s]}
            </button>
          ))}
        </div>
      ) : null}

      {admin ? (
        creating ? (
          <ContactForm
            onDone={(saved) => {
              setCreating(false)
              if (saved) void load()
            }}
          />
        ) : (
          <button type="button" onClick={() => setCreating(true)} className="flex w-full items-center justify-center gap-1.5 rounded-2xl border border-dashed border-slate-300 bg-white p-3 text-sm font-semibold text-slate-500 active:bg-slate-50">
            <Plus className="h-4 w-4" /> 매니저 등록
          </button>
        )
      ) : null}

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-8 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> 불러오는 중…</div>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
          등록된 매니저 연락처가 없습니다.
          {admin ? ' 위의 [매니저 등록]으로 추가해주세요.' : ' 관리자가 등록하면 여기에 표시됩니다.'}
        </div>
      ) : groups.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
          {searching ? `'${q.trim()}' 검색 결과가 없습니다.` : `${sector === '생보' ? '생명보험사' : sector === '손보' ? '손해보험사' : '기타'} 매니저가 아직 없습니다.`}
        </div>
      ) : searching ? (
        /* 검색 결과 — 생/손 구분 없이 회사별 그룹 + 생명/손해 배지 */
        <div className="space-y-4">
          {groups.map((g) => (
            <div key={g.insurer}>
              <div className="mb-1.5 flex items-center gap-1.5 px-1">
                <span className="text-[13px] font-black text-slate-100">{g.insurer}</span>
                <span className="rounded-full bg-slate-50 px-1.5 py-0.5 text-[10px] font-bold text-slate-500">{g.list.length}명</span>
                <span className="rounded-full border px-1.5 py-0.5 text-[9px] font-bold" style={{ borderColor: '#c6982f', color: '#a07a1f' }}>
                  {insurerSector(g.insurer) === '생보' ? '생명' : insurerSector(g.insurer) === '손보' ? '손해' : '기타'}
                </span>
              </div>
              <div className="space-y-2">
                {g.list.map((c) =>
                  editing?.id === c.id ? (
                    <ContactForm
                      key={c.id}
                      initial={c}
                      onDone={(saved) => {
                        setEditing(null)
                        if (saved) void load()
                      }}
                    />
                  ) : (
                    <ContactCard key={c.id} c={c} admin={admin} onSave={() => void saveToPhone([c], `${contactDisplayName(c)}.vcf`)} onEdit={() => setEditing(c)} onDelete={() => void remove(c)} />
                  )
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        (() => {
          const sel = selectedInsurer ? groups.find((g) => g.insurer === selectedInsurer) : undefined
          if (!sel) {
            /* 1단계: 보험사 선택 — 탭(생명/손해)의 회사 버튼 그리드 */
            return (
              <div className="grid grid-cols-2 gap-2">
                {groups.map((g) => (
                  <button
                    key={g.insurer}
                    type="button"
                    onClick={() => setSelectedInsurer(g.insurer)}
                    className="rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition active:bg-slate-50"
                  >
                    <div className="text-sm font-black text-slate-100">{g.insurer}</div>
                    <div className="mt-0.5 text-[11px] text-slate-500">매니저 {g.list.length}명 →</div>
                  </button>
                ))}
              </div>
            )
          }
          /* 2단계: 선택한 회사의 매니저 — 직급 높은 순 */
          return (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedInsurer(null)}
                  className="rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-[12px] font-bold text-slate-500 active:bg-slate-50"
                >
                  ← 보험사 목록
                </button>
                <span className="text-sm font-black text-slate-100">{sel.insurer}</span>
                <span className="rounded-full bg-slate-50 px-1.5 py-0.5 text-[10px] font-bold text-slate-500">{sel.list.length}명</span>
                <button
                  type="button"
                  onClick={() => void saveToPhone(sel.list, `${sel.insurer}-managers.vcf`)}
                  className="ml-auto rounded-xl border px-2.5 py-1.5 text-[11px] font-bold active:opacity-90"
                  style={{ borderColor: '#c6982f', color: '#a07a1f', backgroundColor: '#fdf9ef' }}
                >
                  {sel.insurer} 전체 저장
                </button>
              </div>
              {sel.list.map((c) =>
                editing?.id === c.id ? (
                  <ContactForm
                    key={c.id}
                    initial={c}
                    onDone={(saved) => {
                      setEditing(null)
                      if (saved) void load()
                    }}
                  />
                ) : (
                  <ContactCard key={c.id} c={c} admin={admin} onSave={() => void saveToPhone([c], `${contactDisplayName(c)}.vcf`)} onEdit={() => setEditing(c)} onDelete={() => void remove(c)} />
                )
              )}
            </div>
          )
        })()
      )}
    </div>
  )
}

const telHref = (phone: string): string => `tel:${phone.replace(/[^+\d]/g, '')}`
const smsHref = (phone: string): string => `sms:${phone.replace(/[^+\d]/g, '')}`

function ContactCard({ c, admin, onSave, onEdit, onDelete }: { c: CompanyContact; admin: boolean; onSave: () => void; onEdit: () => void; onDelete: () => void }): JSX.Element {
  const stale = isStaleOnPhone(c)
  const savedBefore = Boolean(getSavedAt(c.id))
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-1 flex items-center gap-1.5">
        <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold" style={{ backgroundColor: '#0e1e3a', borderColor: '#c6982f', color: '#e6c877' }}>{c.insurer}</span>
        {stale ? <span className="rounded-full bg-amber-500 px-2 py-0.5 text-[10px] font-bold text-white">번호 변경됨 · 다시 저장</span> : null}
        {admin ? (
          <span className="ml-auto flex items-center gap-1">
            <button type="button" onClick={onEdit} className="rounded-lg border border-slate-200 p-1.5 text-slate-500 active:bg-slate-50" aria-label="수정"><Pencil className="h-3.5 w-3.5" /></button>
            <button type="button" onClick={onDelete} className="rounded-lg border border-rose-200 p-1.5 text-rose-500 active:bg-rose-50" aria-label="삭제"><Trash2 className="h-3.5 w-3.5" /></button>
          </span>
        ) : null}
      </div>
      <div className="text-sm font-bold text-slate-100">{c.managerName} <span className="font-medium text-slate-400">{c.title}</span></div>
      <div className="mt-0.5 text-[13px] font-medium text-slate-300">
        {c.phone}
        {c.officePhone ? <span className="text-slate-400"> · {c.officePhone}</span> : null}
      </div>
      {c.email ? <div className="mt-0.5 text-[11px] text-slate-500">{c.email}</div> : null}
      {c.memo ? <div className="mt-0.5 line-clamp-2 text-[11px] text-slate-500">{c.memo}</div> : null}
      <div className="mt-3 flex gap-1.5">
        <a href={telHref(c.phone)} className="flex flex-1 items-center justify-center gap-1 rounded-xl border border-emerald-200 bg-emerald-50 py-2 text-[12px] font-bold text-emerald-700 active:bg-[#d1fae5]">
          <Phone className="h-3.5 w-3.5" /> 통화
        </a>
        <a href={smsHref(c.phone)} className="flex flex-1 items-center justify-center gap-1 rounded-xl border border-indigo-200 bg-indigo-50 py-2 text-[12px] font-bold text-indigo-600 active:bg-[#e0e7ff]">
          <MessageSquare className="h-3.5 w-3.5" /> 문자
        </a>
        <button
          type="button"
          onClick={onSave}
          className={['flex flex-1 items-center justify-center gap-1 rounded-xl py-2 text-[12px] font-bold active:opacity-90', stale ? '' : 'border'].join(' ')}
          style={stale ? { backgroundColor: '#c6982f', color: '#fff' } : { borderColor: '#c6982f', color: '#a07a1f', backgroundColor: '#fdf9ef' }}
        >
          <UserPlus className="h-3.5 w-3.5" /> {stale ? '다시 저장' : savedBefore ? '저장됨 · 재저장' : '내 폰에 저장'}
        </button>
      </div>
    </div>
  )
}

const EMPTY_DRAFT: CompanyContactDraft = { insurer: '', managerName: '', title: '매니저', phone: '' }

/** 관리자용 등록/수정 폼 — 보험사는 칩 선택(기타는 직접 입력). */
function ContactForm({ initial, onDone }: { initial?: CompanyContact; onDone: (saved: boolean) => void }): JSX.Element {
  const knownInsurer = initial ? (INSURERS as readonly string[]).includes(initial.insurer) : true
  const [draft, setDraft] = useState<CompanyContactDraft>(
    initial
      ? { insurer: initial.insurer, managerName: initial.managerName, title: initial.title, phone: initial.phone, officePhone: initial.officePhone, email: initial.email, memo: initial.memo }
      : EMPTY_DRAFT
  )
  const [customInsurer, setCustomInsurer] = useState(initial && !knownInsurer ? initial.insurer : '')
  const [useCustom, setUseCustom] = useState(initial ? !knownInsurer : false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | undefined>()

  const set = (patch: Partial<CompanyContactDraft>): void => setDraft((d) => ({ ...d, ...patch }))

  const submit = async (): Promise<void> => {
    if (submitting) return
    setSubmitting(true)
    setError(undefined)
    const insurer = useCustom ? customInsurer : draft.insurer
    const res = await saveCompanyContact({ ...draft, insurer }, initial?.id)
    setSubmitting(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    onDone(true)
  }

  const input = 'w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-100 placeholder:text-slate-400 focus:border-indigo-300 focus:outline-none'

  return (
    <div className="space-y-2.5 rounded-2xl border border-indigo-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="text-sm font-bold text-slate-100">{initial ? '매니저 수정' : '매니저 등록'}</div>
        <button type="button" onClick={() => onDone(false)} className="rounded-lg p-1 text-slate-400 active:bg-slate-50" aria-label="닫기"><X className="h-4 w-4" /></button>
      </div>

      <div>
        <div className="mb-1 text-[11px] font-semibold text-slate-500">보험사</div>
        <div className="flex flex-wrap gap-1.5">
          {INSURERS.map((name) => {
            const active = !useCustom && draft.insurer === name && name !== '기타'
            const isEtc = name === '기타'
            const etcActive = isEtc && useCustom
            return (
              <button
                key={name}
                type="button"
                onClick={() => {
                  if (isEtc) {
                    setUseCustom(true)
                    set({ insurer: '' })
                  } else {
                    setUseCustom(false)
                    set({ insurer: name })
                  }
                }}
                className={['rounded-full border px-2.5 py-1 text-[11px] font-semibold transition', active || etcActive ? 'border-indigo-400 bg-indigo-50 text-indigo-600' : 'border-slate-200 bg-white text-slate-500'].join(' ')}
              >
                {name}
              </button>
            )
          })}
        </div>
        {useCustom ? <input value={customInsurer} onChange={(e) => setCustomInsurer(e.target.value)} placeholder="보험사명 직접 입력" className={`${input} mt-1.5`} /> : null}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <input value={draft.managerName} onChange={(e) => set({ managerName: e.target.value })} placeholder="매니저 이름 *" className={input} />
        <input value={draft.title} onChange={(e) => set({ title: e.target.value })} placeholder="직함 (기본: 매니저)" className={input} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <input value={draft.phone} onChange={(e) => set({ phone: e.target.value })} placeholder="휴대폰 *" inputMode="tel" className={input} />
        <input value={draft.officePhone ?? ''} onChange={(e) => set({ officePhone: e.target.value })} placeholder="유선 (선택)" inputMode="tel" className={input} />
      </div>
      <input value={draft.email ?? ''} onChange={(e) => set({ email: e.target.value })} placeholder="이메일 (선택)" inputMode="email" className={input} />
      <input value={draft.memo ?? ''} onChange={(e) => set({ memo: e.target.value })} placeholder="메모 (선택 — 담당 지역, 처리 잘하는 업무 등)" className={input} />

      {error ? <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] text-rose-600">{error}</div> : null}

      <div className="flex gap-2">
        <button type="button" onClick={() => onDone(false)} className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm font-semibold text-slate-500 active:bg-slate-50">취소</button>
        <button type="button" onClick={() => void submit()} disabled={submitting} className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 py-2.5 text-sm font-bold text-white active:opacity-90 disabled:opacity-50">
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null} {initial ? '수정 저장' : '등록'}
        </button>
      </div>
    </div>
  )
}
