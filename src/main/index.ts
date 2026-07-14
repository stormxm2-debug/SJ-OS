import { app, BrowserWindow, dialog, ipcMain, session, shell } from 'electron'
import { join } from 'node:path'
import { autoUpdater } from 'electron-updater'
import { runCoding } from './coding/engine'
import { CompanyStartupService } from './companyStartupService'
import { openApprovedExternal } from './externalLinks'
import { getAiProxyStatus } from './aiProxyStatus'
import { exportClaudePrompt } from './claudeExport'
import { openPromptsFolder, runApprovedJob } from './claudeRunner'
import {
  approveRepairJob,
  cancelAutoBuildJob,
  cancelQueuedJob,
  checkRunnerEnvironment,
  commitApprovedJob,
  createAutoBuildJob,
  generateCompletionReport,
  getAutoBuildJob,
  loadJobCommitState,
  pushApprovedCommit,
  getQueueState,
  listAutoBuildJobs,
  pauseQueue,
  resumeQueue,
  runAutoBuildJob,
  runNextQueued,
  setAutoBuildEmitter,
  setQueueAutoRun,
  setQueueStateEmitter,
  smokeTestRunner,
  runSafeCheck
} from './claudeAutoBuild'
import {
  commitWorktreeJob,
  getParallelJob,
  listParallelJobs,
  loadWorktreeReview,
  markReviewDecision,
  mergeApprovedWorktree,
  prepareWorktree,
  runWorktreeJob,
  setParallelEmitter
} from './claudeParallel'
import type { ReviewDecision } from '@shared/claudeParallel'
import {
  applyDeployScript,
  cancelDeployment,
  deployScriptExists,
  getDeploymentRun,
  inspectPackageScripts,
  runApprovedDeployment,
  runDeployPreflight,
  setDeploymentEmitter
} from './deploymentRunner'
import {
  createApprovedTag,
  inspectTagReadiness,
  pushApprovedTag
} from './releaseSnapshot'
import type { SnapshotMeta } from '@shared/releaseSnapshot'
import { inspectPackageOutputs, registerPackage } from './distributionPackage'
import {
  applyApprovedPackagingConfig,
  cancelPackageBuild,
  getPackageRun,
  inspectPackageReadiness,
  inspectPackagingConfig,
  runApprovedPackageBuild,
  runPackagePreflight,
  setPackageEmitter
} from './electronPackage'
import {
  configureAiGatewayRoots,
  getAiGatewayStatus,
  transcribeAudio
} from './services/ai-gateway'
import {
  beginSession as secLearnBeginSession,
  captureAfter as secLearnCaptureAfter,
  endSession as secLearnEndSession,
  getDependencyGraph as secLearnGetGraph,
  getState as secLearnGetState,
  listInsurers as secLearnListInsurers,
  listLearned as secLearnListLearned,
  setAutoWatch as secLearnSetAutoWatch,
  setSecurityLearningEmitter
} from './securityLearning'
import type { CodingExecRequest } from '@shared/providers'
import type { AiTranscribeRequest } from '@shared/aiGateway'
import type { ClaudeExportRequest, ClaudeRunRequest } from '@shared/claudeCode'
import type { CreateAutoBuildJobRequest, SafeCheckKind } from '@shared/claudeAutoBuild'

/**
 * SJ AI Company — Electron main process (Node backend).
 *
 * Hosts the real coding engine: the renderer's Developer worker delegates
 * execution here over IPC, and this process performs real file generation and
 * streams progress back. All other logic (Kernel, Chief of Staff) still runs in
 * the renderer for now.
 */

/**
 * GPU / disk-cache stabilization.
 *
 * On this machine Chromium repeatedly fails on its disk cache
 * ("Unable to move the cache: Access denied (0x5)" / "Gpu Cache Creation
 * failed"), and its compositor can then intermittently stop delivering mouse
 * input to the whole window — the app renders but nothing is clickable.
 *
 *  - disableHardwareAcceleration(): force software compositing (no GPU input lock).
 *  - disk-cache-dir → a fresh, writable temp folder so the "Access denied" cache
 *    migration error stops. This is the DISPOSABLE HTTP/code cache only — it is
 *    NOT userData, so no business data (localStorage) is touched or lost.
 *  - disable the GPU shader/program disk caches, which were the failing writes.
 * All must be set before the app is ready.
 */
