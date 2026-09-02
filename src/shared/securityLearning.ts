/**
 * 자동 보안 모듈 탐지 및 학습 엔진 (Security Module Learning Engine, "SMLE")
 * — 공용 계약 + 순수 로직.
 *
 * 이 파일은 Electron 메인(Node)과 렌더러(React)가 함께 import 하며 **Node 의존성이 없다.**
 * 시스템 접근(PowerShell/WMI 등)은 전부 `src/main/securityLearning.ts`가 담당하고,
 * 이 파일은 타입과 순수 함수(분류·신뢰점수·안전규칙·diff)만 정의한다.
 *
 * 설계 근거: docs/SECURITY_MODULE_LEARNING_ENGINE.md
 *
 * 1차(관찰·학습 전용)에서는 어떤 프로세스도 종료하지 않는다. 제어/롤백 타입은
 * 설계를 고정하기 위해 정의하지만 메인에서는 비활성 스텁으로만 사용한다.
 */

// ---------------------------------------------------------------------------
// 기본 열거형
// ---------------------------------------------------------------------------

/** 학습·제어 단위의 종류. */
export type ElementKind =
  | 'process'
  | 'service'
  | 'driver'
  | 'scheduled-task'
  | 'startup'
  | 'network'

/** 반복 학습으로 확정되는 소속 분류. */
export type ElementCategory =
  | 'insurer-exclusive' // 해당 보험사 전용
  | 'insurer-shared' // 여러 보험사 공용
  | 'windows-system' // Windows 시스템
  | 'security-av' // 백신·방화벽·보안
  | 'business-common' // 업무 일반 프로그램
  | 'unknown' // 소속 불명
  | 'never-terminate' // 자동 종료 금지(안전규칙 고정)

/** 스냅샷 시점. */
export type SnapshotPhase = 'baseline' | 'after-launch' | 'after-exit' | 'periodic'

/** 수집기 지원 여부. */
export type CollectorSupport = 'supported' | 'unsupported'

// ---------------------------------------------------------------------------
// 스냅샷 엔트리 (경량: 해시·서명은 diff 변경분에만 부여)
// ---------------------------------------------------------------------------

export interface ProcessEntry {
  pid: number
  parentPid: number
  name: string
  /** 실행 경로(소문자 정규화 전 원본). 없을 수 있음(권한). */
  path: string | null
  /** 정제(redact)된 명령줄. 개인정보/인증서/비밀번호 제거됨. */
  commandLine: string | null
}

export interface ServiceEntry {
  serviceName: string
  displayName: string | null
  state: string // Running/Stopped ...
  startMode: string // Auto/Manual/Disabled ...
  path: string | null // 실행 이미지 경로(정제)
}

export interface DriverEntry {
  driverName: string
  displayName: string | null
  state: string
  started: boolean
  path: string | null
}

export interface ScheduledTaskEntry {
  taskName: string
  taskPath: string
  state: string
}

export interface StartupEntry {
  name: string | null
  command: string // 정제된 명령
  location: string // Registry Run 키 / 폴더 등
}

export interface NetworkConnEntry {
  ownerPid: number
  ownerPath: string | null
  remoteAddress: string
  remotePort: number
  state: string
}

export interface SystemSnapshot {
  id: string
  takenAt: string
  phase: SnapshotPhase
  insurerId: string | null
  processes: ProcessEntry[]
  services: ServiceEntry[]
  drivers: DriverEntry[]
  scheduledTasks: ScheduledTaskEntry[]
  startupItems: StartupEntry[]
  network: NetworkConnEntry[]
  collectorErrors: string[]
}

// ---------------------------------------------------------------------------
// diff
// ---------------------------------------------------------------------------

/** 요소의 표시·분류용 세부(정제된 메타데이터만). */
export interface ElementDetail {
  path: string | null
  commandLine: string | null
  state: string | null
  startMode: string | null
  publisher: string | null
  signatureValid: boolean | null
  sha256: string | null
  /** 브라우저 프로세스인 경우 실행 URL의 호스트(도메인)만. 경로·쿼리는 저장 안 함. */
  urlHosts?: string[]
}

export interface DiffItem {
  kind: ElementKind
  identityKey: string
  label: string
  detail: ElementDetail
}

export interface SnapshotDiff {
  insurerId: string
  baselineId: string
  afterId: string
  appeared: DiffItem[]
  changed: DiffItem[]
  disappeared: DiffItem[]
}

