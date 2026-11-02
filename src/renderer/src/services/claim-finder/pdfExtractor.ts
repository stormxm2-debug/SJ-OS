/**
 * SJ CLAIM FINDER — 실 PDF 페이지 텍스트 추출기(pdfjs 래퍼).
 *
 * ingest.ts 의 PdfPageExtractor 구현. 기존 loadPdfjs(services/files/pdfFill) 를 재사용한다.
 * 무거운 의존(pdfjs)을 분리해, ingest 코어/테스트는 이 파일 없이도 동작한다(DI).
 *
 * ⚠️ 자동 담보 매핑은 하지 않는다 — 페이지별 원문 텍스트만 돌려준다(사람 확인·입력용).
 */
import { loadPdfjs } from '../files/pdfFill'
import type { PdfPageExtractor, PdfPageText } from './ingest'

export const extractPdfPagesForIngest: PdfPageExtractor = async (bytes: Uint8Array): Promise<PdfPageText[]> => {
  const pdfjs = await loadPdfjs()
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes) })
  const doc = await task.promise
  const out: PdfPageText[] = []
  try {
    for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
      const page = await doc.getPage(pageNum)
      const content = await page.getTextContent()
      const text = content.items
        .map((raw) => ('str' in raw ? raw.str : ''))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim()
      out.push({ page: pageNum, text })
      page.cleanup()
    }
  } finally {
    // 워커 리소스 정리(pdfjs 런타임에 존재하나 타입에 없을 수 있어 방어적 캐스팅).
    await (doc as unknown as { destroy?: () => Promise<void> }).destroy?.()
  }
  return out
}
