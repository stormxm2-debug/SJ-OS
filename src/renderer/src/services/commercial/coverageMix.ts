/**
 * 가입제안서 조합 설계안 — 같은 담보를 회사별로 비교해 싼 쪽으로 쪼갠다.
 *
 * 제안서 A·B·C를 올리면 담보마다 "암진단비는 A사, 뇌혈관질환진단비는 B사"처럼
 * 보험료가 가장 싼 회사를 골라 하나의 설계안을 만든다.
 *
 * 비교의 기준은 **가입금액 1,000만원당 월 보험료(단가)**다. 보험료만 보고 고르면
 * 가입금액이 적어서 싼 담보가 이겨버리기 때문이다. 가입금액을 읽지 못한 담보는
 * 단가를 낼 수 없으므로 보험료로만 비교하고 '확인 필요'로 표시한다 — 지어내지 않는다.
 *
 * 담보명은 회사마다 다르므로 MIX_KEYS 의 대표 담보로 모은다. 뇌혈관질환과 뇌졸중처럼
 * 보장 범위가 다른 담보는 일부러 다른 키로 둔다(섞어 비교하면 고객을 오도한다).
 */

import type { PlanKey } from './coveragePlans'
import { normalizeCoverageName } from './coveragePlans'

export interface MixInputItem {
  company: string
  coverageName: string
  /** 제안서에 적힌 가입금액 원문 (예: '3,000만원') */
  amount: string
  /** 제안서에 적힌 보험료 원문 (예: '12,340원') */
  premium: string
  plan: PlanKey
  groupKey: string | null
}

/** 한 회사의 해당 담보 후보. */
export interface MixCandidate {
  company: string
  coverageName: string
  /** 가입금액(만원). 읽지 못하면 null. */
  amountManwon: number | null
  /** 월 보험료(원). 읽지 못하면 null. */
  premiumWon: number | null
  /** 가입금액 1,000만원당 월 보험료(원). 둘 중 하나라도 없으면 null. */
  unitPrice: number | null
}

export interface MixRow {
  /** 대표 담보 키 */
  key: string
  /** 화면에 쓰는 담보 이름 */
  label: string
  plan: PlanKey
  groupKey: string | null
  candidates: MixCandidate[]
  /** 고른 회사(가장 싼 쪽). 후보가 없으면 null. */
  best: MixCandidate | null
  /** 단가를 못 내서 보험료로만 비교했는지 */
  needsReview: boolean
  /** 가입금액이 회사마다 달라 단가로 비교했다는 안내가 필요한지 */
  amountsDiffer: boolean
  /** 이 담보를 가진 회사가 하나뿐이라 비교가 아닌 경우 */
  soleOffer: boolean
}

export interface MixResult {
  rows: MixRow[]
  /** 조합 설계안의 월 보험료 합계(원) */
  mixPremium: number
  /** 회사별 단독 합계(원) — 그 회사가 가진 담보만 더한 값 */
  byCompany: { company: string; premium: number; rowCount: number }[]
  /** 모든 담보를 한 회사에서 다 넣을 수 있는 회사 중 가장 싼 값. 없으면 null. */
  cheapestSingle: { company: string; premium: number } | null
  /** 조합이 단일 회사보다 얼마나 싼지(원). cheapestSingle 이 없으면 null. */
  savedVsSingle: number | null
  /** 조합에 참여한 회사 수 */
  usedCompanies: string[]
}

/* ---------- 금액 읽기 ---------- */

/** '3,000만원' · '1억' · '1억5,000만원' · '30,000,000원' → 만원 단위 숫자. 못 읽으면 null. */
export function parseAmountManwon(text: string): number | null {
  const s = String(text || '').replace(/\s/g, '')
  if (!s || /확인필요/.test(s)) return null

  let total = 0
  let matched = false

  const eok = s.match(/([\d,.]+)억/)
  if (eok) {
    const v = Number(eok[1].replace(/,/g, ''))
    if (Number.isFinite(v)) {
      total += v * 10000
      matched = true
    }
  }

  // '억' 뒤에 남은 만원 부분만 본다. ('1억5,000만원' → 5,000만원)
  const rest = eok ? s.slice(s.indexOf('억') + 1) : s
  const man = rest.match(/([\d,.]+)만/)
  if (man) {
    const v = Number(man[1].replace(/,/g, ''))
    if (Number.isFinite(v)) {
      total += v
      matched = true
    }
  }

  if (matched) return total > 0 ? total : null

  // 만·억 표기가 없는 순수 원 단위 ('30,000,000원').
  const won = s.match(/^([\d,]+)원$/)
  if (won) {
    const v = Number(won[1].replace(/,/g, ''))
    if (Number.isFinite(v) && v > 0) return v / 10000
  }
  return null
}

