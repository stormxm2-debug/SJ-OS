import { useEffect, useRef, useState } from 'react'
import { X, Type, Check, PenLine, Eraser, Loader2, Save, Share2, Download } from 'lucide-react'
import { useSession } from '@renderer/navigation/SessionContext'
import { getSupabaseConfigStatus } from '@renderer/services/commercial/supabaseClient'
import { uploadSharedFile } from '@renderer/services/commercial/sharedFilesService'
import { fillPdf, loadPdfjs, type FillItem } from '@renderer/services/files/pdfFill'

/**
 * PDF 양식 채우기 편집기 (모바일 우선, 풀스크린 오버레이).
 *
 * 흐름: 페이지를 캔버스로 렌더링 → [텍스트/체크/서명] 모드에서 원하는 지점을 탭 →
 * 항목 배치(비율 좌표) → [저장]으로 새 PDF 생성 → 내 파일 업로드 + 공유/다운로드.
 * 원본 파일은 그대로 두고 "이름_작성_날짜.pdf"로 저장된다.
 */

type Mode = 'text' | 'check' | 'sign' | 'erase'

const SIZE_PT: Record<'s' | 'm' | 'l', number> = { s: 10, m: 14, l: 20 }

interface PageInfo {
  index: number
  dataUrl: string
  /** CSS 픽셀 기준 렌더 크기 (오버레이 좌표 계산용) */
  w: number
  h: number
}

function newId(): string {
  return `f-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`
}

