import { useEffect, useRef, useState } from 'react'
import { Building2, ChevronDown, ExternalLink } from 'lucide-react'
import { INSURER_LINKS, INSURER_GROUPS, type InsurerGroup } from '@renderer/data/insurerLinks'

/**
 * 상단 [보험사] 드롭다운 — 각 원수사 설계사 전산 포털 바로가기.
 * 데스크톱 Topbar와 모바일 헤더 양쪽에서 쓴다(compact = 모바일 알약 스타일).
 * 새 탭(noopener)으로만 연다 — 앱 상태에 영향 없음.
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
          className={`absolute right-0 z-[70] mt-2 w-64 overflow-hidden rounded-2xl border border-slate-800 bg-white shadow-xl ${
            compact ? 'max-h-[70vh] overflow-y-auto' : ''
          }`}
        >
          <div className="border-b border-slate-800 px-4 py-2.5 text-[11px] font-bold text-slate-500">
            보험사 전산 바로가기 <span className="font-medium">— 새 탭으로 열립니다</span>
          </div>
          {INSURER_GROUPS.map((group: InsurerGroup) => {
            const items = INSURER_LINKS.filter((l) => l.group === group)
            if (items.length === 0) return null
            return (
              <div key={group}>
                <div className="bg-slate-900 px-4 py-1.5 text-[10px] font-bold tracking-wide text-[#8a6a1f]">
                  {group}
                </div>
                {items.map((l) => (
                  <button
                    key={l.name}
                    type="button"
                    onClick={() => openLink(l.url)}
                    className="flex w-full items-center justify-between px-4 py-2.5 text-left transition hover:bg-slate-900 active:bg-slate-900"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-semibold text-slate-100">{l.name}</span>
                      <span className="block truncate text-[10px] text-slate-500">{l.portal}</span>
                    </span>
                    <ExternalLink className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                  </button>
                ))}
              </div>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
