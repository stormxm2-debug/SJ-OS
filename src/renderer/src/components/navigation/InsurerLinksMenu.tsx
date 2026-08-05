import { useEffect, useRef, useState } from 'react'
import { Building2, ChevronDown, ExternalLink, Phone, X, FileText, ClipboardList, AlertTriangle, ChevronRight, Check, Loader2, Video, Share2 } from 'lucide-react'
import {
  INSURER_LINKS,
  INSURER_GROUPS,
  cancelGuideFor,
  CANCEL_COMMON_STEPS,
  CANCEL_COMMON_DOCS,
  CANCEL_COMMON_NOTE,
  type InsurerGroup,
  type InsurerLink,
  type CancelGuide
} from '@renderer/data/insurerLinks'
import { generateSlideClip, renderSlidePoster, shareGuideFile, type ClipSlide } from '@renderer/services/share/cancelClip'
import { copyText } from '@renderer/services/share/clipboard'

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

/** 카드 모노그램 텍스트 — 회사명의 앞 두 글자(한글/영문만). */
function monogram(name: string): string {
  return name.replace(/[^가-힣A-Za-z]/g, '').slice(0, 2) || name.slice(0, 2)
}

/** 지금 브라우저가 엣지인지 (엣지 UA는 Chrome 문자열도 포함하므로 Edg/ 우선). */
function isEdgeBrowser(): boolean {
  return navigator.userAgent.includes('Edg/')
}