export default function PdfFillEditor({
  fileName,
  data,
  onClose,
  onSaved
}: {
  fileName: string
  data: ArrayBuffer
  onClose: () => void
  onSaved?: () => void
}): JSX.Element {
  const { session } = useSession()
  const [pages, setPages] = useState<PageInfo[]>([])
  const [loadErr, setLoadErr] = useState<string | undefined>()
  const [mode, setMode] = useState<Mode>('text')
  const [textDraft, setTextDraft] = useState('')
  const [textSize, setTextSize] = useState<'s' | 'm' | 'l'>('m')
  const [items, setItems] = useState<FillItem[]>([])
  const [note, setNote] = useState<string | undefined>()

  // 서명: 한 번 그려두면 여러 곳에 반복 배치
  const [signDataUrl, setSignDataUrl] = useState<string | null>(null)
  const [showSignPad, setShowSignPad] = useState(false)

  const [saving, setSaving] = useState(false)
  const [savedBlob, setSavedBlob] = useState<{ blob: Blob; name: string } | null>(null)

  // 원본 바이트는 pdf.js/pdf-lib 각각에 복사본으로 넘긴다 (detach 방지)
  const bytesRef = useRef(new Uint8Array(data))

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const pdfjs = await loadPdfjs()
        const doc = await pdfjs.getDocument({ data: bytesRef.current.slice() }).promise
        const targetW = Math.min(900, Math.max(320, window.innerWidth - 24))
        const out: PageInfo[] = []
        for (let i = 1; i <= doc.numPages; i++) {
          const page = await doc.getPage(i)
          const base = page.getViewport({ scale: 1 })
          const scale = targetW / base.width
          const dpr = Math.min(2, window.devicePixelRatio || 1)
          const vp = page.getViewport({ scale: scale * dpr })
          const canvas = document.createElement('canvas')
          canvas.width = Math.round(vp.width)
          canvas.height = Math.round(vp.height)
          const ctx = canvas.getContext('2d')
          if (!ctx) throw new Error('canvas')
          // intent:'print' — rAF 스케줄링을 쓰지 않아 백그라운드 탭/웹뷰에서도 멈추지 않고,
          // 인쇄용 평면화(주석·양식 포함) 목적과도 일치한다.
          await page.render({ canvasContext: ctx, canvas, viewport: vp, intent: 'print' }).promise
          out.push({ index: i - 1, dataUrl: canvas.toDataURL('image/png'), w: Math.round(vp.width / dpr), h: Math.round(vp.height / dpr) })
          if (!alive) return
        }
        if (alive) setPages(out)
      } catch {
        if (alive) setLoadErr('PDF를 열지 못했습니다. (암호화된 파일은 지원하지 않습니다)')
      }
    })()
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const tapPage = (pageIndex: number, e: React.MouseEvent<HTMLDivElement>): void => {
    const rect = e.currentTarget.getBoundingClientRect()
    const xf = (e.clientX - rect.left) / rect.width
    const yf = (e.clientY - rect.top) / rect.height
    setNote(undefined)
    if (mode === 'erase') return
    if (mode === 'text') {
      if (!textDraft.trim()) {
        setNote('아래 입력칸에 넣을 내용을 먼저 적고, 원하는 위치를 탭하세요.')
        return
      }
      setItems((prev) => [...prev, { id: newId(), page: pageIndex, xf, yf, kind: 'text', text: textDraft.trim(), sizePt: SIZE_PT[textSize] }])
    } else if (mode === 'check') {
      setItems((prev) => [...prev, { id: newId(), page: pageIndex, xf, yf, kind: 'check' }])
    } else if (mode === 'sign') {
      if (!signDataUrl) {
        setShowSignPad(true)
        return
      }
      setItems((prev) => [...prev, { id: newId(), page: pageIndex, xf, yf, kind: 'sign', sign: { dataUrl: signDataUrl, wf: 0.22 } }])
    }
    setSavedBlob(null)
  }

  const removeItem = (id: string): void => {
    setItems((prev) => prev.filter((i) => i.id !== id))
    setSavedBlob(null)
  }

  const save = async (): Promise<void> => {
    if (items.length === 0) {
      setNote('추가된 내용이 없습니다 — 텍스트/체크/서명을 먼저 배치해 주세요.')
      return
    }
    setSaving(true)
    setNote(undefined)
    try {
      const bytes = await fillPdf(bytesRef.current.slice().buffer, items)
      const base = fileName.replace(/\.pdf$/i, '')
      const d = new Date()
      const outName = `${base}_작성_${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}.pdf`
      const blob = new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' })
      setSavedBlob({ blob, name: outName })
      if (getSupabaseConfigStatus().isConfigured) {
        const up = await uploadSharedFile(new File([blob], outName, { type: 'application/pdf' }), 'personal', session.name || '직원')
        setNote(up.ok ? `저장 완료 — [내 파일]에 "${outName}"로 올렸어요. 아래에서 바로 공유/인쇄할 수 있습니다.` : `${up.error} — 아래 공유/다운로드는 사용할 수 있습니다.`)
        if (up.ok) onSaved?.()
      } else {
        setNote('완성된 PDF가 준비됐어요 — 아래에서 공유하거나 다운로드하세요.')
      }
    } catch {
      setNote('PDF 저장에 실패했습니다. 다시 시도해 주세요.')
    } finally {
      setSaving(false)
    }
  }

  const share = async (): Promise<void> => {
    if (!savedBlob) return
    const file = new File([savedBlob.blob], savedBlob.name, { type: 'application/pdf' })
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function' && navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file] })
        return
      } catch {
        /* 사용자가 닫음 → 아래 다운로드로 */
      }
    }
    download()
  }

  const download = (): void => {
    if (!savedBlob) return
    const url = URL.createObjectURL(savedBlob.blob)
    const a = document.createElement('a')
    a.href = url
    a.download = savedBlob.name
    a.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000)
  }

  const toolBtn = (m: Mode, icon: JSX.Element, label: string): JSX.Element => (
    <button
      key={m}
      type="button"
      onClick={() => setMode(m)}
      className={[
        'flex flex-1 items-center justify-center gap-1 rounded-lg px-2 py-2 text-[11px] font-bold transition',
        mode === m ? 'bg-[#0e1e3a] text-[#e6c877]' : 'bg-white text-slate-500'
      ].join(' ')}
    >
      {icon}
      {label}
    </button>
  )

  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-slate-950">
      {/* 헤더 */}
      <div className="flex items-center justify-between gap-2 border-b border-slate-800 bg-white px-3 py-2.5">
        <div className="min-w-0 flex-1 truncate text-[13px] font-bold text-slate-100">{fileName}</div>
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-60"
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} 저장
        </button>
        <button type="button" onClick={onClose} aria-label="닫기" className="shrink-0 rounded-lg border border-slate-800 bg-white p-1.5 text-slate-400">
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* 도구 막대 */}
      <div className="border-b border-slate-800 bg-white px-3 py-2">
        <div className="flex gap-1.5 overflow-hidden rounded-xl border border-slate-800 p-1">
          {toolBtn('text', <Type className="h-3.5 w-3.5" />, '텍스트')}
          {toolBtn('check', <Check className="h-3.5 w-3.5" />, '체크')}
          {toolBtn('sign', <PenLine className="h-3.5 w-3.5" />, '서명')}
          {toolBtn('erase', <Eraser className="h-3.5 w-3.5" />, '지우기')}
        </div>
        {mode === 'text' ? (
          <div className="mt-2 flex items-center gap-1.5">
            <input
              value={textDraft}
              onChange={(e) => setTextDraft(e.target.value)}
              placeholder="넣을 내용 입력 후 원하는 위치를 탭"
              className="min-w-0 flex-1 rounded-lg border border-slate-800 bg-white px-2.5 py-2 text-[13px] text-slate-100 focus:outline-none"
            />
            {(['s', 'm', 'l'] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setTextSize(s)}
                className={['rounded-lg border px-2 py-2 text-[11px] font-bold', textSize === s ? 'border-[#c6982f] bg-[#0e1e3a] text-[#e6c877]' : 'border-slate-800 bg-white text-slate-500'].join(' ')}
              >
                {s === 's' ? '작게' : s === 'm' ? '보통' : '크게'}
              </button>
            ))}
          </div>
        ) : null}
        {mode === 'sign' ? (
          <div className="mt-2 flex items-center gap-2">
            {signDataUrl ? <img src={signDataUrl} alt="서명" className="h-9 rounded-lg border border-slate-800 bg-white px-1" /> : <span className="text-[11px] text-slate-500">서명을 먼저 그려주세요</span>}
            <button type="button" onClick={() => setShowSignPad(true)} className="rounded-lg border border-slate-800 bg-white px-2.5 py-1.5 text-[11px] font-bold text-slate-300">
              {signDataUrl ? '다시 그리기' : '서명 그리기'}
            </button>
            {signDataUrl ? <span className="text-[11px] text-slate-500">← 준비됨 · 넣을 위치를 탭하세요</span> : null}
          </div>
        ) : null}
        {mode === 'erase' ? <p className="mt-1.5 text-[11px] text-slate-500">지울 항목의 ✕ 를 누르세요</p> : null}
        {note ? <p className="mt-1.5 text-[11px] font-medium text-amber-700">{note}</p> : null}
        {savedBlob ? (
          <div className="mt-2 flex gap-1.5">
            <button type="button" onClick={() => void share()} className="inline-flex flex-1 items-center justify-center gap-1 rounded-lg bg-[#fee500] px-2 py-2 text-[11px] font-bold text-[#191919]">
              <Share2 className="h-3.5 w-3.5" /> 공유 / 인쇄
            </button>
            <button type="button" onClick={download} className="inline-flex flex-1 items-center justify-center gap-1 rounded-lg border border-slate-800 bg-white px-2 py-2 text-[11px] font-bold text-slate-300">
              <Download className="h-3.5 w-3.5" /> 다운로드
            </button>
          </div>
        ) : null}
      </div>

      {/* 페이지들 */}
      <div className="flex-1 overflow-y-auto px-3 py-3">
        {loadErr ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-3 text-center text-[12px] text-rose-700">{loadErr}</div>
        ) : pages.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin" /> PDF를 여는 중…
          </div>
        ) : (
          <div className="mx-auto flex w-fit flex-col gap-3 pb-10">
            {pages.map((p) => (
              <div
                key={p.index}
                data-pdf-page={p.index}
                role="button"
                tabIndex={0}
                onClick={(e) => tapPage(p.index, e)}
                onKeyDown={() => undefined}
                className="relative cursor-crosshair overflow-hidden rounded-lg bg-white shadow-lg"
                style={{ width: p.w, height: p.h }}
              >
                <img src={p.dataUrl} alt={`${p.index + 1}페이지`} className="block h-full w-full select-none" draggable={false} />
                {items
                  .filter((it) => it.page === p.index)
                  .map((it) => (
                    <span
                      key={it.id}
                      className="absolute"
                      style={{ left: `${it.xf * 100}%`, top: `${it.yf * 100}%` }}
                      onClick={(e) => {
                        if (mode === 'erase') {
                          e.stopPropagation()
                          removeItem(it.id)
                        }
                      }}
                    >
                      {it.kind === 'text' ? (
                        <span className="whitespace-pre font-semibold text-slate-900" style={{ fontSize: (it.sizePt ?? 14) * (p.w / 595) }}>
                          {it.text}
                        </span>
                      ) : it.kind === 'check' ? (
                        <Check className="text-blue-600" style={{ width: 16 * (p.w / 595), height: 16 * (p.w / 595) }} strokeWidth={3.2} />
                      ) : it.sign ? (
                        <img src={it.sign.dataUrl} alt="서명" style={{ width: it.sign.wf * p.w }} draggable={false} />
                      ) : null}
                      {mode === 'erase' ? (
                        <span className="absolute -right-2.5 -top-2.5 flex h-5 w-5 items-center justify-center rounded-full bg-rose-500 text-[10px] font-bold text-white shadow">✕</span>
                      ) : null}
                    </span>
                  ))}
              </div>
            ))}
          </div>
        )}
      </div>

      {showSignPad ? <SignPad onUse={(url) => { setSignDataUrl(url); setShowSignPad(false) }} onClose={() => setShowSignPad(false)} /> : null}
    </div>
  )
}

