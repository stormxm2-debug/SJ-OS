import { app } from 'electron'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type {
  ChangePlan,
  CollectorSupport,
  DependencyEdge,
  DependencyGraph,
  DiffItem,
  ElementDetail,
  EngineState,
  InsurerProfile,
  LearnedElement,
  LearningSession,
  ProcessEntry,
  SnapshotPhase,
  SystemSnapshot
} from '@shared/securityLearning'
import {
  BUSINESS_COMMON_HINTS,
  NOISY_HOST_PROCESSES,
  SECURITY_VENDOR_HINTS,
  WINDOWS_CORE_PROCESSES,
  baseName,
  computeImprovements,
  diffSnapshots,
  extractUrlHosts,
  norm,
  recomputeElement,
  redact,
  summarize
} from '@shared/securityLearning'

/**
 * 자동 보안 모듈 탐지 및 학습 엔진 — 메인(Node) 구현.
 *
 * SAFETY / 범위(1차): **관찰·학습 전용.** 어떤 프로세스·서비스·드라이버도 종료하지 않는다.
 * 제어(실행/종료)·롤백 함수는 설계 고정을 위해 존재하지만 `disabled` 스텁이다.
 *
 * 시스템 접근은 전부 **고정된 PowerShell 스크립트**로만 수행한다(렌더러 입력이 스크립트
 * 본문에 절대 섞이지 않음 — EncodedCommand + 임시파일 경유). 명령 인젝션 표면이 없다.
 *
 * 개인정보 보호: 원시 스냅샷은 메모리에만 두고 디스크에 저장하지 않는다. 학습 저장소에는
 * 정제(redact)된 최소 메타데이터(경로·해시·게시자·서명유효·상태)만 남는다.
 *
 * 설계: docs/SECURITY_MODULE_LEARNING_ENGINE.md
 */

// ---------------------------------------------------------------------------
// 저장소 / 상태
// ---------------------------------------------------------------------------

interface PersistedStore {
  insurers: InsurerProfile[]
  elements: LearnedElement[]
  recentSessions: LearningSession[]
  /** 완전 자동 감지 켜짐 여부(영속). */
  autoWatchEnabled?: boolean
}

const MAX_RECENT_SESSIONS = 25

let store: PersistedStore = { insurers: [], elements: [], recentSessions: [] }
let activeSession: LearningSession | null = null

/** 메모리 전용 스냅샷 보관(디스크에 쓰지 않음). */
const snapshots = new Map<string, SystemSnapshot>()
/** 세션 내에서 요소별 sessionsSeen 중복 카운트 방지. */
const countedThisSession = new Map<string, Set<string>>()

let emitState: (state: EngineState) => void = () => {}
export function setSecurityLearningEmitter(fn: (state: EngineState) => void): void {
  emitState = fn
}

function isWindows(): boolean {
  return process.platform === 'win32'
}
function nowIso(): string {
  return new Date().toISOString()
}
function storeDir(): string {
  return join(app.getPath('userData'), 'sj-os-security')
}
function storeFile(): string {
  return join(storeDir(), 'learning.json')
}

function loadStore(): void {
  try {
    if (existsSync(storeFile())) {
      const raw = JSON.parse(readFileSync(storeFile(), 'utf8')) as Partial<PersistedStore>
      store = {
        insurers: Array.isArray(raw.insurers) ? raw.insurers : [],
        elements: Array.isArray(raw.elements) ? raw.elements : [],
        recentSessions: Array.isArray(raw.recentSessions) ? raw.recentSessions : [],
        autoWatchEnabled: !!raw.autoWatchEnabled
      }
    }
  } catch {
    store = { insurers: [], elements: [], recentSessions: [] }
  }
}
let loaded = false
function ensureLoaded(): void {
  if (!loaded) {
    loadStore()
    loaded = true
    // 설정에 자동 감지가 켜져 있으면 앱 시작 시 자동으로 감시를 재개한다.
    if (store.autoWatchEnabled && isWindows()) startAutoWatch()
  }
}
function saveStore(): void {
  try {
    if (!existsSync(storeDir())) mkdirSync(storeDir(), { recursive: true })
    writeFileSync(storeFile(), JSON.stringify(store, null, 2), 'utf8')
  } catch {
    /* 저장 실패는 학습 진행을 막지 않음 */
  }
}

