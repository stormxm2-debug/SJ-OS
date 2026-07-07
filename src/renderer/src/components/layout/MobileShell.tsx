import { useEffect, useState } from 'react'
import { Home, Clock, UserRound, CalendarDays, Menu, ClipboardList, BarChart3, Megaphone, Bot, LogOut, ShieldAlert, X } from 'lucide-react'
import { useNavigation } from '@renderer/navigation/NavigationContext'
import type { View, ViewName } from '@renderer/navigation/types'
import { useSession } from '@renderer/navigation/SessionContext'
import { ROLE_LABEL, routeCategory } from '@renderer/navigation/roleAccess'
import { jarvisService } from '@renderer/services/jarvis/JarvisService'
import JarvisPanel from '@renderer/components/jarvis/JarvisPanel'
import MobileHome from '@renderer/components/mobile/MobileHome'
import MobilePerformance from '@renderer/components/mobile/MobilePerformance'
import SupabaseCustomerManager from '@renderer/components/customer/SupabaseCustomerManager'
import SupabaseConsultationManager from '@renderer/components/consultation/SupabaseConsultationManager'
import SupabaseScheduleManager from '@renderer/components/schedule/SupabaseScheduleManager'
import SupabaseAttendanceManager from '@renderer/components/attendance/SupabaseAttendanceManager'
import NoticePage from '@renderer/pages/NoticePage'

/**
 * Mobile-first staff shell: top bar + scrollable content + bottom tab nav. Shows
 * ONLY staff/mobile workflows — developer/release/deployment tools are hidden for
 * every role on mobile. No fullscreen blocking backdrop; the 더보기 sheet is a
 * non-modal panel above the tab bar. Reuses the shared Supabase managers so mobile
 * and desktop share the same data path.
 */

const TABS: { key: string; label: string; icon: typeof Home; view: View; match: ViewName[] }[] = [
  { key: 'home', label: '홈', icon: Home, view: { name: 'staff-home' }, match: ['staff-home'] },
  { key: 'attendance', label: '출퇴근', icon: Clock, view: { name: 'attendance' }, match: ['attendance'] },
  { key: 'customer', label: '고객', icon: UserRound, view: { name: 'customer' }, match: ['customer'] },
  { key: 'schedule', label: '일정', icon: CalendarDays, view: { name: 'schedule' }, match: ['schedule'] }
]

