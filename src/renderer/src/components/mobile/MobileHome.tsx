import { useEffect, useState } from 'react'
import { Star } from 'lucide-react'
import { useSession } from '@renderer/navigation/SessionContext'
import { isAdminRole } from '@renderer/navigation/roleAccess'
import { useNavigation } from '@renderer/navigation/NavigationContext'
import { jarvisService } from '@renderer/services/jarvis/JarvisService'
import RecentAnnouncementsWidget from '@renderer/components/home/RecentAnnouncementsWidget'
import MyDayWidgets from '@renderer/components/home/MyDayWidgets'
import { findMenuItem, listFavorites, subscribeFavorites } from './mobileMenu'

/**
 * 모바일 홈 — 즐겨찾기 + 최근 공지만 (2026-07-10 대표 지시로 대폭 정리).
 * 인사말·오늘 다짐·빠른 실행·통계 카드·자비스 버튼은 제거 — 홈은 "내가 고른
 * 메뉴로 바로 가는 곳"으로 단순화. 다른 기능은 하단 탭/전체 메뉴에서 접근.
 */
export default function MobileHome(): JSX.Element {
  const { session } = useSession()
  const { navigate } = useNavigation()

  // 즐겨찾기 — 전체 메뉴에서 ⭐를 누르면 즉시 반영된다. 관리자 전용 항목은
  // 관리자가 아닌 계정에서 걸러낸다 (기기 공유 등으로 저장돼 있어도 숨김).
  const [favKeys, setFavKeys] = useState<string[]>(() => listFavorites())
  useEffect(() => subscribeFavorites(() => setFavKeys(listFavorites())), [])
  const favItems = favKeys
    .map((k) => findMenuItem(k))
    .filter((i): i is NonNullable<typeof i> => Boolean(i && (!i.adminOnly || isAdminRole(session.role))))

  return (
    <div className="space-y-3">
      {/* 내 하루 — 본인 일정 + 본인 이번 달 매출 (자기 것만) */}
      <MyDayWidgets />

      {/* 즐겨찾기 — 전체 메뉴에서 ⭐한 항목이 여기 나타난다 */}
      {favItems.length > 0 ? (
        <div className="rounded-2xl border border-slate-800 bg-white p-3">
          <div className="mb-2 flex items-center gap-1 text-[11px] font-bold text-slate-500">
            <Star className="h-3.5 w-3.5 fill-[#e6c877] text-[#c6982f]" /> 즐겨찾기
          </div>
          <div className="grid grid-cols-4 gap-2">
            {favItems.map((item) => {
              const Icon = item.icon
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => {
                    if (item.action === 'jarvis') jarvisService.open()
                    else if (item.href) window.open(item.href, '_blank', 'noopener')
                    else if (item.view) navigate(item.view)
                  }}
                  className="flex flex-col items-center gap-1 rounded-2xl border border-slate-800 bg-slate-950 py-3 text-slate-300 transition active:bg-white"
                >
                  <Icon className="h-5 w-5 text-indigo-500" />
                  <span className="w-full truncate px-1 text-center text-[10px] font-medium">{item.label}</span>
                </button>
              )
            })}
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-slate-700 bg-white/50 px-3 py-2.5 text-center text-[11px] text-slate-500">
          더보기(전체 메뉴)에서 <Star className="inline h-3 w-3 fill-[#e6c877] text-[#c6982f]" />를 누르면 즐겨찾기가 여기에 생겨요
        </div>
      )}

      {/* Recent announcements */}
      <RecentAnnouncementsWidget />
    </div>
  )
}