// ---------------------------------------------------------------------------
// PowerShell 실행(고정 스크립트만)
// ---------------------------------------------------------------------------

/** 스크립트를 UTF-16LE base64로 인코딩해 -EncodedCommand로 넘긴다(따옴표/인젝션 회피). */
function encodePwsh(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64')
}

function runPowerShell(script: string, env?: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((resolvePs) => {
    let out = ''
    let child
    try {
      child = spawn(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encodePwsh(script)],
        { windowsHide: true, env: { ...process.env, ...(env ?? {}) } }
      )
    } catch {
      resolvePs('')
      return
    }
    child.stdout?.on('data', (d: Buffer) => (out += d.toString()))
    child.on('error', () => resolvePs(''))
    child.on('close', () => resolvePs(out))
  })
}

/** ConvertTo-Json이 단일 원소를 배열이 아닌 객체로 내보내는 문제를 흡수. */
function asArray<T>(v: unknown): T[] {
  if (Array.isArray(v)) return v as T[]
  if (v === null || v === undefined) return []
  return [v as T]
}

const SNAPSHOT_SCRIPT = `
$ErrorActionPreference='SilentlyContinue'
$errs=@()
try { $procs = Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,ExecutablePath,CommandLine } catch { $errs+='process' }
try { $svcs  = Get-CimInstance Win32_Service | Select-Object Name,DisplayName,State,StartMode,PathName } catch { $errs+='service' }
try { $drv   = Get-CimInstance Win32_SystemDriver | ForEach-Object { [pscustomobject]@{ Name=$_.Name; DisplayName=$_.DisplayName; State=[string]$_.State; Started=[bool]$_.Started; PathName=$_.PathName } } } catch { $errs+='driver' }
try { $tasks = Get-ScheduledTask | ForEach-Object { [pscustomobject]@{ TaskName=$_.TaskName; TaskPath=$_.TaskPath; State=[string]$_.State } } } catch { $errs+='task' }
try { $start = Get-CimInstance Win32_StartupCommand | Select-Object Name,Command,Location } catch { $errs+='startup' }
try { $net   = Get-NetTCPConnection -State Established | Select-Object OwningProcess,RemoteAddress,RemotePort,State } catch { $errs+='network' }
$payload = [pscustomobject]@{
  processes = @($procs)
  services  = @($svcs)
  drivers   = @($drv)
  tasks     = @($tasks)
  startup   = @($start)
  network   = @($net)
  errors    = @($errs)
}
$payload | ConvertTo-Json -Depth 4 -Compress
`

interface RawSnapshot {
  processes?: unknown
  services?: unknown
  drivers?: unknown
  tasks?: unknown
  startup?: unknown
  network?: unknown
  errors?: unknown
}

function toProcessEntry(r: {
  ProcessId?: number
  ParentProcessId?: number
  Name?: string
  ExecutablePath?: string | null
  CommandLine?: string | null
}): ProcessEntry {
  return {
    pid: Number(r.ProcessId ?? 0),
    parentPid: Number(r.ParentProcessId ?? 0),
    name: String(r.Name ?? ''),
    path: r.ExecutablePath ?? null,
    commandLine: redact(r.CommandLine ?? null)
  }
}

