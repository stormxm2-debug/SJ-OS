import * as pdfjs from 'pdfjs-dist'
// Vite resolves `?url` to the emitted worker asset — works in both the web build
// (base '/') and the Electron build (base './'). Keeps PDF rendering off the main thread.
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjs.GlobalWorkerOptions.workerSrc = workerSrc

/** Render each page of a PDF File to a JPEG Blob (scale up so small print stays legible). */
export async function pdfToImageBlobs(file: File, scale = 2): Promise<Blob[]> {
  const data = new Uint8Array(await file.arrayBuffer())
  const loadingTask = pdfjs.getDocument({ data })
  const pdf = await loadingTask.promise
  const blobs: Blob[] = []
  try {
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i)
      const viewport = page.getViewport({ scale })
      const canvas = document.createElement('canvas')
      canvas.width = Math.ceil(viewport.width)
      canvas.height = Math.ceil(viewport.height)
      const ctx = canvas.getContext('2d')
      if (!ctx) continue
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await page.render({ canvas, canvasContext: ctx, viewport } as any).promise
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.85))
      if (blob) blobs.push(blob)
      canvas.width = 0
      canvas.height = 0
    }
  } finally {
    await loadingTask.destroy()
  }
  return blobs
}

/**
 * Convert a mix of files (PDF/images) into image Blobs for OpenAI vision. PDFs are
 * rasterized page-by-page; image files pass through. Capped at `maxImages` total to
 * keep the request within model/token limits.
 */
export async function filesToImageBlobs(files: File[], maxImages = 15): Promise<Blob[]> {
  const out: Blob[] = []
  for (const f of files) {
    if (out.length >= maxImages) break
    if (f.type === 'application/pdf') {
      const pages = await pdfToImageBlobs(f)
      for (const p of pages) {
        if (out.length >= maxImages) break
        out.push(p)
      }
    } else if (f.type.startsWith('image/')) {
      out.push(f)
    }
  }
  return out.slice(0, maxImages)
}
