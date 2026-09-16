import { groupIntoLines, mergeLineIntoWords } from "./extract/parseTable.js";

// 엑셀 양식(시트 "신상")의 담보 항목. 양식 C열 글자와 같아야 한다.
export const CATEGORIES = [
  "입원일당",
  "종합병원일당",
  "간병인사용일당",
  "요양병원및의원",
  "통합간호간병",
  "간병페이백",
  "상급1인실",
  "상급2~3인실",
  "상급4~5인실",
  "종합1인실",
  "종합2~3인실",
  "종합4~5인실",
];

const SANGGEUP_ROOMS = ["상급1인실", "상급2~3인실", "상급4~5인실"];
const GENERAL_ROOMS = ["종합1인실", "종합2~3인실", "종합4~5인실"];

// 보험사 이름(양식 표기 기준)
const COMPANY_PATTERNS = [
  [/NH농협생명|농협생명|NH올원더풀|건강플러스NH/, "농협생명"],
  [/메리츠화재|메리츠/, "메리츠"],
  [/하나생명/, "하나생명"],
  [/현대해상/, "현대해상"],
  [/흥국생명/, "흥국생명"],
  [/흥국화재/, "흥국화재"],
  [/삼성화재/, "삼성화재"],
  [/삼성생명/, "삼성생명"],
  [/DB손해보험|DB손보/, "DB손해보험"],
  [/KB손해보험|KB손보/, "KB손해보험"],
  [/롯데손해보험/, "롯데손해보험"],
  [/한화손해보험/, "한화손해보험"],
  [/한화생명/, "한화생명"],
  [/MG손해보험/, "MG손해보험"],
  [/농협손해보험/, "농협손해보험"],
  [/교보생명/, "교보생명"],
  [/신한라이프/, "신한라이프"],
  [/동양생명/, "동양생명"],
  [/미래에셋생명/, "미래에셋생명"],
  [/ABL생명/, "ABL생명"],
  [/AIA생명/, "AIA생명"],
  [/라이나생명/, "라이나생명"],
  [/KDB생명/, "KDB생명"],
  [/DGB생명/, "DGB생명"],
];

// 간병 페이백(입원지원금) 담보를 가리키는 표현
const PAYBACK_PATTERN = /간병인지원|입원지원금|간병지원금|간병페이백/;

function documentLines(pages, maxPages = Infinity) {
  const lines = [];
  for (const page of pages.slice(0, maxPages)) {
    for (const words of groupIntoLines(page.items).map(mergeLineIntoWords)) {
      lines.push(words.map((w) => w.str).join(" "));
    }
  }
  return lines;
}

// 문서 앞부분에서 보험사 이름을 찾는다. 못 찾으면 파일명에서 한 번 더 찾는다.
export function detectCompany(pages, fileName = "") {
  const haystack = documentLines(pages, 4).join(" ").replace(/\s/g, "") + fileName.replace(/\s/g, "");
  for (const [pattern, name] of COMPANY_PATTERNS) {
    if (pattern.test(haystack)) return name;
  }
  if (/흥생/.test(fileName)) return "흥국생명";
  return null;
}

// 요약표에서 빠질 수 있는 담보라 문서 전체에서 확인하되,
// "※ ○○특약의 경우..."처럼 가입하지 않은 특약을 설명하는 안내문은 제외한다.
const NOTE_LINE = /^\s*[※*▶◈·]|^\s*주\s*\)/;

export function detectPayback(pages) {
  return documentLines(pages).some((line) => !NOTE_LINE.test(line) && PAYBACK_PATTERN.test(line.replace(/\s/g, "")));
}

function moneyValues(line) {
  return [...line.matchAll(/([\d,]{3,})원?/g)]
    .map((match) => Number(match[1].replace(/,/g, "")))
    .filter((value) => Number.isFinite(value) && value >= 1000);
}

function pickPremium(values) {
  if (values.length === 0) return null;
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) || 0) + 1);
  const repeated = [...counts.entries()].filter(([, count]) => count > 1).map(([value]) => value);
  return repeated.length > 0 ? Math.max(...repeated) : Math.max(...values);
}

// 실제 내는 금액 기준: "1회차보험료(할인후)"가 있으면 그 값, 없으면 합계·실납입 보험료를 쓴다.
export function findTotalPremium(pages) {
  const discounted = [];
  const totals = [];
  for (const rawLine of documentLines(pages)) {
    if (NOTE_LINE.test(rawLine)) continue;
    const line = rawLine.replace(/\s/g, "");
    if (/할인후/.test(line)) discounted.push(...moneyValues(line));
    else if (/(합계보험료|보험료합계|실납입보험료|보장보험료합계)/.test(line)) totals.push(...moneyValues(line));
  }
  return pickPremium(discounted) ?? pickPremium(totals);
}

// 가입금액 표기를 일당(만원) 숫자로 바꾼다. 일당으로 보기 어려우면 값 대신 사유를 돌려준다.
export function toDailyManwon(amountText) {
  const text = String(amountText || "").replace(/\s/g, "");
  if (!text) return { value: null, reason: "가입금액 없음" };
  if (text.includes("확인필요")) return { value: null, reason: "금액 확인 필요" };

  const match = text.match(/^([\d,]+(?:\.\d+)?)만원?$/);
  if (match) {
    const value = Number(match[1].replace(/,/g, ""));
    // 일당 담보의 가입금액이 100만원을 넘으면 일당이 아니라 보장금액일 가능성이 크다(NH 등).
    if (value > 100) return { value: null, reason: "일당이 아니라 보장금액으로 보임" };
    return { value, reason: null };
  }
  if (/^([\d,]+(?:\.\d+)?)(천만원?|억원?|백만원?)$/.test(text)) {
    return { value: null, reason: "일당이 아니라 보장금액으로 보임" };
  }
  if (/^[\d,]+원$/.test(text)) return { value: null, reason: "원 단위 금액" };
  return { value: null, reason: "단위를 알 수 없음" };
}

