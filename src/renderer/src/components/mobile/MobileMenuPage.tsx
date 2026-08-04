import { useEffect, useState } from 'react'
import { X, Star, LogOut, Pencil, Check, ArrowUp, ArrowDown, Eye, EyeOff, RotateCcw } from 'lucide-react'
import { useSession } from '@renderer/navigation/SessionContext'
import { canAccessRoute } from '@renderer/navigation/roleAccess'
import type { View } from '@renderer/navigation/types'
import { isNewFeature, subscribeNewFeatures } from '@renderer/navigation/newFeatures'
import {
  MOBILE_MENU,
  listFavorites,
  toggleFavorite,
  subscribeFavorites,
  moveFavorite,
  findMenuItem,
  loadMenuPrefs,
  subscribeMenuPrefs,
  orderedItems,
  moveMenuItem,
  toggleMenuItemHidden,
  resetMenuPrefs
} from './mobileMenu'
import { openFamilyBirthdayGate } from '@renderer/services/commercial/familyBirthdayService'
import { openPasswordGate } from '@renderer/services/commercial/passwordService'

/**
 * 모바일 전체 메뉴 화면 — 더보기를 누르면 새 창처럼 전체 화면으로 열린다.
 * 카테고리별 목록 + 각 항목 오른쪽 ⭐(즐겨찾기 토글). 별표한 항목은 홈 화면
 * 즐겨찾기 줄에 나타난다. 관리자 메뉴 카테고리는 관리자 로그인일 때만 보인다.
 *
 * [편집] 모드 — 회원이 자기 기호대로 메뉴를 손본다 (기기별 저장):
 *  · 항목 ↑/↓ 이동(카테고리 안에서), 안 쓰는 메뉴 숨김/복구
 *  · 홈 즐겨찾기 줄 순서 변경
 *  · [기본 순서]로 언제든 복원. 숨김은 표시만 가리며 접근권한과 무관.
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
  const [favs, setFavs] = useState<string[]>(() => listFavorites())
  useEffect(() => subscribeFavorites(() => setFavs(listFavorites())), [])
  // NEW 뱃지: 2번째 방문 직후 이 화면이 열려 있어도 뱃지가 바로 사라지도록 구독.
  const [, bumpNewFeatures] = useState(0)
  useEffect(() => subscribeNewFeatures(() => bumpNewFeatures((v) => v + 1)), [])

  // 메뉴 순서·숨김 (기기별) — 변경 즉시 리렌더
  const [edit, setEdit] = useState(false)
  const [prefs, setPrefs] = useState(() => loadMenuPrefs())
  useEffect(() => subscribeMenuPrefs(() => setPrefs(loadMenuPrefs())), [])

  const ctrlBtn = 'flex h-8 w-8 items-center justify-center rounded-lg border border-slate-800 bg-slate-950 text-slate-400 active:bg-slate-900 disabled:opacity-30'

  return (
    <div className="fixed inset-0 z-30 flex flex-col bg-slate-950">
      {/* 헤더 */}
      <header className="flex shrink-0 items-center justify-between border-b border-slate-800 bg-white px-4 py-3">
        <div>
          <div className="text-base font-bold text-slate-100">전체 메뉴</div>
          <div className="mt-0.5 flex items-center gap-1 text-[10px] text-slate-500">
            {edit ? (
              <>화살표로 순서 이동 · 눈 아이콘으로 숨김/복구</>
            ) : (
              <>
                <Star className="h-3 w-3 fill-[#e6c877] text-[#c6982f]" />
                별을 누르면 홈 화면 즐겨찾기에 추가됩니다
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {edit ? (
            <button
              type="button"
              onClick={() => {
                if (window.confirm('메뉴 순서와 숨김을 기본값으로 되돌릴까요? (즐겨찾기는 유지)')) resetMenuPrefs()
              }}
              className="flex h-9 items-center gap-1 rounded-full border border-slate-800 bg-slate-950 px-3 text-[11px] font-bold text-slate-400 active:bg-slate-900"
            >
              <RotateCcw className="h-3.5 w-3.5" /> 기본 순서
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setEdit((v) => !v)}
            className={[
              'flex h-9 items-center gap-1 rounded-full px-3 text-[11px] font-bold',
              edit ? 'bg-[#c6982f] text-[#201603]' : 'border border-[#c6982f]/60 bg-[#fdf7ea] text-[#8a6a1f] active:brightness-95'
            ].join(' ')}
            aria-label={edit ? '메뉴 편집 완료' : '메뉴 순서 편집'}
          >
            {edit ? <Check className="h-3.5 w-3.5" /> : <Pencil className="h-3.5 w-3.5" />}
            {edit ? '완료' : '편집'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-800 bg-slate-950 text-slate-400 active:bg-slate-900"
            aria-label="메뉴 닫기"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </header>

      {/* 카테고리 목록 */}
      <div className="flex-1 space-y-3 overflow-y-auto p-3 pb-10">
        {/* 편집 모드: 홈 즐겨찾기 줄 순서 */}
        {edit && favs.length > 0 ? (
          <section className="rounded-2xl border border-[#c6982f]/40 bg-white p-2 shadow-sm">
            <div className="px-2 pb-1 pt-1.5 text-[11px] font-bold text-[#8a6a1e]">홈 즐겨찾기 순서</div>
            {favs.map((k, i) => {
              const item = findMenuItem(k)
              if (!item) return null
              const Icon = item.icon
              return (
                <div key={k} className="flex items-center gap-2 rounded-xl px-3 py-2">
                  <Icon className="h-4 w-4 shrink-0 text-indigo-500" />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-300">{item.label}</span>
                  <button type="button" disabled={i === 0} onClick={() => moveFavorite(k, -1)} className={ctrlBtn} aria-label={`${item.label} 위로`}>
                    <ArrowUp className="h-4 w-4" />
                  </button>
                  <button type="button" disabled={i === favs.length - 1} onClick={() => moveFavorite(k, 1)} className={ctrlBtn} aria-label={`${item.label} 아래로`}>
                    <ArrowDown className="h-4 w-4" />
                  </button>
                </div>
              )
            })}
          </section>
        ) : null}

        {MOBILE_MENU.map((cat) => {
          // 라우트 항목은 역할별 접근권한으로 필터(총무비서는 막힌 화면만 숨김).
          // 화면 이동이 아닌 동작(자비스·인사정보·비밀번호)은 항상 노출.
          const accessible = orderedItems(cat, prefs).filter((i) => (i.view ? canAccessRoute(session.role, i.view.name) : true))
          const items = edit ? accessible : accessible.filter((i) => !prefs.hidden.includes(i.key))
          if (items.length === 0) return null
          const orderedKeys = accessible.map((i) => i.key)
          return (
            <section key={cat.title} className="rounded-2xl border border-slate-800 bg-white p-2 shadow-sm">
              <div className="px-2 pb-1 pt-1.5 text-[11px] font-bold text-slate-500">{cat.title}</div>
              {items.map((item, i) => {
                const Icon = item.icon
                const fav = favs.includes(item.key)
                const hidden = prefs.hidden.includes(item.key)
                return (
                  <div key={item.key} className={['flex items-center', edit && hidden ? 'opacity-45' : ''].join(' ')}>
                    <button
                      type="button"
                      disabled={edit}
                      onClick={() => {
                        if (item.action === 'jarvis') onJarvis()
                        else if (item.action === 'birthday-gate') {
                          openFamilyBirthdayGate()
                          onClose()
                        } else if (item.action === 'password-gate') {
                          openPasswordGate()
                          onClose()
                        } else if (item.href) window.open(item.href, '_blank', 'noopener')
                        else if (item.view) onNavigate(item.view)
                      }}
                      className="flex min-w-0 flex-1 items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium text-slate-300 transition active:bg-slate-950"
                    >
                      <Icon className="h-4 w-4 shrink-0 text-indigo-500" />
                      <span className="truncate">{item.label}</span>
                      {edit && hidden ? (
                        <span className="shrink-0 rounded-full border border-slate-700 bg-slate-950 px-1.5 py-0.5 text-[9px] font-bold text-slate-500">숨김</span>
                      ) : null}
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
                    {edit ? (
                      <div className="flex shrink-0 items-center gap-1 pr-2">
                        <button type="button" disabled={i === 0} onClick={() => moveMenuItem(cat.title, orderedKeys, item.key, -1)} className={ctrlBtn} aria-label={`${item.label} 위로`}>
                          <ArrowUp className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          disabled={i === items.length - 1}
                          onClick={() => moveMenuItem(cat.title, orderedKeys, item.key, 1)}
                          className={ctrlBtn}
                          aria-label={`${item.label} 아래로`}
                        >
                          <ArrowDown className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => toggleMenuItemHidden(item.key)}
                          className={[ctrlBtn, hidden ? 'text-[#8a6a1e]' : ''].join(' ')}
                          aria-label={hidden ? `${item.label} 다시 보이기` : `${item.label} 숨기기`}
                        >
                          {hidden ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => toggleFavorite(item.key)}
                        className="shrink-0 px-3 py-3 active:scale-110"
                        aria-label={fav ? `${item.label} 즐겨찾기 해제` : `${item.label} 즐겨찾기 추가`}
                      >
                        <Star className={fav ? 'h-4 w-4 fill-[#e6c877] text-[#c6982f]' : 'h-4 w-4 text-slate-400'} />
                      </button>
                    )}
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
