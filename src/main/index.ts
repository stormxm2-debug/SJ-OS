import { app, BrowserWindow, ipcMain, session, shell } from 'electron'
import { join } from 'node:path'
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
  smokeTestRunner
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
  configureAiGatewayRoots,
  getAiGatewayStatus,
  transcribeAudio
} from './services/ai-gateway'
import type { CodingExecRequest } from '@shared/providers'
import type { AiTranscribeRequest } from '@shared/aiGateway'
import type { ClaudeExportRequest, ClaudeRunRequest } from '@shared/claudeCode'
import type { CreateAutoBuildJobRequest } from '@shared/claudeAutoBuild'

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
 * Restrict Electron permission grants: allow ONLY microphone (audio media) for
 * our own local origins, and deny every other permission (camera, geolocation,
 * notifications, etc.). Voice Mode needs the mic; nothing here needs more.
 */
function installPermissionHandlers(): void {
  const ses = session.defaultSession

  ses.setPermissionRequestHandler((_webContents, permission, callback, details) => {
    if (permission === 'media') {
      // 'media' covers mic and/or camera — allow audio only, never video.
      const mediaTypes = 'mediaTypes' in details ? details.mediaTypes : undefined
      const wantsVideo = Array.isArray(mediaTypes) && mediaTypes.includes('video')
      const requestingUrl = 'requestingUrl' in details ? details.requestingUrl : ''
      callback(!wantsVideo && isMicOriginAllowed(requestingUrl ?? ''))
      return
    }
    // Default-deny all other permissions.
    callback(false)
  })

  ses.setPermissionCheckHandler((_webContents, permission, requestingOrigin) => {
    if (permission === 'media') return isMicOriginAllowed(requestingOrigin ?? '')
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

  // Parallel worktree builder (foundation). Main-only git/Claude execution; the
  // renderer sends only a source job id. No auto-merge / auto-delete.
  setParallelEmitter((job) => {
    BrowserWindow.getAllWindows().forEach((w) => w.webContents.send('sj-claude-parallel:job-update', { job }))
  })
  ipcMain.handle('sj-claude-parallel:prepare', (_e, sourceJobId: string) => prepareWorktree(sourceJobId))
  ipcMain.handle('sj-claude-parallel:run', (_e, sourceJobId: string) => runWorktreeJob(sourceJobId))
  ipcMain.handle('sj-claude-parallel:get', (_e, sourceJobId: string) => getParallelJob(sourceJobId))
  ipcMain.handle('sj-claude-parallel:list', () => listParallelJobs())
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

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
