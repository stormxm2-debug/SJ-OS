import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import {
  Users,
  Plus,
  Search,
  RefreshCw,
  Loader2,
  AlertTriangle,
  Save,
  X,
  UserRound,
  MapPin,
  FileText,
  Image as ImageIcon,
  Paperclip,
  HeartPulse,
  UsersRound,
  Trash2,
  Pencil
} from 'lucide-react'
import type { CustomerAttachment, CustomerRecord } from '@shared/commercial/models'
import {
  createCustomer,
  listCustomers,
  updateCustomer
} from '@renderer/services/commercial/customerService'
import { deleteCustomerRecord } from '@renderer/services/commercial/recordDeleteService'
import {
  bmiOf,
  CUSTOMER_SOURCES,
  normalizeRrn,
  parseRrn,
  RELATION_OPTIONS,
  validateCustomerInput,
  type CustomerInput
} from '@renderer/services/commercial/customerValidation'
import {
  attachmentKindOf,
  deleteCustomerFile,
  MAX_CUSTOMER_ATTACHMENTS,
  signedUrlsFor,
  uploadCustomerFile
} from '@renderer/services/commercial/customerFilesStorage'
import { createRegistration, INSURERS } from '@renderer/services/commercial/registrationService'
import { useRealtimeSync } from '@renderer/services/commercial/useRealtimeSync'
import { Send, ShieldCheck } from 'lucide-react'

/**
 * 고객관리 v2 — 승인 시안 반영.
 *
 *  - 생년월일·태그·상태 입력 없음. 주민번호에서 나이·성별·생년월일 자동 계산.
 *  - 유입경로 칩 4종(지인/돌방/소개/DB), 병력, 키/몸무게(BMI 자동), 주소.
 *  - 첨부: 사진+PDF 고객당 최대 5개 (비공개 버킷 + 서명 URL 표시).
 *  - 가족 추가: 가족도 각각 정식 고객으로 저장하되 household로 묶어 카드에 표시.
 *    가족 주소를 비우면 세대주 주소를 자동 상속.
 * RLS(본인 고객)가 실제 접근 경계. 주민번호·병력 등 PII는 로깅하지 않는다.
 */

const RT_TABLES = ['customers']

interface FamilyDraft {
  relation: string
  name: string
  rrn: string
  phone: string
  address: string
}

interface FormState {
  editingId: string | null
  /** 가족 추가 대상 세대(기존 고객의 가족으로 등록할 때). */
  joinHouseholdId?: string
  name: string
  phone: string
  rrn: string
  source: string
  address: string
  heightCm: string
  weightKg: string
  medicalHistory: string
  attachments: CustomerAttachment[]
  relation: string
  family: FamilyDraft[]
}

function emptyForm(): FormState {
  return {
    editingId: null,
    joinHouseholdId: undefined,
    name: '',
    phone: '',
    rrn: '',
    source: '지인',
    address: '',
    heightCm: '',
    weightKg: '',
    medicalHistory: '',
    attachments: [],
    relation: '본인',
    family: []
  }
}

function numOr(v: string): number | undefined {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : undefined
}