/* ─── 손가락 서명 패드 ─────────────────────────────────────────────────── */

function SignPad({ onUse, onClose }: { onUse: (dataUrl: string) => void; onClose: () => void }): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)
  const hasInk = useRef(false)

  const pos = (e: React.PointerEvent<HTMLCanvasElement>): { x: number; y: number } => {
    const rect = e.currentTarget.getBoundingClientRect()
    return { x: ((e.clientX - rect.left) / rect.width) * e.currentTarget.width, y: ((e.clientY - rect.top) / rect.height) * e.currentTarget.height }
  }

  const start = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx) return
    drawing.current = true
    hasInk.current = true
    const p = pos(e)
    ctx.strokeStyle = '#101828'
    ctx.lineWidth = 5
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.beginPath()
    ctx.moveTo(p.x, p.y)
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const move = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    if (!drawing.current) return
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx) return
    const p = pos(e)
    ctx.lineTo(p.x, p.y)
    ctx.stroke()
  }
  const end = (): void => {
    drawing.current = false
  }
  const clear = (): void => {
    const c = canvasRef.current
    const ctx = c?.getContext('2d')
    if (c && ctx) ctx.clearRect(0, 0, c.width, c.height)
    hasInk.current = false
  }
  const use = (): void => {
    const c = canvasRef.current
    if (!c || !hasInk.current) return
    onUse(c.toDataURL('image/png'))
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-sm rounded-2xl border border-slate-800 bg-white p-4 shadow-2xl">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-bold text-slate-100">서명 그리기</span>
          <button type="button" onClick={onClose} aria-label="닫기" className="rounded-lg p-1 text-slate-400">
            <X className="h-4 w-4" />
          </button>
        </div>
        <canvas
          ref={canvasRef}
          width={600}
          height={260}
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
          className="w-full touch-none rounded-xl border border-slate-800 bg-slate-950"
          style={{ aspectRatio: '600 / 260' }}
        />
        <div className="mt-3 flex gap-2">
          <button type="button" onClick={clear} className="flex-1 rounded-xl border border-slate-800 bg-white px-3 py-2 text-xs font-bold text-slate-400">
            지우기
          </button>
          <button type="button" onClick={use} className="flex-1 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-3 py-2 text-xs font-bold text-white">
            이 서명 사용
          </button>
        </div>
      </div>
    </div>
  )
}
