import { loadPdfjs } from '@renderer/services/files/pdfFill'

/**
 * 가입제안서 담보표 추출 (전부 브라우저 메모리에서 처리 — 서버·AI 전송 없음).
 *
 * 보험사마다 표 레이아웃이 달라 고정된 열 순서를 가정하지 않는다. 헤더 키워드 위치와
 * 본문 글자의 x좌표로 열을 추론한다. 메리츠·NH농협생명·하나생명·흥국생명·현대해상
 * 실제 제안서로 검증한 규칙을 옮겨왔다. 1차는 글자가 들어 있는 PDF만 지원한다(스캔본 OCR 제외).
 */

export interface TextItem {
  str: string
  x: number
  y: number
  width: number
  height: number
}

export interface PageItems {
  pageNum: number
  items: TextItem[]
}

export interface ParsedRow {
  coverageName: string
  amount: string
  term: string
  premium: string
  pageNum: number
  columnAmbiguous: boolean
}

export interface ParseResult {
  rows: ParsedRow[]
  warnings: string[]
}

type DataColumn = 'amount' | 'paymentTerm' | 'maturity' | 'premium'
type Anchors = Partial<Record<DataColumn, number>>

interface Word extends TextItem {
  endX: number
}

type LineRecord =
  | { kind: 'header' | 'excluded'; pageNum: number }
  | {
      kind: 'data'
      pageNum: number
      cells: Record<DataColumn, Word[]>
      leftItems: Word[]
      termItems: Word[]
      columnAmbiguous: boolean
      hasData: boolean
      amountUnit: string
    }

export const REVIEW = '확인 필요'

const HEADER_KEYWORDS: Record<DataColumn, string[]> = {
  amount: ['가입금액', '보험가입금액'],
  paymentTerm: ['납입기간', '납기', '보험료납입기간'],
  maturity: ['보험기간', '만기', '만기일', '보장기간'],
  premium: ['보험료', '담보보험료', '월보험료', '특약보험료', '계약보험료']
}
const ALL_HEADER_KEYWORDS = Object.values(HEADER_KEYWORDS).flat()

const EXCLUDE_LINE_PATTERNS: RegExp[] = [
  /합\s*계/,
  /총\s*보험료/,
  /총\s*납입/,
  /실\s*납입/,
  /대상계약/,
  /^\s*[※*]/,
  /안내\s*사항/,
  /유의\s*사항/,
  /^\s*\d+\s*\/\s*\d+\s*$/,
  /^\s*-\s*\d+\s*-\s*$/,
  /^\s*-\s*\d+\s*\/\s*\d+\s*-\s*$/,
  /^\s*page\s*[:\s]*\d+/i,
  /page\s*[:\s]*\d+\s*\/\s*\d+/i,
  // 보험료/계약자 안내 블록, 머리글·바닥글
  /^보험료\s*사항/,
  /^계약자\s*\/?\s*피보험자\s*사항/,
  /^담보\s*사항\s*$/,
  /설계번호/,
  /^계약자\s/,
  /^피보험자\s/,
  /계약자\s*연락처/,
  /주피보험자와의\s*관계/,
  /운전자상태/,
  /피보험자\s*직업/,
  /영업담당자/,
  /고객콜센터/,
  /발행정보/,
  /고유번호/,
  /^\(?\d{2,4}[-)]\d{3,4}-\d{4}\)?/
]