// ---------------------------------------------------------------------------
// 학습 요소 / 보험사 프로필 / 그래프
// ---------------------------------------------------------------------------

export interface LearnedElement {
  id: string
  insurerId: string
  kind: ElementKind
  identityKey: string
  label: string
  detail: ElementDetail

  observations: number
  sessionsSeen: number
  totalSessions: number
  firstSeenAt: string
  lastSeenAt: string
  sharedWithInsurerIds: string[]

  signatureValid: boolean | null
  publisher: string | null
  sha256: string | null

  category: ElementCategory
  categoryReasons: string[]
  confidence: number
  controlEligible: boolean
  protectedReasons: string[]
  /** 종료 후에도 남아 있는 것으로 관찰된 경우. */
  lingersAfterExit?: boolean
}

export interface InsurerProfile {
  id: string
  name: string
  launchHints: string[]
  totalSessions: number
  lastSessionAt: string | null
}

export type DependencyRelation =
  | 'parent-child'
  | 'service-dependency'
  | 'loads-driver'
  | 'uses-shared'

export interface DependencyEdge {
  fromKey: string
  toKey: string
  relation: DependencyRelation
}

export interface DependencyGraph {
  insurerId: string
  nodes: LearnedElement[]
  edges: DependencyEdge[]
}

// ---------------------------------------------------------------------------
// 세션 / 엔진 상태 (렌더러 노출용)
// ---------------------------------------------------------------------------

export type SessionStatus = 'idle' | 'baseline-captured' | 'observing' | 'closed'

export interface LearningSession {
  id: string
  insurerId: string
  status: SessionStatus
  startedAt: string
  endedAt: string | null
  baselineSnapshotId: string | null
  lastAfterSnapshotId: string | null
  appearedCount: number
  changedCount: number
}

export interface EngineSummary {
  insurerCount: number
  learnedCount: number
  controlEligibleCount: number
  /** category별 학습 요소 수. */
  byCategory: Record<ElementCategory, number>
}

/** 완전 자동 감지(백그라운드 감시) 상태. */
export interface AutoWatchState {
  /** 사용자가 자동 감지를 켰는지(설정 영속). */
  enabled: boolean
  /** 이 환경(Windows)에서 자동 감지가 가능한지. */
  supported: boolean
  /** 현재 자동 학습 중인 보험사(감지된 전산). */
  activeInsurerId: string | null
  activeInsurerName: string | null
  /** 마지막 자동 이벤트(감지/학습/종료) 시각·설명. */
  lastEventAt: string | null
  lastEventText: string | null
}

/** 자동으로 찾아낸 "보완할 점". 사용자 조치 없이도 계속 학습해 채워진다. */
export interface ImprovementHint {
  insurerId: string
  insurerName: string
  type: 'needs-repeat' | 'unknown' | 'lingering' | 'low-confidence'
  count: number
  message: string
}

/**
 * 충돌 위험 진단 — 여러 보험사 전산을 동시에 켰을 때 "PC 먹통"을 유발할 수 있는
 * 후보를 학습 데이터에서 자동으로 찾아낸다.
 */
export interface ConflictWarning {
  severity: 'high' | 'medium'
  type: 'version-conflict' | 'kernel-driver-stack' | 'keyboard-security-overlap'
  title: string
  detail: string
  /** 관련 보험사 이름들. */
  insurers: string[]
  /** 관련 모듈 이름(있으면). */
  module?: string
}

export interface EngineState {
  support: CollectorSupport
  /** 1차에서는 항상 false(관찰 전용). */
  controlEnabled: boolean
  activeSession: LearningSession | null
  recentSessions: LearningSession[]
  summary: EngineSummary
  /** 완전 자동 감지 상태. */
  autoWatch: AutoWatchState
  /** 자동으로 파악한 보완할 점(반복 학습으로 채워짐). */
  improvements: ImprovementHint[]
  /** 먹통 원인 후보 — 충돌 위험 진단. */
  conflicts: ConflictWarning[]
  updatedAt: string
}

// ---------------------------------------------------------------------------
// 제어 / 롤백 (설계 고정용 — 1차 비활성)
// ---------------------------------------------------------------------------

export type PlannedOp = 'graceful-stop' | 'force-stop' | 'start'

export interface PlannedAction {
  kind: ElementKind
  identityKey: string
  op: PlannedOp
  previousState: string
  result?: 'ok' | 'failed' | 'skipped'
}

