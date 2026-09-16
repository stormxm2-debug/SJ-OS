import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

// PDF 버퍼에서 페이지별 텍스트 아이템(텍스트+좌표)을 추출한다.
// 텍스트 레이어가 없는(스캔) 페이지는 items가 빈 배열로 반환된다 -> 호출부에서 OCR로 폴백.
export async function loadPdf(buffer) {
  const doc = await getDocument({
    data: buffer,
    isEvalSupported: false,
    useWorkerFetch: false,
    disableFontFace: true,
  }).promise;
  return doc;
}

export async function extractPageText(pdfPage) {
  const viewport = pdfPage.getViewport({ scale: 1 });
  const textContent = await pdfPage.getTextContent();

  const items = textContent.items
    .filter((it) => it.str && it.str.trim().length > 0)
    .map((it) => {
      const [a, b, c, d, e, f] = it.transform;
      const fontHeight = Math.hypot(c, d) || Math.hypot(a, b) || 10;
      return {
        str: it.str,
        x: e,
        // pdf.js 좌표는 아래에서 위로 증가하므로 위->아래 기준으로 뒤집는다.
        y: viewport.height - f,
        width: it.width || 0,
        height: fontHeight,
        confidence: 100, // 텍스트 레이어는 인식 오류가 없다고 간주
      };
    });

  return { items, width: viewport.width, height: viewport.height };
}

// 스캔 PDF(텍스트 레이어 없음) 페이지를 OCR용 PNG 이미지로 렌더링한다.
export async function renderPageToPng(pdfPage, scale = 3) {
  const { createCanvas } = await import("@napi-rs/canvas");
  const viewport = pdfPage.getViewport({ scale });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const ctx = canvas.getContext("2d");
  await pdfPage.render({ canvasContext: ctx, viewport }).promise;
  return canvas.toBuffer("image/png");
}
