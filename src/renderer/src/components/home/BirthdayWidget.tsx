import { useEffect, useMemo, useState } from 'react'
import { Cake, ChevronRight } from 'lucide-react'
import { useSession } from '@renderer/navigation/SessionContext'
import { useNavigation } from '@renderer/navigation/NavigationContext'
import { listCustomers } from '@renderer/services/commercial/customerService'
import type { CustomerRecord } from '@shared/commercial/models'
import { toBirthdays, upcomingBirthdays } from '@renderer/services/commercial/birthdayService'

/**
 * 홈 "내 하루" — 7일 내 생일 임박 고객(본인 고객만). 임박 생일이 없으면 아예
 * 렌더링하지 않아 홈을 어지럽히지 않는다. 카드를 누르면 생일 챙기기 화면으로.
 */
export default function BirthdayWidget(): JSX.Element | null {
  const { session } = useSession()
  const { navigate } = useNavigation()
  const [customers, setCustomers] = useState<CustomerRecord[]>([])
  const [mode, setMode] = useState<string>('local-mock')

  useEffect(() => {
    let alive = true
    void (async () => {
      const res = await listCustomers()
      if (!alive) return
      setMode(res.mode)
      setCustomers(res.ok ? res.customers : [])
    })()
    return () => {
      alive = false
    }
  }, [session.id])

  const upcoming = useMemo(() => {
    // 홈은 "내 하루" — 관리자도 본인 고객만. (로컬목업은 소유자 개념이 없어 전체)
    const mine = mode !== 'supabase' ? customers : customers.filter((c) => c.ownerStaffId === session.id)
    return upcomingBirthdays(toBirthdays(mine), 7).slice(0, 3)
  }, [customers, mode, session.id])

  if (upcoming.length === 0) return null

  return (
    <button
      type="button"
      onClick={() => navigate({ name: 'birthdays' })}
      className="block w-full rounded-2xl border border-[#c6982f]/40 bg-white p-3 text-left"
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-[11px] font-bold text-slate-500">
          <Cake className="h-3.5 w-3.5 text-[#c6982f]" /> 생일 임박 고객
        </span>
        <ChevronRight className="h-4 w-4 text-slate-400" />
      </div>
      <ul className="space-y-1.5">
        {upcoming.map((b) => (
          <li key={b.customer.id} className="flex items-center gap-2">
            <span
              className={[
                'shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-bold',
                b.dDay === 0 ? 'bg-[#c6982f] text-[#201603]' : 'bg-[#0e1e3a] text-[#e6c877]'
              ].join(' ')}
            >
              {b.dDay === 0 ? '오늘 🎉' : `D-${b.dDay}`}
            </span>
            <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-slate-100">{b.customer.name}</span>
            <span className="shrink-0 text-[12px] font-bold text-slate-300">
              {b.month}/{b.day}
            </span>
          </li>
        ))}
      </ul>
    </button>
  )
}