export type ChangePlanStatus =
  | 'planned'
  | 'applying'
  | 'applied'
  | 'rolling-back'
  | 'rolled-back'
  | 'failed'
  | 'disabled'

export interface ChangePlan {
  id: string
  insurerId: string
  createdAt: string
  preChangeSnapshotId: string | null
  actions: PlannedAction[]
  attempts: number
  status: ChangePlanStatus
}

// ---------------------------------------------------------------------------
// 튜닝 상수
// ---------------------------------------------------------------------------

/** 자동 제어 승격에 필요한 최소 반복 세션 수. */
export const REPEAT_TARGET = 3
/** 자동 제어 승격 신뢰점수 임계값(보수적). */
export const CONTROL_THRESHOLD = 0.8
/** 롤백 최대 재시도(무한 재시작 방지). */
export const MAX_RETRIES = 2
/** 정상 종료 후 강제 종료를 검토하기까지의 제한시간(ms). */
export const GRACEFUL_STOP_TIMEOUT_MS = 8000

const EMPTY_BY_CATEGORY = (): Record<ElementCategory, number> => ({
  'insurer-exclusive': 0,
  'insurer-shared': 0,
  'windows-system': 0,
  'security-av': 0,
  'business-common': 0,
  unknown: 0,
  'never-terminate': 0
})

/** 종료 금지 Windows 코어 프로세스명(소문자, 확장자 제외/포함 모두 대응). */
export const WINDOWS_CORE_PROCESSES: readonly string[] = [
  'system',
  'smss',
  'csrss',
  'wininit',
  'winlogon',
  'services',
  'lsass',
  'lsaiso',
  'svchost',
  'fontdrvhost',
  'dwm',
  'explorer',
  'sihost',
  'taskhostw',
  'ctfmon',
  'runtimebroker',
  'searchindexer',
  'spoolsv',
  'conhost',
  'dllhost',
  'wudfhost',
  'audiodg',
  'memory compression',
  'registry',
  'securityhealthservice',
  'securityhealthsystray',
  'msmpeng',
  'nissrv'
]

/** 변동성이 커서 신뢰점수 가중을 낮출 호스트 프로세스. */
export const NOISY_HOST_PROCESSES: readonly string[] = [
  'svchost',
  'runtimebroker',
  'dllhost',
  'conhost',
  'taskhostw',
  'backgroundtaskhost',
  'searchprotocolhost',
  'wmiprvse'
]

/** 백신·방화벽·보안 벤더 힌트(게시자/이름 소문자 부분일치). */
export const SECURITY_VENDOR_HINTS: readonly string[] = [
  'ahnlab',
  '안랩',
  'v3',
  'estsecurity',
  'estsoft',
  'alyac',
  '알약',
  'hauri',
  '하우리',
  'virobot',
  'windows defender',
  'microsoft defender',
  'symantec',
  'norton',
  'mcafee',
  'kaspersky',
  'trendmicro',
  'trend micro',
  'bitdefender',
  'avast',
  'avg',
  'sophos',
  'crowdstrike',
  'sentinelone',
  'eset',
  'nod32',
  'malwarebytes',
  'firewall',
  'antivirus',
  'endpoint protection'
]

/**
 * 한국 금융/보안 공용 모듈 힌트(키보드 보안·백신 연동·인증 등). 여러 보험사·은행에서
 * 공통으로 쓰여 `insurer-shared` 신호로 사용한다. (게시자/이름/경로 소문자 부분일치)
 */
export const SHARED_SECURITY_MODULE_HINTS: readonly string[] = [
  'touchen',
  'raonsecure',
  '라온시큐어',
  'nprotect',
  'jiran',
  'nos',
  'veraport',
  'wizvera',
  '위즈베라',
  'delfino',
  'astx',
  'interezen',
  'ipinside',
  'inisafe',
  'initech',
  '이니텍',
  'crosscert',
  'yessign',
  'unizsafe',
  'unisign',
  'magicline',
  'dreamsecurity',
  'softforum',
  'xecure',
  'softcamp',
  'e2e',
  'keysharp',
  'nprotect keycrypt'
]

