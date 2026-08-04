import { useEffect, useRef, useState } from 'react'
import { Building2, ChevronDown, ExternalLink, Phone } from 'lucide-react'
import { INSURER_LINKS, INSURER_GROUPS, type InsurerGroup } from '@renderer/data/insurerLinks'

/**
 * 상단 [보험사] 드롭다운.
 * - 데스크톱(Topbar): 각 원수사 설계사 전산 포털 정사각형 타일 그리드(새 탭).
 * - 모바일(compact): 전산 사이트가 폰에서 깨지는 곳이 많아(대표 확인) 포털 대신
 *   고객센터 전화 안내 — 번호 탭=바로 전화, 공식 확인된 ARS 메뉴 표시.
 */
export default function InsurerLinksMenu({ compact = false }: { compact?: boolean }): JSX.Element {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent | TouchEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('touchstart', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('touchstart', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const openLink = (url: string): void => {
    window.open(url, '_blank', 'noopener')
    setOpen(false)
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="보험사 바로가기"
        aria-expanded={open}
        className={
          compact
            ? 'flex items-center gap-1 rounded-full border border-slate-800 bg-white px-2 py-1 text-[10px] font-bold text-slate-300 active:bg-slate-900'
            : 'inline-flex items-center gap-1.5 rounded-lg border border-slate-800 bg-white px-3 py-2 text-sm font-semibold text-slate-300 transition hover:bg-slate-900'
        }
      >
        <Building2 className={compact ? 'h-3 w-3' : 'h-4 w-4'} />
        보험사
        <ChevronDown className={`${compact ? 'h-3 w-3' : 'h-3.5 w-3.5'} transition ${open ? 'rotate-180' : ''}`} />
      </button>

      {open ? (
        <div
          className={`z-[70] max-h-[70vh] overflow-y-auto rounded-2xl border border-slate-800 bg-white shadow-xl ${
            compact ? 'fixed inset-x-3 top-14' : 'absolute right-0 mt-2 w-[26rem]'
          }`}
        >
          <div className="border-b border-slate-800 px-4 py-2.5 text-[11px] font-bold text-slate-500">
            {compact ? (
              <>보험사 고객센터 — 번호를 누르면 바로 전화됩니다</>
            ) : (
              <>보험사 전산 바로가기 — 새 탭으로 열립니다</>
            )}
          </div>
          {INSURER_GROUPS.map((group: InsurerGroup) => {
            const items = INSURER_LINKS.filter((l) => l.group === group)
            if (items.length === 0) return null
            return (
              <div key={group}>
                <div className="bg-slate-900 px-4 py-1.5 text-[10px] font-bold tracking-wide text-[#8a6a1f]">
                  {group}
                </div>
                {compact ? (
                  /* 모바일: 고객센터 전화 리스트 (+공식 확인된 ARS 안내) */
                  items.map((l) => (
                    <a
                      key={l.name}
                      href={`tel:${l.csPhone}`}
                      onClick={() => setOpen(false)}
                      className="flex items-center justify-between gap-2 border-b border-slate-800 px-4 py-2.5 last:border-b-0 active:bg-slate-900"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-[13px] font-semibold text-slate-100">{l.name}</span>
                        {l.ars ? (
                          <span className="block text-[10px] leading-snug text-slate-500">{l.ars}</span>
                        ) : null}
                      </span>
                      <span className="flex shrink-0 items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-bold text-emerald-700">
                        <Phone className="h-3 w-3" />
                        {l.csPhone}
                      </span>
                    </a>
                  ))
                ) : (
                  /* 데스크톱: 전산 포털 정사각형 타일 그리드 */
                  <div className="grid grid-cols-4 gap-1.5 p-2">
                    {items.map((l) => (
                      <button
                        key={l.name}
                        type="button"
                        onClick={() => openLink(l.url)}
                        title={`${l.name} — ${l.portal}`}
                        className="flex aspect-square flex-col items-center justify-center gap-1 rounded-xl border border-slate-800 bg-white p-1.5 text-center transition hover:border-[#c6982f] hover:bg-slate-900 active:bg-slate-900"
                      >
                        <span className="break-keep text-[11px] font-bold leading-tight text-slate-100">{l.name}</span>
                        <span className="line-clamp-2 break-keep text-[9px] leading-tight text-slate-500">{l.portal}</span>
                        <ExternalLink className="h-3 w-3 text-slate-500" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
