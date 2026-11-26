import { useEffect, useState } from 'react'
import { ListChecks, ChevronRight } from 'lucide-react'
import { useNavigation } from '@renderer/navigation/NavigationContext'
import { useSession } from '@renderer/navigation/SessionContext'
import { canAccessRoute } from '@renderer/navigation/roleAccess'
import { isSupabaseMode, currentMonth, listRows } from '@renderer/services/commercial/salesListService'

/**
 * 홈 카드 — 영업·리쿠르팅 리스트 바로가기 + 이번 달 요약(작성 중 건수).
 * 사용률을 끌어올리기 위해 FC 홈(모바일·PC) 상단에 노출한다. 전체 카드가 버튼.
 */
export default function SalesListHomeCard(): JSX.Element | null {
  const { navigate } = useNavigation()
  const { session } = useSession()
  const [counts, setCounts] = useState<{ cust: number; rec: number } | null>(null)

  useEffect(() => {
    if (!isSupabaseMode()) return
    let alive = true
    void (async () => {
      try {
        const month = currentMonth()
        const [c, r] = await Promise.all([
          listRows('customer', { month, done: false }),
          listRows('recruit', { month, done: false })
        ])
        if (alive) setCounts({ cust: c.length, rec: r.length })
      } catch {
        /* 요약 실패해도 바로가기는 보인다 */
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  // 영업·리쿠르팅 리스트에 접근 못 하는 역할이면 카드도 숨긴다.
  if (!canAccessRoute(session.role, 'sales-recruiting')) return null

  const total = counts ? counts.cust + counts.rec : null
  const sub =
    total === null
      ? '이번 달 영업·리쿠르팅을 기록하세요'
      : total === 0
        ? '이번 달 아직 비어 있어요 — 지금 시작!'
        : `이번 달 작성 중 · 고객 ${counts!.cust} · 리쿠르팅 ${counts!.rec}`

  return (
    <button
      type="button"
      onClick={() => navigate({ name: 'sales-recruiting' })}
      className="flex w-full items-center gap-3 rounded-2xl border border-[#c6982f]/40 bg-white p-3.5 text-left shadow-sm transition active:scale-[.99]"
    >
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#0e1e3a] text-[#e6c877]">
        <ListChecks className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-bold text-slate-800">영업·리쿠르팅 리스트</span>
        <span className="block truncate text-[12px] text-slate-500">{sub}</span>
      </span>
      <ChevronRight className="h-5 w-5 shrink-0 text-slate-300" />
    </button>
  )
}