export default function SupabaseCustomerManager(): JSX.Element {
  const [customers, setCustomers] = useState<CustomerRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | undefined>()
  const [query, setQuery] = useState('')

  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [formErrors, setFormErrors] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const [attachUrls, setAttachUrls] = useState<Map<string, string>>(new Map())

  // 고객등록(보험사) 요청 — 수정 화면에서 사용
  const [regPick, setRegPick] = useState<string[]>([])
  const [regBusy, setRegBusy] = useState(false)
  const [regMsg, setRegMsg] = useState<{ ok: boolean; text: string } | undefined>()

  const load = async (): Promise<void> => {
    const res = await listCustomers()
    setCustomers(res.customers)
    setError(res.ok ? undefined : res.error)
    setLoading(false)
  }

  const removeCustomer = async (c: CustomerRecord): Promise<void> => {
    const msg = `${c.name} 고객을 완전히 삭제할까요?\n\n⚠️ 이 고객의 상담기록·고객등록 요청·청구 분석도 함께 삭제되고, 일정의 고객 연결이 해제됩니다. 되돌릴 수 없습니다.`
    if (typeof window !== 'undefined' && !window.confirm(msg)) return
    const res = await deleteCustomerRecord(c.id)
    if (!res.ok) {
      setError(res.error)
      return
    }
    await load()
  }
  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useRealtimeSync(RT_TABLES, load)

  // 편집 중 고객의 첨부 미리보기 URL
  useEffect(() => {
    if (form.attachments.length === 0) {
      setAttachUrls(new Map())
      return
    }
    let active = true
    void signedUrlsFor(form.attachments).then((m) => {
      if (active) setAttachUrls(m)
    })
    return () => {
      active = false
    }
  }, [form.attachments])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return customers
    return customers.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.phone ?? '').includes(q) ||
        (c.address ?? '').toLowerCase().includes(q)
    )
  }, [customers, query])

  /** 세대 단위 그룹: 세대주(또는 미배정) → 가족 구성원. */
  const households = useMemo(() => {
    const byId = new Map(visible.map((c) => [c.id, c]))
    const groups: { head: CustomerRecord; members: CustomerRecord[] }[] = []
    const memberIds = new Set<string>()
    for (const c of visible) {
      const isHead = !c.householdId || c.householdId === c.id
      if (!isHead && c.householdId && byId.has(c.householdId)) memberIds.add(c.id)
    }
    for (const c of visible) {
      if (memberIds.has(c.id)) continue
      const members = visible.filter((m) => m.id !== c.id && m.householdId === (c.householdId ?? c.id) && memberIds.has(m.id))
      groups.push({ head: c, members })
    }
    return groups
  }, [visible])

  const openCreate = (): void => {
    setForm(emptyForm())
    setFormErrors([])
    setShowForm(true)
  }

  const openEdit = (c: CustomerRecord): void => {
    setForm({
      editingId: c.id,
      joinHouseholdId: undefined,
      name: c.name,
      phone: c.phone ?? '',
      rrn: c.rrn ?? '',
      source: c.source ?? '지인',
      address: c.address ?? '',
      heightCm: c.heightCm ? String(c.heightCm) : '',
      weightKg: c.weightKg ? String(c.weightKg) : '',
      medicalHistory: c.medicalHistory ?? '',
      attachments: c.attachments ?? [],
      relation: c.relation ?? '본인',
      family: []
    })
    setFormErrors([])
    setRegPick([])
    setRegMsg(undefined)
    setShowForm(true)
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const submitRegistration = async (): Promise<void> => {
    if (!form.editingId || regPick.length === 0) return
    setRegBusy(true)
    setRegMsg(undefined)
    const res = await createRegistration(form.editingId, regPick)
    setRegBusy(false)
    if (res.ok) {
      setRegMsg({ ok: true, text: `${regPick.length}개 보험사 고객등록을 요청했습니다 — 관리자에게 알림이 전송됐어요.` })
      setRegPick([])
    } else {
      setRegMsg({ ok: false, text: res.error ?? '요청에 실패했습니다.' })
    }
  }

  const openAddFamily = (head: CustomerRecord): void => {
    setForm({
      ...emptyForm(),
      joinHouseholdId: head.householdId ?? head.id,
      relation: '배우자',
      address: '', // 비우면 저장 시 세대주 주소 상속
      source: head.source ?? '지인'
    })
    setFormErrors([])
    setShowForm(true)
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const onPickFiles = async (e: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
    if (files.length === 0) return
    if (form.attachments.length + files.length > MAX_CUSTOMER_ATTACHMENTS) {
      setFormErrors([`첨부는 고객당 최대 ${MAX_CUSTOMER_ATTACHMENTS}개입니다.`])
      return
    }
    setUploading(true)
    setFormErrors([])
    for (const f of files) {
      if (!attachmentKindOf(f)) {
        setFormErrors((prev) => [...prev, `${f.name}: 사진/PDF만 가능합니다.`])
        continue
      }
      const res = await uploadCustomerFile(f)
      if (res.ok) {
        setForm((prev) => ({ ...prev, attachments: [...prev.attachments, res.attachment] }))
      } else {
        setFormErrors((prev) => [...prev, `${f.name}: ${res.error}`])
      }
    }
    setUploading(false)
  }

  const removeAttachment = (att: CustomerAttachment): void => {
    setForm((prev) => ({ ...prev, attachments: prev.attachments.filter((a) => a.path !== att.path) }))
    void deleteCustomerFile(att.path)
  }

  const buildInput = (over?: Partial<CustomerInput>): CustomerInput => ({
    name: form.name,
    phone: form.phone,
    address: form.address,
    source: form.source,
    status: 'new',
    tags: [],
    rrn: form.rrn ? normalizeRrn(form.rrn) : undefined,
    medicalHistory: form.medicalHistory,
    heightCm: numOr(form.heightCm),
    weightKg: numOr(form.weightKg),
    attachments: form.attachments,
    relation: form.relation,
    ...over
  })

  const submit = async (): Promise<void> => {
    const input = buildInput()
    const v = validateCustomerInput(input)
    const famErrors: string[] = []
    form.family.forEach((f, i) => {
      if (!f.name.trim()) famErrors.push(`가족 ${i + 1}: 이름을 입력해주세요.`)
      if (f.rrn.trim() && !parseRrn(f.rrn)) famErrors.push(`가족 ${i + 1}: 주민번호를 확인해주세요.`)
    })
    setFormErrors([...v.errors, ...famErrors])
    if (!v.ok || famErrors.length > 0) return
    setSaving(true)

    if (form.editingId) {
      const res = await updateCustomer(form.editingId, input)
      setSaving(false)
      if (!res.ok) {
        setFormErrors([res.error ?? '저장에 실패했습니다.'])
        return
      }
    } else if (form.joinHouseholdId) {
      // 기존 세대에 가족으로 등록 — 주소 비우면 세대주 주소 상속
      const head = customers.find((c) => c.id === form.joinHouseholdId || (c.householdId === form.joinHouseholdId && c.relation === '본인'))
      const res = await createCustomer(
        buildInput({
          householdId: form.joinHouseholdId,
          address: form.address.trim() || head?.address || ''
        })
      )
      setSaving(false)
      if (!res.ok) {
        setFormErrors([res.error ?? '저장에 실패했습니다.'])
        return
      }
    } else {
      // 세대주 생성 → household 지정 → 가족들 생성 (주소 미입력 시 세대주 주소)
      const headRes = await createCustomer(buildInput({ relation: '본인' }))
      if (!headRes.ok || !headRes.customer) {
        setSaving(false)
        setFormErrors([headRes.error ?? '저장에 실패했습니다.'])
        return
      }
      const headId = headRes.customer.id
      await updateCustomer(headId, { householdId: headId })
      for (const fam of form.family) {
        await createCustomer({
          name: fam.name,
          phone: fam.phone,
          address: fam.address.trim() || form.address.trim(),
          source: form.source,
          status: 'new',
          tags: [],
          rrn: fam.rrn ? normalizeRrn(fam.rrn) : undefined,
          householdId: headId,
          relation: fam.relation,
          attachments: []
        })
      }
      setSaving(false)
    }

    setShowForm(false)
    setForm(emptyForm())
    void load()
  }

  const rrnInfo = parseRrn(form.rrn)
  const bmi = bmiOf(numOr(form.heightCm), numOr(form.weightKg))

  return (
    <div className="space-y-4">
      {/* 헤더 */}
      <div className="rounded-2xl border border-slate-800 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-indigo-600" />
            <h2 className="text-base font-bold text-slate-100">고객관리</h2>
            <span className="text-sm font-semibold text-slate-400">{customers.length}명</span>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => void load()}
              aria-label="새로고침"
              className="rounded-lg border border-slate-800 bg-white p-2 text-slate-400 transition hover:text-slate-200"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => (showForm ? setShowForm(false) : openCreate())}
              className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 px-3 py-2 text-xs font-bold text-white shadow-sm transition hover:brightness-110"
            >
              {showForm ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />} {showForm ? '닫기' : '고객 등록'}
            </button>
          </div>
        </div>
        {error ? (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-700">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}
          </div>
        ) : null}
        <div className="mt-3 flex items-center gap-2 rounded-xl border border-slate-800 bg-white px-3">
          <Search className="h-4 w-4 shrink-0 text-slate-500" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="이름 · 연락처 · 주소 검색"
            className="w-full py-2.5 text-sm text-slate-100 focus:outline-none"
          />
        </div>
      </div>

      {/* 등록/수정 폼 */}
      {showForm ? (
        <div className="rounded-2xl border border-indigo-200 bg-white p-4 shadow-sm">
          <div className="mb-3 text-sm font-bold text-slate-100">
            {form.editingId ? '고객 정보 수정' : form.joinHouseholdId ? '가족 등록 (기존 세대)' : '새 고객 등록'}
          </div>

          <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="이름 *">
              <input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className="w-full rounded-xl border border-slate-800 bg-white px-3 py-2.5 text-sm text-slate-100 focus:outline-none"
              />
            </Field>
            <Field label="연락처">
              <input
                value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                inputMode="tel"
                placeholder="010-0000-0000"
                className="w-full rounded-xl border border-slate-800 bg-white px-3 py-2.5 text-sm text-slate-100 focus:outline-none"
              />
            </Field>
          </div>

          <div className="mb-3">
            <Field label="주민등록번호">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  value={form.rrn}
                  onChange={(e) => setForm((f) => ({ ...f, rrn: e.target.value }))}
                  onBlur={() => setForm((f) => ({ ...f, rrn: normalizeRrn(f.rrn) }))}
                  inputMode="numeric"
                  placeholder="000000-0000000"
                  className="w-56 rounded-xl border border-slate-800 bg-white px-3 py-2.5 text-sm tracking-wider text-slate-100 focus:outline-none"
                />
                {rrnInfo ? (
                  <span className="rounded-full bg-emerald-50 px-3 py-1.5 text-[11px] font-semibold text-emerald-700">
                    만 {rrnInfo.age}세 · {rrnInfo.gender} · {rrnInfo.birthDate.replace(/-/g, '.')} 자동계산
                  </span>
                ) : form.rrn.trim() ? (
                  <span className="text-[11px] text-slate-500">13자리 입력 시 나이·성별 자동 계산</span>
                ) : null}
              </div>
            </Field>
          </div>

          <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={form.joinHouseholdId || form.editingId ? '유입경로 / 관계' : '유입경로 (택1)'}>
              <div className="flex flex-wrap items-center gap-1.5">
                {CUSTOMER_SOURCES.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, source: s }))}
                    className={[
                      'rounded-full px-3.5 py-1.5 text-[12px] font-semibold transition',
                      form.source === s ? 'bg-indigo-50 text-indigo-700 ring-2 ring-indigo-400' : 'border border-slate-800 bg-white text-slate-400 hover:text-slate-200'
                    ].join(' ')}
                  >
                    {s}
                  </button>
                ))}
                {form.joinHouseholdId || (form.editingId && form.relation !== '본인') ? (
                  <select
                    value={form.relation}
                    onChange={(e) => setForm((f) => ({ ...f, relation: e.target.value }))}
                    className="rounded-lg border border-slate-800 bg-white px-2 py-1.5 text-[12px] text-slate-200 focus:outline-none"
                  >
                    {RELATION_OPTIONS.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                ) : null}
              </div>
            </Field>
            <Field label="키 · 몸무게">
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1 rounded-xl border border-slate-800 bg-white px-3">
                  <input
                    value={form.heightCm}
                    onChange={(e) => setForm((f) => ({ ...f, heightCm: e.target.value.replace(/[^0-9.]/g, '') }))}
                    inputMode="decimal"
                    placeholder="176"
                    className="w-14 py-2.5 text-right text-sm tabular-nums text-slate-100 focus:outline-none"
                  />
                  <span className="text-[11px] text-slate-500">cm</span>
                </div>
                <div className="flex items-center gap-1 rounded-xl border border-slate-800 bg-white px-3">
                  <input
                    value={form.weightKg}
                    onChange={(e) => setForm((f) => ({ ...f, weightKg: e.target.value.replace(/[^0-9.]/g, '') }))}
                    inputMode="decimal"
                    placeholder="74"
                    className="w-14 py-2.5 text-right text-sm tabular-nums text-slate-100 focus:outline-none"
                  />
                  <span className="text-[11px] text-slate-500">kg</span>
                </div>
                {bmi ? <span className="rounded-full bg-slate-950 px-2.5 py-1 text-[11px] font-semibold text-slate-300">BMI {bmi}</span> : null}
              </div>
            </Field>
          </div>

          <div className="mb-3">
            <Field label={form.joinHouseholdId ? '주소 (비우면 세대주 주소 자동)' : '주소'}>
              <div className="flex items-center gap-2 rounded-xl border border-slate-800 bg-white px-3">
                <MapPin className="h-4 w-4 shrink-0 text-slate-500" />
                <input
                  value={form.address}
                  onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
                  placeholder="서울 강남구 테헤란로 152, 101동 1001호"
                  className="w-full py-2.5 text-sm text-slate-100 focus:outline-none"
                />
              </div>
            </Field>
          </div>

          <div className="mb-3">
            <Field label="병력 (보험 심사 참고)">
              <textarea
                value={form.medicalHistory}
                onChange={(e) => setForm((f) => ({ ...f, medicalHistory: e.target.value }))}
                placeholder="예: 2023 고혈압 약 복용 중 · 2021 맹장 수술 · 흡연 X"
                className="h-20 w-full rounded-xl border border-slate-800 bg-white px-3 py-2 text-[13px] leading-6 text-slate-100 focus:outline-none"
              />
            </Field>
          </div>

          {/* 첨부 */}
          <div className="mb-3">
            <Field label={`사진 / 서류 첨부 (${form.attachments.length}/${MAX_CUSTOMER_ATTACHMENTS})`}>
              <div className="flex flex-wrap items-center gap-2">
                {form.attachments.map((a) => {
                  const url = attachUrls.get(a.path)
                  return (
                    <span key={a.path} className="group relative">
                      {a.kind === 'image' && url ? (
                        <img src={url} alt={a.name} className="h-14 w-14 rounded-lg border border-slate-800 object-cover" />
                      ) : (
                        <a
                          href={url}
                          target="_blank"
                          rel="noreferrer"
                          className="flex h-14 w-14 flex-col items-center justify-center rounded-lg border border-slate-800 bg-slate-950 text-slate-400"
                        >
                          {a.kind === 'pdf' ? <FileText className="h-5 w-5" /> : <ImageIcon className="h-5 w-5" />}
                          <span className="mt-0.5 max-w-[52px] truncate text-[8px]">{a.name}</span>
                        </a>
                      )}
                      <button
                        type="button"
                        onClick={() => removeAttachment(a)}
                        aria-label="첨부 삭제"
                        className="absolute -right-1.5 -top-1.5 rounded-full bg-rose-500 p-0.5 text-white shadow"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  )
                })}
                {form.attachments.length < MAX_CUSTOMER_ATTACHMENTS ? (
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    disabled={uploading}
                    className="flex h-14 w-14 items-center justify-center rounded-lg border border-dashed border-slate-700 text-slate-500 transition hover:border-indigo-400 hover:text-indigo-600 disabled:opacity-50"
                  >
                    {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  </button>
                ) : null}
                <span className="text-[11px] text-slate-500">증권·신분증·검진결과 등 (사진/PDF, 폰 카메라 촬영 가능)</span>
              </div>
              <input ref={fileRef} type="file" accept="image/*,application/pdf" multiple onChange={(e) => void onPickFiles(e)} className="hidden" />
            </Field>
          </div>

          {/* 고객등록 (보험사) — 저장된 고객에서만, 추후 추가 요청도 여기서 */}
          {form.editingId ? (
            <div className="mb-3 rounded-xl border border-slate-800 bg-slate-950 p-3">
              <div className="mb-1.5 flex items-center gap-1.5 text-[12px] font-semibold text-slate-300">
                <ShieldCheck className="h-4 w-4 text-indigo-600" /> 고객등록 — 등록할 보험사 체크
              </div>
              <div className="mb-2 flex flex-wrap gap-1.5">
                {INSURERS.map((ins) => {
                  const done = (customers.find((c) => c.id === form.editingId)?.registeredInsurers ?? []).includes(ins)
                  const picked = regPick.includes(ins)
                  return (
                    <button
                      key={ins}
                      type="button"
                      disabled={done}
                      onClick={() => setRegPick((prev) => (picked ? prev.filter((x) => x !== ins) : [...prev, ins]))}
                      className={[
                        'rounded-full px-3 py-1.5 text-[11px] font-semibold transition',
                        done
                          ? 'cursor-default bg-emerald-50 text-emerald-600'
                          : picked
                            ? 'bg-indigo-50 text-indigo-700 ring-2 ring-indigo-400'
                            : 'border border-slate-800 bg-white text-slate-400 hover:text-slate-200'
                      ].join(' ')}
                    >
                      {done ? `${ins} ✓` : ins}
                    </button>
                  )
                })}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void submitRegistration()}
                  disabled={regBusy || regPick.length === 0}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-indigo-600 to-violet-600 px-3.5 py-2 text-[12px] font-bold text-white shadow-sm transition hover:brightness-110 disabled:opacity-50"
                >
                  {regBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                  고객등록 요청{regPick.length > 0 ? ` (${regPick.length}개사)` : ''}
                </button>
                <span className="text-[11px] text-slate-500">관리자가 처리하면 알림으로 알려드립니다 · ✓ = 이미 등록됨</span>
              </div>
              {regMsg ? (
                <p className={['mt-1.5 text-[11px]', regMsg.ok ? 'text-emerald-600' : 'text-rose-600'].join(' ')}>{regMsg.text}</p>
              ) : null}
            </div>
          ) : null}

          {/* 가족 추가 (신규 세대 등록 시) */}
          {!form.editingId && !form.joinHouseholdId ? (
            <div className="mb-3 rounded-xl border border-slate-800 bg-slate-950 p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-300">
                  <UsersRound className="h-4 w-4 text-indigo-600" /> 가족 {form.family.length}명
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setForm((f) => ({ ...f, family: [...f.family, { relation: '배우자', name: '', rrn: '', phone: '', address: '' }] }))
                  }
                  className="inline-flex items-center gap-1 rounded-full border border-indigo-300 bg-white px-3 py-1.5 text-[11px] font-bold text-indigo-600 transition hover:bg-indigo-50"
                >
                  <Plus className="h-3 w-3" /> 가족 추가
                </button>
              </div>
              {form.family.length === 0 ? (
                <p className="text-[11px] text-slate-500">가족을 추가하면 각각 고객으로 저장되고, 카드에서 가족으로 묶여 보입니다. 주소를 비우면 위 주소를 따라갑니다.</p>
              ) : (
                <div className="space-y-2">
                  {form.family.map((fam, i) => (
                    <div key={i} className="grid grid-cols-1 gap-1.5 rounded-lg border border-slate-800 bg-white p-2 sm:grid-cols-[90px_1fr_1fr_1fr_auto]">
                      <select
                        value={fam.relation}
                        onChange={(e) => setForm((f) => ({ ...f, family: f.family.map((x, j) => (j === i ? { ...x, relation: e.target.value } : x)) }))}
                        className="rounded-lg border border-slate-800 bg-white px-1.5 py-1.5 text-[12px] text-slate-200 focus:outline-none"
                      >
                        {RELATION_OPTIONS.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                      <input
                        value={fam.name}
                        onChange={(e) => setForm((f) => ({ ...f, family: f.family.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) }))}
                        placeholder="이름 *"
                        className="rounded-lg border border-slate-800 bg-white px-2 py-1.5 text-[12px] text-slate-100 focus:outline-none"
                      />
                      <input
                        value={fam.rrn}
                        onChange={(e) => setForm((f) => ({ ...f, family: f.family.map((x, j) => (j === i ? { ...x, rrn: e.target.value } : x)) }))}
                        inputMode="numeric"
                        placeholder="주민번호 (선택)"
                        className="rounded-lg border border-slate-800 bg-white px-2 py-1.5 text-[12px] tracking-wider text-slate-100 focus:outline-none"
                      />
                      <input
                        value={fam.address}
                        onChange={(e) => setForm((f) => ({ ...f, family: f.family.map((x, j) => (j === i ? { ...x, address: e.target.value } : x)) }))}
                        placeholder="주소 (비우면 위 주소)"
                        className="rounded-lg border border-slate-800 bg-white px-2 py-1.5 text-[12px] text-slate-100 focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => setForm((f) => ({ ...f, family: f.family.filter((_, j) => j !== i) }))}
                        aria-label="가족 삭제"
                        className="rounded-lg p-1.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : null}

          {formErrors.length > 0 ? (
            <ul className="mb-2 space-y-0.5 text-[12px] text-rose-600">
              {formErrors.map((e) => (
                <li key={e}>• {e}</li>
              ))}
            </ul>
          ) : null}
          <button
            type="button"
            onClick={() => void submit()}
            disabled={saving || uploading}
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-5 py-2.5 text-sm font-bold text-white shadow-sm transition hover:brightness-110 disabled:opacity-60"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {form.editingId ? '수정 저장' : form.family.length > 0 ? `본인 + 가족 ${form.family.length}명 등록` : '고객 등록'}
          </button>
        </div>
      ) : null}

      {/* 고객 카드 (세대 묶음) */}
      <div className="rounded-2xl border border-slate-800 bg-white p-4 shadow-sm">
        {loading ? (
          <div className="flex items-center gap-2 py-8 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" /> 고객을 불러오는 중…
          </div>
        ) : households.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-700 py-8 text-center text-[12px] text-slate-500">
            {query ? '검색 결과가 없습니다.' : '등록된 고객이 없습니다. 첫 고객을 등록해보세요.'}
          </div>
        ) : (
          <div className="space-y-2.5">
            {households.map(({ head, members }) => {
              const info = parseRrn(head.rrn)
              const bmiVal = bmiOf(head.heightCm, head.weightKg)
              return (
                <div key={head.id} className="rounded-xl border border-slate-800 bg-white p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <button type="button" onClick={() => openEdit(head)} className="flex items-center gap-1.5 text-left">
                      <UserRound className="h-4 w-4 text-slate-500" />
                      <span className="text-sm font-bold text-slate-100 hover:text-indigo-700">{head.name}</span>
                    </button>
                    {info ? (
                      <span className="text-[11px] text-slate-500">
                        만 {info.age}세 · {info.gender}
                        {bmiVal ? ` · BMI ${bmiVal}` : ''}
                      </span>
                    ) : bmiVal ? (
                      <span className="text-[11px] text-slate-500">BMI {bmiVal}</span>
                    ) : null}
                    {head.source ? (
                      <span className="rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-bold text-violet-700">{head.source}</span>
                    ) : null}
                    <span className="ml-auto flex items-center gap-1.5">
                      {members.length > 0 ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-400">
                          <UsersRound className="h-3.5 w-3.5" /> 가족 {members.length + 1}명
                        </span>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => openAddFamily(head)}
                        className="rounded-full border border-indigo-200 bg-white px-2.5 py-1 text-[10px] font-bold text-indigo-600 transition hover:bg-indigo-50"
                      >
                        + 가족
                      </button>
                      <button
                        type="button"
                        onClick={() => openEdit(head)}
                        aria-label="수정"
                        className="rounded-lg border border-slate-800 bg-white p-1.5 text-slate-400 transition hover:border-indigo-300 hover:text-indigo-600"
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void removeCustomer(head)}
                        aria-label="고객 삭제"
                        className="rounded-lg border border-slate-800 bg-white p-1.5 text-slate-400 transition hover:border-rose-300 hover:text-rose-600"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </span>
                  </div>
                  {members.length > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {members.map((m) => (
                        <span key={m.id} className="inline-flex items-center overflow-hidden rounded-full bg-slate-950">
                          <button
                            type="button"
                            onClick={() => openEdit(m)}
                            className="px-2.5 py-1 text-[11px] font-medium text-slate-300 transition hover:bg-indigo-50 hover:text-indigo-700"
                          >
                            {m.name} ({m.relation ?? '가족'})
                          </button>
                          <button
                            type="button"
                            onClick={() => void removeCustomer(m)}
                            aria-label={`${m.name} 삭제`}
                            className="px-1.5 py-1 text-slate-400 transition hover:text-rose-600"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  ) : null}
                  <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-slate-500">
                    {head.phone ? <span>{head.phone}</span> : null}
                    {head.address ? (
                      <span className="inline-flex items-center gap-0.5">
                        <MapPin className="h-3 w-3" /> {head.address}
                      </span>
                    ) : null}
                    {head.medicalHistory ? (
                      <span className="inline-flex items-center gap-0.5 text-amber-700">
                        <HeartPulse className="h-3 w-3" /> 병력 있음
                      </span>
                    ) : null}
                    {head.attachments.length > 0 ? (
                      <span className="inline-flex items-center gap-0.5">
                        <Paperclip className="h-3 w-3" /> 첨부 {head.attachments.length}
                      </span>
                    ) : null}
                    {head.registeredInsurers.length > 0 ? (
                      <span className="inline-flex items-center gap-0.5 font-semibold text-emerald-600">
                        <ShieldCheck className="h-3 w-3" /> 등록 {head.registeredInsurers.length}개사
                      </span>
                    ) : null}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11px] font-medium text-slate-500">{label}</span>
      {children}
    </label>
  )
}