/** 업무 일반 프로그램 게시자/이름 힌트. */
export const BUSINESS_COMMON_HINTS: readonly string[] = [
  'microsoft office',
  'winword',
  'excel',
  'powerpnt',
  'outlook',
  'hancom',
  '한글',
  'hwp',
  'google chrome',
  'chrome',
  'mozilla',
  'firefox',
  'microsoft edge',
  'msedge',
  'whale',
  'naver',
  'kakao',
  'acrobat',
  'adobe',
  'notepad',
  'code.exe',
  'slack',
  'zoom'
]

// ---------------------------------------------------------------------------
// 정규화 / 식별자
// ---------------------------------------------------------------------------

/** 경로/이름 비교용 소문자 정규화. */
export function norm(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase().replace(/\\+/g, '\\')
}

/** 확장자를 제외한 실행 파일명(소문자). */
export function baseName(pathOrName: string | null | undefined): string {
  const n = norm(pathOrName)
  const last = n.split(/[\\/]/).pop() ?? n
  return last.replace(/\.(exe|sys|dll|com|scr)$/i, '')
}

export function processIdentity(p: ProcessEntry): string {
  return `${norm(p.path) || norm(p.name)}`
}
export function serviceIdentity(s: ServiceEntry): string {
  return norm(s.serviceName)
}
export function driverIdentity(d: DriverEntry): string {
  return norm(d.driverName)
}
export function scheduledTaskIdentity(t: ScheduledTaskEntry): string {
  return `${norm(t.taskPath)}${norm(t.taskName)}`
}
export function startupIdentity(s: StartupEntry): string {
  return `${norm(s.location)}|${norm(s.command)}`
}
export function networkIdentity(n: NetworkConnEntry): string {
  return `${n.remoteAddress}:${n.remotePort}|${norm(n.ownerPath)}`
}

// ---------------------------------------------------------------------------
// 개인정보 정제 (redaction) — 저장 전에 반드시 통과
// ---------------------------------------------------------------------------