/** 고정 스크립트로 시스템 스냅샷을 수집한다(경량: 해시·서명 없음). */
export async function collectSnapshot(
  phase: SnapshotPhase,
  insurerId: string | null
): Promise<SystemSnapshot> {
  const id = randomUUID()
  const base: SystemSnapshot = {
    id,
    takenAt: nowIso(),
    phase,
    insurerId,
    processes: [],
    services: [],
    drivers: [],
    scheduledTasks: [],
    startupItems: [],
    network: [],
    collectorErrors: []
  }
  if (!isWindows()) {
    base.collectorErrors.push('unsupported-platform')
    snapshots.set(id, base)
    return base
  }

  const raw = await runPowerShell(SNAPSHOT_SCRIPT)
  if (!raw.trim()) {
    base.collectorErrors.push('collector-empty')
    snapshots.set(id, base)
    return base
  }
  let parsed: RawSnapshot
  try {
    parsed = JSON.parse(raw) as RawSnapshot
  } catch {
    base.collectorErrors.push('collector-parse-failed')
    snapshots.set(id, base)
    return base
  }

  base.processes = asArray<Parameters<typeof toProcessEntry>[0]>(parsed.processes).map(toProcessEntry)
  base.services = asArray<{
    Name?: string
    DisplayName?: string | null
    State?: string
    StartMode?: string
    PathName?: string | null
  }>(parsed.services).map((s) => ({
    serviceName: String(s.Name ?? ''),
    displayName: s.DisplayName ?? null,
    state: String(s.State ?? ''),
    startMode: String(s.StartMode ?? ''),
    path: redact(s.PathName ?? null)
  }))
  base.drivers = asArray<{
    Name?: string
    DisplayName?: string | null
    State?: string
    Started?: boolean
    PathName?: string | null
  }>(parsed.drivers).map((d) => ({
    driverName: String(d.Name ?? ''),
    displayName: d.DisplayName ?? null,
    state: String(d.State ?? ''),
    started: Boolean(d.Started),
    path: d.PathName ?? null
  }))
  base.scheduledTasks = asArray<{ TaskName?: string; TaskPath?: string; State?: string }>(
    parsed.tasks
  ).map((t) => ({
    taskName: String(t.TaskName ?? ''),
    taskPath: String(t.TaskPath ?? ''),
    state: String(t.State ?? '')
  }))
  base.startupItems = asArray<{ Name?: string | null; Command?: string; Location?: string }>(
    parsed.startup
  ).map((s) => ({
    name: s.Name ?? null,
    command: redact(String(s.Command ?? '')) ?? '',
    location: String(s.Location ?? '')
  }))
  base.network = asArray<{
    OwningProcess?: number
    RemoteAddress?: string
    RemotePort?: number
    State?: string
  }>(parsed.network).map((n) => ({
    ownerPid: Number(n.OwningProcess ?? 0),
    ownerPath: null,
    remoteAddress: String(n.RemoteAddress ?? ''),
    remotePort: Number(n.RemotePort ?? 0),
    state: String(n.State ?? '')
  }))
  base.collectorErrors = asArray<string>(parsed.errors).map(String)

  snapshots.set(id, base)
  return base
}

// ---------------------------------------------------------------------------
// 변경분 enrich(해시·서명·게시자) — diff로 걸러진 실행파일에만
// ---------------------------------------------------------------------------

const ENRICH_SCRIPT = `
$ErrorActionPreference='SilentlyContinue'
$list = @()
try { $list = Get-Content -Raw -LiteralPath $env:SJ_ENRICH_FILE | ConvertFrom-Json } catch {}
$out=@()
foreach($p in $list){
  if([string]::IsNullOrWhiteSpace($p)){ continue }
  $h=$null; $valid=$null; $pub=$null
  try { if(Test-Path -LiteralPath $p){ $h=(Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash } } catch {}
  try { $s=Get-AuthenticodeSignature -LiteralPath $p; $valid=($s.Status -eq 'Valid'); if($s.SignerCertificate){ $pub=$s.SignerCertificate.Subject } } catch {}
  $out += [pscustomobject]@{ path=$p; sha256=$h; signatureValid=$valid; publisher=$pub }
}
@($out) | ConvertTo-Json -Depth 3 -Compress
`

interface EnrichResult {
  path: string
  sha256: string | null
  signatureValid: boolean | null
  publisher: string | null
}

/** 인증서 Subject("CN=AhnLab, Inc., O=...")에서 CN만 뽑아 게시자로. */
function cnOf(subject: string | null): string | null {
  if (!subject) return null
  const m = subject.match(/CN=([^,]+)/i)
  return (m ? m[1] : subject).trim() || null
}

async function enrichPaths(paths: string[]): Promise<Map<string, EnrichResult>> {
  const result = new Map<string, EnrichResult>()
  const unique = [...new Set(paths.filter((p) => !!p))]
  if (!isWindows() || unique.length === 0) return result
  const file = join(tmpdir(), `sj-enrich-${randomUUID()}.json`)
  try {
    writeFileSync(file, JSON.stringify(unique), 'utf8')
    const raw = await runPowerShell(ENRICH_SCRIPT, { SJ_ENRICH_FILE: file })
    if (raw.trim()) {
      const parsed = asArray<{
        path?: string
        sha256?: string | null
        signatureValid?: boolean | null
        publisher?: string | null
      }>(JSON.parse(raw))
      for (const r of parsed) {
        if (!r.path) continue
        result.set(r.path, {
          path: r.path,
          sha256: r.sha256 ?? null,
          signatureValid: r.signatureValid ?? null,
          publisher: cnOf(r.publisher ?? null)
        })
      }
    }
  } catch {
    /* enrich 실패는 학습을 막지 않음(메타 없이 진행) */
  }
  return result
}