export default function MobileShell(): JSX.Element {
  const { route, navigate } = useNavigation()
  const { session, logout } = useSession()
  const [moreOpen, setMoreOpen] = useState(false)

  // Interaction watchdog (same guarantee as desktop): never leave the app unclickable.
  useEffect(() => {
    const id = window.setInterval(() => {
      if (typeof document === 'undefined') return
      if (document.body.style.pointerEvents === 'none') document.body.style.pointerEvents = ''
      if (document.documentElement.style.pointerEvents === 'none') document.documentElement.style.pointerEvents = ''
    }, 5000)
    return () => window.clearInterval(id)
  }, [])

  const go = (view: View): void => {
    setMoreOpen(false)
    navigate(view)
  }

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-slate-50 text-slate-800">
      {/* Top bar */}
      <header className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-blue-600 to-indigo-600">
            <Bot className="h-4 w-4 text-white" />
          </div>
          <div>
            <div className="text-sm font-bold text-slate-100">SJ OS</div>
            <div className="text-[10px] text-slate-500">{session.name || '직원'} · {ROLE_LABEL[session.role]}</div>
          </div>
        </div>
        <span className="rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[10px] font-bold text-indigo-600">모바일</span>
      </header>

      {/* Content */}
      <main className="flex-1 overflow-y-auto overflow-x-hidden p-3 pb-24">
        <MobileContent routeName={route.name} />
      </main>

      {/* 더보기 sheet (non-modal, above tab bar) */}
      {moreOpen ? (
        <div className="fixed inset-x-0 bottom-16 z-20 mx-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-xl">
          <div className="mb-1 flex items-center justify-between px-2">
            <span className="text-xs font-semibold text-slate-500">더보기</span>
            <button type="button" onClick={() => setMoreOpen(false)} className="text-slate-400"><X className="h-4 w-4" /></button>
          </div>
          <MoreItem icon={<ClipboardList className="h-4 w-4" />} label="상담기록" onClick={() => go({ name: 'consultation' })} />
          <MoreItem icon={<BarChart3 className="h-4 w-4" />} label="실적관리" onClick={() => go({ name: 'performance' })} />
          <MoreItem icon={<Megaphone className="h-4 w-4" />} label="공지사항" onClick={() => go({ name: 'notice' })} />
          <MoreItem icon={<Bot className="h-4 w-4" />} label="자비스" onClick={() => { setMoreOpen(false); jarvisService.open() }} />
          <MoreItem icon={<LogOut className="h-4 w-4" />} label="로그아웃" onClick={() => { setMoreOpen(false); logout() }} danger />
        </div>
      ) : null}

      {/* Bottom tab nav */}
      <nav className="fixed inset-x-0 bottom-0 z-10 flex h-16 items-stretch border-t border-slate-200 bg-white">
        {TABS.map((t) => {
          const active = t.match.includes(route.name)
          const Icon = t.icon
          return (
            <button key={t.key} type="button" onClick={() => go(t.view)} className={['flex flex-1 flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition', active ? 'text-indigo-600' : 'text-slate-500'].join(' ')}>
              <Icon className={['h-5 w-5', active ? 'text-indigo-600' : 'text-slate-400'].join(' ')} />
              {t.label}
            </button>
          )
        })}
        <button type="button" onClick={() => setMoreOpen((v) => !v)} className={['flex flex-1 flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition', moreOpen ? 'text-indigo-600' : 'text-slate-500'].join(' ')}>
          <Menu className={['h-5 w-5', moreOpen ? 'text-indigo-600' : 'text-slate-400'].join(' ')} />
          더보기
        </button>
      </nav>

      <JarvisPanel />
    </div>
  )
}

/** Mobile router: staff routes only; admin/dev routes → mobile access-denied card. */
function MobileContent({ routeName }: { routeName: ViewName }): JSX.Element {
  // Hide developer/release/deployment tools on mobile for EVERY role.
  if (routeCategory(routeName) === 'admin') return <MobileAccessDenied />
  switch (routeName) {
    case 'staff-home':
      return <MobileHome />
    case 'attendance':
      return <SupabaseAttendanceManager />
    case 'customer':
      return <SupabaseCustomerManager />
    case 'consultation':
      return <SupabaseConsultationManager />
    case 'schedule':
      return <SupabaseScheduleManager />
    case 'performance':
      return <MobilePerformance />
    case 'notice':
      return <NoticePage />
    default:
      return <MobileHome />
  }
}

function MobileAccessDenied(): JSX.Element {
  const { navigate } = useNavigation()
  return (
    <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
      <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-100">
        <ShieldAlert className="h-6 w-6 text-amber-600" />
      </div>
      <h2 className="text-base font-bold text-slate-100">관리자 기능</h2>
      <p className="mt-1.5 text-sm text-slate-500">모바일에서는 사용할 수 없는 관리자 기능입니다.</p>
      <button type="button" onClick={() => navigate({ name: 'staff-home' })} className="mt-4 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-4 py-2 text-sm font-semibold text-white">홈으로 이동</button>
    </div>
  )
}

function MoreItem({ icon, label, onClick, danger }: { icon: JSX.Element; label: string; onClick: () => void; danger?: boolean }): JSX.Element {
  return (
    <button type="button" onClick={onClick} className={['flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium transition active:bg-slate-50', danger ? 'text-rose-600' : 'text-slate-300'].join(' ')}>
      <span className={danger ? 'text-rose-500' : 'text-indigo-500'}>{icon}</span>
      {label}
    </button>
  )
}