// 담보명 뒤에 붙는 상품 형태 표기는 분류에 방해가 되므로 떼어낸다.
// 예: (무), (무배당), (해약환급금 미지급형, 일반심사형), (사망시적립액미지급형), (통합간편가입)
const FORM_SUFFIX = /\([^()]*(?:무배당|해약환급금|해약미지급|미지급형|일반심사형|간편가입|통합간편|간편형|간편|사망시적립액|납입면제형|고지형|V2|배당)[^()]*\)/g;

function cleanName(coverageName) {
  return String(coverageName || "")
    .replace(/^\s*\d{1,3}\s*[.,]\s*/, "") // 앞에 붙은 담보 번호
    .replace(/\(무\)|\(무배당\)/g, "")
    .replace(FORM_SUFFIX, "")
    .replace(/\s/g, "");
}

function sidesOf(name) {
  const hasInjury = /상해|재해/.test(name);
  const hasIllness = /질병/.test(name);
  if (hasInjury && !hasIllness) return ["상해"];
  if (hasIllness && !hasInjury) return ["질병"];
  return ["상해", "질병"]; // 구분이 없으면 양쪽 모두에 해당
}

// 담보명을 양식의 어느 행에 넣을지 정한다.
export function classifyCoverage(coverageName, amountText) {
  const name = cleanName(coverageName);
  const result = {
    categories: [],
    sides: sidesOf(name),
    value: null,
    valueReason: null,
    needsReview: false,
    payback: false,
    reason: "",
  };

  if (!name) {
    result.reason = "담보명 없음";
    return result;
  }
  // 181일 이상 연장 담보는 기본(1~180일) 담보와 중복이므로 제외한다.
  if (/181일이상|181[-~]\d+일|\(181/.test(name)) {
    result.reason = "181일 이상 담보(기본 담보와 중복)";
    return result;
  }
  if (PAYBACK_PATTERN.test(name)) {
    result.payback = true;
    result.reason = "간병페이백 여부로만 사용";
    return result;
  }
  if (/중환자실|응급실/.test(name)) {
    result.reason = "양식에 없는 담보";
    return result;
  }

  const { value, reason } = toDailyManwon(amountText);
  result.value = value;
  result.valueReason = reason;

  const isSanggeup = /상급종합병원/.test(name);
  const isGeneralHospital = /종합병원/.test(name);
  const isAdmission = /입원/.test(name);
  const oneBed = /1인실/.test(name);
  const twoThreeBed = /2[-~]3인실/.test(name);
  const fourFiveBed = /4[-~]5인실/.test(name);

  if (/간호.?간병통합/.test(name)) {
    result.categories = ["통합간호간병"];
  } else if (/간병인사용|간병사용|간병인/.test(name)) {
    result.categories = [/요양병원/.test(name) && !/제외/.test(name) ? "요양병원및의원" : "간병인사용일당"];
  } else if (oneBed) {
    result.categories = [isSanggeup ? "상급1인실" : "종합1인실"];
  } else if (twoThreeBed) {
    result.categories = [isSanggeup ? "상급2~3인실" : "종합2~3인실"];
  } else if (fourFiveBed) {
    result.categories = [isSanggeup ? "상급4~5인실" : "종합4~5인실"];
  } else if (/사망|후유장해|장해|수술|진단|납입면제|생활자금|골절|화상|암|뇌|심장/.test(name)) {
    result.reason = "양식에 없는 담보";
    return result;
  } else if (isSanggeup && isAdmission) {
    // 하나생명처럼 병실 구분이 없는 상급종합병원 입원 담보 -> 상급 3개 항목에 같은 값(확인 필요)
    result.categories = [...SANGGEUP_ROOMS];
    result.needsReview = true;
    result.reason = "병실 구분이 없어 상급 3개 항목에 같은 값";
  } else if (isGeneralHospital && isAdmission) {
    result.categories = ["종합병원일당"];
  } else if (isAdmission) {
    result.categories = ["입원일당"];
  } else {
    result.reason = "양식에 없는 담보";
    return result;
  }

  if (result.categories.length > 0 && result.value === null) {
    result.needsReview = true;
    result.reason = result.reason || reason || "값 확인 필요";
  }
  return result;
}

// 한 파일 전체를 보고 판단하는 규칙:
// 종합병원 입원 담보만 있고 병실별 담보가 따로 없으면, 종합 1인/2~3/4~5인실에도 같은 값을 넣는다(확인 필요).
export function applyFileLevelRules(items) {
  const hasGeneralRoom = items.some((item) => item.categories.some((c) => GENERAL_ROOMS.includes(c)));
  if (hasGeneralRoom) return items;
  for (const item of items) {
    if (item.categories.includes("종합병원일당")) {
      item.categories = [...item.categories, ...GENERAL_ROOMS];
      item.needsReview = true;
      item.reason = item.reason || "병실 구분이 없어 종합 3개 항목에 같은 값";
    }
  }
  return items;
}