// ---------------------------------------------------------------------------
// 보험사 / 세션
// ---------------------------------------------------------------------------

function findInsurer(id: string): InsurerProfile | undefined {
  return store.insurers.find((i) => i.id === id)
}
function upsertInsurer(id: string, name?: string): InsurerProfile {
  let insurer = findInsurer(id)
  if (!insurer) {
    insurer = { id, name: name ?? id, launchHints: [], totalSessions: 0, lastSessionAt: null }
    store.insurers.push(insurer)
  } else if (name && insurer.name === insurer.id) {
    insurer.name = name
  }
  return insurer
}

function buildState(): EngineState {
  ensureLoaded()
  return {
    support: (isWindows() ? 'supported' : 'unsupported') as CollectorSupport,
    controlEnabled: false, // 1차: 관찰 전용
    activeSession,
    recentSessions: store.recentSessions.slice(0, MAX_RECENT_SESSIONS),
    summary: summarize(store.insurers, store.elements),
    autoWatch: {
      enabled: !!store.autoWatchEnabled,
      supported: isWindows(),
      activeInsurerId: activeAuto?.insurerId ?? null,
      activeInsurerName: activeAuto?.insurerName ?? null,
      lastEventAt: autoLastEvent?.at ?? null,
      lastEventText: autoLastEvent?.text ?? null
    },
    improvements: computeImprovements(store.insurers, store.elements),
    updatedAt: nowIso()
  }
}

function pushState(): EngineState {
  const s = buildState()
  emitState(s)
  return s
}

export function getState(): EngineState {
  return buildState()
}

export function listInsurers(): InsurerProfile[] {
  ensureLoaded()
  return store.insurers
}

export function listLearned(insurerId?: string): LearnedElement[] {
  ensureLoaded()
  const items = insurerId ? store.elements.filter((e) => e.insurerId === insurerId) : store.elements
  return [...items].sort((a, b) => b.confidence - a.confidence)
}

/** baseline 스냅샷을 찍고 보험사 학습 세션을 시작한다. */
export async function beginSession(insurerId: string, insurerName?: string): Promise<EngineState> {
  ensureLoaded()
  const insurer = upsertInsurer(insurerId, insurerName)
  insurer.totalSessions += 1
  insurer.lastSessionAt = nowIso()

  const baseline = await collectSnapshot('baseline', insurerId)
  const session: LearningSession = {
    id: randomUUID(),
    insurerId,
    status: 'baseline-captured',
    startedAt: nowIso(),
    endedAt: null,
    baselineSnapshotId: baseline.id,
    lastAfterSnapshotId: null,
    appearedCount: 0,
    changedCount: 0
  }
  activeSession = session
  countedThisSession.set(session.id, new Set())
  saveStore()
  return pushState()
}

/** 실행 후 스냅샷을 찍고 diff → enrich → 학습 병합을 수행한다. */
export async function captureAfter(): Promise<EngineState> {
  ensureLoaded()
  if (!activeSession) return getState()
  const session = activeSession
  const baseline = session.baselineSnapshotId ? snapshots.get(session.baselineSnapshotId) : undefined
  if (!baseline) return getState()

  const after = await collectSnapshot('after-launch', session.insurerId)
  const diff = diffSnapshots(baseline, after)

  // 변경분 실행파일에만 해시·서명 부여.
  const enrichTargets = [...diff.appeared, ...diff.changed]
    .map((it) => it.detail.path)
    .filter((p): p is string => !!p)
  const enriched = await enrichPaths(enrichTargets)

  mergeDiff(session, diff, enriched)

  session.status = 'observing'
  session.lastAfterSnapshotId = after.id
  session.appearedCount = diff.appeared.length
  session.changedCount = diff.changed.length
  activeSession = session
  saveStore()
  return pushState()
}

