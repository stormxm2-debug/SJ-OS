import { useEffect, useMemo, useState } from 'react'
import { Cake, Loader2, Search, Gift, PartyPopper } from 'lucide-react'
import { useRealtimeSync } from '@renderer/services/commercial/useRealtimeSync'
import { listAllFamilyBirthdays, birthdayInfo, type FamilyBirthday } from '@renderer/services/commercial/familyBirthdayService'

/**
 * 관리자 · 직원 본인/가족 생일 모아보기 (route 'family-birthdays', 관리자 전용).
 * 직원이 등록한 본인·가족 생일을 다가오는 순으로 보여준다. 3일 전~당일 알림은
 * NotificationCenter(관리자에게만 토스트)가 담당한다.
 */

const RT = ['staff_family_birthdays', 'birthday_alerts']

interface Row extends FamilyBirthday {
  md: string
  label: string
  daysUntil: number
  age?: number
}

export default function FamilyBirthdayAdminPage(): JSX.Element {
  const [items, setItems] = useState<FamilyBirthday[]>([])
  const [configured, setConfigured] = useState(true)
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')

  const load = async (): Promise<void> => {
    const r = await listAllFamilyBirthdays()
    setItems(r.items)
    setConfigured(r.configured)
    setLoading(false)
  }
  useEffect(() => {
    void load()
  }, [])
  useRealtimeSync(RT, () => void load())

  const rows: Row[] = useMemo(() => {
    const q = query.trim().toLowerCase()
    return items
      .map((it) => {
        const info = birthdayInfo(it.rrnFront)
        return { ...it, md: info?.md ?? '', label: info?.label ?? '?', daysUntil: info?.daysUntil ?? 999, age: info?.age }
      })
      .filter((r) => !q || r.name.toLowerCase().includes(q) || r.staffName.toLowerCase().includes(q))
      .sort((a, b) => a.daysUntil - b.daysUntil)
  }, [items, query])

  const upcoming = rows.filter((r) => r.daysUntil <= 7)

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="rounded-2xl bg-gradient-to-br from-[#0e1e3a] to-[#1b3a6b] p-5 text-white">
        <div className="flex items-center gap-2">
          <Gift className="h-5 w-5 text-[#e6c877]" />
          <h1 className="text-lg font-extrabold">직원 생일 복지</h1>
        </div>
        <p className="mt-1 text-[13px] leading-5 text-white/70">
          직원이 등록한 <b className="text-[#e6c877]">본인·가족 생일</b>입니다. 3일 전부터 관리자에게 알림이 옵니다.
        </p>
        {upcoming.length > 0 ? (
          <div className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-[#c6982f] px-3 py-1 text-[12px] font-bold text-[#201603]">
            <PartyPopper className="h-3.5 w-3.5" /> 이번 주 생일 {upcoming.length}건
          </div>
        ) : null}
      </div>

      <div className="flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-950 px-2.5 py-1.5">
        <Search className="h-3.5 w-3.5 text-slate-500" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="직원/가족 이름 검색" className="w-full bg-transparent text-[12px] text-slate-100 outline-none placeholder:text-slate-500" />
      </div>

      {!configured ? (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-[13px] text-amber-800">생일 복지가 아직 설정되지 않았습니다(테이블 미적용).</div>
      ) : loading ? (
        <div className="flex items-center gap-2 p-6 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" /> 불러오는 중…
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-700 py-10 text-center text-[13px] text-slate-500">
          아직 등록된 생일이 없습니다. 직원들이 로그인 시 본인·가족 생일을 등록하면 여기에 모입니다.
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => {
            const soon = r.daysUntil <= 3
            return (
              <div key={r.id} className="flex items-center gap-3 rounded-xl border border-slate-800 bg-white p-3">
                <span className={['flex h-9 w-9 shrink-0 items-center justify-center rounded-full', soon ? 'bg-[#c6982f] text-[#0e1e3a]' : 'bg-slate-100 text-slate-400'].join(' ')}>
                  <Cake className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-bold text-slate-100">
                    {r.name} <span className="text-[11px] font-medium text-slate-500">· {r.relation}</span>
                  </div>
                  <div className="text-[11px] text-slate-500">
                    직원: {r.staffName || '—'} · {r.label}{r.age != null ? ` · 만 ${r.age}세` : ''}
                  </div>
                </div>
                <span className={['shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold', soon ? 'bg-[#c6982f] text-[#201603]' : r.daysUntil <= 7 ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-500'].join(' ')}>
                  {r.daysUntil === 0 ? '오늘 🎂' : `D-${r.daysUntil}`}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