app.disableHardwareAcceleration()
try {
  app.commandLine.appendSwitch('disk-cache-dir', join(app.getPath('temp'), 'sj-os-cache'))
} catch {
  /* getPath('temp') unavailable this early on some platforms — safe to skip */
}
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache')
app.commandLine.appendSwitch('disable-gpu-program-cache')

const startupService = new CompanyStartupService()

/**
 * 자동 업데이트 (GitHub Releases: stormxm2-debug/SJ-OS — public이라 다운로드에 토큰
 * 불필요). 배포는 `3-앱-업데이트-배포.bat`(electron-builder --publish)가 수행하고,
 * 설치된 앱은 시작 시 + 4시간마다 새 버전을 확인해 내려받은 뒤 재시작을 제안한다.
 * "나중에"를 고르면 앱을 완전히 종료할 때 자동 적용된다. 개발 모드에서는 no-op.
 */
function setupAutoUpdate(): void {
  if (!app.isPackaged) return
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on('update-downloaded', (info) => {
    void dialog
      .showMessageBox({
        type: 'info',
        buttons: ['지금 재시작', '나중에'],
        defaultId: 0,
        cancelId: 1,
        message: `SJ INVEST 새 버전(v${info.version})이 준비되었습니다.`,
        detail: '지금 재시작하면 바로 적용됩니다. "나중에"를 누르면 앱을 완전히 종료할 때 자동으로 적용됩니다.'
      })
      .then(({ response }) => {
        if (response === 0) autoUpdater.quitAndInstall()
      })
  })
  // 실패(오프라인, 첫 릴리즈 전 등)는 조용히 무시 — 앱 사용에 지장 없음.
  autoUpdater.checkForUpdates().catch(() => {})
  setInterval(() => {
    autoUpdater.checkForUpdates().catch(() => {})
  }, 4 * 60 * 60 * 1000)
}

/**
 * Origins allowed to request the microphone for Jarvis Voice Mode.
 *  - The packaged app loads the renderer from a local file:// origin.
 *  - `npm run dev` serves the renderer from a localhost dev port.
 * Only these local origins may use the mic; nothing else is trusted.
 */
const MIC_ALLOWED_HTTP_ORIGINS = new Set([
  'http://localhost:5173',
  'http://localhost:5174'
])

/** A request/origin is trusted for the mic if it is our own file:// app or a local dev origin. */
function isMicOriginAllowed(originOrUrl: string): boolean {
  if (!originOrUrl || originOrUrl.startsWith('file://')) return true
  try {
    return MIC_ALLOWED_HTTP_ORIGINS.has(new URL(originOrUrl).origin)
  } catch {
    return false
  }
}

/**
 * Restrict Electron permission grants to our OWN local origins only, and deny
 * everything else. Voice Mode needs the microphone; the 출퇴근 photo report needs
 * the camera; the photo watermark needs geolocation. Camera + mic (media) and
 * geolocation are granted ONLY for file:// (our app) and the local dev origins —
 * no third-party origin can ever request them. All other permissions are denied.
 */
