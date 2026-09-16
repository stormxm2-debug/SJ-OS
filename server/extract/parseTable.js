// 담보표 파싱 로직.
// 실제 가입제안서 샘플(메리츠화재, NH농협생명 2건, 하나생명, 흥국생명)의 좌표 구조를 분석해 만든
// 범용 파서다. 보험사마다 표 레이아웃이 달라 고정된 열 순서를 가정하지 않고,
// 헤더 키워드의 위치와 본문 글자의 x좌표로 열을 추론한다.

const HEADER_KEYWORDS = {
  amount: ["가입금액", "보험가입금액"],
  paymentTerm: ["납입기간", "납기", "보험료납입기간"],
  maturity: ["보험기간", "만기", "만기일", "보장기간"],
  premium: ["보험료", "담보보험료", "월보험료", "특약보험료", "계약보험료"],
};
const ALL_HEADER_KEYWORDS = Object.values(HEADER_KEYWORDS).flat();

const EXCLUDE_LINE_PATTERNS = [
  /합\s*계/,
  /총\s*보험료/,
  /총\s*납입/,
  /실\s*납입/,
  /대상계약/,
  /^\s*[※\*]/,
  /안내\s*사항/,
  /유의\s*사항/,
  /^\s*\d+\s*\/\s*\d+\s*$/,
  /^\s*-\s*\d+\s*-\s*$/,
  /^\s*-\s*\d+\s*\/\s*\d+\s*-\s*$/,
  /^\s*page\s*[:\s]*\d+/i,
  /page\s*[:\s]*\d+\s*\/\s*\d+/i,
  // 보험료/계약자 정보 안내 블록, 머리글·바닥글
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
  /^\(?\d{2,4}[-)]\d{3,4}-\d{4}\)?/,
];

// 표가 끝났음을 알리는 안내문
const TABLE_END_NOTE = /요약하여\s*안내하는\s*표|가입담보리스트는/;
// 이미 추출한 담보표를 설명과 함께 다시 싣는 상세본
const DETAIL_HEADER_LABEL = /보장내용|설명서|상품설명/;
// "40세, 남자 기준 보험료 비교(예시)"처럼 실제 계약이 아닌 예시표 앞에 붙는 문구
const EXAMPLE_CONTEXT = /예시|비교|산출\s*조건|가상|\d+\s*세\s*,\s*(남|여)/;
// 만기 쪽 값("100세만기", "90세", "종신")
const MATURITY_LIKE = /만기|세$|종신/;

const LOW_CONF_THRESHOLD = 70;
const REJECT_CONF_THRESHOLD = 40;
const HEADER_CELL_MAX_LEN = 10;
const REVIEW = "확인 필요";

// 금액 칸으로 볼 수 있는 값: "300", "2,460", "1천만원", "5.4만원", "1억5천만원", "0 원", "확인 필요"
const MONEY_LIKE = /^(확인 필요|(?:[\d,.]+\s*(?:십|백|천|만|억)*\s*)+원?)$/;
const PURE_NUMBER = /^\d+$/;