const REDACT_PATTERNS: readonly RegExp[] = [
  /(pass(word)?|pwd|pw|secret|token|api[-_]?key|auth)\s*[=:]\s*[^\s"']+/gi,
  /\b\d{6}-\d{7}\b/g, // 주민등록번호
  /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, // email
  /(cert|인증서|signcert|signpri)[^\s"']*/gi
]

/** 명령줄/문자열에서 민감 정보를 제거한 사본을 만든다(원본 저장 금지). */
export function redact(value: string | null | undefined): string | null {
  if (!value) return value ?? null
  let out = value
  for (const re of REDACT_PATTERNS) out = out.replace(re, '***')
  // URL은 호스트만 남기고 경로·쿼리 제거.
  out = out.replace(/https?:\/\/([^/\s"']+)[^\s"']*/gi, 'https://$1')
  return out.slice(0, 512)
}

/** 문자열에서 URL 호스트만 추출(개인 세션 경로/쿼리는 버림). */
export function extractUrlHosts(commandLine: string | null | undefined): string[] {
  if (!commandLine) return []
  const hosts = new Set<string>()
  const re = /https?:\/\/([^/\s"']+)/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(commandLine)) !== null) hosts.add(m[1].toLowerCase())
  return [...hosts]
}

// ---------------------------------------------------------------------------
// 안전규칙 평가
// ---------------------------------------------------------------------------

function matchesAny(haystacks: (string | null | undefined)[], hints: readonly string[]): boolean {
  const joined = haystacks.map((h) => norm(h)).join(' | ')
  return hints.some((hint) => joined.includes(hint))
}

function isWindowsCore(el: Pick<LearnedElement, 'kind' | 'label' | 'detail'>): boolean {
  const bn = baseName(el.detail.path ?? el.label)
  if (WINDOWS_CORE_PROCESSES.includes(bn)) return true
  const p = norm(el.detail.path)
  const microsoftSigned =
    el.detail.signatureValid === true && matchesAny([el.detail.publisher], ['microsoft'])
  const inWindows = p.startsWith('c:\\windows\\') || p.includes('\\system32\\')
  return microsoftSigned && inWindows
}

function isSecurityAv(el: Pick<LearnedElement, 'label' | 'detail'>): boolean {
  return matchesAny([el.label, el.detail.path, el.detail.publisher], SECURITY_VENDOR_HINTS)
}

/**
 * 안전규칙(§6)을 평가해 종료 금지 사유 목록을 만든다. 하나라도 있으면 자동 제어 불가.
 * (미저장 Office 문서 검사는 종료 직전 실시간으로만 가능하므로 여기서는 정적 규칙만.)
 */
export function evaluateProtection(
  el: Pick<LearnedElement, 'kind' | 'label' | 'detail' | 'category'>
): string[] {
  const reasons: string[] = []
  if (isWindowsCore(el)) reasons.push('Windows 핵심 구성요소 — 종료 금지')
  if (isSecurityAv(el)) reasons.push('백신·방화벽·보안 프로그램 — 종료 금지')
  if (el.kind === 'driver' && el.detail.signatureValid !== true) {
    reasons.push('서명이 유효하지 않은 드라이버 — 종료 금지')
  }
  if (el.detail.signatureValid === false) {
    reasons.push('서명 무효/위조 의심 — 자동 제어 제외')
  }
  return reasons
}

// ---------------------------------------------------------------------------
// 분류 (§4.3) — 위에서 아래로, 먼저 걸리는 규칙 채택
// ---------------------------------------------------------------------------

export interface ClassifyResult {
  category: ElementCategory
  reasons: string[]
}

export function classify(el: LearnedElement): ClassifyResult {
  const reasons: string[] = []

  // 1) 안전규칙 → never-terminate
  const protectedReasons = evaluateProtection(el)
  if (isWindowsCore(el)) {
    return { category: 'windows-system', reasons: ['Windows 코어/서명·경로 일치'] }
  }
  if (isSecurityAv(el)) {
    return { category: 'security-av', reasons: ['보안 벤더 힌트 일치'] }
  }
  if (protectedReasons.length > 0) {
    return { category: 'never-terminate', reasons: protectedReasons }
  }

  // 4) 공용: 2개 이상 보험사에서 관찰되거나 공용 보안모듈 힌트 일치
  const distinctInsurers = new Set([el.insurerId, ...el.sharedWithInsurerIds])
  const sharedHint = matchesAny(
    [el.label, el.detail.path, el.detail.publisher],
    SHARED_SECURITY_MODULE_HINTS
  )
  if (distinctInsurers.size >= 2) {
    reasons.push(`${distinctInsurers.size}개 보험사 세션에서 공통 관찰`)
    return { category: 'insurer-shared', reasons }
  }
  if (sharedHint) {
    reasons.push('공용 보안/인증 모듈 힌트 일치')
    return { category: 'insurer-shared', reasons }
  }

  // 5) 업무 일반
  if (matchesAny([el.label, el.detail.path, el.detail.publisher], BUSINESS_COMMON_HINTS)) {
    return { category: 'business-common', reasons: ['업무 일반 프로그램 힌트 일치'] }
  }

  // 6) 전용: 이 보험사에서만 반복 관찰
  const exclusivity = el.totalSessions > 0 ? el.sessionsSeen / el.totalSessions : 0
  if (el.sessionsSeen >= 2 && exclusivity >= 0.5 && distinctInsurers.size === 1) {
    reasons.push(`단일 보험사 반복 관찰(${el.sessionsSeen}/${el.totalSessions})`)
    return { category: 'insurer-exclusive', reasons }
  }

  // 7) 소속 불명
  reasons.push('반복/소속 신호 부족 — 계속 학습')
  return { category: 'unknown', reasons }
}

// ---------------------------------------------------------------------------
// 신뢰점수 (§4.4)
// ---------------------------------------------------------------------------

export function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v))
}

export function computeConfidence(el: LearnedElement): number {
  const exclusivity = el.totalSessions > 0 ? el.sessionsSeen / el.totalSessions : 0
  const bn = baseName(el.detail.path ?? el.label)
  const isNoisy = NOISY_HOST_PROCESSES.includes(bn)
  const hasStablePath = !!el.detail.path && norm(el.detail.path).includes('\\')

  let base = 0
  base += 0.4 * Math.min(1, el.sessionsSeen / REPEAT_TARGET)
  base += 0.1 * Math.min(1, el.observations / (REPEAT_TARGET * 2))
  base += 0.2 * exclusivity
  base +=
    el.signatureValid === true ? 0.15 : el.signatureValid === false ? 0 : 0.05
  base += el.publisher ? 0.05 : 0
  base += hasStablePath ? 0.05 : 0
  base -= isNoisy ? 0.2 : 0
  return clamp01(base)
}

/** 자동 제어 승격 여부(§4.4). 1차에서는 표시용으로만 계산한다. */
export function isControlEligible(el: LearnedElement): boolean {
  if (el.protectedReasons.length > 0) return false
  if (el.signatureValid === false) return false
  if (!(el.category === 'insurer-exclusive' || el.category === 'insurer-shared')) return false
  if (el.sessionsSeen < REPEAT_TARGET) return false
  return el.confidence >= CONTROL_THRESHOLD
}

/**
 * 학습 요소의 분류·신뢰점수·승격 여부를 일괄 재계산해 반영한 사본을 반환한다(순수).
 * 관찰 병합 후, 그리고 UI 렌더 전에 호출한다.
 */
export function recomputeElement(el: LearnedElement): LearnedElement {
  const protectedReasons = evaluateProtection(el)
  const { category, reasons } = classify({ ...el, protectedReasons })
  const withCat: LearnedElement = {
    ...el,
    protectedReasons,
    category,
    categoryReasons: reasons
  }
  const confidence = computeConfidence(withCat)
  const next: LearnedElement = { ...withCat, confidence }
  next.controlEligible = isControlEligible(next)
  return next
}

// ---------------------------------------------------------------------------
// diff (순수)
// ---------------------------------------------------------------------------

function processDiffItem(p: ProcessEntry): DiffItem {
  return {
    kind: 'process',
    identityKey: processIdentity(p),
    label: p.name || baseName(p.path),
    detail: {
      path: p.path,
      commandLine: p.commandLine,
      state: null,
      startMode: null,
      publisher: null,
      signatureValid: null,
      sha256: null,
      urlHosts: extractUrlHosts(p.commandLine)
    }
  }
}
function serviceDiffItem(s: ServiceEntry): DiffItem {
  return {
    kind: 'service',
    identityKey: serviceIdentity(s),
    label: s.displayName || s.serviceName,
    detail: {
      path: s.path,
      commandLine: null,
      state: s.state,
      startMode: s.startMode,
      publisher: null,
      signatureValid: null,
      sha256: null
    }
  }
}
function driverDiffItem(d: DriverEntry): DiffItem {
  return {
    kind: 'driver',
    identityKey: driverIdentity(d),
    label: d.displayName || d.driverName,
    detail: {
      path: d.path,
      commandLine: null,
      state: d.state,
      startMode: null,
      publisher: null,
      signatureValid: null,
      sha256: null
    }
  }
}
function taskDiffItem(t: ScheduledTaskEntry): DiffItem {
  return {
    kind: 'scheduled-task',
    identityKey: scheduledTaskIdentity(t),
    label: `${t.taskPath}${t.taskName}`,
    detail: {
      path: null,
      commandLine: null,
      state: t.state,
      startMode: null,
      publisher: null,
      signatureValid: null,
      sha256: null
    }
  }
}
function startupDiffItem(s: StartupEntry): DiffItem {
  return {
    kind: 'startup',
    identityKey: startupIdentity(s),
    label: s.name || baseName(s.command),
    detail: {
      path: null,
      commandLine: s.command,
      state: null,
      startMode: null,
      publisher: null,
      signatureValid: null,
      sha256: null
    }
  }
}
function networkDiffItem(n: NetworkConnEntry): DiffItem {
  return {
    kind: 'network',
    identityKey: networkIdentity(n),
    label: `${n.remoteAddress}:${n.remotePort}`,
    detail: {
      path: n.ownerPath,
      commandLine: null,
      state: n.state,
      startMode: null,
      publisher: null,
      signatureValid: null,
      sha256: null
    }
  }
}

/** 상태 변경 감지 키(서비스/드라이버의 State·StartMode). */
function stateSignature(item: DiffItem): string {
  return `${item.detail.state ?? ''}|${item.detail.startMode ?? ''}`
}

/**
 * baseline → after 스냅샷 diff(순수). appeared/changed/disappeared를 계산한다.
 * State/StartMode가 바뀐 서비스·드라이버는 changed로 잡는다.
 */
export function diffSnapshots(baseline: SystemSnapshot, after: SystemSnapshot): SnapshotDiff {
  const baseItems: DiffItem[] = [
    ...baseline.processes.map(processDiffItem),
    ...baseline.services.map(serviceDiffItem),
    ...baseline.drivers.map(driverDiffItem),
    ...baseline.scheduledTasks.map(taskDiffItem),
    ...baseline.startupItems.map(startupDiffItem),
    ...baseline.network.map(networkDiffItem)
  ]
  const afterItems: DiffItem[] = [
    ...after.processes.map(processDiffItem),
    ...after.services.map(serviceDiffItem),
    ...after.drivers.map(driverDiffItem),
    ...after.scheduledTasks.map(taskDiffItem),
    ...after.startupItems.map(startupDiffItem),
    ...after.network.map(networkDiffItem)
  ]

  const baseMap = new Map<string, DiffItem>()
  for (const it of baseItems) baseMap.set(`${it.kind}:${it.identityKey}`, it)
  const afterMap = new Map<string, DiffItem>()
  for (const it of afterItems) afterMap.set(`${it.kind}:${it.identityKey}`, it)

  const appeared: DiffItem[] = []
  const changed: DiffItem[] = []
  const disappeared: DiffItem[] = []

  for (const [key, it] of afterMap) {
    const prev = baseMap.get(key)
    if (!prev) appeared.push(it)
    else if (stateSignature(prev) !== stateSignature(it)) changed.push(it)
  }
  for (const [key, it] of baseMap) {
    if (!afterMap.has(key)) disappeared.push(it)
  }

  return {
    insurerId: after.insurerId ?? baseline.insurerId ?? '',
    baselineId: baseline.id,
    afterId: after.id,
    appeared,
    changed,
    disappeared
  }
}

// ---------------------------------------------------------------------------
// 요약 / 카테고리 라벨
// ---------------------------------------------------------------------------

export function summarize(insurers: InsurerProfile[], learned: LearnedElement[]): EngineSummary {
  const byCategory = EMPTY_BY_CATEGORY()
  let controlEligibleCount = 0
  for (const el of learned) {
    byCategory[el.category] += 1
    if (el.controlEligible) controlEligibleCount += 1
  }
  return {
    insurerCount: insurers.length,
    learnedCount: learned.length,
    controlEligibleCount,
    byCategory
  }
}

/**
 * 자동으로 "보완할 점"을 계산한다(순수). 사용자 조치 없이도 반복 학습으로 채워질
 * 항목들: 학습 횟수 부족, 소속 불명, 종료 후 잔존, 신뢰점수 낮음.
 */
export function computeImprovements(
  insurers: InsurerProfile[],
  learned: LearnedElement[]
): ImprovementHint[] {
  const hints: ImprovementHint[] = []
  const byInsurer = new Map<string, LearnedElement[]>()
  for (const el of learned) {
    const arr = byInsurer.get(el.insurerId) ?? []
    arr.push(el)
    byInsurer.set(el.insurerId, arr)
  }
  for (const insurer of insurers) {
    const els = byInsurer.get(insurer.id) ?? []
    const name = insurer.name
    if (insurer.totalSessions < REPEAT_TARGET) {
      hints.push({
        insurerId: insurer.id,
        insurerName: name,
        type: 'needs-repeat',
        count: REPEAT_TARGET - insurer.totalSessions,
        message: `${name}: 전산을 ${REPEAT_TARGET}번 이상 실행하면 분류가 정확해집니다 (현재 ${insurer.totalSessions}번 학습)`
      })
    }
    const unknown = els.filter((e) => e.category === 'unknown').length
    if (unknown > 0) {
      hints.push({ insurerId: insurer.id, insurerName: name, type: 'unknown', count: unknown, message: `${name}: 소속 불명 ${unknown}건 — 계속 자동 학습 중` })
    }
    const lingering = els.filter((e) => e.lingersAfterExit).length
    if (lingering > 0) {
      hints.push({ insurerId: insurer.id, insurerName: name, type: 'lingering', count: lingering, message: `${name}: 전산 종료 후 잔존 ${lingering}건 — 자동 전환 시 정리 후보` })
    }
    const lowConf = els.filter((e) => e.confidence < 0.5 && e.sessionsSeen >= 1).length
    if (lowConf > 0) {
      hints.push({ insurerId: insurer.id, insurerName: name, type: 'low-confidence', count: lowConf, message: `${name}: 신뢰점수 낮은 항목 ${lowConf}건 — 반복 학습으로 보완 중` })
    }
  }
  return hints.slice(0, 12)
}

/**
 * 충돌 위험 진단(순수) — "여러 보험사 전산 동시 실행 시 먹통" 원인 후보를 학습 데이터에서
 * 찾아낸다. 3가지 신호:
 *  1) version-conflict: 같은 보안 모듈을 보험사마다 서로 다른 버전/경로로 사용 (가장 위험)
 *  2) keyboard-security-overlap: 공용 키보드/인증 보안 모듈이 여러 보험사에 걸침 (입력 먹통)
 *  3) kernel-driver-stack: 보험사 전용 커널 드라이버가 다수 상주 (자원 고갈/충돌)
 */
export function computeConflicts(
  insurers: InsurerProfile[],
  learned: LearnedElement[]
): ConflictWarning[] {
  const nameOf = (id: string): string => insurers.find((i) => i.id === id)?.name ?? id
  const warnings: ConflictWarning[] = []

  // 모듈 이름 기준 그룹핑(같은 프로그램을 여러 보험사가 올렸는지).
  interface Group {
    module: string
    kind: ElementKind
    insurerIds: Set<string>
    hashes: Set<string>
    paths: Set<string>
    isSharedSecurity: boolean
  }
  const groups = new Map<string, Group>()
  for (const el of learned) {
    const mod = baseName(el.detail.path ?? el.label)
    if (!mod) continue
    const gkey = `${el.kind}:${mod}`
    let g = groups.get(gkey)
    if (!g) {
      g = {
        module: mod,
        kind: el.kind,
        insurerIds: new Set(),
        hashes: new Set(),
        paths: new Set(),
        isSharedSecurity: SHARED_SECURITY_MODULE_HINTS.some((h) =>
          `${norm(el.label)} ${norm(el.detail.path)}`.includes(h)
        )
      }
      groups.set(gkey, g)
    }
    g.insurerIds.add(el.insurerId)
    if (el.sha256) g.hashes.add(el.sha256)
    if (el.detail.path) g.paths.add(norm(el.detail.path))
  }

  for (const g of groups.values()) {
    if (g.insurerIds.size < 2) continue
    const names = [...g.insurerIds].map(nameOf)
    const versionDiffers = g.hashes.size >= 2 || g.paths.size >= 2
    if (versionDiffers) {
      warnings.push({
        severity: 'high',
        type: 'version-conflict',
        title: `'${g.module}' 버전 충돌`,
        detail: `${names.join(', ')} 전산이 같은 보안 모듈 '${g.module}'을(를) 서로 다른 버전/경로로 사용합니다. 동시에 켜면 충돌해 PC가 먹통될 수 있습니다.`,
        insurers: names,
        module: g.module
      })
    } else if (g.isSharedSecurity) {
      warnings.push({
        severity: 'medium',
        type: 'keyboard-security-overlap',
        title: `공용 보안 모듈 중복 '${g.module}'`,
        detail: `${names.join(', ')}이(가) 공용 키보드/인증 보안 '${g.module}'을(를) 함께 사용합니다. 여러 전산을 동시에 켜면 입력(키보드·마우스)이 멈출 수 있습니다.`,
        insurers: names,
        module: g.module
      })
    }
  }

  // 보험사 전용 커널 드라이버 다수 상주.
  const exclusiveDrivers = new Set<string>()
  const driverInsurers = new Set<string>()
  for (const el of learned) {
    if (el.kind === 'driver' && el.category === 'insurer-exclusive') {
      exclusiveDrivers.add(baseName(el.detail.path ?? el.label))
      driverInsurers.add(el.insurerId)
    }
  }
  if (exclusiveDrivers.size >= 3) {
    warnings.push({
      severity: 'medium',
      type: 'kernel-driver-stack',
      title: `보험사 전용 커널 드라이버 ${exclusiveDrivers.size}개`,
      detail: `여러 보험사 전산을 동시에 켜면 전용 커널 드라이버 ${exclusiveDrivers.size}개가 함께 상주해 시스템 부하·충돌(먹통) 위험이 커집니다.`,
      insurers: [...driverInsurers].map(nameOf)
    })
  }

  // high 먼저.
  return warnings.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'high' ? -1 : 1)).slice(0, 12)
}

export const CATEGORY_LABEL: Record<ElementCategory, string> = {
  'insurer-exclusive': '보험사 전용',
  'insurer-shared': '여러 보험사 공용',
  'windows-system': 'Windows 시스템',
  'security-av': '백신·보안',
  'business-common': '업무 일반',
  unknown: '소속 불명',
  'never-terminate': '자동 종료 금지'
}

export const KIND_LABEL: Record<ElementKind, string> = {
  process: '프로세스',
  service: '서비스',
  driver: '드라이버',
  'scheduled-task': '예약 작업',
  startup: '시작 프로그램',
  network: '네트워크'
}