/** 종료 스냅샷을 찍어 "종료 후 잔존" 요소를 표시하고 세션을 닫는다(종료 동작 없음). */
export async function endSession(): Promise<EngineState> {
  ensureLoaded()
  if (!activeSession) return getState()
  const session = activeSession
  const baseline = session.baselineSnapshotId ? snapshots.get(session.baselineSnapshotId) : undefined

  if (baseline) {
    const exit = await collectSnapshot('after-exit', session.insurerId)
    const diff = diffSnapshots(baseline, exit)
    // baseline엔 없었는데 종료 후에도 여전히 존재 → 잔존.
    const lingering = new Set(diff.appeared.map((it) => `${it.kind}:${it.identityKey}`))
    for (const el of store.elements) {
      if (el.insurerId !== session.insurerId) continue
      if (lingering.has(`${el.kind}:${el.identityKey}`)) el.lingersAfterExit = true
    }
  }

  session.status = 'closed'
  session.endedAt = nowIso()
  store.recentSessions.unshift(session)
  store.recentSessions = store.recentSessions.slice(0, MAX_RECENT_SESSIONS)

  // baseline/after 스냅샷 메모리 해제.
  if (session.baselineSnapshotId) snapshots.delete(session.baselineSnapshotId)
  if (session.lastAfterSnapshotId) snapshots.delete(session.lastAfterSnapshotId)
  countedThisSession.delete(session.id)
  activeSession = null
  saveStore()
  return pushState()
}

// ---------------------------------------------------------------------------
// 학습 병합
// ---------------------------------------------------------------------------

function elementKey(insurerId: string, kind: string, identityKey: string): string {
  return `${insurerId}::${kind}::${identityKey}`
}

function applyEnrichment(detail: ElementDetail, enriched: Map<string, EnrichResult>): ElementDetail {
  if (!detail.path) return detail
  const e = enriched.get(detail.path)
  if (!e) return detail
  return {
    ...detail,
    sha256: e.sha256 ?? detail.sha256,
    signatureValid: e.signatureValid ?? detail.signatureValid,
    publisher: e.publisher ?? detail.publisher
  }
}

/** 같은 kind+identityKey를 다른 보험사에서도 학습했는지 스캔해 공용 표시를 갱신. */
function crossInsurerShares(insurerId: string, kind: string, identityKey: string): string[] {
  const others = new Set<string>()
  for (const el of store.elements) {
    if (el.kind === kind && el.identityKey === identityKey && el.insurerId !== insurerId) {
      others.add(el.insurerId)
    }
  }
  return [...others]
}

function mergeDiff(
  session: LearningSession,
  diff: { appeared: DiffItem[]; changed: DiffItem[] },
  enriched: Map<string, EnrichResult>
): void {
  const insurer = upsertInsurer(session.insurerId)
  const counted = countedThisSession.get(session.id) ?? new Set<string>()
  countedThisSession.set(session.id, counted)

  const items = [...diff.appeared, ...diff.changed]
  for (const item of items) {
    const key = elementKey(session.insurerId, item.kind, item.identityKey)
    const detail = applyEnrichment(item.detail, enriched)
    let el = store.elements.find(
      (e) => e.insurerId === session.insurerId && e.kind === item.kind && e.identityKey === item.identityKey
    )

    if (!el) {
      el = {
        id: randomUUID(),
        insurerId: session.insurerId,
        kind: item.kind,
        identityKey: item.identityKey,
        label: item.label,
        detail,
        observations: 0,
        sessionsSeen: 0,
        totalSessions: insurer.totalSessions,
        firstSeenAt: nowIso(),
        lastSeenAt: nowIso(),
        sharedWithInsurerIds: [],
        signatureValid: detail.signatureValid,
        publisher: detail.publisher,
        sha256: detail.sha256,
        category: 'unknown',
        categoryReasons: [],
        confidence: 0,
        controlEligible: false,
        protectedReasons: []
      }
      store.elements.push(el)
    } else {
      // 보험사 업데이트로 실행파일 해시가 바뀌면 재학습 트리거(§6-10).
      if (detail.sha256 && el.sha256 && detail.sha256 !== el.sha256) {
        el.categoryReasons = [...el.categoryReasons, '실행파일 변경 감지 — 재학습']
        el.controlEligible = false
      }
      el.label = item.label || el.label
      el.detail = { ...el.detail, ...detail }
      if (detail.urlHosts && detail.urlHosts.length) {
        const hosts = new Set([...(el.detail.urlHosts ?? []), ...detail.urlHosts])
        el.detail.urlHosts = [...hosts]
      }
    }

    el.observations += 1
    el.lastSeenAt = nowIso()
    el.totalSessions = insurer.totalSessions
    el.signatureValid = detail.signatureValid ?? el.signatureValid
    el.publisher = detail.publisher ?? el.publisher
    el.sha256 = detail.sha256 ?? el.sha256

    if (!counted.has(key)) {
      el.sessionsSeen += 1
      counted.add(key)
    }
    el.sharedWithInsurerIds = crossInsurerShares(session.insurerId, item.kind, item.identityKey)

    // 브라우저 실행 URL 호스트(개인 경로/쿼리 제외).
    if (item.kind === 'process' && detail.commandLine) {
      const hosts = new Set([...(el.detail.urlHosts ?? []), ...extractUrlHosts(detail.commandLine)])
      if (hosts.size) el.detail.urlHosts = [...hosts]
    }

    // 실행파일 힌트 축적.
    if (item.kind === 'process' && detail.path && !insurer.launchHints.includes(detail.path)) {
      insurer.launchHints = [...insurer.launchHints, detail.path].slice(-20)
    }

    // 분류·신뢰점수·승격 재계산.
    const recomputed = recomputeElement(el)
    Object.assign(el, recomputed)
  }
}