// 표가 끝났음을 알리는 안내문
const TABLE_END_NOTE = /요약하여\s*안내하는\s*표|가입담보리스트는/
// 이미 추출한 담보표를 설명과 함께 다시 싣는 상세본
const DETAIL_HEADER_LABEL = /보장내용|설명서|상품설명/
// "40세, 남자 기준 보험료 비교(예시)"처럼 실제 계약이 아닌 예시표 앞에 붙는 문구
const EXAMPLE_CONTEXT = /예시|비교|산출\s*조건|가상|\d+\s*세\s*,\s*(남|여)/
const MATURITY_LIKE = /만기|세$|종신/
const HEADER_CELL_MAX_LEN = 10
const MONEY_LIKE = /^(확인 필요|(?:[\d,.]+\s*(?:십|백|천|만|억)*\s*)+원?)$/
// 쉼표는 세 자리마다, 소수점은 "5.4만원"처럼 두 자리 이하만 허용
const STRICT_MONEY =
  /^(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?\s*(?:[십백천만억]+)?(?:\s*(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?\s*[십백천만억]+)*\s*원?$/
// 표 왼쪽의 특약 순번. '12' 도 있고 '12.' '12)' 도 있다.
const PURE_NUMBER = /^\d+[.)]?$/

/* ---------- PDF 글자 추출 ---------- */

export async function extractPdfPages(data: ArrayBuffer): Promise<{ pages: PageItems[]; scannedPages: number[] }> {
  const pdfjs = await loadPdfjs()
  const task = pdfjs.getDocument({ data: new Uint8Array(data) })
  const doc = await task.promise
  const pages: PageItems[] = []
  const scannedPages: number[] = []
  try {
    for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
      const page = await doc.getPage(pageNum)
      const viewport = page.getViewport({ scale: 1 })
      const content = await page.getTextContent()
      const items: TextItem[] = []
      for (const raw of content.items) {
        if (!('str' in raw) || !raw.str.trim()) continue
        const [a, b, c, d, e, f] = raw.transform as number[]
        const height = Math.hypot(c, d) || Math.hypot(a, b) || 10
        // pdf.js 좌표는 아래에서 위로 증가 → 위에서 아래 기준으로 뒤집는다.
        items.push({ str: raw.str, x: e, y: viewport.height - f, width: raw.width || 0, height })
      }
      if (items.length === 0) scannedPages.push(pageNum)
      pages.push({ pageNum, items })
      page.cleanup()
    }
  } finally {
    await task.destroy()
  }
  return { pages, scannedPages }
}

/* ---------- 줄·단어 구성 ---------- */

