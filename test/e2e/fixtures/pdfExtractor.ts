// E2E 스텁: pdfjs 미번들(?url 임포트 회피). window.__FIX.pdfPages 로 페이지 주입.
export const extractPdfPagesForIngest = async (): Promise<Array<{ page: number; text: string }>> => {
  const g = globalThis as unknown as { __FIX?: { pdfPages?: Array<{ page: number; text: string }> } }
  return g.__FIX?.pdfPages ?? [{ page: 1, text: 'stub page text' }]
}
