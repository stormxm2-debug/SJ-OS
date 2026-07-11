import { PDFDocument, rgb } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — vite 에셋(?url) 임포트
import koreanFontUrl from '@renderer/assets/fonts/NanumGothic-Regular.ttf?url'

/**
 * PDF 양식 채우기 코어 (전부 브라우저 메모리에서 처리 — 서버 전송 없음).
 *
 * - 좌표는 화면에서 찍은 지점을 페이지 크기의 비율(0~1, 좌상단 원점)로 저장하고,
 *   PDF 좌표(좌하단 원점)로 변환해 원본 PDF 위에 그린다. 원본은 수정하지 않는다.
 * - 한글 텍스트는 나눔고딕(OFL)을 subset 임베드 — 표준 PDF 폰트는 한글이 안 나온다.
 * - 서명은 PNG(투명 배경)로 임베드.
 */

export type FillKind = 'text' | 'check' | 'sign'

export interface FillItem {
  id: string
  /** 0-based 페이지 번호 */
  page: number
  /** 페이지 가로/세로 대비 비율 (0~1, 좌상단 원점) */
  xf: number
  yf: number
  kind: FillKind
  text?: string
  /** A4(595pt) 기준 포인트 크기 — 페이지 폭에 비례 스케일 */
  sizePt?: number
  sign?: { dataUrl: string; wf: number }
}

let fontCache: ArrayBuffer | null = null

/** 한글 폰트 로드 (최초 1회만 네트워크, 이후 메모리 캐시). */
export async function loadKoreanFont(): Promise<ArrayBuffer> {
  if (fontCache) return fontCache
  const res = await fetch(koreanFontUrl as string)
  if (!res.ok) throw new Error('한글 폰트를 불러오지 못했습니다.')
  fontCache = await res.arrayBuffer()
  return fontCache
}

/** pdf.js 지연 로드 (+worker 연결) — 편집기를 열 때만 내려받는다. */
export async function loadPdfjs(): Promise<typeof import('pdfjs-dist')> {
  const pdfjs = await import('pdfjs-dist')
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore — vite 에셋(?url) 임포트
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default as string
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
  return pdfjs
}

/** 원본 PDF 위에 입력 항목들을 그려 새 PDF 바이트를 만든다. */
export async function fillPdf(original: ArrayBuffer, items: FillItem[]): Promise<Uint8Array> {
  const doc = await PDFDocument.load(original, { ignoreEncryption: true })
  let font: Awaited<ReturnType<typeof doc.embedFont>> | undefined
  if (items.some((i) => i.kind === 'text' && (i.text ?? '').trim())) {
    doc.registerFontkit(fontkit)
    font = await doc.embedFont(await loadKoreanFont(), { subset: true })
  }
  const pages = doc.getPages()

  for (const it of items) {
    const page = pages[it.page]
    if (!page) continue
    const { width, height } = page.getSize()
    const x = it.xf * width
    const yTop = it.yf * height
    const scale = width / 595 // A4 폭 기준 비례

    if (it.kind === 'text' && it.text?.trim() && font) {
      const size = (it.sizePt ?? 14) * scale
      page.drawText(it.text, { x, y: height - yTop - size, size, font, color: rgb(0.08, 0.1, 0.14) })
    } else if (it.kind === 'check') {
      const s = 16 * scale
      const stroke = { thickness: Math.max(1.2, s * 0.14), color: rgb(0.05, 0.35, 0.85) }
      page.drawLine({ start: { x, y: height - yTop - s * 0.55 }, end: { x: x + s * 0.35, y: height - yTop - s * 0.95 }, ...stroke })
      page.drawLine({ start: { x: x + s * 0.35, y: height - yTop - s * 0.95 }, end: { x: x + s, y: height - yTop - s * 0.05 }, ...stroke })
    } else if (it.kind === 'sign' && it.sign) {
      const png = await doc.embedPng(it.sign.dataUrl)
      const w = Math.max(24, (it.sign.wf || 0.25) * width)
      const h = w * (png.height / png.width)
      page.drawImage(png, { x, y: height - yTop - h, width: w, height: h })
    }
  }
  return doc.save()
}
