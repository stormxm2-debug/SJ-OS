/**
 * 가입제안서 담보 → 플랜 분류.
 *
 * 제안서 한 건에는 종합·운전자·실손·입원비 담보가 섞여 있다. 담보명을 보고 네 플랜으로
 * 갈라, FC가 필요한 플랜만 골라 보게 한다. 입원비플랜의 세부 분류(입원일당·병실 등)는
 * 기존 hospitalCoverage.ts 가 그대로 담당하고, 이 모듈은 "어느 플랜인가"만 정한다.
 *
 * 분류는 담보명 패턴으로만 한다. 애매한 담보는 지어내지 않고 '기타'로 두어 FC가 직접
 * 켜고 끌 수 있게 한다. 그룹별 켜짐/꺼짐 기본값은 DEFAULT_ON 이고, FC가 바꾼 값은
 * coveragePlanPrefs.ts 가 기기별로 저장한다.
 */

export type PlanKey = 'hospital' | 'comprehensive' | 'driver' | 'actual'

export interface PlanInfo {
  key: PlanKey
  label: string
  hint: string
}

export const PLANS: PlanInfo[] = [
  { key: 'hospital', label: '입원비플랜', hint: '입원일당·간병·병실료 — 합계표와 엑셀 양식으로 이어집니다' },
  { key: 'comprehensive', label: '종합담보', hint: '진단·수술·사망·후유장해 등 종합보험 담보' },
  { key: 'driver', label: '운전자', hint: '교통사고처리지원금·변호사선임비·벌금 등' },
  { key: 'actual', label: '실손', hint: '급여·비급여 의료비와 3대 비급여' }
]

export interface PlanGroup {
  key: string
  plan: PlanKey
  label: string
  /** 담보명(공백 제거)에 대해 검사하는 패턴. 배열 순서가 곧 분류 우선순위다. */
  pattern: RegExp
  /** 기본으로 체크해 둘 그룹인지. FC가 바꾸면 기기에 저장된다. */
  defaultOn: boolean
}

/**
 * 분류 우선순위 순서. 위에서부터 먼저 맞는 그룹이 이긴다.
 *
 * 실손·운전자를 종합보다 먼저 두는 이유: '자동차사고부상치료비'는 치료비지만 운전자
 * 담보이고, '비급여주사료'는 주사지만 실손 담보라 종합 패턴에 먼저 걸리면 안 된다.
 */
