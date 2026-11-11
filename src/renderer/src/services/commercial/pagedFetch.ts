/**
 * 페이지 단위로 끝까지 모두 가져오기 (순수 함수, 테스트 대상).
 *
 * 배경: PostgREST 는 한 번의 조회에 기본 1,000행까지만 돌려준다. 정렬 없이 또는 오래된
 * 순으로 한 번만 조회하면, 행이 1,000개를 넘는 순간 최근 데이터가 통째로 빠진다
 * (일정 목록에서 11월 등록 일정이 안 보였던 원인).
 *
 * 규칙: fetchPage(from, to) 를 pageSize 단위로 호출하고, 마지막 페이지(행 수 < pageSize)가
 * 나올 때까지 모은다. 안전 상한(maxRows)을 둬서 무한 루프를 막는다.
 */

export interface PageResult<T> {
  rows: T[]
  error?: unknown
}

export async function fetchAllPages<T>(
  fetchPage: (from: number, to: number) => Promise<PageResult<T>>,
  pageSize = 1000,
  maxRows = 50000
): Promise<{ rows: T[]; error?: unknown }> {
  const out: T[] = []
  let from = 0
  // 안전 상한까지만 반복
  while (out.length < maxRows) {
    const to = from + pageSize - 1
    const { rows, error } = await fetchPage(from, to)
    if (error) return { rows: out, error }
    out.push(...rows)
    if (rows.length < pageSize) break
    from += pageSize
  }
  return { rows: out }
}