function installPermissionHandlers(): void {
  const ses = session.defaultSession

  ses.setPermissionRequestHandler((_webContents, permission, callback, details) => {
    const requestingUrl = 'requestingUrl' in details ? details.requestingUrl : ''
    const trusted = isMicOriginAllowed(requestingUrl ?? '')
    // 'media' = mic and/or camera (Voice Mode + 출퇴근 사진); 'geolocation' = 사진
    // 워터마크. Both only for trusted local origins.
    if (permission === 'media' || permission === 'geolocation') {
      callback(trusted)
      return
    }
    // Default-deny all other permissions.
    callback(false)
  })

  ses.setPermissionCheckHandler((_webContents, permission, requestingOrigin) => {
    if (permission === 'media' || permission === 'geolocation') {
      return isMicOriginAllowed(requestingOrigin ?? '')
    }
    return false
  })
}

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 832,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    backgroundColor: '#020617',
    title: 'SJ AI Company',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.on('did-finish-load', () => {
    startupService.notifyRendererReady()
  })

  // Open external links in the system browser, never in-app.
  mainWindow.webContents.setWindowOpenHandler((details) => {
    void shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  // Restrict permissions (mic-only, local origins) before any window loads.
  installPermissionHandlers()

  // 자동 업데이트 감시 시작 (패키지된 앱에서만 동작).
  setupAutoUpdate()

  // Static app metadata.
  ipcMain.handle('app:getInfo', () => ({
    name: app.getName(),
    version: app.getVersion()
  }))

  // Real coding execution: run the engine and stream progress back to the
  // requesting renderer over the 'coding:event' channel.
  ipcMain.handle('coding:execute', (event, request: CodingExecRequest) =>
    runCoding(request, (ev) => event.sender.send('coding:event', ev))
  )

  ipcMain.handle('company:start', () => startupService.start())

  // Safe external-link opener: the renderer sends an approved key only; the
  // whitelist in externalLinks.ts maps it to a vetted URL. No raw URL, shell
  // execution, or filesystem access is exposed.
  ipcMain.handle('external:open', (_event, key: unknown) => openApprovedExternal(key))

  // AI proxy readiness: probe ONLY the local sj-ai-proxy status endpoint from
  // the main process (no CORS/origin issues, no API key ever read or returned).
  // Legacy/optional deployment path — Jarvis desktop mode no longer depends on it.
  ipcMain.handle('ai-proxy:status', () => getAiProxyStatus())

  // Electron Main AI Gateway (Jarvis desktop mode): the main process IS the local
  // AI gateway. The OpenAI key lives here only (SJ OS root .env / process.env),
  // is never returned or logged, and the renderer only ever gets sanitized status
  // and transcript text. No separate proxy server, no localhost:8787, no CORS.
  configureAiGatewayRoots([app.getAppPath()])
  ipcMain.handle('sj-ai:status', () => getAiGatewayStatus())
  ipcMain.handle('sj-ai:transcribe', (_event, request: AiTranscribeRequest) =>
    transcribeAudio(request)
  )

  // Claude Code Bridge: safe .md prompt export (no shell execution).
  ipcMain.handle('sj-claude:export-prompt', (_event, request: ClaudeExportRequest) =>
    exportClaudePrompt(request)
  )
  // Claude Code Runner: approval-gated + validated. Currently refuses to execute
  // (returns disabled) — no shell command is run.
  ipcMain.handle('sj-claude:run-approved', (_event, request: ClaudeRunRequest) =>
    runApprovedJob(request)
  )
  ipcMain.handle('sj-claude:open-prompts-folder', () => openPromptsFolder())

  // Jarvis → Claude Code Auto Builder. Main-only execution; the renderer only
  // sends a validated prompt + job id, never a shell command. Job updates are
  // broadcast to all windows.
  setAutoBuildEmitter((job) => {
    BrowserWindow.getAllWindows().forEach((w) => w.webContents.send('sj-claude-build:job-update', { job }))
  })
  setQueueStateEmitter((state) => {
    BrowserWindow.getAllWindows().forEach((w) => w.webContents.send('sj-claude-build:queue-state', state))
  })
  ipcMain.handle('sj-claude-build:create', (_e, request: CreateAutoBuildJobRequest) =>
    createAutoBuildJob(request)
  )
  ipcMain.handle('sj-claude-build:run', (_e, id: string) => runAutoBuildJob(id))
  ipcMain.handle('sj-claude-build:cancel', (_e, id: string) => cancelAutoBuildJob(id))
  ipcMain.handle('sj-claude-build:get', (_e, id: string) => getAutoBuildJob(id))
  ipcMain.handle('sj-claude-build:list', () => listAutoBuildJobs())
  // Runner environment diagnostics (fixed checks only; no renderer commands).
  ipcMain.handle('sj-claude-build:check-env', () => checkRunnerEnvironment())
  ipcMain.handle('sj-claude-build:smoke-test', () => smokeTestRunner())
  // Fixed, enum-gated safe checks (no arbitrary command from renderer).
  ipcMain.handle('sj-claude-build:safe-check', (_e, kind: SafeCheckKind) => {
    const allowed: SafeCheckKind[] = ['git-status', 'git-log', 'typecheck', 'build', 'build-web', 'claude-version']
    if (!allowed.includes(kind)) return { kind, label: '', command: '', cwd: '', available: false, ok: false, exitCode: -1, durationMs: 0, stdoutTail: '', stderrTail: '', message: '허용되지 않은 점검입니다.' }
    return runSafeCheck(kind)
  })
  // Queue controls (single-writer serialization is enforced in main).
  ipcMain.handle('sj-claude-build:queue-state', () => getQueueState())
  ipcMain.handle('sj-claude-build:queue-auto-run', (_e, on: boolean) => setQueueAutoRun(on))
  ipcMain.handle('sj-claude-build:queue-pause', () => pauseQueue())
  ipcMain.handle('sj-claude-build:queue-resume', () => resumeQueue())
  ipcMain.handle('sj-claude-build:queue-next', () => runNextQueued())
  ipcMain.handle('sj-claude-build:queue-cancel', (_e, id: string) => cancelQueuedJob(id))
  // Auto-repair: approve a generated repair job so it can be run.
  ipcMain.handle('sj-claude-build:approve-repair', (_e, id: string) => approveRepairJob(id))
  // Approved commit / push (main workspace; explicit; no force, no `git add .`).
  ipcMain.handle('sj-claude-build:commit-state', (_e, id: string) => loadJobCommitState(id))
  ipcMain.handle('sj-claude-build:commit', (_e, id: string) => commitApprovedJob(id))
  ipcMain.handle('sj-claude-build:push', (_e, id: string) => pushApprovedCommit(id))
  // Completion report (read-only inspection; no deployment).
  ipcMain.handle('sj-claude-build:completion-report', (_e, id: string) => generateCompletionReport(id))

  // Parallel worktree builder (foundation). Main-only git/Claude execution; the
  // renderer sends only a source job id. No auto-merge / auto-delete.
  setParallelEmitter((job) => {
    BrowserWindow.getAllWindows().forEach((w) => w.webContents.send('sj-claude-parallel:job-update', { job }))
  })
  ipcMain.handle('sj-claude-parallel:prepare', (_e, sourceJobId: string) => prepareWorktree(sourceJobId))
  ipcMain.handle('sj-claude-parallel:run', (_e, sourceJobId: string) => runWorktreeJob(sourceJobId))
  ipcMain.handle('sj-claude-parallel:get', (_e, sourceJobId: string) => getParallelJob(sourceJobId))
  ipcMain.handle('sj-claude-parallel:list', () => listParallelJobs())

  // Approved deployment runner (main-only; fixed `npm run deploy`; no auto-deploy).
  setDeploymentEmitter((run) => {
    BrowserWindow.getAllWindows().forEach((w) => w.webContents.send('sj-deploy:run-update', { run }))
  })
  ipcMain.handle('sj-deploy:script-exists', () => deployScriptExists())
  ipcMain.handle('sj-deploy:preflight', (_e, releaseItemId: string) => runDeployPreflight(releaseItemId))
  ipcMain.handle('sj-deploy:run', (_e, releaseItemId: string) => runApprovedDeployment(releaseItemId))
  ipcMain.handle('sj-deploy:cancel', (_e, releaseItemId: string) => cancelDeployment(releaseItemId))
  ipcMain.handle('sj-deploy:get', (_e, releaseItemId: string) => getDeploymentRun(releaseItemId))
  // Deployment profile / deploy-script manager (read + validated approved write).
  ipcMain.handle('sj-deploy:inspect-scripts', () => inspectPackageScripts())
  ipcMain.handle('sj-deploy:apply-script', (_e, script: string) => applyDeployScript(script))

  // Electron installer package center (existing package scripts only; no publish).
  setPackageEmitter((run) => {
    BrowserWindow.getAllWindows().forEach((w) => w.webContents.send('sj-package:run-update', { run }))
  })
  ipcMain.handle('sj-package:inspect', () => inspectPackageReadiness())
  ipcMain.handle('sj-package:preflight', (_e, id: string) => runPackagePreflight(id))
  ipcMain.handle('sj-package:run', (_e, id: string) => runApprovedPackageBuild(id))
  ipcMain.handle('sj-package:cancel', (_e, id: string) => cancelPackageBuild(id))
  ipcMain.handle('sj-package:get', (_e, id: string) => getPackageRun(id))
  // Packaging configuration center (read + approved package.json script/metadata write).
  ipcMain.handle('sj-package-config:inspect', () => inspectPackagingConfig())
  ipcMain.handle('sj-package-config:apply', () => applyApprovedPackagingConfig())

  // Release snapshot / Git tag center (fixed git tag/push only; two-step approval).
  ipcMain.handle('sj-snapshot:inspect', (_e, meta?: SnapshotMeta) => inspectTagReadiness(meta))
  ipcMain.handle('sj-snapshot:create-tag', (_e, snapshotId: string) => createApprovedTag(snapshotId))
  ipcMain.handle('sj-snapshot:push-tag', (_e, snapshotId: string) => pushApprovedTag(snapshotId))

  // Staff distribution package registry (fixed folder inspection + SHA-256; no upload).
  ipcMain.handle('sj-dist:inspect', () => inspectPackageOutputs())
  ipcMain.handle('sj-dist:register', (_e, detectedId: string) => registerPackage(detectedId))
  // Review (read-only git inspection; NO merge).
  ipcMain.handle('sj-claude-parallel:review', (_e, sourceJobId: string) => loadWorktreeReview(sourceJobId))
  ipcMain.handle(
    'sj-claude-parallel:review-decision',
    (_e, args: { sourceJobId: string; decision: ReviewDecision; notes?: string }) =>
      markReviewDecision(args.sourceJobId, args.decision, args.notes)
  )
  // Controlled worktree commit (explicit; safe staging; no push).
  ipcMain.handle('sj-claude-parallel:commit', (_e, sourceJobId: string) => commitWorktreeJob(sourceJobId))
  // Approved merge into main (explicit; validated; no push, no force).
  ipcMain.handle('sj-claude-parallel:merge', (_e, sourceJobId: string) =>
    mergeApprovedWorktree(sourceJobId)
  )

  // 자동 보안 모듈 탐지 및 학습 엔진 (관찰·학습 전용; 종료/제어 채널 없음).
  // 상태 변경은 모든 창에 broadcast. 시스템 접근은 메인의 고정 PowerShell 스크립트뿐.
  setSecurityLearningEmitter((state) => {
    BrowserWindow.getAllWindows().forEach((w) => w.webContents.send('sj-seclearn:state', state))
  })
  ipcMain.handle('sj-seclearn:status', () => secLearnGetState())
  ipcMain.handle('sj-seclearn:list-insurers', () => secLearnListInsurers())
  ipcMain.handle('sj-seclearn:learned', (_e, insurerId?: string) => secLearnListLearned(insurerId))
  ipcMain.handle('sj-seclearn:graph', (_e, insurerId: string) => secLearnGetGraph(insurerId))
  ipcMain.handle('sj-seclearn:begin-session', (_e, args: { insurerId: string; insurerName?: string }) =>
    secLearnBeginSession(args.insurerId, args.insurerName)
  )
  ipcMain.handle('sj-seclearn:capture-after', () => secLearnCaptureAfter())
  ipcMain.handle('sj-seclearn:end-session', () => secLearnEndSession())
  ipcMain.handle('sj-seclearn:set-auto-watch', (_e, enabled: boolean) => secLearnSetAutoWatch(!!enabled))
  // 앱 시작 시 상태를 한 번 읽어, 설정에 저장된 자동 감지를 페이지 열기 전에도 재개시킨다.
  try { secLearnGetState() } catch { /* noop */ }

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