// ---------------------------------------------------------------------------
// 의존성 그래프
// ---------------------------------------------------------------------------

/** 보험사별 학습 요소 + parent-child 엣지(마지막 스냅샷 기준, 메모리에 있을 때). */
export function getDependencyGraph(insurerId: string): DependencyGraph {
  ensureLoaded()
  const nodes = store.elements.filter((e) => e.insurerId === insurerId)
  const edges: DependencyEdge[] = []

  // parent-child: 활성 세션의 마지막 after 스냅샷이 메모리에 있으면 경로 기반으로 추정.
  const snapId = activeSession?.insurerId === insurerId ? activeSession?.lastAfterSnapshotId : null
  const snap = snapId ? snapshots.get(snapId) : undefined
  if (snap) {
    const pidToPath = new Map<number, string>()
    for (const p of snap.processes) if (p.path) pidToPath.set(p.pid, p.path.toLowerCase())
    const nodeKeys = new Set(nodes.filter((n) => n.kind === 'process').map((n) => n.identityKey))
    for (const p of snap.processes) {
      const childPath = p.path?.toLowerCase()
      const parentPath = pidToPath.get(p.parentPid)
      if (childPath && parentPath && childPath !== parentPath) {
        if (nodeKeys.has(childPath) && nodeKeys.has(parentPath)) {
          edges.push({ fromKey: parentPath, toKey: childPath, relation: 'parent-child' })
        }
      }
    }
  }

  return { insurerId, nodes, edges }
}

// ---------------------------------------------------------------------------
// 완전 자동 감지 (백그라운드) — 사용자 조작 없이 전산 실행을 감지·학습·재보완
// ---------------------------------------------------------------------------
//
// 동작: 가벼운 프로세스 목록을 주기적으로 폴링해서 (1) 유휴 상태의 기준 스냅샷을
// 유지하고, (2) 눈에 띄는 사용자 앱(=보험사 전산 후보)이 새로 뜨면 자동으로 학습
// 세션을 시작한다. 같은 세션에서 몇 회 더 캡처해 늦게 뜨는 보안 모듈까지 보완하고,
// 그 전산이 종료되면 잔존 요소를 표시한 뒤 세션을 닫는다. 여전히 관찰 전용 —
// 어떤 프로세스도 종료하지 않는다.

const AUTO_INTERVAL_MS = 8000
const AUTO_MAX_CAPTURES = 3 // 실행 직후 + 늦게 뜨는 모듈까지 "한 번 더 보완"
const AUTO_RECAPTURE_GAP_MS = 20000
const IDLE_BASELINE_REFRESH_POLLS = 8

interface ActiveAuto {
  insurerId: string
  insurerName: string
  session: LearningSession
  launchKey: string
  captureCount: number
  lastCaptureAt: number
}

let autoWatchTimer: ReturnType<typeof setInterval> | null = null
let rollingBaseline: SystemSnapshot | null = null
let lastProcKeys = new Set<string>()
let idlePolls = 0
let activeAuto: ActiveAuto | null = null
let autoLastEvent: { at: string; text: string } | null = null

function autoEvent(text: string): void {
  autoLastEvent = { at: nowIso(), text }
}

const FAST_PROC_SCRIPT = `
$ErrorActionPreference='SilentlyContinue'
Get-Process | Select-Object Id,ProcessName,Path | ConvertTo-Json -Compress
`

