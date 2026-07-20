import { useEffect, useState } from 'react'
import { Cake, X, Plus, Trash2, Loader2, Gift } from 'lucide-react'
import { useSession } from '@renderer/navigation/SessionContext'
import {
  listMyFamilyBirthdays,
  createFamilyBirthday,
  deleteFamilyBirthday,
  subscribeFamilyBirthdayGate,
  birthdayInfo,
  FAMILY_RELATIONS,
  type FamilyBirthday,
  type FamilyRelation
} from '@renderer/services/commercial/familyBirthdayService'

/**
 * 직원 복지 · 본인/가족 생일 등록 게이트. 로그인 후 등록분이 하나도 없으면 자동으로
 * 한 번 뜨고(이번 세션 '다음에'로 넘기면 다시 안 뜸), 메뉴에서 언제든 다시 열 수 있다.
 * 회사가 생일을 챙기려면 직원이 알려줘야 하므로, 강제가 아닌 부드러운 안내로 둔다.
 * 🔒 주민번호는 앞자리(생년월일)만 입력받는다.
 */

const SKIP_KEY = 'sj-family-bday-skip-v1'

export default function FamilyBirthdayGate(): JSX.Element | null {
  const { session } = useSession()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<FamilyBirthday[]>([])
  const [loaded, setLoaded] = useState(false)

  const load = async (): Promise<FamilyBirthday[]> => {
    const r = await listMyFamilyBirthdays()
    setItems(r.items)
    setLoaded(true)
    return r.items
  }

  // 로그인 시 1회 자동 안내 — 등록분 0건 + 이번 세션에 '다음에' 안 눌렀을 때만.
  useEffect(() => {
    if (!session.isLoggedIn) return
    let alive = true
    void load().then((list) => {
      if (!alive) return
      const skipped = typeof sessionStorage !== 'undefined' && sessionStorage.getItem(SKIP_KEY) === '1'
      if (list.length === 0 && !skipped) setOpen(true)
    })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.isLoggedIn])

  // 메뉴에서 수동으로 열기
  useEffect(() => {
    return subscribeFamilyBirthdayGate(() => {
      void load()
      setOpen(true)
    })
  }, [])

  const later = (): void => {
    try {
      sessionStorage.setItem(SKIP_KEY, '1')
    } catch {
      /* ignore */
    }
    setOpen(false)
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[65] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4">
      <div className="max-h-[88vh] w-full max-w-md overflow-y-auto rounded-t-2xl border border-slate-800 bg-white p-4 shadow-xl sm:rounded-2xl sm:p-5">
        {/* 헤더 */}
        <div className="mb-1 flex items-center justify-between">
          <h3 className="flex items-center gap-1.5 text-sm font-extrabold text-slate-100">
            <Gift className="h-4 w-4 text-[#b0821f]" /> 생일 복지 · 본인/가족 생일 등록
          </h3>
          <button type="button" onClick={later} aria-label="닫기" className="rounded-lg p-1 text-slate-400 hover:text-slate-100">
            <X className="h-5 w-5" />
          </button>
        </div>
        <p className="mb-3 text-[12px] leading-5 text-slate-500">
          회사가 <b className="text-slate-300">본인·가족 생일</b>을 챙겨드립니다. 생년월일만 있으면 되니
          <b className="text-slate-300"> 주민번호 앞자리</b>만 적어주세요. (뒷자리는 받지 않습니다)
        </p>

        {/* 이미 등록한 목록 */}
        {loaded && items.length > 0 ? (
          <div className="mb-3 space-y-1">
            {items.map((it) => {
              const info = birthdayInfo(it.rrnFront)
              return (
                <div key={it.id} className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950 px-2.5 py-1.5 text-[12px]">
                  <span className="text-slate-100">
                    <b>{it.name}</b> <span className="text-slate-500">· {it.relation}</span>
                    {info ? <span className="ml-1.5 text-[#b0821f]">{info.label}</span> : null}
                  </span>
                  <button
                    type="button"
                    onClick={() => void deleteFamilyBirthday(it.id).then(() => void load())}
                    aria-label="삭제"
                    className="text-slate-400 hover:text-rose-600"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              )
            })}
          </div>
        ) : null}

        <AddForm defaultName={items.length === 0 ? session.name : ''} onAdded={() => void load()} />

        <div className="mt-3 flex items-center justify-between">
          <button type="button" onClick={later} className="text-[12px] font-semibold text-slate-500 hover:text-slate-100">
            다음에 하기
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded-lg bg-[#0e1e3a] px-4 py-2 text-[12px] font-extrabold text-[#e6c877] hover:brightness-125"
          >
            완료
          </button>
        </div>
      </div>
    </div>
  )
}

function AddForm({ defaultName, onAdded }: { defaultName: string; onAdded: () => void }): JSX.Element {
  const [name, setName] = useState(defaultName)
  const [relation, setRelation] = useState<FamilyRelation>(defaultName ? '본인' : '배우자')
  const [rrn, setRrn] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const info = birthdayInfo(rrn)

  const add = async (): Promise<void> => {
    setBusy(true)
    setMsg('')
    const r = await createFamilyBirthday({ name, relation, rrnFront: rrn })
    setBusy(false)
    if (!r.ok) {
      setMsg(r.error ?? '저장 실패')
      return
    }
    setName('')
    setRelation('배우자')
    setRrn('')
    onAdded()
  }

  return (
    <div className="rounded-xl border border-[#c6982f]/40 bg-white p-3">
      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="mb-0.5 block text-[10px] font-semibold text-slate-500">이름</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="이름" className="w-full rounded-lg border border-slate-800 bg-slate-950 px-2.5 py-1.5 text-[12px] text-slate-100 outline-none placeholder:text-slate-500 focus:border-[#c6982f]" />
        </label>
        <label className="block">
          <span className="mb-0.5 block text-[10px] font-semibold text-slate-500">관계</span>
          <select value={relation} onChange={(e) => setRelation(e.target.value as FamilyRelation)} className="w-full rounded-lg border border-slate-800 bg-white px-2 py-1.5 text-[12px] text-slate-100">
            {FAMILY_RELATIONS.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </label>
      </div>
      <label className="mt-2 block">
        <span className="mb-0.5 block text-[10px] font-semibold text-slate-500">주민번호 앞자리 (생년월일)</span>
        <input
          value={rrn}
          onChange={(e) => setRrn(e.target.value.replace(/\D/g, '').slice(0, 7))}
          inputMode="numeric"
          placeholder="예: 900101 또는 9001011"
          className="w-full rounded-lg border border-slate-800 bg-slate-950 px-2.5 py-1.5 text-[13px] tracking-widest text-slate-100 outline-none placeholder:tracking-normal placeholder:text-slate-500 focus:border-[#c6982f]"
        />
      </label>
      {info ? (
        <p className="mt-1 text-[11px] text-[#b0821f]">생일: {info.label}{info.age != null ? ` · 만 ${info.age}세` : ''}</p>
      ) : null}
      {msg ? <div className="mt-1 text-[11px] font-medium text-rose-600">{msg}</div> : null}
      <button
        type="button"
        onClick={() => void add()}
        disabled={busy || !name.trim() || (rrn.replace(/\D/g, '').length < 6)}
        className={['mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-[12px] font-extrabold', busy || !name.trim() || rrn.replace(/\D/g, '').length < 6 ? 'cursor-not-allowed bg-slate-200 text-slate-400' : 'bg-gradient-to-r from-[#0e1e3a] to-[#1b3a6b] text-[#e6c877]'].join(' ')}
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} 생일 추가
      </button>
    </div>
  )
}