export const PLAN_GROUPS: PlanGroup[] = [
  /* ---------- 실손 ---------- */
  {
    key: 'actual-3',
    plan: 'actual',
    label: '3대 비급여(도수·주사·MRI)',
    pattern: /도수치료|체외충격파|증식치료|비급여주사|주사료|자기공명영상|MRI|MRA/i,
    defaultOn: true
  },
  {
    key: 'actual-non',
    plan: 'actual',
    label: '비급여 입원·통원',
    pattern: /비급여.*(의료비|입원|통원|치료)/,
    defaultOn: true
  },
  {
    key: 'actual-cov',
    plan: 'actual',
    label: '급여 입원·통원',
    pattern: /(^|[^비])급여.*(의료비|입원|통원)/,
    defaultOn: true
  },
  {
    key: 'actual-base',
    plan: 'actual',
    label: '실손의료비',
    pattern: /실손|실비|(입원|통원|종합)의료비/,
    defaultOn: true
  },

  /* ---------- 운전자 ---------- */
  {
    key: 'driver-accident',
    plan: 'driver',
    label: '교통사고처리지원금',
    pattern: /교통사고처리지원|사고처리지원|형사합의/,
    defaultOn: true
  },
  {
    key: 'driver-lawyer',
    plan: 'driver',
    label: '변호사선임비용',
    pattern: /변호사선임|변호사비용/,
    defaultOn: true
  },
  {
    key: 'driver-fine',
    plan: 'driver',
    label: '벌금',
    pattern: /벌금/,
    defaultOn: true
  },
  {
    key: 'driver-injury',
    plan: 'driver',
    label: '자동차사고부상치료비',
    pattern: /자동차사고부상|교통상해부상|부상치료비|부상발생금/,
    defaultOn: true
  },
  {
    key: 'driver-license',
    plan: 'driver',
    label: '면허정지·취소 위로금',
    pattern: /면허정지|면허취소|운전면허/,
    defaultOn: true
  },
  {
    key: 'driver-etc',
    plan: 'driver',
    label: '할증지원금·견인 등 기타',
    pattern: /보험료할증|긴급견인|견인비용|차량손해위로|렌트비용|보복운전|스쿨존|어린이보호구역|중대법규위반|운전자/,
    defaultOn: true
  },

  /* ---------- 종합 ---------- */
  // 골절·화상을 진단비보다 먼저 본다: '골절진단비'·'화상진단비'는 이름에 '진단비'가 들어가지만
  // 암·뇌·심장 진단비가 아니라 소액 담보다.
  {
    key: 'comp-minor',
    plan: 'comprehensive',
    label: '골절·화상·깁스·응급실',
    pattern: /골절|화상|깁스|부목|응급실|응급치료|외상|치아파절/,
    defaultOn: true
  },
  {
    key: 'comp-diagnosis',
    plan: 'comprehensive',
    label: '진단비(암·뇌·심장)',
    pattern:
      /암진단|유사암|소액암|고액암|제자리암|경계성종양|재진단암|특정암|뇌혈관|뇌졸중|뇌출혈|뇌경색|급성심근경색|허혈성심장|특정심장|심혈관|[23]대질환|진단비|진단급여금|진단보험금/,
    defaultOn: true
  },
  {
    key: 'comp-surgery',
    plan: 'comprehensive',
    label: '수술비',
    pattern: /수술/,
    defaultOn: true
  },
  {
    key: 'comp-death',
    plan: 'comprehensive',
    label: '사망·후유장해',
    pattern: /사망|후유장해|고도장해|장해급여금|[^무]장해/,
    defaultOn: true
  },
  {
    key: 'comp-etc',
    plan: 'comprehensive',
    label: '기타 담보',
    // 위 네 그룹에 안 걸린 종합 담보. 기본은 꺼 두고 FC가 필요할 때 켠다.
    pattern: /납입면제|생활자금|재활|치아|임플란트|배상책임|일상생활|치매|간병|요양|건강관리|통원|입원/,
    defaultOn: false
  }
]

/** 담보명 뒤 상품 형태 표기는 분류에 방해가 되므로 뗀다. hospitalCoverage.cleanName 과 같은 규칙. */
const FORM_SUFFIX =
  /\([^()]*(?:무배당|해약환급금|해약미지급|미지급형|일반심사형|간편가입|통합간편|간편형|간편|사망시적립액|납입면제형|고지형|V2|배당)[^()]*\)/g

export function normalizeCoverageName(name: string): string {
  return String(name || '')
    .replace(/^\s*\d{1,3}\s*[.,]\s*/, '')
    .replace(/\(무\)|\(무배당\)/g, '')
    .replace(FORM_SUFFIX, '')
    .replace(/\s/g, '')
}

/**
 * 담보가 속한 플랜 그룹. 입원비플랜으로 이미 분류된 담보(hospitalCoverage 가 양식 항목을
 * 찾아준 담보)는 isHospital=true 로 넘기면 입원비플랜으로 고정한다.
 */
export function classifyPlanGroup(coverageName: string, isHospital: boolean): PlanGroup | null {
  if (isHospital) return null
  const name = normalizeCoverageName(coverageName)
  if (!name) return null
  return PLAN_GROUPS.find((group) => group.pattern.test(name)) ?? null
}

/** 그룹 키 → 그룹. 저장된 설정을 읽을 때 쓴다. */
export function findPlanGroup(key: string): PlanGroup | undefined {
  return PLAN_GROUPS.find((g) => g.key === key)
}

/** 플랜에 속한 그룹들(화면 표시 순서). */
export function groupsOfPlan(plan: PlanKey): PlanGroup[] {
  return PLAN_GROUPS.filter((g) => g.plan === plan)
}

/** 플랜의 기본 켜짐 그룹 키. */
export function defaultOnKeys(plan: PlanKey): string[] {
  return groupsOfPlan(plan)
    .filter((g) => g.defaultOn)
    .map((g) => g.key)
}