/** 전화 ARS 스타일 통화 화면 — 키패드에 각 번호의 기능을 매핑해 표시. */
function ArsCallScreen({ insurer, onClose }: { insurer: InsurerLink; onClose: () => void }): JSX.Element {
  const keys = parseArsKeys(insurer.ars)
  const keyMap = new Map<string, string>((keys ?? []).map((k) => [k.digit, k.label]))
  const cancel = cancelGuideFor(insurer.name)
  const [showCancel, setShowCancel] = useState(false)
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

      {/* 하단: 해지 순서 진입 + 통화 버튼 (실제 전화) */}
      <div className="shrink-0 pb-10 pt-3 text-center">
        {cancel ? (
          <div className="mb-3">
            <button
              type="button"
              onClick={() => setShowCancel(true)}
              className="inline-flex items-center gap-1.5 rounded-full border border-[#c6982f] bg-[rgba(198,152,47,0.12)] px-4 py-2 text-[12px] font-bold text-[#e6c877] active:bg-[rgba(198,152,47,0.25)]"
            >
              <FileText className="h-3.5 w-3.5" /> 해지 진행 순서 보기 <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : null}
        <a
          href={`tel:${insurer.csPhone}`}
          aria-label={`${insurer.name} 전화 걸기`}
          className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-[#22c55e] shadow-[0_0_30px_rgba(34,197,94,0.45)] active:brightness-90"
        >
          <Phone className="h-7 w-7 text-white" />
        </a>
        <div className="mt-2 text-[11px] font-semibold text-[#94a3b8]">전화 걸기</div>
      </div>

      {showCancel && cancel ? (
        <CancelGuideScreen insurer={insurer} guide={cancel} onClose={() => setShowCancel(false)} />
      ) : null}
    </div>
  )
}

/** 해지 진행 순서 안내 화면 (검수 전 참고용). 색은 전부 명시적 hex(토큰 리매핑 회피). */
function CancelGuideScreen({
  insurer,
  guide,
  onClose
}: {
  insurer: InsurerLink
  guide: CancelGuide
  onClose: () => void
}): JSX.Element {
  const steps = guide.steps ?? CANCEL_COMMON_STEPS
  const docs = guide.docs ?? CANCEL_COMMON_DOCS
  const note = guide.notes ?? CANCEL_COMMON_NOTE

  // 고객에게 보낼 자막 슬라이드 영상 — 넣을 단계를 체크(기본 전체)하고 만든다.
  const [chosen, setChosen] = useState<Set<number>>(() => new Set(steps.map((_, i) => i)))
  const [customer, setCustomer] = useState('')
  const [busy, setBusy] = useState(false)
  const [shareNote, setShareNote] = useState<string | null>(null)
  const toggleStep = (i: number): void =>
    setChosen((prev) => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })

  const buildSlides = (): ClipSlide[] => {
    const picked = steps.filter((_, i) => chosen.has(i))
    const who = customer.trim() ? `${customer.trim()}님, ` : ''
    return [
      { badge: '보험 해지 안내', title: `${who}${insurer.name} 해지 방법`, body: ['아래 순서대로 하시면 됩니다'] },
      { badge: '전화 경로', title: guide.arsPath, body: [`고객센터 ${insurer.csPhone}`] },
      ...picked.map((s, i) => ({ badge: `STEP ${i + 1}`, title: s })),
      { badge: '미리 준비할 것', title: '준비물', body: docs },
      { badge: '꼭 확인', title: '해지 전 유의사항', body: [note] },
      { badge: '문의', title: '궁금하면 담당 설계사에게', body: ['SJ INVEST'] }
    ]
  }

  const makeAndShare = async (): Promise<void> => {
    if (busy || chosen.size === 0) return
    setBusy(true)
    setShareNote(null)
    const slides = buildSlides()
    let file: File | null = null
    let asVideo = false
    const clip = await generateSlideClip(slides, 2000)
    if (clip) {
      asVideo = true
      file = new File([clip.blob], `${insurer.name}_해지안내.${clip.ext}`, { type: clip.blob.type })
    } else {
      const png = await renderSlidePoster(slides)
      if (png) file = new File([png], `${insurer.name}_해지안내.png`, { type: 'image/png' })
    }
    if (!file) {
      setBusy(false)
      setShareNote('이 기기에서는 영상·이미지 생성이 안 돼요. 화면을 캡처해 보내주세요.')
      return
    }
    const r = await shareGuideFile(file)
    setBusy(false)
    setShareNote(r.message ?? (asVideo ? '영상 공유창을 열었어요.' : '영상이 지원되지 않아 이미지 안내로 보냈어요.'))
  }

  return (
    <div className="fixed inset-0 z-[95] flex flex-col bg-gradient-to-b from-[#0a1830] via-[#0e1e3a] to-[#091326]">
      {/* 헤더 */}
      <div className="relative shrink-0 border-b border-[rgba(255,255,255,0.08)] px-5 pb-3 pt-7 text-center">
        <button
          type="button"
          onClick={onClose}
          aria-label="해지 안내 닫기"
          className="absolute right-4 top-5 rounded-full border border-[rgba(255,255,255,0.18)] p-2 text-[#cbd5e1] active:bg-[rgba(255,255,255,0.08)]"
        >
          <X className="h-4 w-4" />
        </button>
        <div className="text-[11px] font-bold tracking-[0.2em] text-[#e6c877]">해지 진행 순서</div>
        <div className="mt-1 text-[19px] font-bold text-[#f1f5f9]">{insurer.name}</div>
        <span className="mt-1.5 inline-block rounded-full border border-[rgba(230,200,119,0.4)] bg-[rgba(230,200,119,0.1)] px-2 py-0.5 text-[10px] font-bold text-[#e6c877]">
          검수 전 참고용
        </span>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4">
        <div className="mx-auto max-w-[24rem] space-y-4">
          {/* ARS 경로 + 전화 */}
          <div className="rounded-2xl border border-[#c6982f] bg-[rgba(198,152,47,0.12)] p-3.5">
            <div className="text-[10px] font-bold tracking-widest text-[#e6c877]">전화 경로</div>
            <div className="mt-1 text-[14px] font-bold leading-relaxed text-[#f1f5f9]">{guide.arsPath}</div>
            <a
              href={`tel:${insurer.csPhone}`}
              className="mt-2.5 inline-flex items-center gap-1.5 rounded-full bg-[#22c55e] px-4 py-2 text-[13px] font-bold text-white active:brightness-90"
            >
              <Phone className="h-3.5 w-3.5" /> {insurer.csPhone} 전화
            </a>
          </div>

          {/* 준비물 */}
          <div>
            <div className="mb-1.5 flex items-center gap-1.5 text-[12px] font-bold text-[#cbd5e1]">
              <ClipboardList className="h-3.5 w-3.5 text-[#e6c877]" /> 미리 준비할 것
            </div>
            <div className="flex flex-wrap gap-1.5">
              {docs.map((d) => (
                <span
                  key={d}
                  className="rounded-full border border-[rgba(255,255,255,0.14)] bg-[rgba(255,255,255,0.04)] px-2.5 py-1 text-[11px] font-semibold text-[#e2e8f0]"
                >
                  {d}
                </span>
              ))}
            </div>
          </div>

          {/* 단계 (체크한 단계가 영상에 담긴다) */}
          <div>
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-[12px] font-bold text-[#cbd5e1]">
                <FileText className="h-3.5 w-3.5 text-[#e6c877]" /> 진행 순서
              </div>
              <span className="text-[10px] text-[#64748b]">체크한 단계가 영상에 담겨요</span>
            </div>
            <ol className="space-y-1.5">
              {steps.map((s, i) => {
                const on = chosen.has(i)
                return (
                  <li key={i}>
                    <button
                      type="button"
                      onClick={() => toggleStep(i)}
                      aria-pressed={on}
                      className={`flex w-full items-start gap-2.5 rounded-xl border px-3 py-2.5 text-left transition ${
                        on ? 'border-[#c6982f] bg-[rgba(198,152,47,0.1)]' : 'border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)]'
                      }`}
                    >
                      <span
                        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${
                          on ? 'border-[#c6982f] bg-[#c6982f] text-[#201603]' : 'border-[rgba(255,255,255,0.25)] text-transparent'
                        }`}
                      >
                        <Check className="h-3 w-3" />
                      </span>
                      <span className="text-[12.5px] leading-snug text-[#e2e8f0]">{s}</span>
                    </button>
                  </li>
                )
              })}
            </ol>
          </div>

          {/* 유의 */}
          <div className="rounded-2xl border border-[rgba(251,191,36,0.4)] bg-[rgba(251,191,36,0.08)] p-3">
            <div className="flex items-center gap-1.5 text-[11px] font-bold text-[#fbbf24]">
              <AlertTriangle className="h-3.5 w-3.5" /> 해지 전 꼭 확인
            </div>
            <p className="mt-1 text-[11.5px] leading-relaxed text-[#e2e8f0]">{note}</p>
          </div>

          {/* 고객에게 보내기 — 자막 슬라이드 영상 → 카톡 공유 */}
          <div className="rounded-2xl border border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.03)] p-3.5">
            <div className="flex items-center gap-1.5 text-[12px] font-bold text-[#e6c877]">
              <Video className="h-3.5 w-3.5" /> 고객에게 영상으로 보내기
            </div>
            <p className="mt-1 text-[10.5px] leading-relaxed text-[#94a3b8]">
              위에서 체크한 단계로 짧은 안내 영상을 만들어 카톡으로 공유합니다. (만드는 데 약 20초)
            </p>
            <input
              value={customer}
              onChange={(e) => setCustomer(e.target.value)}
              placeholder="고객 이름 (선택)"
              className="mt-2.5 w-full rounded-lg border border-[rgba(255,255,255,0.14)] bg-[rgba(255,255,255,0.04)] px-3 py-2 text-[13px] text-[#f1f5f9] outline-none placeholder:text-[#64748b] focus:border-[#c6982f]"
            />
            <button
              type="button"
              onClick={() => void makeAndShare()}
              disabled={busy || chosen.size === 0}
              className="mt-2.5 inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-[#22c55e] px-4 py-2.5 text-[13px] font-bold text-white active:brightness-90 disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Share2 className="h-4 w-4" />}
              {busy ? '영상 만드는 중… (약 20초)' : '영상 만들어 카톡 공유'}
            </button>
            {chosen.size === 0 ? (
              <p className="mt-1.5 text-[10.5px] text-[#fbbf24]">영상에 넣을 단계를 하나 이상 체크하세요.</p>
            ) : null}
            {shareNote ? <p className="mt-1.5 text-[11px] font-semibold text-[#e6c877]">{shareNote}</p> : null}
          </div>
        </div>
      </div>
    </div>
  )
}

export default function InsurerLinksMenu({ compact = false }: { compact?: boolean }): JSX.Element {
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<InsurerLink | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)

  // 브라우저 호환 안내는 몇 초 뒤 자동으로 사라진다.
  useEffect(() => {
    if (!notice) return
    const id = window.setTimeout(() => setNotice(null), 6000)
    return () => window.clearTimeout(id)
  }, [notice])

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

  /**
   * 전산 열기 — 무슨 상황이든 사이트는 반드시 새 탭으로 연다(2026-08-05 대표:
   * "크롬 전용 회사가 안 열린다" — 이전엔 엣지에서 크롬 전용을 안내만 하고 안 열어
   * 먹통처럼 보였음). 브라우저가 안 맞으면(설계사닷컴 호환표 기준) 여는 것과
   * 동시에 주소를 복사해주고 안내를 띄운다. 엣지 전용을 크롬에서 누르면
   * 윈도우 microsoft-edge: 프로토콜로 엣지 실행도 함께 시도한다.
   */
  const openInsurer = (l: InsurerLink): void => {
    const edgeNow = isEdgeBrowser()
    if (edgeNow && !l.edge && l.chrome) {
      window.open(l.url, '_blank', 'noopener')
      void copyText(l.url)
      setNotice(`${l.name} 전산은 크롬 권장입니다 — 일단 열었고 주소도 복사했어요. 화면이 이상하면 크롬 주소창에 붙여넣어 주세요.`)
      return
    }
    if (!edgeNow && !l.chrome && l.edge) {
      window.open(l.url, '_blank', 'noopener')
      try {
        window.location.href = `microsoft-edge:${l.url}`
      } catch {
        /* 프로토콜 미지원 환경이면 새 탭만 */
      }
      setNotice(`${l.name} 전산은 엣지 권장입니다 — 엣지 열기 창이 뜨면 허용을 눌러주세요.`)
      return
    }
    openLink(l.url)
  }

  const close = (): void => {
    setSelected(null)
    setNotice(null)
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
        /* 데스크톱: 회사 카드(브랜드 모노그램 + 전산 + 고객센터 + 공시실 + 브라우저 호환) */
        <div className="absolute right-0 z-[70] mt-2 max-h-[72vh] w-[31rem] overflow-y-auto rounded-2xl border border-slate-800 bg-white shadow-xl">
          <div className="border-b border-slate-800 bg-gradient-to-r from-[#0e1e3a] to-[#1a3057] px-4 py-3">
            <div className="text-[13px] font-bold text-[#f1f5f9]">보험사 바로가기</div>
            <div className="text-[10px] text-[#93a6c9]">
              카드 클릭=전산 접속(새 탭) · <span className="text-[#e6c877]">크롬/엣지</span> 배지는 전산 지원 브라우저
            </div>
          </div>
          {notice ? (
            <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-[11px] font-semibold text-amber-800">
              {notice}
            </div>
          ) : null}
          {INSURER_GROUPS.map((group: InsurerGroup) => {
            const items = INSURER_LINKS.filter((l) => l.group === group)
            if (items.length === 0) return null
            return (
              <div key={group}>
                <div className="bg-slate-900 px-4 py-1.5 text-[10px] font-bold tracking-wide text-[#8a6a1f]">
                  {group}
                </div>
                <div className="grid grid-cols-3 gap-2 bg-[#f4f6fb] p-2.5">
                  {items.map((l) => (
                    <div
                      key={l.name}
                      role="button"
                      tabIndex={0}
                      onClick={() => openInsurer(l)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') openInsurer(l)
                      }}
                      title={`${l.name} — ${l.portal}`}
                      className="group flex aspect-square cursor-pointer flex-col items-center justify-between rounded-2xl border border-slate-800 bg-white p-2 text-center shadow-sm transition hover:-translate-y-0.5 hover:border-[#c6982f] hover:shadow-md"
                      style={{ borderTopWidth: 3, borderTopColor: l.color }}
                    >
                      <div className="flex flex-1 flex-col items-center justify-center gap-1">
                        <span
                          className="flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-extrabold"
                          style={{ background: `${l.color}1f`, color: l.color }}
                        >
                          {monogram(l.name)}
                        </span>
                        <span className="break-keep text-[12px] font-bold leading-tight text-slate-100">{l.name}</span>
                        <span className="flex items-center gap-1 text-[10px] font-semibold text-slate-300">
                          <Phone className="h-2.5 w-2.5 text-emerald-700" />
                          {l.csPhone}
                        </span>
                        <span className="flex items-center gap-1">
                          <span
                            title={l.chrome ? '크롬 지원' : '크롬 미지원'}
                            className={`rounded px-1 py-px text-[8.5px] font-bold ${
                              l.chrome ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-900 text-slate-500 opacity-50 line-through'
                            }`}
                          >
                            크롬
                          </span>
                          <span
                            title={l.edge ? '엣지 지원' : '엣지 미지원'}
                            className={`rounded px-1 py-px text-[8.5px] font-bold ${
                              l.edge ? 'bg-sky-50 text-sky-700' : 'bg-slate-900 text-slate-500 opacity-50 line-through'
                            }`}
                          >
                            엣지
                          </span>
                        </span>
                      </div>
                      <div className="flex w-full gap-1">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            openInsurer(l)
                          }}
                          className="flex flex-1 items-center justify-center gap-0.5 rounded-lg border border-[#c6982f] bg-[#fdf7ea] py-1 text-[10px] font-bold text-[#8a6a1f] transition hover:brightness-95"
                        >
                          <ExternalLink className="h-2.5 w-2.5" />
                          전산
                        </button>
                        {l.disclosure ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              openLink(l.disclosure!)
                            }}
                            title={`${l.name} 상품공시실`}
                            className="flex flex-1 items-center justify-center gap-0.5 rounded-lg border border-indigo-200 bg-indigo-50 py-1 text-[10px] font-bold text-indigo-600 transition hover:brightness-95"
                          >
                            <ExternalLink className="h-2.5 w-2.5" />
                            공시실
                          </button>
                        ) : null}
                      </div>
                    </div>
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