/** 경량 프로세스 목록(경로 기준 식별자 → 이름·경로). 폴링 전용. */
async function collectProcMap(): Promise<Map<string, { name: string; path: string | null }>> {
  const map = new Map<string, { name: string; path: string | null }>()
  if (!isWindows()) return map
  const raw = await runPowerShell(FAST_PROC_SCRIPT)
  if (!raw.trim()) return map
  try {
    const arr = asArray<{ Id?: number; ProcessName?: string; Path?: string | null }>(JSON.parse(raw))
    for (const p of arr) {
      const path = p.Path ?? null
      const name = String(p.ProcessName ?? '')
      const key = norm(path) || norm(name)
      if (key) map.set(key, { name, path })
    }
  } catch {
    /* 파싱 실패는 무시 */
  }
  return map
}

function matchesHints(value: string, hints: readonly string[]): boolean {
  const v = norm(value)
  return hints.some((h) => v.includes(h))
}

/** 학습 세션을 시작할 만한 "눈에 띄는 사용자 앱"인가(=보험사 전산 후보). */
function isLaunchCandidate(name: string, path: string | null): boolean {
  if (!path) return false
  const p = norm(path)
  if (p.startsWith('c:\\windows')) return false // 시스템
  const bn = baseName(path)
  if (WINDOWS_CORE_PROCESSES.includes(bn) || NOISY_HOST_PROCESSES.includes(bn)) return false
  // 우리 앱/런타임 제외
  if (p.includes('sj invest') || p.includes('sj-os') || p.includes('sjinvest') || bn === 'electron') return false
  // 브라우저·오피스·백신은 "트리거"에서 제외(전산 실행 시 diff엔 여전히 잡힘)
  if (matchesHints(`${name} ${path}`, BUSINESS_COMMON_HINTS)) return false
  if (matchesHints(`${name} ${path}`, SECURITY_VENDOR_HINTS)) return false
  return true
}

/** 감지된 전산에 대해 자동 학습 세션을 시작한다. */
async function autoStartSession(launchKey: string, name: string, path: string | null): Promise<void> {
  const insurerId = `auto:${baseName(path ?? name) || launchKey}`
  const insurerName = name || baseName(path ?? '') || insurerId
  const insurer = upsertInsurer(insurerId, insurerName)
  insurer.totalSessions += 1
  insurer.lastSessionAt = nowIso()
  const session: LearningSession = {
    id: randomUUID(),
    insurerId,
    status: 'observing',
    startedAt: nowIso(),
    endedAt: null,
    baselineSnapshotId: rollingBaseline?.id ?? null,
    lastAfterSnapshotId: null,
    appearedCount: 0,
    changedCount: 0
  }
  countedThisSession.set(session.id, new Set())
  activeAuto = { insurerId, insurerName, session, launchKey, captureCount: 0, lastCaptureAt: 0 }
  autoEvent(`${insurerName} 전산 자동 감지 — 학습 시작`)
  await autoLearnCapture(activeAuto)
}

/** 현재 상태를 기준 스냅샷과 비교해 학습에 병합한다("한 번 더 보완"에도 재사용). */
async function autoLearnCapture(a: ActiveAuto): Promise<void> {
  if (!rollingBaseline) return
  const after = await collectSnapshot('after-launch', a.insurerId)
  const diff = diffSnapshots(rollingBaseline, after)
  const enrichTargets = [...diff.appeared, ...diff.changed]
    .map((it) => it.detail.path)
    .filter((p): p is string => !!p)
  const enriched = await enrichPaths(enrichTargets)
  mergeDiff(a.session, diff, enriched)
  a.session.lastAfterSnapshotId = after.id
  a.session.appearedCount = diff.appeared.length
  a.session.changedCount = diff.changed.length
  a.captureCount += 1
  a.lastCaptureAt = Date.now()
  snapshots.delete(after.id)
  autoEvent(`${a.insurerName} 자동 학습 ${a.captureCount}회차 — 신규 ${diff.appeared.length}건`)
  saveStore()
  pushState()
}

