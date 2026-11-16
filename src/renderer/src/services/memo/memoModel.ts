/**
 * 개인 메모 모델 (순수 함수). 고정 메모가 먼저, 그다음 최근 수정 순.
 */
export interface MemoItem {
  id: string
  title: string
  body: string
  pinned: boolean
  updatedAt: string
}

export const MEMO_TITLE_MAX = 100
export const MEMO_BODY_MAX = 10000

export interface MemoValidation {
  ok: boolean
  error?: string
}

/** 저장 전 입력 검증. 빈 제목은 허용(본문 첫 줄로 대체 표시). */
export function validateMemo(title: string, body: string): MemoValidation {
  if (title.length > MEMO_TITLE_MAX) return { ok: false, error: `제목은 ${MEMO_TITLE_MAX}자 이내여야 합니다.` }
  if (body.length > MEMO_BODY_MAX) return { ok: false, error: `내용은 ${MEMO_BODY_MAX}자 이내여야 합니다.` }
  return { ok: true }
}

/** 목록 표시 제목: 제목이 있으면 제목, 없으면 본문 첫 줄, 둘 다 없으면 '빈 메모'. */
export function memoDisplayTitle(m: Pick<MemoItem, 'title' | 'body'>): string {
  const t = m.title.trim()
  if (t) return t
  const firstLine = m.body.split('\n').map((l) => l.trim()).find((l) => l.length > 0)
  return firstLine ?? '빈 메모'
}

/** 고정 우선, 그다음 최근 수정 순. 원본 배열은 바꾸지 않는다. */
export function sortMemos(list: MemoItem[]): MemoItem[] {
  return [...list].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
    return (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0)
  })
}

/** 검색어로 제목·본문을 거른다(대소문자 무시, 공백만 있으면 전체). */
export function filterMemos(list: MemoItem[], query: string): MemoItem[] {
  const q = query.trim().toLowerCase()
  if (!q) return list
  return list.filter((m) => `${m.title}\n${m.body}`.toLowerCase().includes(q))
}
