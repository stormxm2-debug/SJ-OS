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
  CheckCircle2
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
      ) : (
        <div className="space-y-2">
          {items.map((c) =>
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