/** 감지된 전산이 종료되면 잔존 요소를 표시하고 세션을 닫는다(종료 동작 없음). */
async function autoCloseSession(a: ActiveAuto): Promise<void> {
  if (rollingBaseline) {
    const exit = await collectSnapshot('after-exit', a.insurerId)
    const diff = diffSnapshots(rollingBaseline, exit)
    const lingering = new Set(diff.appeared.map((it) => `${it.kind}:${it.identityKey}`))
    for (const el of store.elements) {
      if (el.insurerId === a.insurerId && lingering.has(`${el.kind}:${el.identityKey}`)) {
        el.lingersAfterExit = true
      }
    }
    snapshots.delete(exit.id)
  }
  a.session.status = 'closed'
  a.session.endedAt = nowIso()
  store.recentSessions.unshift(a.session)
  store.recentSessions = store.recentSessions.slice(0, MAX_RECENT_SESSIONS)
  countedThisSession.delete(a.session.id)
  autoEvent(`${a.insurerName} 전산 종료 감지 — 세션 마감`)
  // 다음 감지를 위해 기준 스냅샷을 다시 잡도록 초기화.
  rollingBaseline = null
  idlePolls = 0
  saveStore()
  pushState()
}

/** 주기 폴링 1회: 감지/학습/종료를 자동 진행. */
async function autoTick(): Promise<void> {
  if (!isWindows()) return
  const procs = await collectProcMap()
  const currentKeys = new Set(procs.keys())

  if (activeAuto) {
    if (currentKeys.has(activeAuto.launchKey)) {
      if (
        activeAuto.captureCount < AUTO_MAX_CAPTURES &&
        Date.now() - activeAuto.lastCaptureAt >= AUTO_RECAPTURE_GAP_MS
      ) {
        await autoLearnCapture(activeAuto)
      }
    } else {
      const closing = activeAuto
      activeAuto = null
      await autoCloseSession(closing)
    }
    lastProcKeys = currentKeys
    return
  }

  // 유휴: 기준 스냅샷 유지 + 신규 전산 감시.
  if (!rollingBaseline) {
    rollingBaseline = await collectSnapshot('baseline', null)
    lastProcKeys = currentKeys
    return
  }
  const appeared = [...currentKeys].filter((k) => !lastProcKeys.has(k))
  const launch = appeared
    .map((k) => ({ k, info: procs.get(k)! }))
    .find((x) => isLaunchCandidate(x.info.name, x.info.path))
  if (launch) {
    await autoStartSession(launch.k, launch.info.name, launch.info.path)
  } else {
    idlePolls += 1
    if (idlePolls >= IDLE_BASELINE_REFRESH_POLLS) {
      rollingBaseline = await collectSnapshot('baseline', null)
      idlePolls = 0
    }
  }
  lastProcKeys = currentKeys
}

function startAutoWatch(): void {
  if (autoWatchTimer || !isWindows()) return
  autoWatchTimer = setInterval(() => {
    void autoTick().catch(() => {})
  }, AUTO_INTERVAL_MS)
}
function stopAutoWatch(): void {
  if (autoWatchTimer) {
    clearInterval(autoWatchTimer)
    autoWatchTimer = null
  }
  activeAuto = null
  rollingBaseline = null
  lastProcKeys = new Set()
  idlePolls = 0
}

/** 완전 자동 감지를 켜고/끈다(설정 영속). 켜면 앱 재시작 후에도 유지된다. */
export function setAutoWatch(enabled: boolean): EngineState {
  ensureLoaded()
  store.autoWatchEnabled = enabled
  saveStore()
  if (enabled) {
    autoEvent('자동 감지 켜짐 — 전산 실행을 자동으로 학습합니다')
    startAutoWatch()
  } else {
    stopAutoWatch()
    autoEvent('자동 감지 꺼짐')
  }
  return pushState()
}

// ---------------------------------------------------------------------------
// 제어 / 롤백 (1차 비활성 스텁 — §5/§6/§7 설계만)
// ---------------------------------------------------------------------------

/**
 * 자동 모드 전환(실행/정리 종료)은 1차에서 비활성이다. 신뢰점수가 충분히 축적되고
 * 안전기준(§6)을 통과한 요소에 한해 후속 단계에서 승인 게이트와 함께 활성화한다.
 * 지금은 어떤 프로세스도 종료하지 않으며, 호출 시 `disabled` 계획만 반환한다.
 */
export function planModeSwitch(insurerId: string): ChangePlan {
  return {
    id: randomUUID(),
    insurerId,
    createdAt: nowIso(),
    preChangeSnapshotId: null,
    actions: [],
    attempts: 0,
    status: 'disabled'
  }
}