/** '12,340원' → 12340. 못 읽으면 null. */
export function parsePremiumWon(text: string): number | null {
  const s = String(text || '').replace(/[^\d]/g, '')
  if (!s) return null
  const v = Number(s)
  return Number.isFinite(v) && v > 0 ? v : null
}

/* ---------- 대표 담보 키 ---------- */

interface MixKey {
  key: string
  label: string
  pattern: RegExp
}

/**
 * 회사마다 다른 담보명을 대표 담보로 모은다. 위에서부터 먼저 맞는 키가 이긴다.
 *
 * 보장 범위가 다른 담보는 일부러 나눠 둔다:
 * - 뇌혈관질환 ⊃ 뇌졸중 ⊃ 뇌출혈, 허혈성심장질환 ⊃ 급성심근경색
 *   → 같은 키로 묶어 비교하면 좁은 담보가 싸다는 이유로 이겨버린다.
 */
const MIX_KEYS: MixKey[] = [
  /* 실손 */
  { key: 'actual-massage', label: '비급여 도수·체외충격파·증식치료', pattern: /도수치료|체외충격파|증식치료/ },
  { key: 'actual-injection', label: '비급여 주사료', pattern: /비급여주사|주사료/ },
  { key: 'actual-mri', label: '비급여 MRI·MRA', pattern: /자기공명영상|MRI|MRA/i },
  { key: 'actual-non-in', label: '비급여 입원의료비', pattern: /비급여.*입원/ },
  { key: 'actual-non-out', label: '비급여 통원의료비', pattern: /비급여.*통원/ },
  { key: 'actual-cov-in', label: '급여 입원의료비', pattern: /급여.*입원/ },
  { key: 'actual-cov-out', label: '급여 통원의료비', pattern: /급여.*통원/ },

  /* 운전자 */
  { key: 'driver-settle', label: '교통사고처리지원금', pattern: /교통사고처리지원|사고처리지원|형사합의/ },
  { key: 'driver-lawyer', label: '변호사선임비용', pattern: /변호사선임|변호사비용/ },
  { key: 'driver-fine-obj', label: '벌금(대물)', pattern: /대물.*벌금|벌금.*대물/ },
  { key: 'driver-fine', label: '벌금(대인)', pattern: /벌금/ },
  { key: 'driver-injury', label: '자동차사고부상치료비', pattern: /자동차사고부상|교통상해부상|부상치료비|부상발생금/ },
  { key: 'driver-revoke', label: '면허취소 위로금', pattern: /면허취소/ },
  { key: 'driver-suspend', label: '면허정지 위로금', pattern: /면허정지/ },
  { key: 'driver-surcharge', label: '자동차보험료 할증지원금', pattern: /보험료할증/ },

  /* 종합 — 진단비 (넓은 담보부터) */
  { key: 'comp-cancer-minor', label: '유사암진단비', pattern: /유사암|소액암|제자리암|경계성종양|기타피부암|갑상선암/ },
  { key: 'comp-cancer-re', label: '재진단암진단비', pattern: /재진단암|암재진단|2차암/ },
  { key: 'comp-cancer', label: '암진단비(일반암)', pattern: /암진단|일반암|고액암|특정암/ },
  { key: 'comp-brain-vessel', label: '뇌혈관질환진단비', pattern: /뇌혈관/ },
  { key: 'comp-stroke', label: '뇌졸중진단비', pattern: /뇌졸중/ },
  { key: 'comp-brain-bleed', label: '뇌출혈진단비', pattern: /뇌출혈|뇌경색/ },
  { key: 'comp-heart-isch', label: '허혈성심장질환진단비', pattern: /허혈성심장|특정심장|심혈관/ },
  { key: 'comp-heart-ami', label: '급성심근경색진단비', pattern: /급성심근경색|심근경색/ },

  /* 종합 — 수술 */
  { key: 'comp-surg-cancer', label: '암수술비', pattern: /암.*수술/ },
  { key: 'comp-surg-brain', label: '뇌·심장 수술비', pattern: /(뇌|심장|심혈관).*수술/ },
  { key: 'comp-surg-illness', label: '질병수술비', pattern: /질병.*수술/ },
  { key: 'comp-surg-injury', label: '상해수술비', pattern: /(상해|재해).*수술/ },
  { key: 'comp-surg', label: '수술비', pattern: /수술/ },

  /* 종합 — 사망·후유장해 */
  { key: 'comp-death-injury', label: '상해사망', pattern: /(상해|재해).*사망/ },
  { key: 'comp-death-illness', label: '질병사망', pattern: /질병.*사망/ },
  { key: 'comp-death', label: '사망보험금', pattern: /사망/ },
  { key: 'comp-disab-injury', label: '상해후유장해', pattern: /(상해|재해).*(후유장해|장해)/ },
  { key: 'comp-disab-illness', label: '질병후유장해', pattern: /질병.*(후유장해|장해)/ },
  { key: 'comp-disab', label: '후유장해', pattern: /후유장해/ },

  /* 종합 — 소액 */
  { key: 'comp-fracture', label: '골절진단비', pattern: /골절/ },
  { key: 'comp-burn', label: '화상진단비', pattern: /화상/ },
  { key: 'comp-cast', label: '깁스치료비', pattern: /깁스|부목/ },
  { key: 'comp-er', label: '응급실내원비', pattern: /응급실|응급치료/ }
]