function median(nums: number[]): number {
  if (nums.length === 0) return 0
  const sorted = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

export function groupIntoLines(items: TextItem[]): TextItem[][] {
  if (items.length === 0) return []
  const tolerance = Math.max(4, median(items.map((it) => it.height).filter((h) => h > 0)) * 0.6)
  const sorted = [...items].sort((a, b) => a.y - b.y)
  const lines: TextItem[][] = []
  let current = [sorted[0]]
  let currentY = sorted[0].y
  for (let i = 1; i < sorted.length; i++) {
    const it = sorted[i]
    if (Math.abs(it.y - currentY) <= tolerance) {
      current.push(it)
      currentY = (currentY * (current.length - 1) + it.y) / current.length
    } else {
      lines.push(current)
      current = [it]
      currentY = it.y
    }
  }
  lines.push(current)
  return lines.map((line) => line.sort((a, b) => a.x - b.x))
}

// 일부 PDF(NH 등)는 한 글자씩 따로 나뉘어 있어, 맞붙은 글자를 한 단어로 합친다.
export function mergeLineIntoWords(line: TextItem[]): Word[] {
  if (line.length === 0) return []
  const sorted = [...line].sort((a, b) => a.x - b.x)
  const words: Word[] = []
  let cur: Word = { ...sorted[0], endX: sorted[0].x + sorted[0].width }
  for (let i = 1; i < sorted.length; i++) {
    const it = sorted[i]
    const threshold = Math.min(4, Math.max(1.5, (it.height || cur.height || 10) * 0.2))
    if (it.x - cur.endX <= threshold) {
      cur.str += it.str
      cur.endX = Math.max(cur.endX, it.x + it.width)
      cur.width = cur.endX - cur.x
    } else {
      words.push(cur)
      cur = { ...it, endX: it.x + it.width }
    }
  }
  words.push(cur)
  return words
}

export function documentLines(pages: PageItems[], maxPages = Infinity): string[] {
  const lines: string[] = []
  for (const page of pages.slice(0, maxPages)) {
    for (const words of groupIntoLines(page.items).map(mergeLineIntoWords)) {
      lines.push(words.map((w) => w.str).join(' '))
    }
  }
  return lines
}

const lineText = (words: TextItem[]): string => words.map((w) => w.str).join(' ').replace(/\s+/g, ' ').trim()
const isExcludedLine = (text: string): boolean => !text || EXCLUDE_LINE_PATTERNS.some((re) => re.test(text))
const normalizeHeaderText = (str: string): string => str.replace(/\s/g, '')

function isBalanced(text: string): boolean {
  const count = (ch: string): number => text.split(ch).length - 1
  return count('(') === count(')') && count('[') === count(']')
}

/**
 * 표 머리글 칸인지 — 설명 문장 속 '보험료' 를 머리글로 오인하지 않으려고 길이를 제한한다.
 *
 * 다만 '납기/만기(갱신종료시기)' 처럼 한 칸에 두 열 이름과 괄호 설명이 같이 들어간 머리글이
 * 있다(DB손해보험 가입담보요약). 10자로 자르면 이 칸을 놓쳐 만기 열이 없는 표가 되고,
 * 만기 글자가 보험료 칸으로 밀려 들어가 표 전체가 버려졌다. 그래서 숫자·영문 없이
 * 한글과 괄호로만 된 칸은 좀 더 길어도 머리글로 인정한다(문장은 띄어쓰기가 있어 걸러진다).
 */
const HEADER_CELL_LONG_MAX_LEN = 20
const HEADER_CELL_SHAPE = /^[가-힣()/·~\-]+$/

function isHeaderCell(word: TextItem): boolean {
  const compact = normalizeHeaderText(word.str)
  if (!ALL_HEADER_KEYWORDS.some((kw) => compact.includes(kw))) return false
  if (compact.length <= HEADER_CELL_MAX_LEN) return true
  return compact.length <= HEADER_CELL_LONG_MAX_LEN && HEADER_CELL_SHAPE.test(compact) && !/\s/.test(word.str.trim())
}

// 여러 줄로 나뉜 헤더("보험" / "기간")를 같은 x 위치끼리 위아래로 이어붙인다.
function stackWordsAcrossLines(lineGroup: Word[][]): Word[] {
  const stacks: Word[] = []
  for (const line of lineGroup) {
    for (const w of line) {
      const s = stacks.find((st) => w.x < st.x + st.width + 2 && w.x + w.width > st.x - 2)
      if (s) {
        const end = Math.max(s.x + s.width, w.x + w.width)
        s.str += w.str
        s.x = Math.min(s.x, w.x)
        s.width = end - s.x
        s.endX = end
      } else {
        stacks.push({ ...w })
      }
    }
  }
  return stacks
}

// 헤더 후보에서 가입금액/납입기간/만기/보험료 열의 x좌표(중심)를 찾는다.
function detectHeaderAnchors(words: Word[]): Anchors | null {
  // 헤더 칸에는 숫자가 없다. 숫자가 섞이면 본문 행이나 요약 정보 박스로 본다.
  if (words.some((w) => /\d/.test(w.str))) return null
  const found: Anchors = {}
  for (const w of words) {
    // 설명 문장 속 "보험료" 같은 단어를 헤더로 오인하지 않도록 짧은 칸 글자만 인정한다.
    if (!isHeaderCell(w)) continue
    const compact = normalizeHeaderText(w.str)
    for (const col of Object.keys(HEADER_KEYWORDS) as DataColumn[]) {
      if (found[col] !== undefined) continue
      if (HEADER_KEYWORDS[col].some((kw) => compact.includes(kw))) found[col] = w.x + w.width / 2
    }
  }
  // 담보표라면 가입금액과 보험료 열이 반드시 함께 있다.
  if (found.amount === undefined || found.premium === undefined) return null
  const xs = Object.values(found)
  return Math.max(...xs) - Math.min(...xs) > 50 ? found : null
}

function clusterByX(items: Word[]): Word[][] {
  if (items.length === 0) return []
  const sorted = [...items].sort((a, b) => a.x - b.x)
  const gapThreshold = Math.max(15, median(sorted.map((it) => it.height).filter((h) => h > 0)) * 1.8)
  const clusters: Word[][] = []
  let current = [sorted[0]]
  let currentEnd = sorted[0].x + sorted[0].width
  for (let i = 1; i < sorted.length; i++) {
    const it = sorted[i]
    if (it.x - currentEnd > gapThreshold) {
      clusters.push(current)
      current = [it]
    } else {
      current.push(it)
    }
    currentEnd = Math.max(currentEnd, it.x + it.width)
  }
  clusters.push(current)
  return clusters
}

function cellsToText(items: Word[]): string {
  if (items.length === 0) return ''
  let out = ''
  let prevEnd: number | null = null
  let prevHeight = 10
  for (const it of [...items].sort((a, b) => a.x - b.x)) {
    if (prevEnd !== null && it.x - prevEnd > Math.max(1.5, prevHeight * 0.25)) out += ' '
    out += it.str
    prevEnd = it.x + it.width
    prevHeight = it.height || prevHeight
  }
  return out.trim()
}

// 금액 형식이 맞지 않으면 임의로 고치지 않고 "확인 필요"로 둔다.
const guardMoney = (text: string): string => (!text || STRICT_MONEY.test(text) ? text : REVIEW)

function combineTerm(paymentTerm: string, maturity: string): string {
  if (paymentTerm && maturity) return `${paymentTerm}·${maturity}`
  return paymentTerm || maturity || ''
}

// 한쪽 칸에 "20년/ 100세" 또는 "20년납 90세만기"처럼 두 값이 함께 들어간 경우 나누고, 순서를 납입기간·만기로 맞춘다.
function normalizeTerm(paymentTerm: string, maturity: string): [string, string] {
  let pay = paymentTerm
  let mat = maturity.replace(/^\/\s*/, '')
  if (!(pay && mat)) {
    const single = pay || mat
    if (single.includes('/')) {
      const [left, ...rest] = single.split('/')
      pay = left.trim()
      mat = rest.join('/').trim()
    } else if (/\s/.test(single)) {
      const parts = single.split(/\s+/)
      for (let i = 1; i < parts.length; i++) {
        const left = parts.slice(0, i).join('')
        const right = parts.slice(i).join('')
        if (/(납|년)$/.test(left) && /만기|세|종신/.test(right)) {
          pay = left
          mat = right
          break
        }
      }
    }
  }
  if (pay && mat && MATURITY_LIKE.test(pay) && !MATURITY_LIKE.test(mat)) return [mat, pay]
  return [pay, mat]
}

/* ---------- 담보표 파싱 ---------- */

export function parseCoverageTable(pages: PageItems[]): ParseResult {
  const pageLines = pages.map((page) => ({
    pageNum: page.pageNum,
    lines: groupIntoLines(page.items).map(mergeLineIntoWords)
  }))

  let anchors: Anchors | null = null
  let combinedTermAnchor: number | null = null // 납입기간과 만기가 한 칸("납기/만기")에 있는 경우
  let leftBoundaryX = Infinity // 이보다 왼쪽은 담보명 영역
  let amountUnit = ''

  const nearestAnchor = (x: number): { column: DataColumn | 'combinedTerm' | null; ambiguous: boolean } => {
    const candidates: [DataColumn | 'combinedTerm', number][] = anchors
      ? (Object.entries(anchors) as [DataColumn, number][])
      : []
    if (combinedTermAnchor !== null) candidates.push(['combinedTerm', combinedTermAnchor])
    let best: DataColumn | 'combinedTerm' | null = null
    let bestDist = Infinity
    let secondDist = Infinity
    for (const [col, anchorX] of candidates) {
      const dist = Math.abs(x - anchorX)
      if (dist < bestDist) {
        secondDist = bestDist
        bestDist = dist
        best = col
      } else if (dist < secondDist) {
        secondDist = dist
      }
    }
    return { column: best, ambiguous: secondDist !== Infinity && secondDist - bestDist < bestDist * 0.3 }
  }

  const records: LineRecord[] = []
  const leftPool: Word[] = []
  const termPool: Word[] = []
  let firstTableCaptured = false
  let suppressSection = false

  for (const { pageNum, lines } of pageLines) {
    const recentTexts: string[] = []
    let li = 0
    while (li < lines.length) {
      const words = lines[li]
      if (words.length === 0) {
        li++
        continue
      }
      const text = lineText(words)

      // 헤더가 "가입금액/보험/납입" + "구분/보험료(원)" + "(만원)/기간/기간"처럼 여러 줄에 걸친 경우도 있다.
      let header: Anchors | null = null
      let headerSpan = 1
      let headerWords = words
      for (let span = 1; span <= Math.min(3, lines.length - li); span++) {
        const combined = span === 1 ? words : stackWordsAcrossLines(lines.slice(li, li + span))
        const found = detectHeaderAnchors(combined)
        if (found) {
          header = found
          headerSpan = span
          headerWords = combined
          break
        }
      }
      while (header && headerSpan < 5 && li + headerSpan < lines.length) {
        const extendedWords = stackWordsAcrossLines(lines.slice(li, li + headerSpan + 1))
        const extended = detectHeaderAnchors(extendedWords)
        if (!extended || Object.keys(extended).length <= Object.keys(header).length) break
        header = extended
        headerWords = extendedWords
        headerSpan++
      }

      if (header) {
        anchors = { ...header }
        combinedTermAnchor = null
        if (
          anchors.paymentTerm !== undefined &&
          anchors.maturity !== undefined &&
          Math.abs(anchors.paymentTerm - anchors.maturity) < 1
        ) {
          combinedTermAnchor = anchors.paymentTerm
          delete anchors.paymentTerm
          delete anchors.maturity
        }
        const anchorXs = [...Object.values(anchors), ...(combinedTermAnchor !== null ? [combinedTermAnchor] : [])]
        const headerCells = headerWords.filter(isHeaderCell)
        // 금액이 헤더 글자 왼쪽 끝에 맞춰 적힌 표도 있어, 담보명 영역 경계는 헤더 칸의 왼쪽 끝으로 잡는다.
        leftBoundaryX = Math.min(...anchorXs, ...headerCells.map((w) => w.x)) - 3

        // "가입금액(만원)"처럼 단위가 헤더에만 적힌 경우, 숫자만 있는 칸에 원본 단위를 붙인다.
        const amountHeader = headerCells.find((w) => normalizeHeaderText(w.str).includes('가입금액'))
        const unitMatch = amountHeader ? normalizeHeaderText(amountHeader.str).match(/\((천원|만원|억원|원)\)/) : null
        amountUnit = unitMatch ? unitMatch[1] : ''

        const headerLabel = headerWords
          .filter((w) => w.x + w.width / 2 < leftBoundaryX)
          .map((w) => w.str)
          .join('')
        suppressSection =
          firstTableCaptured && (DETAIL_HEADER_LABEL.test(headerLabel) || EXAMPLE_CONTEXT.test(recentTexts.join(' ')))
        records.push({ kind: 'header', pageNum })
        li += headerSpan
        continue
      }

      recentTexts.push(text)
      if (recentTexts.length > 8) recentTexts.shift()

      if (!anchors || suppressSection) {
        li++
        continue
      }
      if (TABLE_END_NOTE.test(text)) {
        anchors = null
        records.push({ kind: 'excluded', pageNum })
        li++
        continue
      }
      if (isExcludedLine(text)) {
        records.push({ kind: 'excluded', pageNum })
        li++
        continue
      }

      const cells: Record<DataColumn, Word[]> = { amount: [], premium: [], paymentTerm: [], maturity: [] }
      const leftItems: Word[] = []
      const termItems: Word[] = []
      let columnAmbiguous = false

      for (const w of words) {
        const center = w.x + w.width / 2
        if (PURE_NUMBER.test(w.str) && center < leftBoundaryX) continue // 특약 순번
        if (center < leftBoundaryX) {
          leftItems.push(w)
          continue
        }
        const { column, ambiguous } = nearestAnchor(center)
        if (column === 'combinedTerm') {
          termItems.push(w)
        } else if (column) {
          cells[column].push(w)
          if (ambiguous && (column === 'amount' || column === 'premium')) columnAmbiguous = true
        }
      }

      const hasData =
        cells.amount.length + cells.premium.length + cells.paymentTerm.length + cells.maturity.length + termItems.length > 0

      if (hasData) {
        const amountText = lineText(cells.amount)
        const premiumText = lineText(cells.premium)
        const termText = lineText([...cells.paymentTerm, ...cells.maturity, ...termItems])
        const moneyOk = (t: string): boolean => !t || MONEY_LIKE.test(t)
        const looksLikeRow =
          Boolean(amountText || premiumText) && moneyOk(amountText) && moneyOk(premiumText) && termText.length <= 25
        if (!looksLikeRow) {
          // 금액 칸에 금액이 아닌 문장이 들어오면 담보표가 끝난 것으로 보고 다음 헤더까지 무시한다.
          anchors = null
          records.push({ kind: 'excluded', pageNum })
          li++
          continue
        }
        firstTableCaptured = true
      }

      leftPool.push(...leftItems)
      termPool.push(...termItems)
      records.push({ kind: 'data', pageNum, cells, leftItems, termItems, columnAmbiguous, hasData, amountUnit })
      li++
    }
  }

  // "구분" 표시(주계약/선택특약/기본계약 등)를 담보명과 분리한다.
  // 담보명은 긴 글자가 같은 x에서 반복해 시작하고, 구분 표시는 그보다 확실히 왼쪽에 짧게 붙는다.
  const nameStartCounts = new Map<number, number>()
  for (const it of leftPool) {
    if (it.str.replace(/\s/g, '').length < 8) continue
    const bin = Math.round(it.x / 4) * 4
    nameStartCounts.set(bin, (nameStartCounts.get(bin) ?? 0) + 1)
  }
  const nameStartX =
    nameStartCounts.size > 0 ? [...nameStartCounts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0] : null
  const isCategoryLabel = (it: Word): boolean =>
    nameStartX !== null && it.x < nameStartX - 15 && it.str.replace(/\s/g, '').length <= 8

  // 납입기간/만기가 한 칸에 함께 있으면 두 덩어리로 나눈다.
  let termSplitX: number | null = null
  const termClusters = clusterByX(termPool)
  if (termClusters.length >= 2) {
    const leftEnd = Math.max(...termClusters[0].map((it) => it.x + it.width))
    const rightStart = Math.min(...termClusters[1].map((it) => it.x))
    termSplitX = (leftEnd + rightStart) / 2
  }

  // 행 조립: 담보명이 여러 줄로 줄바꿈된 경우 앞/뒤 줄 조각을 이어붙인다.
  // 괄호가 아직 닫히지 않았거나 데이터 줄에 이름이 없으면 다음 이름 조각까지 같은 담보로 본다.
  const rows: ParsedRow[] = []
  let pendingName = ''
  let lastRow: ParsedRow | null = null
  let mode: 'before' | 'after' = 'before'

  for (const rec of records) {
    if (rec.kind !== 'data') {
      mode = 'before'
      pendingName = ''
      lastRow = null
      continue
    }

    const nameItems = rec.leftItems.filter((it) => !isCategoryLabel(it))
    // 순번이 담보명과 한 칸에 붙어 나오는 제안서가 있다("1. (건강고지)상해사망…").
    // 담보명에 남으면 화면과 엑셀에 번호가 그대로 찍힌다. '5대골절' 처럼 숫자로 시작하는
    // 담보명은 점·괄호가 없어 그대로 남는다.
    const fragment = cellsToText(nameItems).replace(/^\s*\d{1,3}\s*[.)]\s*/, '')

    if (!rec.hasData) {
      if (!fragment) continue
      if (mode === 'after' && lastRow) {
        lastRow.coverageName += fragment
        mode = isBalanced(lastRow.coverageName) ? 'before' : 'after'
      } else {
        pendingName += fragment
      }
      continue
    }

    let paymentTerm = cellsToText(rec.cells.paymentTerm)
    let maturity = cellsToText(rec.cells.maturity)
    if (rec.termItems.length > 0) {
      if (termSplitX !== null) {
        const split = termSplitX
        paymentTerm = paymentTerm || cellsToText(rec.termItems.filter((it) => it.x <= split))
        maturity = maturity || cellsToText(rec.termItems.filter((it) => it.x > split))
      } else {
        paymentTerm = paymentTerm || cellsToText(rec.termItems)
      }
    }
    ;[paymentTerm, maturity] = normalizeTerm(paymentTerm, maturity)

    let amount = cellsToText(rec.cells.amount)
    if (rec.amountUnit && /^[\d,.]+$/.test(amount)) amount += rec.amountUnit

    const coverageName = (pendingName + fragment).trim()
    pendingName = ''

    const row: ParsedRow = {
      coverageName,
      amount: guardMoney(amount),
      term: combineTerm(paymentTerm, maturity),
      premium: guardMoney(cellsToText(rec.cells.premium)),
      pageNum: rec.pageNum,
      columnAmbiguous: rec.columnAmbiguous
    }
    if (!row.coverageName && !row.amount && !row.premium && !row.term) continue

    rows.push(row)
    lastRow = row
    mode = nameItems.length === 0 || !isBalanced(coverageName) ? 'after' : 'before'
  }

  const warnings: string[] = []
  if (rows.length === 0) {
    warnings.push('담보표를 찾지 못했습니다. 가입금액과 보험료 열이 있는 표가 문서에 있는지 확인해주세요.')
  }
  return { rows, warnings }
}