function median(nums) {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function groupIntoLines(items) {
  if (items.length === 0) return [];
  const heights = items.map((it) => it.height).filter((h) => h > 0);
  const tolerance = Math.max(4, median(heights) * 0.6);
  const sorted = [...items].sort((a, b) => a.y - b.y);
  const lines = [];
  let current = [sorted[0]];
  let currentY = sorted[0].y;
  for (let i = 1; i < sorted.length; i++) {
    const it = sorted[i];
    if (Math.abs(it.y - currentY) <= tolerance) {
      current.push(it);
      currentY = (currentY * (current.length - 1) + it.y) / current.length;
    } else {
      lines.push(current);
      current = [it];
      currentY = it.y;
    }
  }
  lines.push(current);
  return lines.map((line) => line.sort((a, b) => a.x - b.x));
}

// 일부 PDF와 OCR 결과는 한 글자씩 따로 나뉘어 있어, 가까이 붙은 글자를 한 단어로 합친다.
// PDF 글자는 거의 맞붙어 있고, OCR 글자는 글자 높이의 절반 정도 간격이 생긴다.
function mergeLineIntoWords(line) {
  if (line.length === 0) return [];
  const sorted = [...line].sort((a, b) => a.x - b.x);
  const words = [];
  let cur = { ...sorted[0], endX: sorted[0].x + sorted[0].width };
  for (let i = 1; i < sorted.length; i++) {
    const it = sorted[i];
    const gap = it.x - cur.endX;
    const h = it.height || cur.height || 10;
    const threshold = it.ocr || cur.ocr ? h * 0.7 : Math.min(4, Math.max(1.5, h * 0.2));
    if (gap <= threshold) {
      cur.str += it.str;
      cur.endX = Math.max(cur.endX, it.x + it.width);
      cur.width = cur.endX - cur.x;
      cur.confidence = Math.min(cur.confidence ?? 100, it.confidence ?? 100);
    } else {
      words.push(cur);
      cur = { ...it, endX: it.x + it.width };
    }
  }
  words.push(cur);
  return words;
}

function lineText(words) {
  return words.map((w) => w.str).join(" ").replace(/\s+/g, " ").trim();
}

function isExcludedLine(text) {
  if (!text) return true;
  return EXCLUDE_LINE_PATTERNS.some((re) => re.test(text));
}

function isBalanced(text) {
  const count = (ch) => text.split(ch).length - 1;
  return count("(") === count(")") && count("[") === count("]");
}

// 헤더 비교용 정규화. OCR이 "납입"을 "남입"으로 읽는 경우가 잦아 헤더 판별에서만 같은 글자로 본다.
function normalizeHeaderText(str) {
  return str.replace(/\s/g, "").replace(/남입/g, "납입");
}

function isHeaderCell(word) {
  const compact = normalizeHeaderText(word.str);
  return compact.length <= HEADER_CELL_MAX_LEN && ALL_HEADER_KEYWORDS.some((kw) => compact.includes(kw));
}

// 여러 줄로 나뉜 헤더("보험" / "기간")를 같은 x 위치끼리 위아래로 이어붙인다.
function stackWordsAcrossLines(lineGroup) {
  const stacks = [];
  for (const line of lineGroup) {
    for (const w of line) {
      const s = stacks.find((st) => w.x < st.x + st.width + 2 && w.x + w.width > st.x - 2);
      if (s) {
        const end = Math.max(s.x + s.width, w.x + w.width);
        s.str += w.str;
        s.x = Math.min(s.x, w.x);
        s.width = end - s.x;
      } else {
        stacks.push({ ...w });
      }
    }
  }
  return stacks;
}

// 헤더 후보에서 가입금액/납입기간/만기/보험료 열의 x좌표(중심)를 찾는다.
function detectHeaderAnchors(words) {
  // 헤더 칸에는 숫자 데이터가 없다. 숫자가 섞이면 본문 행이나 요약 정보 박스로 본다.
  if (words.some((w) => /\d/.test(w.str))) return null;
  const found = {};
  for (const w of words) {
    // 설명 문장 속 "보험료" 같은 단어를 헤더로 오인하지 않도록 짧은 칸 글자만 인정한다.
    if (!isHeaderCell(w)) continue;
    const compact = normalizeHeaderText(w.str);
    for (const [col, keywords] of Object.entries(HEADER_KEYWORDS)) {
      if (found[col]) continue;
      if (keywords.some((kw) => compact.includes(kw))) {
        found[col] = w.x + w.width / 2;
      }
    }
  }
  // 담보표라면 가입금액과 보험료 열이 반드시 함께 있다.
  if (!found.amount || !found.premium) return null;
  const xs = Object.values(found);
  if (Math.max(...xs) - Math.min(...xs) > 50) return found;
  return null;
}

// x좌표 기준으로 항목들을 왼쪽->오른쪽 군집으로 나눈다.
function clusterByX(items) {
  if (items.length === 0) return [];
  const sorted = [...items].sort((a, b) => a.x - b.x);
  const heights = sorted.map((it) => it.height).filter((h) => h > 0);
  const gapThreshold = Math.max(15, median(heights) * 1.8);
  const clusters = [];
  let current = [sorted[0]];
  let currentEnd = sorted[0].x + sorted[0].width;
  for (let i = 1; i < sorted.length; i++) {
    const it = sorted[i];
    if (it.x - currentEnd > gapThreshold) {
      clusters.push(current);
      current = [it];
    } else {
      current.push(it);
    }
    currentEnd = Math.max(currentEnd, it.x + it.width);
  }
  clusters.push(current);
  return clusters;
}

function cellsToText(items) {
  if (items.length === 0) return "";
  const sorted = [...items].sort((a, b) => a.x - b.x);
  let out = "";
  let prevEnd = null;
  let prevHeight = 10;
  for (const it of sorted) {
    if (prevEnd !== null && it.x - prevEnd > Math.max(1.5, prevHeight * 0.25)) out += " ";
    out += it.str;
    prevEnd = it.x + it.width;
    prevHeight = it.height || prevHeight;
  }
  return out.trim();
}

function minConfidence(items) {
  return items.reduce((min, it) => Math.min(min, it.confidence ?? 100), 100);
}

// 최종 금액 검증: 쉼표는 세 자리마다, 소수점은 "5.4만원"처럼 두 자리 이하만 허용한다.
// OCR이 쉼표를 마침표로 읽은 "5.8792" 같은 값은 여기서 걸러 "확인 필요"로 둔다.
const STRICT_MONEY =
  /^(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?\s*(?:[십백천만억]+)?(?:\s*(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?\s*[십백천만억]+)*\s*원?$/;

// 금액 칸: 형식이 맞지 않거나 인식 신뢰도가 매우 낮으면 임의로 고치지 않고 "확인 필요"로 둔다.
function guardMoneyCell(text, confidence) {
  if (!text) return { text: "", lowConfidence: false };
  if (!STRICT_MONEY.test(text) || confidence < REJECT_CONF_THRESHOLD) return { text: REVIEW, lowConfidence: true };
  return { text, lowConfidence: confidence < LOW_CONF_THRESHOLD };
}

function combineTerm(paymentTerm, maturity) {
  if (paymentTerm && maturity) return `${paymentTerm}·${maturity}`;
  return paymentTerm || maturity || "";
}

// pages: [{ pageNum, items: [{ str, x, y, width, height, confidence, ocr? }] }]
export function parseCoverageTable(pages) {
  const warnings = [];

  // 1단계: 페이지별 줄 구성
  const pageLines = pages.map((page) => ({
    pageNum: page.pageNum,
    lines: groupIntoLines(page.items).map(mergeLineIntoWords),
  }));

  // 2단계: 문서 순서대로 훑으며 헤더를 만나면 그때부터 담보표 본문으로 본다.
  let anchors = null;
  let combinedTermAnchor = null; // 납입기간과 만기가 한 칸("납기/만기")에 함께 있는 경우
  let dataAnchorEntries = [];
  let leftmostAnchorX = Infinity;
  let leftBoundaryX = Infinity; // 이보다 왼쪽은 담보명 영역
  let amountUnit = "";

  function nearestAnchor(x) {
    const candidates = [...dataAnchorEntries];
    if (combinedTermAnchor !== null) candidates.push(["combinedTerm", combinedTermAnchor]);
    let best = null;
    let bestDist = Infinity;
    let secondDist = Infinity;
    for (const [col, anchorX] of candidates) {
      const dist = Math.abs(x - anchorX);
      if (dist < bestDist) {
        secondDist = bestDist;
        bestDist = dist;
        best = col;
      } else if (dist < secondDist) {
        secondDist = dist;
      }
    }
    const ambiguous = secondDist !== Infinity && secondDist - bestDist < bestDist * 0.3;
    return { column: best, ambiguous };
  }

  const lineRecords = [];
  const leftPoolItems = [];
  const termPoolItems = [];
  let firstTableCaptured = false;
  let suppressSection = false;

  for (const { pageNum, lines } of pageLines) {
    const recentTexts = [];
    let li = 0;
    while (li < lines.length) {
      const words = lines[li];
      if (words.length === 0) {
        li++;
        continue;
      }
      const text = lineText(words);

      // 헤더가 "가입금액/보험/납입" + "구분/보험료(원)" + "(만원)/기간/기간"처럼 여러 줄에 걸친 경우도 있다.
      let header = null;
      let headerSpan = 1;
      let headerWords = words;
      const maxSpan = Math.min(3, lines.length - li);
      for (let span = 1; span <= maxSpan; span++) {
        const combined = span === 1 ? words : stackWordsAcrossLines(lines.slice(li, li + span));
        const found = detectHeaderAnchors(combined);
        if (found) {
          header = found;
          headerSpan = span;
          headerWords = combined;
          break;
        }
      }
      while (header && headerSpan < 5 && li + headerSpan < lines.length) {
        const extendedWords = stackWordsAcrossLines(lines.slice(li, li + headerSpan + 1));
        const extended = detectHeaderAnchors(extendedWords);
        if (!extended || Object.keys(extended).length <= Object.keys(header).length) break;
        header = extended;
        headerWords = extendedWords;
        headerSpan++;
      }

      if (header) {
        anchors = header;
        combinedTermAnchor = null;
        if (anchors.paymentTerm && anchors.maturity && Math.abs(anchors.paymentTerm - anchors.maturity) < 1) {
          combinedTermAnchor = anchors.paymentTerm;
          delete anchors.paymentTerm;
          delete anchors.maturity;
        }
        // 기간 헤더를 읽지 못했고(주로 OCR) 가입금액과 보험료 사이가 넓으면, 그 가운데를 기간 열로 본다.
        if (!anchors.paymentTerm && !anchors.maturity && combinedTermAnchor === null) {
          if (Math.abs(anchors.premium - anchors.amount) > 150) {
            combinedTermAnchor = (anchors.amount + anchors.premium) / 2;
          }
        }
        dataAnchorEntries = Object.entries(anchors);
        leftmostAnchorX = Math.min(
          ...dataAnchorEntries.map(([, x]) => x),
          ...(combinedTermAnchor !== null ? [combinedTermAnchor] : [])
        );
        // 금액이 헤더 글자 왼쪽 끝에 맞춰 적힌 표도 있어, 담보명 영역 경계는 헤더 칸의 왼쪽 끝으로 잡는다.
        const headerCells = headerWords.filter(isHeaderCell);
        leftBoundaryX = Math.min(leftmostAnchorX, ...headerCells.map((w) => w.x)) - 3;

        // "가입금액(만원)"처럼 단위가 헤더에만 적힌 경우, 숫자만 있는 칸에 원본 단위를 붙인다.
        const amountHeader = headerCells.find((w) => normalizeHeaderText(w.str).includes("가입금액"));
        const unitMatch = amountHeader && normalizeHeaderText(amountHeader.str).match(/\((천원|만원|억원|원)\)/);
        amountUnit = unitMatch ? unitMatch[1] : "";

        const headerLabelText = headerWords
          .filter((w) => w.x + w.width / 2 < leftBoundaryX)
          .map((w) => w.str)
          .join("");
        suppressSection =
          firstTableCaptured &&
          (DETAIL_HEADER_LABEL.test(headerLabelText) || EXAMPLE_CONTEXT.test(recentTexts.join(" ")));
        if (process.env.DEBUG_PARSE) {
          console.error(
            `[HEADER p${pageNum}] span=${headerSpan} anchors=${JSON.stringify(anchors)} combinedTerm=${combinedTermAnchor} unit=${amountUnit} suppress=${suppressSection}`
          );
        }
        lineRecords.push({ pageNum, isHeader: true });
        li += headerSpan;
        continue;
      }

      recentTexts.push(text);
      if (recentTexts.length > 8) recentTexts.shift();

      if (!anchors || suppressSection) {
        li++;
        continue;
      }

      if (TABLE_END_NOTE.test(text)) {
        anchors = null;
        lineRecords.push({ pageNum, isExcluded: true });
        li++;
        continue;
      }

      if (isExcludedLine(text)) {
        lineRecords.push({ pageNum, isExcluded: true });
        li++;
        continue;
      }

      const cells = { amount: [], premium: [], paymentTerm: [], maturity: [] };
      const leftItems = [];
      const termItems = [];
      let columnAmbiguous = false;

      for (const w of words) {
        const wCenter = w.x + w.width / 2;
        if (PURE_NUMBER.test(w.str) && wCenter < leftBoundaryX) continue; // 특약 순번
        if (wCenter < leftBoundaryX) {
          leftItems.push(w);
          continue;
        }
        const { column, ambiguous } = nearestAnchor(wCenter);
        if (column === "combinedTerm") {
          termItems.push(w);
          continue;
        }
        if (!column) continue;
        cells[column].push(w);
        if (ambiguous && (column === "amount" || column === "premium")) columnAmbiguous = true;
      }

      let hasData =
        cells.amount.length > 0 ||
        cells.premium.length > 0 ||
        cells.paymentTerm.length > 0 ||
        cells.maturity.length > 0 ||
        termItems.length > 0;

      // OCR 잡음: 이름 줄의 얼룩이 금액/기간 칸에 "원", "세" 같은 한두 글자로만 잡힌 경우는 데이터가 아닌 것으로 본다.
      if (hasData && words.some((w) => w.ocr)) {
        const strayText = lineText([...cells.amount, ...cells.premium, ...cells.paymentTerm, ...cells.maturity, ...termItems]);
        const eachShort = [cells.amount, cells.premium, [...cells.paymentTerm, ...cells.maturity, ...termItems]].every(
          (group) => lineText(group).replace(/\s/g, "").length <= 3
        );
        if (!/\d/.test(strayText) && eachShort) {
          cells.amount = [];
          cells.premium = [];
          cells.paymentTerm = [];
          cells.maturity = [];
          termItems.length = 0;
          hasData = false;
        }
      }

      if (hasData) {
        const amountText = lineText(cells.amount);
        const premiumText = lineText(cells.premium);
        const termText = lineText([...cells.paymentTerm, ...cells.maturity, ...termItems]);
        const moneyOk = (t) => !t || MONEY_LIKE.test(t);
        const exactRow =
          (amountText || premiumText) && moneyOk(amountText) && moneyOk(premiumText) && termText.length <= 25;
        // OCR은 금액 글자 일부를 잘못 읽을 수 있다. 숫자가 있고 문장 길이가 아니면 행은 살리고,
        // 형식이 맞지 않는 금액 칸은 5단계에서 "확인 필요"로 표시한다.
        const ocrRowWithMisread =
          words.some((w) => w.ocr) &&
          /\d/.test(amountText + premiumText) &&
          amountText.length <= 15 &&
          premiumText.length <= 15 &&
          termText.length <= 25;
        if (!exactRow && !ocrRowWithMisread) {
          // 금액 칸에 금액이 아닌 문장이 들어오면 담보표가 끝난 것으로 보고 다음 헤더까지 무시한다.
          anchors = null;
          lineRecords.push({ pageNum, isExcluded: true });
          li++;
          continue;
        }
        firstTableCaptured = true;
      }

      leftPoolItems.push(...leftItems);
      termPoolItems.push(...termItems);
      lineRecords.push({ pageNum, cells, leftItems, termItems, columnAmbiguous, hasData, amountUnit });
      li++;
    }
  }

  // 3단계: 왼쪽 영역에서 "구분" 표시(주계약/선택특약/기본계약 등)를 담보명과 분리한다.
  // 담보명은 긴 글자가 같은 x에서 반복해 시작하고, 구분 표시는 그보다 확실히 왼쪽에 짧게 붙는다.
  const nameStartCounts = new Map();
  for (const it of leftPoolItems) {
    if (it.str.replace(/\s/g, "").length < 8) continue;
    const bin = Math.round(it.x / 4) * 4;
    nameStartCounts.set(bin, (nameStartCounts.get(bin) || 0) + 1);
  }
  const nameStartX =
    nameStartCounts.size > 0
      ? [...nameStartCounts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0]
      : null;
  const startsLeftOfNameColumn = (it) => nameStartX !== null && it.x < nameStartX - 15;
  const isCategoryLabel = (it) => startsLeftOfNameColumn(it) && it.str.replace(/\s/g, "").length <= 8;

  function nameItemsOf(rec) {
    return rec.leftItems
      .filter((it) => !isCategoryLabel(it))
      .map((it) =>
        // OCR에서 순번이 담보명 앞에 붙어 읽힌 경우("2(무)암납입...") 순번을 떼어낸다.
        startsLeftOfNameColumn(it) ? { ...it, str: it.str.replace(/^\d{1,3}[.,]?\s*/, "") } : it
      )
      .filter((it) => it.str);
  }

  // 4단계: 납입기간/만기가 한 칸에 함께 있으면 두 덩어리로 나눈다.
  let termSplitX = null;
  const termClusters = clusterByX(termPoolItems);
  if (termClusters.length >= 2) {
    const leftClusterEnd = Math.max(...termClusters[0].map((it) => it.x + it.width));
    const rightClusterStart = Math.min(...termClusters[1].map((it) => it.x));
    termSplitX = (leftClusterEnd + rightClusterStart) / 2;
  }

  // 5단계: 행 조립. 담보명이 여러 줄로 줄바꿈된 경우 앞/뒤 줄 조각을 이어붙인다.
  // 괄호가 아직 닫히지 않았거나 데이터 줄에 이름이 없으면 다음 이름 조각까지 같은 담보로 본다.
  const rows = [];
  let pendingNameBefore = "";
  let pendingNameConf = 100;
  let lastRow = null;
  let mode = "before";

  for (const rec of lineRecords) {
    if (rec.isHeader || rec.isExcluded) {
      mode = "before";
      pendingNameBefore = "";
      pendingNameConf = 100;
      lastRow = null;
      continue;
    }

    const nameItems = nameItemsOf(rec);
    const ownNameFragment = cellsToText(nameItems);

    if (!rec.hasData) {
      if (!ownNameFragment) continue;
      if (mode === "after" && lastRow) {
        lastRow.coverageName += ownNameFragment;
        lastRow.nameConfidence = Math.min(lastRow.nameConfidence, minConfidence(nameItems));
        mode = isBalanced(lastRow.coverageName) ? "before" : "after";
      } else {
        pendingNameBefore += ownNameFragment;
        pendingNameConf = Math.min(pendingNameConf, minConfidence(nameItems));
      }
      continue;
    }

    let paymentTermText = cellsToText(rec.cells.paymentTerm);
    let maturityText = cellsToText(rec.cells.maturity);
    if (rec.termItems.length > 0) {
      if (termSplitX !== null) {
        paymentTermText = paymentTermText || cellsToText(rec.termItems.filter((it) => it.x <= termSplitX));
        maturityText = maturityText || cellsToText(rec.termItems.filter((it) => it.x > termSplitX));
      } else {
        paymentTermText = paymentTermText || cellsToText(rec.termItems);
      }
    }
    maturityText = maturityText.replace(/^\/\s*/, "");
    // 한쪽 칸에만 "20년/ 100세" 또는 "20년납 90세만기"처럼 두 값이 함께 들어간 경우(헤더 하나만 인식) 둘로 나눈다.
    if (!(paymentTermText && maturityText)) {
      const single = paymentTermText || maturityText;
      if (single.includes("/")) {
        const [pay, ...rest] = single.split("/");
        paymentTermText = pay.trim();
        maturityText = rest.join("/").trim();
      } else if (/\s/.test(single)) {
        const parts = single.split(/\s+/);
        for (let i = 1; i < parts.length; i++) {
          const left = parts.slice(0, i).join("");
          const right = parts.slice(i).join("");
          if (/(납|년)$/.test(left) && /만기|세|종신/.test(right)) {
            paymentTermText = left;
            maturityText = right;
            break;
          }
        }
      }
    }
    // 표에서 만기 열이 납입기간 열보다 앞에 있으면 순서를 "납입기간·만기"로 맞춘다.
    if (paymentTermText && maturityText && MATURITY_LIKE.test(paymentTermText) && !MATURITY_LIKE.test(maturityText)) {
      [paymentTermText, maturityText] = [maturityText, paymentTermText];
    }

    let amountText = cellsToText(rec.cells.amount);
    if (rec.amountUnit && /^[\d,.]+$/.test(amountText)) amountText += rec.amountUnit;
    const amountGuard = guardMoneyCell(amountText, minConfidence(rec.cells.amount));
    const premiumGuard = guardMoneyCell(cellsToText(rec.cells.premium), minConfidence(rec.cells.premium));

    const coverageName = (pendingNameBefore + ownNameFragment).trim();
    const nameConfidence = Math.min(pendingNameConf, minConfidence(nameItems));
    const termConfidence = minConfidence([...rec.cells.paymentTerm, ...rec.cells.maturity, ...rec.termItems]);
    pendingNameBefore = "";
    pendingNameConf = 100;

    let term = combineTerm(paymentTermText, maturityText);
    if (term && termConfidence < REJECT_CONF_THRESHOLD) term = `${REVIEW}: ${term}`;

    const row = {
      coverageName,
      amount: amountGuard.text,
      term,
      premium: premiumGuard.text,
      pageNum: rec.pageNum,
      lowConfidenceFields: [],
      columnAmbiguous: rec.columnAmbiguous,
      nameConfidence,
    };
    if (amountGuard.lowConfidence) row.lowConfidenceFields.push("amount");
    if (term && termConfidence < LOW_CONF_THRESHOLD) row.lowConfidenceFields.push("term");
    if (premiumGuard.lowConfidence) row.lowConfidenceFields.push("premium");
    if (!row.coverageName && !row.amount && !row.premium && !row.term) continue;

    rows.push(row);
    lastRow = row;
    mode = nameItems.length === 0 || !isBalanced(coverageName) ? "after" : "before";
  }

  // 담보명은 줄 조각을 모두 이어붙인 뒤 신뢰도를 판단한다.
  for (const row of rows) {
    if (row.coverageName && row.nameConfidence < LOW_CONF_THRESHOLD) row.lowConfidenceFields.unshift("coverageName");
    if (row.coverageName && row.nameConfidence < REJECT_CONF_THRESHOLD) {
      row.coverageName = `${REVIEW}: ${row.coverageName}`;
    }
    delete row.nameConfidence;
  }

  if (rows.length === 0) {
    warnings.push("담보표를 찾지 못했습니다. 가입금액과 보험료 열이 있는 표가 문서에 있는지 확인해주세요.");
  }

  return { rows, warnings };
}

export { groupIntoLines, mergeLineIntoWords, detectHeaderAnchors };