/**
 * 괄호 안 '○○제외' 는 보장에서 빼는 항목을 적은 것이라 담보명에서 뗀다.
 *
 * 떼지 않으면 '암진단비(유사암제외)' 가 유사암 담보로 잡혀, 일반암과 유사암을 섞어
 * 비교하게 된다. 보험료 차이가 큰 담보라 그대로 두면 조합이 완전히 틀어진다.
 */
const EXCLUSION = /\([^()]*제외[^()]*\)/g

/** 담보명 → 대표 담보. 못 찾으면 이름 자체를 키로 쓴다(같은 이름끼리는 여전히 묶인다). */
export function mixKeyOf(coverageName: string): { key: string; label: string } {
  const name = normalizeCoverageName(coverageName).replace(EXCLUSION, '')
  if (!name) return { key: '', label: '' }
  const found = MIX_KEYS.find((k) => k.pattern.test(name))
  return found ? { key: found.key, label: found.label } : { key: `raw:${name}`, label: coverageName.trim() }
}

/* ---------- 조합 만들기 ---------- */

const round = (n: number): number => Math.round(n * 100) / 100

/**
 * 담보별로 가장 싼 회사를 골라 조합 설계안을 만든다.
 *
 * 같은 회사의 같은 대표 담보가 여러 줄이면(세부 특약이 나뉜 경우) 보험료를 합치고
 * 가입금액은 가장 큰 값을 쓴다 — 합치면 실제보다 커지기 때문이다.
 */
