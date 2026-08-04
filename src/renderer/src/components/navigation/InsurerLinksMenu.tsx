import { useEffect, useRef, useState } from 'react'
import { Building2, ChevronDown, ExternalLink, Phone, X } from 'lucide-react'
import { INSURER_LINKS, INSURER_GROUPS, type InsurerGroup, type InsurerLink } from '@renderer/data/insurerLinks'

/**
 * 상단 [보험사] 메뉴.
 * - 데스크톱(Topbar): 설계사 전산 포털 정사각형 타일 드롭다운(새 탭).
 * - 모바일(compact): 풀스크린 새 창 — 고객센터 정사각형 타일 그리드,
 *   타일 탭 → 전화 ARS 스타일 통화 화면(키패드에 기능 매핑, 전화 걸기).
 *   전산 포털은 PC 전용.
 *
 * 통화 화면은 다크 배경이므로 색은 전부 명시적 hex(토큰 리매핑 회피).
 */

interface ArsKey {
  digit: string
  label: string
}

/**
 * ars 한 줄("1 차사고접수 · 2 긴급출동 …")을 키패드 매핑으로 파싱.
 * 구분자는 ' · '(공백 포함) — 항목 안의 '계약조회·변경'과 충돌하지 않는다.
 * 단일 키(0~9, *, #)로 시작하는 항목이 3개 이상일 때만 키패드 모드,
 * 아니면(우체국식 서비스번호 등) null → 텍스트 안내로 폴백.
 */
function parseArsKeys(ars?: string): ArsKey[] | null {
  if (!ars) return null
  const seen = new Set<string>()
  const keys: ArsKey[] = []
  for (const part of ars.split(' · ')) {
    const m = part.trim().match(/^([0-9#*])\s+(.+)$/)
    if (!m || seen.has(m[1])) continue
    seen.add(m[1])
    keys.push({ digit: m[1], label: m[2] })
  }
  return keys.length >= 3 ? keys : null
}

const DIALPAD: string[] = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#']

/** 전화 ARS 스타일 통화 화면 — 키패드에 각 번호의 기능을 매핑해 표시. */
function ArsCallScreen({ insurer, onClose }: { insurer: InsurerLink; onClose: () => void }): JSX.Element {
  const keys = parseArsKeys(insurer.ars)
  const keyMap = new Map<string, string>((keys ?? []).map((k) => [k.digit, k.label]))
  const dial = (): void => {
    window.location.href = `tel:${insurer.csPhone}`
  }

  return (
    <div className="fixed inset-0 z-[90] flex flex-col bg-gradient-to-b from-[#0a1830] via-[#0e1e3a] to-[#091326]">
      {/* 상단: 회사·번호 (실제 통화 화면 헤더 느낌) */}
      <div className="relative shrink-0 px-6 pb-4 pt-8 text-center">
        <button
          type="button"
          onClick={onClose}
          aria-label="통화 안내 닫기"
          className="absolute right-4 top-6 rounded-full border border-[rgba(255,255,255,0.18)] p-2 text-[#cbd5e1] active:bg-[rgba(255,255,255,0.08)]"
        >
          <X className="h-4 w-4" />
        </button>
        <div className="text-[11px] font-bold tracking-[0.2em] text-[#e6c877]">고객센터 ARS</div>
        <div className="mt-1.5 text-[22px] font-bold text-[#f1f5f9]">{insurer.name}</div>
        <div className="mt-0.5 text-[15px] font-semibold tracking-wider text-[#e6c877]">{insurer.csPhone}</div>
      </div>

      {/* 중앙: ARS 키패드 매핑 (또는 텍스트 안내) */}
      <div className="flex-1 overflow-y-auto px-5">
        {keys ? (
          <div className="mx-auto grid max-w-[21rem] grid-cols-3 gap-2">
            {DIALPAD.map((d) => {
              const label = keyMap.get(d)
              return (
                <button
                  key={d}
                  type="button"
                  onClick={label ? dial : undefined}
                  className={`flex aspect-square flex-col items-center justify-center gap-1 rounded-2xl border p-1.5 text-center transition ${
                    label
                      ? 'border-[#c6982f] bg-[rgba(198,152,47,0.12)] active:bg-[rgba(198,152,47,0.25)]'
                      : 'border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)]'
                  }`}
                >
                  <span className={`text-[22px] font-bold leading-none ${label ? 'text-[#f1f5f9]' : 'text-[#33415e]'}`}>
                    {d}
                  </span>
                  {label ? (
                    <span className="line-clamp-2 break-keep text-[9.5px] font-semibold leading-tight text-[#e6c877]">
                      {label}
                    </span>
                  ) : null}
                </button>
              )
            })}
          </div>
        ) : insurer.ars ? (
          <div className="mx-auto max-w-[21rem] rounded-2xl border border-[rgba(198,152,47,0.4)] bg-[rgba(198,152,47,0.1)] px-4 py-3 text-[12px] leading-relaxed text-[#f1f5f9]">
            <div className="mb-1 text-[10px] font-bold tracking-widest text-[#e6c877]">ARS 안내</div>
            {insurer.ars}
          </div>
        ) : (
          <div className="mx-auto max-w-[21rem] rounded-2xl border border-[rgba(255,255,255,0.12)] bg-[rgba(255,255,255,0.04)] px-4 py-3 text-center text-[12px] text-[#94a3b8]">
            이 회사는 공식 ARS 메뉴 안내가 없습니다.
            <br />
            연결 후 음성 안내를 따라 주세요.
          </div>
        )}
        {keys ? (
          <div className="mt-2 pb-2 text-center text-[10px] text-[#64748b]">
            금색 버튼이 실제 ARS 번호입니다 — 누르면 바로 전화가 걸립니다
          </div>
        ) : null}
      </div>

      {/* 하단: 통화 버튼 (실제 전화) */}
      <div className="shrink-0 pb-10 pt-3 text-center">
        <a
          href={`tel:${insurer.csPhone}`}
          aria-label={`${insurer.name} 전화 걸기`}
          className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-[#22c55e] shadow-[0_0_30px_rgba(34,197,94,0.45)] active:brightness-90"
        >
          <Phone className="h-7 w-7 text-white" />
        </a>
        <div className="mt-2 text-[11px] font-semibold text-[#94a3b8]">전화 걸기</div>
      </div>
    </div>
  )
}

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
              <div className="text-[10px] text-slate-500">회사를 누르면 ARS 통화 화면이 열립니다</div>
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

          <div className="flex-1 overflow-y-auto pb-10">
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
                        className="flex aspect-square flex-col items-center justify-center gap-1 rounded-xl border border-slate-800 bg-white p-1.5 text-center transition active:bg-slate-900"
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

          {/* 선택한 보험사 — 전화 ARS 스타일 통화 화면 */}
          {selected ? <ArsCallScreen insurer={selected} onClose={() => setSelected(null)} /> : null}
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
