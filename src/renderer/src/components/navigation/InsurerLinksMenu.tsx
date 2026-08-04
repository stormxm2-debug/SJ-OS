import { useEffect, useRef, useState } from 'react'
import { Building2, ChevronDown, ExternalLink, Phone, X } from 'lucide-react'
import { INSURER_LINKS, INSURER_GROUPS, type InsurerGroup, type InsurerLink } from '@renderer/data/insurerLinks'

/**
 * 상단 [보험사] 메뉴.
 * - 데스크톱(Topbar): 설계사 전산 포털 정사각형 타일 드롭다운(새 탭).
 * - 모바일(compact): 풀스크린 새 창 — 고객센터 정사각형 타일 그리드,
 *   타일 탭 → 하단 카드(번호·ARS 메뉴·전화 걸기). 전산 포털은 PC 전용.
 */
export default function InsurerLinksMenu({ compact = false }: { compact?: boolean }): JSX.Element {
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<InsurerLink | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent | TouchEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        setSelected(null)
        setOpen(false)
      }
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

  const close = (): void => {
    setSelected(null)
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

      {open && compact ? (
        /* 모바일: 풀스크린 새 창 — 고객센터 정사각형 타일 */
        <div className="fixed inset-0 z-[80] flex flex-col bg-slate-950">
          <div className="flex shrink-0 items-center justify-between border-b border-slate-800 bg-white px-4 py-3">
            <div>
              <div className="text-[15px] font-bold text-slate-100">보험사 고객센터</div>
              <div className="text-[10px] text-slate-500">회사를 누르면 번호·ARS 안내가 뜹니다</div>
            </div>
            <button
              type="button"
              onClick={close}
              aria-label="닫기"
              className="rounded-full border border-slate-800 bg-white p-2 text-slate-300 active:bg-slate-900"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto pb-44">
            {INSURER_GROUPS.map((group: InsurerGroup) => {
              const items = INSURER_LINKS.filter((l) => l.group === group)
              if (items.length === 0) return null
              return (
                <div key={group}>
                  <div className="bg-slate-900 px-4 py-1.5 text-[10px] font-bold tracking-wide text-[#8a6a1f]">
                    {group}
                  </div>
                  <div className="grid grid-cols-3 gap-1.5 p-2">
                    {items.map((l) => (
                      <button
                        key={l.name}
                        type="button"
                        onClick={() => setSelected(l)}
                        className={`flex aspect-square flex-col items-center justify-center gap-1 rounded-xl border p-1.5 text-center transition active:bg-slate-900 ${
                          selected?.name === l.name ? 'border-[#c6982f] bg-[#fdf7ea]' : 'border-slate-800 bg-white'
                        }`}
                      >
                        <span className="break-keep text-[11px] font-bold leading-tight text-slate-100">{l.name}</span>
                        <span className="flex items-center gap-0.5 text-[9px] font-semibold text-emerald-700">
                          <Phone className="h-2.5 w-2.5" />
                          {l.csPhone}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>

          {/* 선택한 보험사 — 하단 카드: 번호 + ARS + 전화 걸기 */}
          {selected ? (
            <div className="fixed inset-x-0 bottom-0 z-[90] rounded-t-2xl border-t border-slate-800 bg-white p-4 shadow-[0_-8px_30px_rgba(0,0,0,0.15)]">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-[15px] font-bold text-slate-100">{selected.name}</div>
                  <div className="text-[12px] font-semibold text-slate-300">{selected.csPhone}</div>
                </div>
                <button
                  type="button"
                  onClick={() => setSelected(null)}
                  aria-label="안내 닫기"
                  className="rounded-full p-1.5 text-slate-500 active:bg-slate-900"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              {selected.ars ? (
                <div className="mt-2 rounded-xl bg-slate-900 px-3 py-2 text-[11px] leading-relaxed text-slate-300">
                  <span className="font-bold text-[#8a6a1f]">ARS 안내</span> · {selected.ars}
                </div>
              ) : (
                <div className="mt-2 text-[10px] text-slate-500">이 회사는 공식 ARS 메뉴 안내가 없습니다 — 연결 후 안내를 따라 주세요.</div>
              )}
              <a
                href={`tel:${selected.csPhone}`}
                className="mt-3 flex items-center justify-center gap-2 rounded-xl bg-emerald-600 py-3 text-[14px] font-bold text-white active:brightness-95"
              >
                <Phone className="h-4 w-4" />
                {selected.name} 전화 걸기
              </a>
            </div>
          ) : null}
        </div>
      ) : null}

      {open && !compact ? (
        /* 데스크톱: 전산 포털 정사각형 타일 드롭다운 */
        <div className="absolute right-0 z-[70] mt-2 max-h-[70vh] w-[26rem] overflow-y-auto rounded-2xl border border-slate-800 bg-white shadow-xl">
          <div className="border-b border-slate-800 px-4 py-2.5 text-[11px] font-bold text-slate-500">
            보험사 전산 바로가기 — 새 탭으로 열립니다
          </div>
          {INSURER_GROUPS.map((group: InsurerGroup) => {
            const items = INSURER_LINKS.filter((l) => l.group === group)
            if (items.length === 0) return null
            return (
              <div key={group}>
                <div className="bg-slate-900 px-4 py-1.5 text-[10px] font-bold tracking-wide text-[#8a6a1f]">
                  {group}
                </div>
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
              </div>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