export function buildMix(items: MixInputItem[]): MixResult {
  const byKey = new Map<string, { label: string; plan: PlanKey; groupKey: string | null; byCompany: Map<string, MixCandidate> }>()

  for (const item of items) {
    const company = item.company.trim()
    if (!company) continue
    const raw = mixKeyOf(item.coverageName)
    if (!raw.key) continue
    // 같은 자리 담보(뇌혈관 vs 뇌졸중)는 한 줄로 본다.
    // 나누면 A사 뇌혈관과 B사 뇌졸중을 둘 다 산 것으로 더해져 조합 보험료가 부풀려진다.
    const { key, label } = familyOf(raw.key, raw.label)

    const bucket = byKey.get(key) ?? { label, plan: item.plan, groupKey: item.groupKey, byCompany: new Map<string, MixCandidate>() }
    const amount = parseAmountManwon(item.amount)
    const premium = parsePremiumWon(item.premium)
    const existing = bucket.byCompany.get(company)

    if (existing) {
      // 같은 회사에 같은 담보가 또 있으면 보험료는 합치고 가입금액은 큰 쪽을 쓴다.
      existing.premiumWon = (existing.premiumWon ?? 0) + (premium ?? 0) || null
      existing.amountManwon = Math.max(existing.amountManwon ?? 0, amount ?? 0) || null
      existing.unitPrice =
        existing.premiumWon !== null && existing.amountManwon ? round((existing.premiumWon / existing.amountManwon) * 1000) : null
    } else {
      bucket.byCompany.set(company, {
        company,
        coverageName: item.coverageName.trim(),
        amountManwon: amount,
        premiumWon: premium,
        unitPrice: premium !== null && amount ? round((premium / amount) * 1000) : null
      })
    }
    byKey.set(key, bucket)
  }

  const rows: MixRow[] = []
  for (const [key, bucket] of byKey) {
    const candidates = [...bucket.byCompany.values()]
    // 단가가 있는 후보끼리 먼저 비교한다. 하나도 없으면 보험료로만 비교(확인 필요).
    const priced = candidates.filter((c) => c.unitPrice !== null)
    const usableUnit = priced.length > 0
    const pool = usableUnit ? priced : candidates.filter((c) => c.premiumWon !== null)
    const best =
      pool.length === 0
        ? null
        : [...pool].sort((a, b) => (usableUnit ? a.unitPrice! - b.unitPrice! : a.premiumWon! - b.premiumWon!))[0]

    const amounts = candidates.map((c) => c.amountManwon).filter((v): v is number => v !== null)
    rows.push({
      key,
      label: bucket.label,
      plan: bucket.plan,
      groupKey: bucket.groupKey,
      candidates: [...candidates].sort((a, b) => (a.premiumWon ?? Infinity) - (b.premiumWon ?? Infinity)),
      best,
      needsReview: !usableUnit,
      amountsDiffer: amounts.length > 1 && new Set(amounts).size > 1,
      soleOffer: candidates.length === 1
    })
  }

  // 화면·엑셀 순서: 플랜 → 보험료 큰 담보부터(고객이 먼저 보는 순서).
  rows.sort((a, b) => (b.best?.premiumWon ?? 0) - (a.best?.premiumWon ?? 0))

  const mixPremium = rows.reduce((n, r) => n + (r.best?.premiumWon ?? 0), 0)

  const companies = [...new Set(items.map((i) => i.company.trim()).filter(Boolean))]
  const byCompany = companies
    .map((company) => {
      const owned = rows.filter((r) => r.candidates.some((c) => c.company === company))
      return {
        company,
        premium: owned.reduce((n, r) => n + (r.candidates.find((c) => c.company === company)?.premiumWon ?? 0), 0),
        rowCount: owned.length
      }
    })
    .sort((a, b) => a.premium - b.premium)

  // 조합에 들어간 담보를 전부 가진 회사만 "한 회사로도 가능"하다고 본다.
  const full = byCompany.filter((c) => c.rowCount === rows.length && c.premium > 0)
  const cheapestSingle = full.length ? { company: full[0].company, premium: full[0].premium } : null

  return {
    rows,
    mixPremium,
    byCompany,
    cheapestSingle,
    savedVsSingle: cheapestSingle ? cheapestSingle.premium - mixPremium : null,
    usedCompanies: [...new Set(rows.map((r) => r.best?.company).filter((c): c is string => Boolean(c)))]
  }
}

/* ---------- 보장군(같은 목적, 다른 범위) ---------- */

/**
 * 회사마다 "같은 자리"에 넣는 담보가 다르다. 뇌 진단비가 대표적이다 —
 * A사는 뇌혈관질환, B사는 뇌졸중, C사는 뇌출혈만 넣는다.
 *
 * 이걸 각각 다른 줄로 두면 비교표가 0으로 가득 차서 못 본다. 그래서 한 줄로 모으되,
 * **회사마다 실제로 무엇이 들어갔는지 칸에 표시**한다. 보장 범위가 달라 값이 다르다는
 * 사실을 숨기면 안 되기 때문이다(뇌혈관질환 ⊃ 뇌졸중 ⊃ 뇌출혈).
 *
 * 범위가 겹치지 않는 담보(일반암 vs 유사암처럼 보험금이 따로 나오는 것)는 묶지 않는다.
 */
const FAMILIES: { key: string; label: string; members: string[] }[] = [
  { key: 'fam-brain', label: '뇌 진단비', members: ['comp-brain-vessel', 'comp-stroke', 'comp-brain-bleed'] },
  { key: 'fam-heart', label: '심장 진단비', members: ['comp-heart-isch', 'comp-heart-ami'] }
]

export interface CoverageFamily {
  /** 비교표에서 한 줄로 묶는 키 */
  key: string
  /** 줄 제목 */
  label: string
  /** 여러 담보를 묶은 줄인지(칸마다 실제 담보를 같이 보여줘야 한다) */
  grouped: boolean
}

/** 대표 담보 키 → 비교표에서 묶일 보장군. 묶이지 않으면 자기 자신. */
export function familyOf(mixKey: string, label: string): CoverageFamily {
  const family = FAMILIES.find((f) => f.members.includes(mixKey))
  return family
    ? { key: family.key, label: family.label, grouped: true }
    : { key: mixKey, label, grouped: false }
}

/* ---------- 단가 표시 단위 ---------- */

export interface UnitBasis {
  /** 몇 만원을 한 단위로 볼지 */
  perManwon: number
  /** 화면에 쓰는 이름 */
  label: string
}

