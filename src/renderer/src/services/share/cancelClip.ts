/**
 * 해지 안내 '자막 슬라이드 영상' 생성 + 공유.
 *
 * - 캔버스에 단계별 자막 슬라이드를 그려 MediaRecorder 로 짧은 세로 영상(mp4/webm)으로 캡처.
 * - navigator.share(파일)로 카톡 등에 공유, 없으면 다운로드 폴백(screenCapture 패턴 동일).
 * - MediaRecorder/캔버스 캡처 미지원(일부 카톡 인앱 웹뷰)에서는 generateSlideClip 이 null →
 *   호출부가 renderSlidePoster(PNG) 폴백으로 전환한다. (거짓 성공 없이 정직하게)
 * - 전부 기기 안에서 처리 — 서버로 아무것도 올라가지 않는다.
 */

export interface ClipSlide {
  /** 상단 소제목 (예: "STEP 2", "전화 경로", "준비물") */
  badge: string
  /** 큰 제목 */
  title: string
  /** 본문 여러 줄 */
  body?: string[]
}

const W = 720
const H = 1280

/** 글자 폭 기준 줄바꿈 (한글은 글자 단위로 끊는다). */
function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const lines: string[] = []
  let cur = ''
  for (const ch of [...text]) {
    const test = cur + ch
    if (ctx.measureText(test).width > maxW && cur) {
      lines.push(cur)
      cur = ch
    } else {
      cur = test
    }
  }
  if (cur) lines.push(cur)
  return lines
}

function paintBackground(ctx: CanvasRenderingContext2D): void {
  const g = ctx.createLinearGradient(0, 0, 0, H)
  g.addColorStop(0, '#0a1830')
  g.addColorStop(1, '#091326')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, W, H)
}

/** 슬라이드 한 장 그리기. t=0~1 (슬라이드 내 경과) — 앞부분 페이드인. */
function drawSlide(ctx: CanvasRenderingContext2D, s: ClipSlide, t: number): void {
  paintBackground(ctx)
  ctx.globalAlpha = Math.min(1, t / 0.18)
  ctx.textAlign = 'center'
  const cx = W / 2

  ctx.fillStyle = '#e6c877'
  ctx.font = 'bold 30px sans-serif'
  ctx.fillText('SJ INVEST', cx, 96)

  ctx.fillStyle = '#c6982f'
  ctx.font = 'bold 34px sans-serif'
  ctx.fillText(s.badge, cx, 300)

  ctx.fillStyle = '#f1f5f9'
  ctx.font = 'bold 58px sans-serif'
  let y = 300 + 96
  for (const line of wrap(ctx, s.title, W - 120)) {
    ctx.fillText(line, cx, y)
    y += 72
  }

  if (s.body?.length) {
    ctx.fillStyle = '#cbd5e1'
    ctx.font = '38px sans-serif'
    y += 26
    for (const b of s.body) {
      for (const line of wrap(ctx, b, W - 140)) {
        ctx.fillText(line, cx, y)
        y += 52
      }
      y += 12
    }
  }
  ctx.globalAlpha = 1
}

type CanvasWithCapture = HTMLCanvasElement & { captureStream?: (fps?: number) => MediaStream }

/** 자막 슬라이드 세로 영상 생성. 미지원 브라우저면 null. */
export async function generateSlideClip(
  slides: ClipSlide[],
  perSlideMs = 2800
): Promise<{ blob: Blob; ext: 'mp4' | 'webm' } | null> {
  if (typeof document === 'undefined' || typeof MediaRecorder === 'undefined' || slides.length === 0) return null
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  const capture = (canvas as CanvasWithCapture).captureStream
  if (!ctx || typeof capture !== 'function') return null

  const mime = MediaRecorder.isTypeSupported('video/mp4')
    ? 'video/mp4'
    : MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
      ? 'video/webm;codecs=vp9'
      : MediaRecorder.isTypeSupported('video/webm')
        ? 'video/webm'
        : ''
  if (!mime) return null

  let rec: MediaRecorder
  try {
    rec = new MediaRecorder(capture.call(canvas, 30), { mimeType: mime })
  } catch {
    return null
  }

  const chunks: BlobPart[] = []
  rec.ondataavailable = (e): void => {
    if (e.data && e.data.size) chunks.push(e.data)
  }
  const stopped = new Promise<void>((res) => {
    rec.onstop = (): void => res()
  })

  drawSlide(ctx, slides[0], 1)
  try {
    rec.start()
  } catch {
    return null
  }

  const total = slides.length * perSlideMs
  const start = performance.now()
  await new Promise<void>((resolve) => {
    const frame = (now: number): void => {
      const elapsed = now - start
      const idx = Math.min(slides.length - 1, Math.floor(elapsed / perSlideMs))
      drawSlide(ctx, slides[idx], (elapsed - idx * perSlideMs) / perSlideMs)
      if (elapsed >= total) resolve()
      else requestAnimationFrame(frame)
    }
    requestAnimationFrame(frame)
  })

  rec.stop()
  await stopped
  const ext: 'mp4' | 'webm' = mime.startsWith('video/mp4') ? 'mp4' : 'webm'
  return { blob: new Blob(chunks, { type: mime }), ext }
}

/** 영상 미지원 시 폴백 — 전체 안내를 세로 PNG 한 장으로. */
export async function renderSlidePoster(slides: ClipSlide[]): Promise<Blob | null> {
  if (typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  paintBackground(ctx)
  ctx.textAlign = 'left'
  ctx.fillStyle = '#e6c877'
  ctx.font = 'bold 34px sans-serif'
  ctx.fillText('SJ INVEST · 보험 해지 안내', 56, 96)
  let y = 176
  for (const s of slides) {
    if (y > H - 90) break
    ctx.fillStyle = '#c6982f'
    ctx.font = 'bold 26px sans-serif'
    ctx.fillText(s.badge, 56, y)
    y += 42
    ctx.fillStyle = '#f1f5f9'
    ctx.font = 'bold 36px sans-serif'
    for (const line of wrap(ctx, s.title, W - 112)) {
      ctx.fillText(line, 56, y)
      y += 46
    }
    if (s.body?.length) {
      ctx.fillStyle = '#cbd5e1'
      ctx.font = '30px sans-serif'
      for (const b of s.body) for (const line of wrap(ctx, b, W - 112)) {
        ctx.fillText(line, 56, y)
        y += 40
      }
    }
    y += 24
  }
  return new Promise((res) => canvas.toBlob((b) => res(b), 'image/png'))
}

export interface ShareResult {
  ok: boolean
  /** 성공적으로 공유창이 뜨면 비어 있음 — 폴백/실패 시에만 안내. */
  message?: string
}

/** 생성된 파일(영상/이미지)을 OS 공유창으로 — 없으면 다운로드 폴백. */
export async function shareGuideFile(file: File): Promise<ShareResult> {
  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function' && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] })
      return { ok: true }
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return { ok: true }
      /* 공유 실패 → 다운로드 폴백 */
    }
  }
  try {
    const url = URL.createObjectURL(file)
    const a = document.createElement('a')
    a.href = url
    a.download = file.name
    a.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000)
    return { ok: true, message: '이 기기는 공유창이 없어 파일로 저장했어요 — 카톡 대화방에 첨부해 보내세요.' }
  } catch {
    return { ok: false, message: '공유에 실패했습니다. 다시 시도해 주세요.' }
  }
}
