/**
 * 공용 클립보드 복사 — 인앱 브라우저(카톡 등)·구형 웹뷰까지 커버.
 *
 * 왜 필요한가: `navigator.clipboard`는 HTTPS + 권한 + 포커스가 모두 맞아야 동작하고,
 * **카카오톡 인앱 브라우저·일부 안드로이드 웹뷰에서는 아예 막혀 있다.** 표준 API만
 * 쓰면 폰에서 복사 버튼이 조용히 실패한다(실제 대표님 신고 사례: AI 스튜디오 릴스 복사).
 * 그래서 표준 API가 실패하면 execCommand('copy') 폴백으로 재시도한다.
 *
 * 반환값은 **정직하다** — 실제로 복사됐을 때만 true. (성공한 척 하지 않는다: 사용자가
 * 붙여넣기 했을 때 비어 있는 게 최악이다.)
 * 주의: 폴백은 사용자 제스처(클릭) 안에서 호출해야 브라우저가 허용한다.
 */
export async function copyText(text: string): Promise<boolean> {
  if (!text) return false

  // 1) 표준 Clipboard API
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* 인앱 브라우저/권한 거부 — 폴백으로 */
  }

  // 2) execCommand 폴백 (카톡 인앱·구형 웹뷰)
  try {
    if (typeof document === 'undefined') return false
    const ta = document.createElement('textarea')
    ta.value = text
    // 화면에 보이지 않게, 단 display:none 은 선택이 안 되므로 투명 고정 배치
    ta.style.position = 'fixed'
    ta.style.top = '0'
    ta.style.left = '0'
    ta.style.width = '1px'
    ta.style.height = '1px'
    ta.style.padding = '0'
    ta.style.border = 'none'
    ta.style.outline = 'none'
    ta.style.boxShadow = 'none'
    ta.style.background = 'transparent'
    ta.style.opacity = '0'
    // iOS 사파리는 readonly textarea 선택이 막히므로 contentEditable 로 우회
    ta.contentEditable = 'true'
    ta.readOnly = false
    document.body.appendChild(ta)

    const range = document.createRange()
    range.selectNodeContents(ta)
    const sel = window.getSelection()
    sel?.removeAllRanges()
    sel?.addRange(range)
    ta.setSelectionRange(0, text.length)
    ta.focus()

    const ok = document.execCommand('copy')
    sel?.removeAllRanges()
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}
