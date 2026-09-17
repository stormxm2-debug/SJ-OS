import { groupIntoLines, mergeLineIntoWords } from "./extract/parseTable.js";

// 간병인 지원금(페이백) 조건을 제안서 본문에서 찾아 쉬운 문장으로 바꾼다.
// 예) "1일당 간병인 사용금액 7만원 미만인 경우 : 7만5천원(가입금액의 50%) 지급"
//     "간병인 사용금액은 1일당 25만원을 한도로 하며..."

// NH식 "간병인 사용금액이 1일당 7만원 미만" / 메리츠식 "1일당 간병인 사용금액 7만원 미만" 둘 다 찾는다.
const THRESHOLD = /(?:간병인사용금액이?1일당|1일당간병인사용금액이?)([\d.]+)만원(미만|이상)/;
const LIMIT = /1일당\s*간병인\s*사용금액\s*([\d.]+)\s*만원\s*한도|간병인\s*사용금액은\s*1일당\s*([\d.]+)\s*만원을?\s*한도/;
const BELOW_PAYOUT = /가입금액의\s*([\d.]+)\s*%/;

function documentLines(pages) {
  const lines = [];
  for (const page of pages) {
    for (const words of groupIntoLines(page.items).map(mergeLineIntoWords)) {
      lines.push(words.map((w) => w.str).join(" "));
    }
  }
  return lines;
}

export function extractPaybackRule(pages) {
  let threshold = null;
  let limit = null;
  let belowPercent = null;
  const evidence = [];

  for (const line of documentLines(pages)) {
    const compact = line.replace(/\s/g, "");

    const thresholdMatch = compact.match(THRESHOLD);
    if (thresholdMatch) {
      threshold = threshold ?? Number(thresholdMatch[1]);
      if (evidence.length < 4) evidence.push(line.trim().slice(0, 120));
      const percentMatch = compact.match(BELOW_PAYOUT);
      if (percentMatch && thresholdMatch[2] === "미만") belowPercent = belowPercent ?? Number(percentMatch[1]);
    }

    const limitMatch = compact.match(LIMIT);
    if (limitMatch) limit = limit ?? Number(limitMatch[1] || limitMatch[2]);

    // "7만원 미만인 경우 : 7만5천원(가입금액의 50%) 지급"처럼 한 줄에 함께 적힌 경우
    if (!belowPercent && /미만/.test(compact)) {
      const percentMatch = compact.match(BELOW_PAYOUT);
      if (percentMatch) belowPercent = Number(percentMatch[1]);
    }
  }

  if (threshold === null && limit === null) return null;
  return { threshold, limit, belowPercent, evidence };
}

// 화면과 엑셀에 넣을 안내 문장을 만든다. 근거를 못 찾은 부분은 지어내지 않는다.
export function describePaybackRule(company, rule) {
  if (!rule) return null;
  const name = company || "이 보험사";
  const parts = [];

  if (rule.threshold !== null) {
    if (rule.belowPercent !== null) {
      parts.push(
        `간병인을 하루 ${rule.threshold}만원 이상 쓰면 가입금액 전액이 나오고, ${rule.threshold}만원 미만이면 가입금액의 ${rule.belowPercent}%만 나옵니다.`
      );
    } else {
      parts.push(
        `간병인을 하루 ${rule.threshold}만원 이상 쓰는지에 따라 지급액이 달라집니다(미만일 때 지급액은 원문 확인 필요).`
      );
    }
  }
  if (rule.limit !== null) parts.push(`하루 간병인 사용금액은 ${rule.limit}만원까지만 인정됩니다.`);

  return { company: name, text: parts.join(" "), evidence: rule.evidence };
}