/**
 * 담보 크기에 맞는 단가 단위를 고른다.
 *
 * 암진단비(3,000만원)와 깁스치료비(30만원)를 같은 단위로 보여주면 한쪽은 자릿수가
 * 너무 크거나 0에 가까워 읽을 수 없다. FC 가 실제로 쓰는 단위에 맞춘다.
 *
 *   1,000만원 이상 -> 1,000만원당  (진단비·사망 등 큰 담보)
 *     100만원 이상 -> 100만원당    (골절·화상 등 소액 담보)
 *     그 미만      -> 1만원당      (입원일당처럼 일당으로 가입하는 담보)
 *
 * 단위를 바꿔도 한 줄 안에서 회사 순위는 그대로다(같은 수로 나누기 때문).
 * 그래서 어디가 싼지 고르는 계산에는 영향이 없고, 보여주기용이다.
 */
export function unitBasis(amountManwon: number | null): UnitBasis | null {
  if (!amountManwon || amountManwon <= 0) return null
  if (amountManwon >= 1000) return { perManwon: 1000, label: '1,000만원당' }
  if (amountManwon >= 100) return { perManwon: 100, label: '100만원당' }
  return { perManwon: 1, label: '1만원당' }
}

/** 그 단위당 월 보험료(원). 반올림해서 원 단위로 돌려준다. */
export function unitPriceAt(premiumWon: number | null, amountManwon: number | null, basis: UnitBasis | null): number | null {
  if (!premiumWon || !amountManwon || !basis) return null
  return Math.round((premiumWon / amountManwon) * basis.perManwon)
}

/* ---------- 담보 한 개를 회사별로 줄 세우기 ---------- */

export interface CompanyOffer {
  company: string
  premiumWon: number
  amountManwon: number | null
}

export interface RankedOffer extends CompanyOffer {
  /** 이 회사의 단위당 보험료(가입금액을 읽었을 때만) */
  unitPrice: number | null
  /** 비교에 실제로 쓴 값 — 가입금액을 읽었으면 단가, 못 읽었으면 보험료 */
  score: number
  /** 제일 비싼 곳 대비 길이(0~1). 막대 길이로 쓴다 */
  ratio: number
  /** 제일 싼 곳보다 얼마나 더 내는지(score 기준). 1등은 0 */
  extra: number
  best: boolean
}

export interface CoverageRanking {
  ranked: RankedOffer[]
  best: RankedOffer | null
  /** 1등과 2등의 차이. 회사가 하나뿐이면 null */
  gap: number | null
  /** 회사마다 가입금액이 달라 보험료를 그대로 비교할 수 없는 줄인지 */
  amountsDiffer: boolean
}

/**
 * 담보 하나를 두고 회사를 싼 순으로 줄 세운다.
 *
 * 표 대신 담보마다 카드를 보여주기 위한 계산이다. 화면에는 막대 길이(ratio)와
 * "얼마 더 비싼지"(extra)만 있으면 되고, FC 는 숫자를 읽지 않아도 길이로 안다.
 *
 * 가입금액을 읽었으면 단가로 비교한다. 3,000만원 18,000원과 2,000만원 14,000원을
 * 보험료로만 줄 세우면 적게 가입한 쪽이 싸 보이기 때문이다.
 * 한 회사라도 가입금액을 못 읽으면 그 줄은 보험료로 비교하고 amountsDiffer 로 알린다.
 */
export function rankOffers(offers: CompanyOffer[], basis: UnitBasis | null): CoverageRanking {
  const usable = offers.filter((o) => o.premiumWon > 0)
  if (usable.length === 0) return { ranked: [], best: null, gap: null, amountsDiffer: false }

  const amounts = new Set(usable.map((o) => o.amountManwon))
  const everyAmountKnown = usable.every((o) => Boolean(o.amountManwon))
  const amountsDiffer = amounts.size > 1

  const scored = usable.map((o) => {
    const unitPrice = unitPriceAt(o.premiumWon, o.amountManwon, basis)
    // 가입금액을 모두 읽었을 때만 단가로 비교한다. 하나라도 모르면 사과와 배를 섞는 셈이다.
    return { ...o, unitPrice, score: everyAmountKnown && unitPrice ? unitPrice : o.premiumWon }
  })

  const sorted = [...scored].sort((a, b) => a.score - b.score)
  const cheapest = sorted[0].score
  const dearest = sorted[sorted.length - 1].score

  return {
    ranked: sorted.map((o, i) => ({
      ...o,
      ratio: dearest > 0 ? o.score / dearest : 0,
      extra: o.score - cheapest,
      best: i === 0
    })),
    best: { ...sorted[0], ratio: dearest > 0 ? cheapest / dearest : 0, extra: 0, best: true },
    gap: sorted.length > 1 ? sorted[1].score - cheapest : null,
    amountsDiffer
  }
}
