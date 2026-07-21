import { useEffect, useState } from 'react'
import { X, Star, LogOut } from 'lucide-react'
import { useSession } from '@renderer/navigation/SessionContext'
import { isAdminRole } from '@renderer/navigation/roleAccess'
import type { View } from '@renderer/navigation/types'
import { isNewFeature, subscribeNewFeatures } from '@renderer/navigation/newFeatures'
import { MOBILE_MENU, listFavorites, toggleFavorite, subscribeFavorites } from './mobileMenu'
import { openFamilyBirthdayGate } from '@renderer/services/commercial/familyBirthdayService'

/**
 * 모바일 전체 메뉴 화면 — 더보기를 누르면 새 창처럼 전체 화면으로 열린다.
 * 카테고리별 목록 + 각 항목 오른쪽 ⭐(즐겨찾기 토글). 별표한 항목은 홈 화면
 * 즐겨찾기 줄에 나타난다. 관리자 메뉴 카테고리는 관리자 로그인일 때만 보인다.
 */
export default function MobileMenuPage({
  onClose,
  onNavigate,
  onJarvis,
  onLogout
}: {
  onClose: () => void
  onNavigate: (view: View) => void
  onJarvis: () => void
  onLogout: () => void
}): JSX.Element {
  const { session } = useSession()
  const admin = isAdminRole(session.role)
  const [favs, setFavs] = useState<string[]>(() => listFavorites())
  useEffect(() => subscribeFavorites(() => setFavs(listFavorites())), [])
  // NEW 뱃지: 2번째 방문 직후 이 화면이 열려 있어도 뱃지가 바로 사라지도록 구독.
  const [, bumpNewFeatures] = useState(0)
  useEffect(() => subscribeNewFeatures(() => bumpNewFeatures((v) => v + 1)), [])

  return (
    <div className="fixed inset-0 z-30 flex flex-col bg-slate-950">
      {/* 헤더 */}
      <header className="flex shrink-0 items-center justify-between border-b border-slate-800 bg-white px-4 py-3">
        <div>
          <div className="text-base font-bold text-slate-100">전체 메뉴</div>
          <div className="mt-0.5 flex items-center gap-1 text-[10px] text-slate-500">
            <Star className="h-3 w-3 fill-[#e6c877] text-[#c6982f]" />
            별을 누르면 홈 화면 즐겨찾기에 추가됩니다
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-800 bg-slate-950 text-slate-400 active:bg-slate-900"
          aria-label="메뉴 닫기"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      {/* 카테고리 목록 */}
      <div className="flex-1 space-y-3 overflow-y-auto p-3 pb-10">
        {MOBILE_MENU.map((cat) => {
          const items = cat.items.filter((i) => !i.adminOnly || admin)
          if (items.length === 0) return null
          return (
            <section key={cat.title} className="rounded-2xl border border-slate-800 bg-white p-2 shadow-sm">
              <div className="px-2 pb-1 pt-1.5 text-[11px] font-bold text-slate-500">{cat.title}</div>
              {items.map((item) => {
                const Icon = item.icon
                const fav = favs.includes(item.key)
                return (
                  <div key={item.key} className="flex items-center">
                    <button
                      type="button"
                      onClick={() => {
                        if (item.action === 'jarvis') onJarvis()
                        else if (item.action === 'birthday-gate') {
                          openFamilyBirthdayGate()
                          onClose()
                        } else if (item.href) window.open(item.href, '_blank', 'noopener')
                        else if (item.view) onNavigate(item.view)
                      }}
                      className="flex min-w-0 flex-1 items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium text-slate-300 transition active:bg-slate-950"
                    >
                      <Icon className="h-4 w-4 shrink-0 text-indigo-500" />
                      <span className="truncate">{item.label}</span>
                      {item.view && isNewFeature(item.view.name) ? (
                        <span className="shrink-0 rounded-full bg-[#e6c877] px-1.5 py-0.5 text-[9px] font-bold leading-none text-[#0e1e3a]">
                          NEW
                        </span>
                      ) : null}
                      {item.adminOnly ? (
                        <span className="shrink-0 rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[9px] font-bold text-amber-600">
                          관리자
                        </span>
                      ) : null}
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleFavorite(item.key)}
                      className="shrink-0 px-3 py-3 active:scale-110"
                      aria-label={fav ? `${item.label} 즐겨찾기 해제` : `${item.label} 즐겨찾기 추가`}
                    >
                      <Star className={fav ? 'h-4 w-4 fill-[#e6c877] text-[#c6982f]' : 'h-4 w-4 text-slate-400'} />
                    </button>
                  </div>
                )
              })}
            </section>
          )
        })}

        {/* 계정 */}
        <section className="rounded-2xl border border-slate-800 bg-white p-2 shadow-sm">
          <button
            type="button"
            onClick={onLogout}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium text-rose-600 transition active:bg-rose-50"
          >
            <LogOut className="h-4 w-4 text-rose-500" />
            로그아웃
          </button>
        </section>
      </div>
    </div>
  )
}
