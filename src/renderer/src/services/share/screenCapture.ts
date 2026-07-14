/**
 * 화면 캡처 → 카톡 전송 (대표 지시: "앱 화면 캡처해서 그대로 고객에게 카톡으로").
 *
 * - 현재 콘텐츠 영역(스크롤 전체 높이 포함)을 고해상도 PNG로 뜬다 (html-to-image, 지연 로드).
 * - OS 공유창(navigator.share)으로 넘겨 카톡 방/고객을 골라 바로 전송.
 * - 공유창이 없는 환경(PC 브라우저 등)은 PNG 다운로드로 폴백 — 파일을 카톡 PC버전에 첨부.
 * - 전부 기기 안에서 처리 — 캡처 이미지가 서버로 올라가지 않는다.
 */

export interface CaptureResult {
  ok: boolean
  /** 실패/폴백 안내 (성공적으로 공유창이 뜨면 비어 있음). */
  message?: string
}

function stamp(): string {
  const d = new Date()
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`
}

export async function captureAndShareElement(el: HTMLElement, baseName = 'SJ화면'): Promise<CaptureResult> {
  let blob: Blob | null = null
  try {
    const { toBlob } = await import('html-to-image')
    // 일부 웹뷰에서 렌더링 프레임이 멈춰 있으면 라이브러리가 영원히 대기할 수 있어
    // 하드 타임아웃을 건다 — 버튼이 무한 로딩으로 남지 않게.
    blob = await Promise.race([
      toBlob(el, {
        pixelRatio: 2,
        backgroundColor: '#f1f5f9',
        // 스크롤 밖 내용까지 전체 캡처
        width: el.scrollWidth,
        height: el.scrollHeight,
        style: { overflow: 'visible' }
      }),
      new Promise<null>((_, reject) => window.setTimeout(() => reject(new Error('capture-timeout')), 15000))
    ])
  } catch {
    return { ok: false, message: '화면 캡처에 실패했습니다. 다시 시도해 주세요.' }
  }
  if (!blob) return { ok: false, message: '화면 캡처에 실패했습니다. 다시 시도해 주세요.' }

  const file = new File([blob], `${baseName}_${stamp()}.png`, { type: 'image/png' })

  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function' && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] })
      return { ok: true }
    } catch (e) {
      // 사용자가 공유창을 닫은 것(AbortError)은 실패가 아님
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
    return { ok: true, message: '이 기기는 공유창이 없어 이미지로 저장했어요 — 카톡에 첨부해 보내세요.' }
  } catch {
    return { ok: false, message: '이미지 저장에 실패했습니다.' }
  }
}
