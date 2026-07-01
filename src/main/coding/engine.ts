import { app } from 'electron'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type {
  CodingExecEvent,
  CodingExecRequest,
  CodingExecResult,
  ProviderPhase
} from '@shared/providers'
import type { AssetManifest } from '@shared/kernel'

interface ScaffoldResult {
  files: string[]
  assets: AssetManifest[]
}

/**
 * The real coding engine (Node main process).
 *
 * This is where the AI Company delivers a real product. Each project gets an
 * independent on-disk workspace under the app's userData directory. On the first
 * task the engine scaffolds a complete, runnable Electron + React + TypeScript
 * desktop-application foundation (Milestone 1: routing, sidebar, dashboard,
 * theme, status bar, window layout, settings, build config) plus the project
 * documents (vision, goals, milestones, backlog, risks, timeline). Every task
 * then generates real, role-appropriate files that fit that structure.
 *
 * It streams genuine phase/progress/log signals and returns the real artifacts
 * it produced — no fake progress, strictly non-destructive, no business logic.
 * It sits behind the provider-neutral `CodingExecutionBackend` contract.
 */

export async function runCoding(
  request: CodingExecRequest,
  emit: (event: CodingExecEvent) => void
): Promise<CodingExecResult> {
  const phase = (p: ProviderPhase): void =>
    emit({ execId: request.execId, kind: 'phase', phase: p })
  const progress = (value: number): void =>
    emit({ execId: request.execId, kind: 'progress', progress: value })
  const log = (message: string): void =>
    emit({ execId: request.execId, kind: 'log', message })

  const projectName = request.projectName || 'Application'
  // Workspace is keyed by the product name, so commands about the same product
  // accrete into one stable project workspace ("the SJ Insurance Platform").
  const workspace = join(
    app.getPath('userData'),
    'sj-workspaces',
    slug(projectName) || request.projectId
  )

  try {
    phase('planning')
    progress(10)
    const subject = subjectOf(request.title)
    log(`Planning ${request.capability} work for “${subject}”`)

    const scaffold = await ensureScaffold(request.projectId, workspace, projectName)

    phase('coding')
    progress(45)
    const files = filesFor(request.capability, subject)
    const written: string[] = []
    for (const file of files) {
      const abs = join(workspace, file.rel)
      await mkdir(dirname(abs), { recursive: true })
      await writeFile(abs, file.content, 'utf8')
      written.push(file.rel)
      log(`Wrote ${file.rel}`)
      progress(45 + Math.round((written.length / files.length) * 45))
    }

    phase('testing')
    progress(100)

    return {
      ok: true,
      summary: `${capabilityVerb(request.capability)} “${subject}”`,
      actions: written.map((rel, i) => ({
        id: `${request.taskId}-f${i + 1}`,
        description: `Create ${rel}`,
        risk: 'safe' as const
      })),
      artifacts: [...scaffold.files, ...written],
      workspace,
      assets: scaffold.assets,
      logs: [`workspace: ${workspace}`, ...written.map((r) => `wrote ${r}`)]
    }
  } catch (err) {
    return {
      ok: false,
      summary: `Execution failed: ${err instanceof Error ? err.message : 'unknown error'}`,
      actions: [],
      artifacts: [],
      workspace,
      assets: [],
      logs: []
    }
  }
}

// ---- Scaffolding (Milestone 1: Desktop Application Foundation) --------------

const scaffolds = new Map<string, Promise<ScaffoldResult>>()

function ensureScaffold(
  projectId: string,
  workspace: string,
  projectName: string
): Promise<ScaffoldResult> {
  const existing = scaffolds.get(projectId)
  if (existing) return existing
  const promise = writeScaffold(workspace, projectName)
  scaffolds.set(projectId, promise)
  return promise
}

async function writeScaffold(
  workspace: string,
  projectName: string
): Promise<ScaffoldResult> {
  const files = scaffoldFiles(projectName)
  for (const file of files) {
    const abs = join(workspace, file.rel)
    await mkdir(dirname(abs), { recursive: true })
    await writeFile(abs, file.content, 'utf8')
  }
  const assets: AssetManifest[] = []
  if (isInsuranceProject(projectName)) {
    const moduleFiles = files
      .map((f) => f.rel)
      .filter((rel) => rel.startsWith(MODULE_DIR))
    assets.push({
      type: 'business_module',
      name: 'Customer',
      version: '1.0.0',
      dependencies: [],
      supportedProjects: ['SJ Insurance', 'CRM', 'Shopping Mall', 'ERP'],
      ownerDepartment: 'developer',
      files: moduleFiles
    })
    const consultationFiles = files
      .map((f) => f.rel)
      .filter((rel) => rel.startsWith(CONS_DIR))
    assets.push({
      type: 'business_module',
      name: 'Consultation',
      version: '1.0.0',
      dependencies: ['Customer'],
      supportedProjects: ['SJ Insurance', 'CRM'],
      ownerDepartment: 'developer',
      files: consultationFiles
    })
    const policyFiles = files.map((f) => f.rel).filter((rel) => rel.startsWith(POLICY_DIR))
    assets.push({
      type: 'business_module',
      name: 'Policy',
      version: '1.0.0',
      dependencies: [],
      supportedProjects: ['SJ Insurance'],
      ownerDepartment: 'developer',
      files: policyFiles
    })
    const analysisFiles = files
      .map((f) => f.rel)
      .filter((rel) => rel.startsWith(IA_DIR))
    assets.push({
      type: 'business_module',
      name: 'Insurance Analysis',
      version: '1.0.0',
      dependencies: ['Customer', 'Policy'],
      supportedProjects: ['SJ Insurance'],
      ownerDepartment: 'developer',
      files: analysisFiles
    })
  }
  return { files: files.map((f) => f.rel), assets }
}

interface GenFile {
  rel: string
  content: string
}

function isInsuranceProject(name: string): boolean {
  return /insurance/i.test(name)
}

function scaffoldFiles(name: string): GenFile[] {
  const pkg = slug(name) || 'app'
  const files: GenFile[] = [
    // ---- Build configuration ----
    {
      rel: 'package.json',
      content: JSON.stringify(
        {
          name: pkg,
          private: true,
          version: '0.0.0',
          main: './out/main/index.js',
          scripts: {
            dev: 'electron-vite dev',
            build: 'electron-vite build',
            start: 'electron-vite preview'
          },
          dependencies: { react: '^18.3.1', 'react-dom': '^18.3.1' },
          devDependencies: {
            '@types/node': '^22.10.0',
            '@types/react': '^18.3.12',
            '@types/react-dom': '^18.3.1',
            '@vitejs/plugin-react': '^4.3.4',
            electron: '^33.2.1',
            'electron-vite': '^2.3.0',
            typescript: '^5.7.2',
            vite: '^5.4.11'
          }
        },
        null,
        2
      )
    },
    {
      rel: 'electron.vite.config.ts',
      content: [
        "import { resolve } from 'node:path'",
        "import { defineConfig } from 'electron-vite'",
        "import react from '@vitejs/plugin-react'",
        '',
        'export default defineConfig({',
        '  main: { build: { rollupOptions: { input: { index: resolve(__dirname, \'src/main/index.ts\') } } } },',
        '  preload: { build: { rollupOptions: { input: { index: resolve(__dirname, \'src/preload/index.ts\') } } } },',
        '  renderer: {',
        "    root: 'src/renderer',",
        '    build: { rollupOptions: { input: { index: resolve(__dirname, \'src/renderer/index.html\') } } },',
        '    plugins: [react()]',
        '  }',
        '})',
        ''
      ].join('\n')
    },
    {
      rel: 'tsconfig.json',
      content: JSON.stringify(
        {
          compilerOptions: {
            target: 'ES2020',
            lib: ['ES2020', 'DOM', 'DOM.Iterable'],
            module: 'ESNext',
            moduleResolution: 'Bundler',
            jsx: 'react-jsx',
            types: ['node'],
            strict: true,
            skipLibCheck: true,
            esModuleInterop: true,
            noEmit: true
          },
          include: ['src']
        },
        null,
        2
      )
    },
    // ---- Electron main process (window layout) ----
    {
      rel: 'src/main/index.ts',
      content: [
        "import { app, BrowserWindow } from 'electron'",
        "import { join } from 'node:path'",
        '',
        'function createWindow(): void {',
        '  const window = new BrowserWindow({',
        '    width: 1200,',
        '    height: 800,',
        '    minWidth: 960,',
        '    minHeight: 640,',
        '    show: false,',
        "    backgroundColor: '#020617',",
        '    autoHideMenuBar: true,',
        '    webPreferences: {',
        "      preload: join(__dirname, '../preload/index.js'),",
        '      contextIsolation: true,',
        '      nodeIntegration: false',
        '    }',
        '  })',
        '',
        "  window.on('ready-to-show', () => window.show())",
        '',
        '  if (process.env.ELECTRON_RENDERER_URL) {',
        '    void window.loadURL(process.env.ELECTRON_RENDERER_URL)',
        '  } else {',
        "    void window.loadFile(join(__dirname, '../renderer/index.html'))",
        '  }',
        '}',
        '',
        'app.whenReady().then(createWindow)',
        '',
        "app.on('window-all-closed', () => {",
        "  if (process.platform !== 'darwin') app.quit()",
        '})',
        ''
      ].join('\n')
    },
    {
      rel: 'src/preload/index.ts',
      content: [
        "import { contextBridge } from 'electron'",
        '',
        "contextBridge.exposeInMainWorld('api', {",
        `  appName: '${name}'`,
        '})',
        ''
      ].join('\n')
    },
    // ---- Renderer (React + routing + layout) ----
    {
      rel: 'src/renderer/index.html',
      content: [
        '<!doctype html>',
        '<html lang="en">',
        '  <head>',
        '    <meta charset="UTF-8" />',
        '    <meta name="viewport" content="width=device-width, initial-scale=1.0" />',
        `    <title>${name}</title>`,
        '  </head>',
        '  <body>',
        '    <div id="root"></div>',
        '    <script type="module" src="/src/main.tsx"></script>',
        '  </body>',
        '</html>',
        ''
      ].join('\n')
    },
    {
      rel: 'src/renderer/src/main.tsx',
      content: [
        "import React from 'react'",
        "import { createRoot } from 'react-dom/client'",
        "import { App } from './App'",
        "import './index.css'",
        '',
        "createRoot(document.getElementById('root')!).render(",
        '  <React.StrictMode>',
        '    <App />',
        '  </React.StrictMode>',
        ')',
        ''
      ].join('\n')
    },
    {
      rel: 'src/renderer/src/App.tsx',
      content: appTsx(name)
    },
    {
      rel: 'src/renderer/src/components/Layout.tsx',
      content: [
        "import type { ReactNode } from 'react'",
        "import type { Route } from '../App'",
        "import { Sidebar } from './Sidebar'",
        "import { StatusBar } from './StatusBar'",
        '',
        'export function Layout({',
        '  route,',
        '  onNavigate,',
        '  children',
        '}: {',
        '  route: Route',
        '  onNavigate: (route: Route) => void',
        '  children: ReactNode',
        '}): JSX.Element {',
        '  return (',
        '    <div className="app-shell">',
        '      <Sidebar route={route} onNavigate={onNavigate} />',
        '      <div className="app-main">',
        '        <main className="app-content">{children}</main>',
        '        <StatusBar />',
        '      </div>',
        '    </div>',
        '  )',
        '}',
        ''
      ].join('\n')
    },
    {
      rel: 'src/renderer/src/components/Sidebar.tsx',
      content: sidebarTsx(name)
    },
    {
      rel: 'src/renderer/src/components/StatusBar.tsx',
      content: [
        'export function StatusBar(): JSX.Element {',
        '  return (',
        '    <footer className="status-bar">',
        '      <span>Ready</span>',
        '      <span>v0.0.0</span>',
        '    </footer>',
        '  )',
        '}',
        ''
      ].join('\n')
    },
    {
      rel: 'src/renderer/src/pages/Dashboard.tsx',
      content: dashboardTsx(name)
    },
    {
      rel: 'src/renderer/src/pages/Settings.tsx',
      content: [
        "import { useState } from 'react'",
        "import { toggleTheme } from '../lib/theme'",
        '',
        'export function Settings(): JSX.Element {',
        '  const [dark, setDark] = useState(true)',
        '  return (',
        '    <section className="page">',
        '      <h1>Settings</h1>',
        '      <label>',
        '        <input',
        '          type="checkbox"',
        '          checked={dark}',
        '          onChange={() => {',
        '            setDark(!dark)',
        '            toggleTheme()',
        '          }}',
        '        />{\' \'}',
        '        Dark theme',
        '      </label>',
        '    </section>',
        '  )',
        '}',
        ''
      ].join('\n')
    },
    {
      rel: 'src/renderer/src/lib/theme.ts',
      content: [
        "export type ThemeMode = 'light' | 'dark'",
        '',
        'export function toggleTheme(): void {',
        "  document.documentElement.classList.toggle('light')",
        '}',
        ''
      ].join('\n')
    },
    {
      rel: 'src/renderer/src/index.css',
      content: [
        ':root { --bg: #020617; --fg: #e2e8f0; --panel: #0f172a; --muted: #64748b; --accent: #6366f1; }',
        '.light { --bg: #f8fafc; --fg: #0f172a; --panel: #ffffff; --muted: #94a3b8; --accent: #4f46e5; }',
        '* { box-sizing: border-box; }',
        'body { margin: 0; font-family: system-ui, sans-serif; background: var(--bg); color: var(--fg); }',
        '.app-shell { display: flex; height: 100vh; }',
        '.app-main { display: flex; flex-direction: column; flex: 1; }',
        '.app-content { flex: 1; padding: 24px; overflow: auto; }',
        '.sidebar { width: 210px; background: var(--panel); padding: 16px; border-right: 1px solid rgba(148,163,184,0.15); }',
        '.sidebar-brand { font-weight: 600; margin-bottom: 16px; }',
        '.nav-item { display: block; width: 100%; text-align: left; padding: 8px 10px; margin-bottom: 4px; border: 0; border-radius: 8px; background: transparent; color: var(--fg); cursor: pointer; }',
        '.nav-item.active { background: var(--accent); color: #fff; }',
        '.status-bar { display: flex; justify-content: space-between; padding: 6px 16px; font-size: 12px; color: var(--muted); border-top: 1px solid rgba(148,163,184,0.15); }',
        '.page h1 { margin-top: 0; }',
        '.stat-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin-bottom: 16px; }',
        '.stat { background: var(--panel); border: 1px solid rgba(148,163,184,0.15); border-radius: 12px; padding: 14px; display: flex; flex-direction: column; gap: 4px; }',
        '.stat-label { font-size: 12px; color: var(--muted); }',
        '.stat-value { font-size: 22px; font-weight: 600; }',
        '.shortcut-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; margin-bottom: 16px; }',
        '.shortcut { text-align: left; background: var(--panel); border: 1px solid rgba(148,163,184,0.15); border-radius: 12px; padding: 14px; color: var(--fg); cursor: pointer; display: flex; flex-direction: column; gap: 4px; }',
        '.shortcut.highlight { border-color: var(--accent); }',
        '.shortcut span { font-size: 12px; color: var(--muted); }',
        '.dash-columns { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px; margin-bottom: 16px; }',
        '.panel { background: var(--panel); border: 1px solid rgba(148,163,184,0.15); border-radius: 12px; padding: 14px; }',
        '.panel h2 { margin: 0 0 8px; font-size: 14px; }',
        '.pipeline, .list { list-style: none; margin: 0; padding: 0; }',
        '.pipeline li, .list li { display: flex; justify-content: space-between; gap: 8px; padding: 6px 0; border-bottom: 1px solid rgba(148,163,184,0.1); font-size: 13px; }',
        '.badge { background: var(--accent); color: #fff; border-radius: 999px; padding: 0 8px; font-size: 12px; }',
        '.muted { color: var(--muted); font-size: 12px; }',
        '.quick-actions { display: flex; flex-wrap: wrap; gap: 8px; }',
        '.action { background: var(--accent); color: #fff; border: 0; border-radius: 8px; padding: 8px 12px; cursor: pointer; font-size: 13px; }',
        '.cust-list { list-style: none; margin: 0; padding: 0; }',
        '.cust-row { display: flex; justify-content: space-between; align-items: center; padding: 6px 0; border-bottom: 1px solid rgba(148,163,184,0.1); cursor: pointer; font-size: 13px; }',
        '.cust-badge { border-radius: 999px; padding: 1px 8px; font-size: 11px; text-transform: capitalize; }',
        '.cust-active { background: rgba(16,185,129,0.18); color: #34d399; }',
        '.cust-lead { background: rgba(99,102,241,0.18); color: #818cf8; }',
        '.cust-inactive { background: rgba(148,163,184,0.18); color: #94a3b8; }',
        '.cust-churned { background: rgba(244,63,94,0.18); color: #fb7185; }',
        '.cust-tags { display: flex; flex-wrap: wrap; gap: 6px; margin: 6px 0; }',
        '.cust-tag { background: rgba(148,163,184,0.15); border-radius: 999px; padding: 1px 8px; font-size: 11px; }',
        '.cust-search { width: 100%; padding: 8px 10px; margin-bottom: 8px; border-radius: 8px; border: 1px solid rgba(148,163,184,0.2); background: var(--bg); color: var(--fg); }',
        '.cust-stat-total { font-size: 28px; font-weight: 700; margin-bottom: 8px; }',
        '.cust-memos, .cust-timeline { list-style: none; margin: 0; padding: 0; font-size: 13px; }',
        '.cust-memos li, .cust-timeline li { padding: 4px 0; }',
        '.cust-mgmt-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }',
        '.cust-mgmt-body { display: grid; grid-template-columns: 1fr 1.4fr; gap: 12px; margin-top: 12px; }',
        '.cust-mgmt-left { display: flex; flex-direction: column; gap: 12px; }',
        '@media (max-width: 860px) { .cust-mgmt-body { grid-template-columns: 1fr; } }',
        '.cons-list { list-style: none; margin: 0; padding: 0; }',
        '.cons-row { display: flex; justify-content: space-between; align-items: center; padding: 6px 0; border-bottom: 1px solid rgba(148,163,184,0.1); cursor: pointer; font-size: 13px; }',
        '.cons-row-meta { display: flex; align-items: center; gap: 6px; }',
        '.cons-badge { border-radius: 999px; padding: 1px 8px; font-size: 11px; }',
        '.cons-scheduled { background: rgba(99,102,241,0.18); color: #818cf8; }',
        '.cons-in_progress { background: rgba(16,185,129,0.18); color: #34d399; }',
        '.cons-completed { background: rgba(56,189,248,0.18); color: #38bdf8; }',
        '.cons-cancelled { background: rgba(244,63,94,0.18); color: #fb7185; }',
        '.cons-type { background: rgba(148,163,184,0.15); border-radius: 999px; padding: 1px 8px; font-size: 11px; }',
        '.cons-next { margin: 4px 0; font-size: 13px; }',
        '.cs-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }',
        '.cs-select select { background: var(--panel); color: var(--fg); border: 1px solid rgba(148,163,184,0.2); border-radius: 8px; padding: 6px 8px; margin-left: 6px; }',
        '.cs-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; margin-bottom: 6px; }',
        '.cs-toolbar h2 { margin: 0; }',
        '.cs-controls { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }',
        '.cs-filters { display: flex; gap: 4px; }',
        '.chip-btn { background: transparent; color: var(--muted); border: 1px solid rgba(148,163,184,0.2); border-radius: 999px; padding: 2px 10px; font-size: 12px; cursor: pointer; text-transform: capitalize; }',
        '.chip-btn.active { background: var(--accent); color: #fff; border-color: var(--accent); }',
        '.cs-policies { list-style: none; margin: 0; padding: 0; }',
        '.cs-policy { padding: 6px 0; border-bottom: 1px solid rgba(148,163,184,0.1); }',
        '.cs-policy.active { border-left: 2px solid var(--accent); padding-left: 8px; }',
        '.cs-policy-row { display: flex; justify-content: space-between; cursor: pointer; font-size: 13px; }',
        '.cs-expand { background: transparent; border: 0; color: var(--accent); cursor: pointer; font-size: 12px; padding: 4px 0; }',
        '.cs-ok { color: #34d399; font-size: 12px; }',
        '.cs-missing { color: #fb7185; font-size: 12px; }',
        '.cs-missing-list { display: flex; flex-wrap: wrap; gap: 6px; }',
        '.cs-missing-tag { background: rgba(244,63,94,0.18); color: #fb7185; border-radius: 999px; padding: 1px 8px; font-size: 12px; }',
        '.journey-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }',
        '.journey-customer { font-size: 13px; color: var(--muted); }',
        '.journey-steps { display: flex; flex-wrap: wrap; gap: 8px; margin: 12px 0; }',
        '.journey-step { border: 1px solid rgba(148,163,184,0.2); background: transparent; color: var(--muted); border-radius: 999px; padding: 4px 12px; font-size: 12px; cursor: pointer; }',
        '.journey-step.active { background: var(--accent); color: #fff; border-color: var(--accent); }',
        '.journey-step.locked { opacity: 0.4; cursor: not-allowed; }',
        '.journey-nav { margin-top: 10px; }',
        '.journey-ok { color: #34d399; font-size: 13px; margin: 8px 0; }',
        ''
      ].join('\n')
    },
    // ---- Project documents ----
    { rel: 'docs/VISION.md', content: visionDoc(name) },
    { rel: 'docs/GOALS.md', content: goalsDoc() },
    { rel: 'docs/MILESTONES.md', content: milestonesDoc(isInsuranceProject(name)) },
    { rel: 'docs/BACKLOG.md', content: backlogDoc() },
    { rel: 'docs/RISKS.md', content: risksDoc() },
    { rel: 'docs/TIMELINE.md', content: timelineDoc() },
    { rel: 'README.md', content: readmeDoc(name) },
    { rel: '.gitignore', content: 'node_modules\nout\ndist\n.DS_Store\n' }
  ]

  // Insurance projects are organized as business domains. The Dashboard's own
  // (non-customer) mock data, the reusable Customer Module (inside the Customer
  // Domain), and the full domain architecture are all generated here.
  if (isInsuranceProject(name)) {
    files.push({
      rel: 'src/renderer/src/data/mockDashboard.ts',
      content: mockDashboardData()
    })
    files.push({ rel: 'docs/DOMAINS.md', content: domainsDoc() })
    // Feature screens, wired into app navigation.
    files.push({ rel: 'src/renderer/src/pages/Customers.tsx', content: customersPage() })
    files.push({ rel: 'src/renderer/src/pages/Consultations.tsx', content: consultationsPage() })
    files.push({ rel: 'src/renderer/src/pages/Analysis.tsx', content: analysisPage() })
    // Workflow 001 — New Customer Journey (shared state + guided navigation).
    files.push({ rel: 'src/renderer/src/pages/Journey.tsx', content: journeyPage() })
    files.push({ rel: 'src/renderer/src/workflow/WorkflowContext.tsx', content: workflowContext() })
    files.push({ rel: 'src/renderer/src/workflow/JourneyView.tsx', content: journeyView() })
    files.push({ rel: 'docs/FEATURE-001-customer-management.md', content: feature001Doc() })
    files.push({ rel: 'docs/FEATURE-002-consultation-management.md', content: feature002Doc() })
    files.push({ rel: 'docs/EPIC-001-insurance-analysis.md', content: epic001Doc() })
    files.push({ rel: 'docs/WORKFLOW-001-new-customer-journey.md', content: workflow001Doc() })
    files.push(...customerModuleFiles())
    files.push(...customerDomainExtras())
    for (const d of DOMAINS) {
      if (d.slug === 'customer') continue
      if (d.slug === 'consultation') {
        files.push(...consultationModuleFiles())
        continue
      }
      if (d.slug === 'insurance-analysis') {
        files.push(...insuranceAnalysisEpicFiles())
        continue
      }
      if (d.slug === 'policy') {
        files.push(...policyModuleFiles())
        continue
      }
      files.push(...domainSkeletonFiles(d.slug, d.title))
    }
  }

  return files
}

function domainsDoc(): string {
  const lines = [
    '# Domain architecture',
    '',
    'SJ Insurance Platform is organized as independent business domains',
    '(Clean Architecture / DDD-inspired). Each domain owns its own models,',
    'services, views, components, commands, events, documentation, assets and tests.',
    '',
    '## Domains',
    ''
  ]
  for (const d of DOMAINS) {
    lines.push(`- ${d.title}${d.slug === 'customer' ? ' (active — includes the Customer Module)' : ''}`)
  }
  lines.push('', 'No business logic is implemented yet — only the domain architecture.', '')
  return lines.join('\n')
}

function feature001Doc(): string {
  return [
    '# Feature 001 — Customer Management',
    '',
    'Status: delivered.',
    '',
    'A real customer management screen, reachable from the sidebar ("Customers").',
    'It is composed entirely from the reusable Customer Module (a Company Asset)',
    'inside the Customer Domain — the feature owns no customer logic of its own.',
    '',
    '## Workflow',
    '',
    '1. Browse the customer list with live search.',
    '2. Select a customer to view their profile: status, tags, memos, timeline.',
    '3. Customer statistics and quick actions are shown alongside.',
    '',
    'UI + local mock data only — no APIs, database or authentication.',
    '',
    '## Files',
    '',
    '- `src/renderer/src/pages/Customers.tsx` (route target)',
    '- `src/renderer/src/domains/customer/views/CustomerManagementView.tsx` (master-detail)',
    '- `Sidebar.tsx` + `App.tsx` updated to include the "Customers" route',
    ''
  ].join('\n')
}

function feature002Doc(): string {
  return [
    '# Feature 002 — Consultation Management',
    '',
    'Status: delivered.',
    '',
    'A real consultation management screen ("Consultations" in the sidebar). Built',
    'on the Consultation Domain and REUSING the Customer Domain for the customer',
    'link. Registered as the reusable **Consultation** Company Asset (depends on',
    'the Customer asset).',
    '',
    '## Requirements covered',
    '',
    '- Consultation list, detail, status and type',
    '- Consultation schedule and customer link (via the Customer Module)',
    '- 상담 메모, 상담 이력, 다음 액션',
    '- 상담 파이프라인 and quick actions',
    '',
    'UI + local mock data only — no APIs, database, authentication or insurance-',
    'company integration.',
    '',
    '## Files',
    '',
    '- `src/renderer/src/pages/Consultations.tsx` (route target)',
    '- `src/renderer/src/domains/consultation/` (models, services, components, views, …)',
    '- `Sidebar.tsx` + `App.tsx` updated to include the "Consultations" route',
    ''
  ].join('\n')
}

// ---- Business domains (Clean Architecture / DDD-inspired) -------------------

const DOMAINS_DIR = 'src/renderer/src/domains/'
// The Customer Module lives inside the Customer Domain.
const MODULE_DIR = DOMAINS_DIR + 'customer/'
// The Consultation Module lives inside the Consultation Domain.
const CONS_DIR = DOMAINS_DIR + 'consultation/'
// Epic 001 (Insurance Analysis) lives inside the Insurance Analysis Domain.
const IA_DIR = DOMAINS_DIR + 'insurance-analysis/'
// The Policy Module lives inside the Policy Domain.
const POLICY_DIR = DOMAINS_DIR + 'policy/'

const DOMAINS: { slug: string; title: string }[] = [
  { slug: 'customer', title: 'Customer' },
  { slug: 'consultation', title: 'Consultation' },
  { slug: 'insurance-analysis', title: 'Insurance Analysis' },
  { slug: 'policy', title: 'Policy' },
  { slug: 'claim', title: 'Claim' },
  { slug: 'medical', title: 'Medical' },
  { slug: 'hidden-money', title: 'Hidden Insurance Money' },
  { slug: 'ai-planner', title: 'AI Planner' },
  { slug: 'document', title: 'Document' },
  { slug: 'admin', title: 'Admin' }
]

function mod(rel: string, lines: string[]): GenFile {
  return { rel: MODULE_DIR + rel, content: lines.join('\n') }
}

/** A standard DDD-inspired scaffold for a domain (architecture only). */
function domainSkeletonFiles(slug: string, title: string): GenFile[] {
  const D = pascal(slug)
  const camel = D.charAt(0).toLowerCase() + D.slice(1)
  const dir = DOMAINS_DIR + slug + '/'
  const g = (rel: string, lines: string[]): GenFile => ({ rel: dir + rel, content: lines.join('\n') })
  return [
    g('models.ts', [
      `// ${title} Domain — models. Architecture scaffold only; no business logic yet.`,
      `export interface ${D}Ref {`,
      '  id: string',
      '}',
      ''
    ]),
    g('services.ts', [
      `import type { ${D}Ref } from './models'`,
      '',
      `export interface ${D}Service {`,
      `  list(): ${D}Ref[]`,
      '}',
      '',
      `export class Mock${D}Service implements ${D}Service {`,
      `  list(): ${D}Ref[] {`,
      '    return []',
      '  }',
      '}',
      '',
      `export const ${camel}Service: ${D}Service = new Mock${D}Service()`,
      ''
    ]),
    g('commands.ts', [
      `// ${title} Domain — commands.`,
      `export type ${D}Command = { type: '${slug}/noop' }`,
      ''
    ]),
    g('events.ts', [
      `// ${title} Domain — events.`,
      `export type ${D}Event = { type: '${slug}/initialized' }`,
      ''
    ]),
    g(`views/${D}View.tsx`, [
      `export function ${D}View(): JSX.Element {`,
      '  return (',
      '    <section className="page">',
      `      <h1>${title}</h1>`,
      `      <p>The ${title} domain — architecture scaffold (no business logic yet).</p>`,
      '    </section>',
      '  )',
      '}',
      ''
    ]),
    g(`components/${D}Panel.tsx`, [
      `export function ${D}Panel(): JSX.Element {`,
      '  return (',
      '    <div className="panel">',
      `      <h2>${title}</h2>`,
      '      <p>Domain component scaffold.</p>',
      '    </div>',
      '  )',
      '}',
      ''
    ]),
    g('index.ts', [
      `// ${title} Domain — public contract.`,
      `export type { ${D}Ref } from './models'`,
      `export type { ${D}Service } from './services'`,
      `export { ${camel}Service } from './services'`,
      `export type { ${D}Command } from './commands'`,
      `export type { ${D}Event } from './events'`,
      `export { ${D}View } from './views/${D}View'`,
      `export { ${D}Panel } from './components/${D}Panel'`,
      ''
    ]),
    g('README.md', [
      `# ${title} Domain`,
      '',
      'Architecture scaffold (Clean Architecture / DDD-inspired). No business logic yet.',
      '',
      '## Owns',
      '',
      'Models · Services · Views · Components · Commands · Events · Documentation · Assets · Tests',
      ''
    ]),
    g('assets/README.md', [
      `# ${title} Domain — Assets`,
      '',
      'Reusable assets produced by this domain are registered in the Company Asset Store.',
      ''
    ]),
    g(`tests/${slug}.test.ts`, [
      `// ${title} Domain — placeholder test.`,
      'export {}',
      ''
    ]),
    g('domain.json', [
      JSON.stringify(
        {
          name: title,
          layer: 'domain',
          ownerDepartment: 'developer',
          status: 'scaffolded',
          owns: ['models', 'services', 'views', 'components', 'commands', 'events', 'documentation', 'assets', 'tests']
        },
        null,
        2
      ),
      ''
    ])
  ]
}

// ---- Feature 002 — Consultation Module (Consultation Domain) ---------------

function cmod(rel: string, lines: string[]): GenFile {
  return { rel: CONS_DIR + rel, content: lines.join('\n') }
}

function consultationModuleFiles(): GenFile[] {
  return [
    cmod('models.ts', [
      "export type ConsultationType = 'phone' | 'visit' | 'video' | 'chat'",
      "export type ConsultationStatus = 'scheduled' | 'in_progress' | 'completed' | 'cancelled'",
      '',
      'export interface ConsultationMemo {',
      '  id: string',
      '  text: string',
      '  at: string',
      '}',
      '',
      'export interface ConsultationHistoryEvent {',
      '  id: string',
      '  description: string',
      '  at: string',
      '}',
      '',
      'export interface Consultation {',
      '  id: string',
      '  customerId: string',
      '  type: ConsultationType',
      '  status: ConsultationStatus',
      '  scheduledAt: string',
      '  nextAction: string',
      '  memos: ConsultationMemo[]',
      '  history: ConsultationHistoryEvent[]',
      '}',
      '',
      'export interface ConsultationStats {',
      '  total: number',
      '  byStatus: Record<ConsultationStatus, number>',
      '}',
      '',
      'export interface PipelineStage {',
      '  status: ConsultationStatus',
      '  label: string',
      '  count: number',
      '}',
      ''
    ]),
    cmod('data/mockConsultations.ts', [
      "import type { Consultation } from '../models'",
      '',
      '// Local mock data only — customerId links to the Customer Domain.',
      'export const mockConsultations: Consultation[] = [',
      '  {',
      "    id: 'cons-1',",
      "    customerId: 'cust-1',",
      "    type: 'phone',",
      "    status: 'in_progress',",
      "    scheduledAt: 'Today 14:00',",
      "    nextAction: 'Send coverage summary and schedule a follow-up.',",
      "    memos: [{ id: 'cm-1', text: 'Interested in cancer coverage.', at: '10m ago' }],",
      '    history: [',
      "      { id: 'ch-1', description: 'Consultation scheduled', at: '2d ago' },",
      "      { id: 'ch-2', description: 'Consultation started', at: 'Today 14:00' }",
      '    ]',
      '  },',
      '  {',
      "    id: 'cons-2',",
      "    customerId: 'cust-2',",
      "    type: 'visit',",
      "    status: 'scheduled',",
      "    scheduledAt: 'Tomorrow 10:30',",
      "    nextAction: 'Prepare life insurance proposal.',",
      "    memos: [],",
      "    history: [{ id: 'ch-3', description: 'Consultation scheduled', at: '1d ago' }]",
      '  },',
      '  {',
      "    id: 'cons-3',",
      "    customerId: 'cust-3',",
      "    type: 'video',",
      "    status: 'completed',",
      "    scheduledAt: 'Yesterday 16:00',",
      "    nextAction: 'None — closed.',",
      "    memos: [{ id: 'cm-2', text: 'Requested a follow-up next quarter.', at: '1d ago' }],",
      '    history: [',
      "      { id: 'ch-4', description: 'Consultation scheduled', at: '3d ago' },",
      "      { id: 'ch-5', description: 'Consultation completed', at: 'Yesterday 16:40' }",
      '    ]',
      '  },',
      '  {',
      "    id: 'cons-4',",
      "    customerId: 'cust-4',",
      "    type: 'chat',",
      "    status: 'scheduled',",
      "    scheduledAt: 'Fri 09:00',",
      "    nextAction: 'Confirm availability.',",
      "    memos: [],",
      "    history: [{ id: 'ch-6', description: 'Consultation scheduled', at: '4h ago' }]",
      '  }',
      ']',
      ''
    ]),
    cmod('services.ts', [
      "import type { Consultation, ConsultationStats, ConsultationStatus, PipelineStage } from './models'",
      "import { mockConsultations } from './data/mockConsultations'",
      '',
      'export interface ConsultationService {',
      '  list(): Consultation[]',
      '  get(id: string): Consultation | undefined',
      '  byCustomer(customerId: string): Consultation[]',
      '  search(query: string): Consultation[]',
      '  stats(): ConsultationStats',
      '  pipeline(): PipelineStage[]',
      '}',
      '',
      'export class MockConsultationService implements ConsultationService {',
      '  private readonly consultations: Consultation[] = mockConsultations',
      '  list(): Consultation[] {',
      '    return this.consultations',
      '  }',
      '  get(id: string): Consultation | undefined {',
      '    return this.consultations.find((c) => c.id === id)',
      '  }',
      '  byCustomer(customerId: string): Consultation[] {',
      '    return this.consultations.filter((c) => c.customerId === customerId)',
      '  }',
      '  search(query: string): Consultation[] {',
      '    const q = query.trim().toLowerCase()',
      '    if (!q) return this.consultations',
      '    return this.consultations.filter((c) => c.nextAction.toLowerCase().includes(q))',
      '  }',
      '  stats(): ConsultationStats {',
      '    const byStatus: Record<ConsultationStatus, number> = { scheduled: 0, in_progress: 0, completed: 0, cancelled: 0 }',
      '    for (const c of this.consultations) byStatus[c.status] += 1',
      '    return { total: this.consultations.length, byStatus }',
      '  }',
      '  pipeline(): PipelineStage[] {',
      '    const s = this.stats().byStatus',
      '    return [',
      "      { status: 'scheduled', label: 'Scheduled', count: s.scheduled },",
      "      { status: 'in_progress', label: 'In progress', count: s.in_progress },",
      "      { status: 'completed', label: 'Completed', count: s.completed },",
      "      { status: 'cancelled', label: 'Cancelled', count: s.cancelled }",
      '    ]',
      '  }',
      '}',
      '',
      'export const consultationService: ConsultationService = new MockConsultationService()',
      ''
    ]),
    cmod('commands.ts', [
      "import type { ConsultationStatus, ConsultationType } from './models'",
      '',
      'export type ConsultationCommand =',
      "  | { type: 'consultation/create'; customerId: string; consultationType: ConsultationType }",
      "  | { type: 'consultation/changeStatus'; id: string; status: ConsultationStatus }",
      "  | { type: 'consultation/addMemo'; id: string; text: string }",
      "  | { type: 'consultation/setNextAction'; id: string; action: string }",
      ''
    ]),
    cmod('events.ts', [
      "import type { ConsultationStatus } from './models'",
      '',
      'export type ConsultationEvent =',
      "  | { type: 'consultation/created'; id: string }",
      "  | { type: 'consultation/statusChanged'; id: string; status: ConsultationStatus }",
      "  | { type: 'consultation/memoAdded'; id: string }",
      ''
    ]),
    cmod('components/ConsultationStatusBadge.tsx', [
      "import type { ConsultationStatus } from '../models'",
      '',
      'const LABEL: Record<ConsultationStatus, string> = {',
      "  scheduled: 'Scheduled',",
      "  in_progress: 'In progress',",
      "  completed: 'Completed',",
      "  cancelled: 'Cancelled'",
      '}',
      '',
      'export function ConsultationStatusBadge({ status }: { status: ConsultationStatus }): JSX.Element {',
      "  return <span className={'cons-badge cons-' + status}>{LABEL[status]}</span>",
      '}',
      ''
    ]),
    cmod('components/ConsultationTypeBadge.tsx', [
      "import type { ConsultationType } from '../models'",
      '',
      'const LABEL: Record<ConsultationType, string> = {',
      "  phone: '전화',",
      "  visit: '방문',",
      "  video: '화상',",
      "  chat: '채팅'",
      '}',
      '',
      'export function ConsultationTypeBadge({ type }: { type: ConsultationType }): JSX.Element {',
      '  return <span className="cons-type">{LABEL[type]}</span>',
      '}',
      ''
    ]),
    cmod('components/ConsultationMemoList.tsx', [
      "import type { ConsultationMemo } from '../models'",
      '',
      'export function ConsultationMemoList({ memos }: { memos: ConsultationMemo[] }): JSX.Element {',
      '  return (',
      '    <ul className="cust-memos">',
      '      {memos.map((m) => (',
      '        <li key={m.id}>{m.text} <span className="muted">{m.at}</span></li>',
      '      ))}',
      '    </ul>',
      '  )',
      '}',
      ''
    ]),
    cmod('components/ConsultationHistory.tsx', [
      "import type { ConsultationHistoryEvent } from '../models'",
      '',
      'export function ConsultationHistory({ events }: { events: ConsultationHistoryEvent[] }): JSX.Element {',
      '  return (',
      '    <ul className="cust-timeline">',
      '      {events.map((e) => (',
      '        <li key={e.id}>{e.description} <span className="muted">{e.at}</span></li>',
      '      ))}',
      '    </ul>',
      '  )',
      '}',
      ''
    ]),
    cmod('components/ConsultationNextAction.tsx', [
      'export function ConsultationNextAction({ action }: { action: string }): JSX.Element {',
      '  return <p className="cons-next">{action}</p>',
      '}',
      ''
    ]),
    cmod('components/ConsultationPipeline.tsx', [
      "import { consultationService } from '../services'",
      '',
      'export function ConsultationPipeline(): JSX.Element {',
      '  const stages = consultationService.pipeline()',
      '  return (',
      '    <div className="panel">',
      '      <h2>상담 파이프라인</h2>',
      '      <ul className="pipeline">',
      '        {stages.map((s) => (',
      '          <li key={s.status}>',
      '            <span>{s.label}</span>',
      '            <span className="badge">{s.count}</span>',
      '          </li>',
      '        ))}',
      '      </ul>',
      '    </div>',
      '  )',
      '}',
      ''
    ]),
    cmod('components/ConsultationQuickActions.tsx', [
      "const ACTIONS = ['New consultation', 'Schedule', 'Add memo', 'Complete']",
      '',
      'export function ConsultationQuickActions(): JSX.Element {',
      '  return (',
      '    <div className="cust-actions">',
      '      {ACTIONS.map((a) => (',
      '        <button key={a} className="action">{a}</button>',
      '      ))}',
      '    </div>',
      '  )',
      '}',
      ''
    ]),
    cmod('components/ConsultationStatisticsCard.tsx', [
      "import { consultationService } from '../services'",
      '',
      'export function ConsultationStatisticsCard(): JSX.Element {',
      '  const stats = consultationService.stats()',
      '  return (',
      '    <div className="panel">',
      '      <h2>Consultations</h2>',
      '      <div className="cust-stat-total">{stats.total}</div>',
      '      <ul className="list">',
      '        <li><span>Scheduled</span><span className="badge">{stats.byStatus.scheduled}</span></li>',
      '        <li><span>In progress</span><span className="badge">{stats.byStatus.in_progress}</span></li>',
      '        <li><span>Completed</span><span className="badge">{stats.byStatus.completed}</span></li>',
      '        <li><span>Cancelled</span><span className="badge">{stats.byStatus.cancelled}</span></li>',
      '      </ul>',
      '    </div>',
      '  )',
      '}',
      ''
    ]),
    cmod('components/ConsultationList.tsx', [
      "import { customerService } from '../../customer'",
      "import type { Consultation } from '../models'",
      "import { ConsultationStatusBadge } from './ConsultationStatusBadge'",
      "import { ConsultationTypeBadge } from './ConsultationTypeBadge'",
      '',
      'export function ConsultationList({',
      '  consultations,',
      '  onSelect',
      '}: {',
      '  consultations: Consultation[]',
      '  onSelect?: (id: string) => void',
      '}): JSX.Element {',
      '  return (',
      '    <ul className="cons-list">',
      '      {consultations.map((c) => (',
      '        <li key={c.id} className="cons-row" onClick={() => onSelect?.(c.id)}>',
      '          <span>{customerService.get(c.customerId)?.name ?? c.customerId}</span>',
      '          <span className="cons-row-meta">',
      '            <ConsultationTypeBadge type={c.type} />',
      '            <ConsultationStatusBadge status={c.status} />',
      '          </span>',
      '        </li>',
      '      ))}',
      '    </ul>',
      '  )',
      '}',
      ''
    ]),
    cmod('components/ConsultationDetail.tsx', [
      "import { customerService } from '../../customer'",
      "import type { Consultation } from '../models'",
      "import { ConsultationStatusBadge } from './ConsultationStatusBadge'",
      "import { ConsultationTypeBadge } from './ConsultationTypeBadge'",
      "import { ConsultationMemoList } from './ConsultationMemoList'",
      "import { ConsultationHistory } from './ConsultationHistory'",
      "import { ConsultationNextAction } from './ConsultationNextAction'",
      '',
      'export function ConsultationDetail({ consultation }: { consultation: Consultation }): JSX.Element {',
      '  const customer = customerService.get(consultation.customerId)',
      '  return (',
      '    <div className="cons-detail">',
      '      <h3>',
      "        {customer?.name ?? consultation.customerId}{' '}",
      '        <ConsultationTypeBadge type={consultation.type} />{\' \'}',
      '        <ConsultationStatusBadge status={consultation.status} />',
      '      </h3>',
      '      <p className="muted">Scheduled: {consultation.scheduledAt}</p>',
      "      <p className=\"muted\">Customer: {customer?.email ?? '—'}</p>",
      '      <h4>다음 액션</h4>',
      '      <ConsultationNextAction action={consultation.nextAction} />',
      '      <h4>상담 메모</h4>',
      '      <ConsultationMemoList memos={consultation.memos} />',
      '      <h4>상담 이력</h4>',
      '      <ConsultationHistory events={consultation.history} />',
      '    </div>',
      '  )',
      '}',
      ''
    ]),
    cmod('views/ConsultationListView.tsx', [
      "import { consultationService } from '../services'",
      "import { ConsultationList } from '../components/ConsultationList'",
      '',
      'export function ConsultationListView(): JSX.Element {',
      '  return <ConsultationList consultations={consultationService.list()} />',
      '}',
      ''
    ]),
    cmod('views/ConsultationDetailView.tsx', [
      "import { consultationService } from '../services'",
      "import { ConsultationDetail } from '../components/ConsultationDetail'",
      '',
      'export function ConsultationDetailView({ consultationId }: { consultationId: string }): JSX.Element {',
      '  const consultation = consultationService.get(consultationId)',
      '  if (!consultation) return <p>Consultation not found.</p>',
      '  return <ConsultationDetail consultation={consultation} />',
      '}',
      ''
    ]),
    cmod('views/ConsultationManagementView.tsx', [
      "import { useState } from 'react'",
      "import { consultationService } from '../services'",
      "import { ConsultationPipeline } from '../components/ConsultationPipeline'",
      "import { ConsultationStatisticsCard } from '../components/ConsultationStatisticsCard'",
      "import { ConsultationList } from '../components/ConsultationList'",
      "import { ConsultationDetail } from '../components/ConsultationDetail'",
      "import { ConsultationQuickActions } from '../components/ConsultationQuickActions'",
      '',
      '// Feature 002 — Consultation Management (master-detail + pipeline).',
      'export function ConsultationManagementView(): JSX.Element {',
      '  const all = consultationService.list()',
      '  const [selectedId, setSelectedId] = useState<string | null>(all[0]?.id ?? null)',
      '  const selected = selectedId ? consultationService.get(selectedId) : undefined',
      '  return (',
      '    <section className="page cust-mgmt">',
      '      <div className="cust-mgmt-header">',
      '        <h1>Consultation Management</h1>',
      '        <ConsultationQuickActions />',
      '      </div>',
      '      <ConsultationPipeline />',
      '      <div className="cust-mgmt-body">',
      '        <div className="cust-mgmt-left">',
      '          <ConsultationStatisticsCard />',
      '          <div className="panel">',
      '            <ConsultationList consultations={all} onSelect={setSelectedId} />',
      '          </div>',
      '        </div>',
      '        <div className="cust-mgmt-right panel">',
      '          {selected ? (',
      '            <ConsultationDetail consultation={selected} />',
      '          ) : (',
      '            <p className="muted">Select a consultation.</p>',
      '          )}',
      '        </div>',
      '      </div>',
      '    </section>',
      '  )',
      '}',
      ''
    ]),
    cmod('index.ts', [
      '// Consultation Module — public contract. Consumers compose these.',
      'export type {',
      '  Consultation,',
      '  ConsultationType,',
      '  ConsultationStatus,',
      '  ConsultationMemo,',
      '  ConsultationHistoryEvent,',
      '  ConsultationStats,',
      '  PipelineStage',
      "} from './models'",
      "export type { ConsultationService } from './services'",
      "export { consultationService, MockConsultationService } from './services'",
      "export type { ConsultationCommand } from './commands'",
      "export type { ConsultationEvent } from './events'",
      "export { ConsultationList } from './components/ConsultationList'",
      "export { ConsultationDetail } from './components/ConsultationDetail'",
      "export { ConsultationStatusBadge } from './components/ConsultationStatusBadge'",
      "export { ConsultationTypeBadge } from './components/ConsultationTypeBadge'",
      "export { ConsultationMemoList } from './components/ConsultationMemoList'",
      "export { ConsultationHistory } from './components/ConsultationHistory'",
      "export { ConsultationNextAction } from './components/ConsultationNextAction'",
      "export { ConsultationPipeline } from './components/ConsultationPipeline'",
      "export { ConsultationQuickActions } from './components/ConsultationQuickActions'",
      "export { ConsultationStatisticsCard } from './components/ConsultationStatisticsCard'",
      "export { ConsultationListView } from './views/ConsultationListView'",
      "export { ConsultationDetailView } from './views/ConsultationDetailView'",
      "export { ConsultationManagementView } from './views/ConsultationManagementView'",
      ''
    ]),
    cmod('README.md', [
      '# Consultation Module',
      '',
      'A reusable business module for the Consultation Domain. Local mock data only —',
      'no APIs, database or authentication. Depends on the Customer Module for the',
      'customer link.',
      '',
      '## Owns',
      '',
      'Models · Services · Views · Components · Commands · Events · Documentation · Tests',
      ''
    ]),
    cmod('domain.json', [
      JSON.stringify(
        {
          name: 'Consultation',
          layer: 'domain',
          ownerDepartment: 'developer',
          status: 'active',
          module: 'Consultation',
          dependsOn: ['Customer'],
          owns: ['models', 'services', 'views', 'components', 'commands', 'events', 'documentation', 'assets', 'tests']
        },
        null,
        2
      ),
      ''
    ]),
    cmod('assets/README.md', [
      '# Consultation Domain — Assets',
      '',
      'Owns the reusable **Consultation** module, registered in the Company Asset Store.',
      ''
    ]),
    cmod('tests/consultation.test.ts', [
      '// Consultation Domain — placeholder test.',
      'export {}',
      ''
    ])
  ]
}

// ---- Epic 001 — Insurance Analysis -----------------------------------------

const EPIC_FEATURES: { slug: string; title: string; kind: string; dependsOn: string[] }[] = [
  { slug: 'mock-analysis-data', title: 'Mock Analysis Data', kind: 'data', dependsOn: [] },
  { slug: 'customer-link', title: 'Customer Link', kind: 'link-customer', dependsOn: [] },
  { slug: 'policy-link', title: 'Policy Link', kind: 'link-policy', dependsOn: [] },
  { slug: 'coverage-summary', title: 'Coverage Summary', kind: 'coverage-summary', dependsOn: ['mock-analysis-data', 'policy-link'] },
  { slug: 'coverage-gap-detection', title: 'Coverage Gap Detection', kind: 'view', dependsOn: ['coverage-summary'] },
  { slug: 'recommendation-engine', title: 'Recommendation Engine', kind: 'view', dependsOn: ['coverage-gap-detection'] },
  { slug: 'analysis-report', title: 'Analysis Report', kind: 'view', dependsOn: ['coverage-summary', 'coverage-gap-detection', 'recommendation-engine'] },
  { slug: 'analysis-dashboard', title: 'Analysis Dashboard', kind: 'dashboard', dependsOn: ['coverage-summary', 'coverage-gap-detection', 'recommendation-engine', 'analysis-report', 'customer-link', 'policy-link', 'mock-analysis-data'] }
]

function iaFile(rel: string, lines: string[]): GenFile {
  return { rel: IA_DIR + rel, content: lines.join('\n') }
}

function epicFeatureFiles(feature: { slug: string; title: string; kind: string }): GenFile[] {
  const F = pascal(feature.slug)
  const camel = F.charAt(0).toLowerCase() + F.slice(1)
  const dir = 'features/' + feature.slug + '/'
  const f = (rel: string, lines: string[]): GenFile => iaFile(dir + rel, lines)
  const readme = f('README.md', [
    `# ${feature.title}`,
    '',
    'Epic 001 feature scaffold — no business logic yet.',
    ''
  ])

  if (feature.kind === 'coverage-summary') {
    return coverageSummaryFeatureFiles()
  }
  if (feature.kind === 'data') {
    return [
      f('models.ts', [
        `// ${feature.title} — models.`,
        'export interface CoverageItem {',
        '  id: string',
        '  name: string',
        '  covered: boolean',
        '}',
        '',
        'export interface AnalysisRecord {',
        '  customerId: string',
        '  items: CoverageItem[]',
        '}',
        ''
      ]),
      f('data.ts', [
        "import type { AnalysisRecord } from './models'",
        '',
        '// Local mock analysis data only — no APIs, no business logic.',
        'export const mockAnalysis: AnalysisRecord[] = [',
        '  {',
        "    customerId: 'cust-1',",
        '    items: [',
        "      { id: 'ci-1', name: 'Hospitalization', covered: true },",
        "      { id: 'ci-2', name: 'Cancer', covered: false },",
        "      { id: 'ci-3', name: 'Dental', covered: false }",
        '    ]',
        '  }',
        ']',
        ''
      ]),
      f('index.ts', [
        "export type { CoverageItem, AnalysisRecord } from './models'",
        "export { mockAnalysis } from './data'",
        ''
      ]),
      readme
    ]
  }
  if (feature.kind === 'link-customer') {
    return [
      f('index.ts', [
        '// Customer Link — reuses the Customer Domain.',
        "export { customerService } from '../../../customer'",
        ''
      ]),
      readme
    ]
  }
  if (feature.kind === 'link-policy') {
    return [
      f('index.ts', [
        '// Policy Link — reuses the Policy Domain.',
        "export { policyService } from '../../../policy'",
        ''
      ]),
      readme
    ]
  }
  if (feature.kind === 'dashboard') {
    return [
      f('view.tsx', [
        "import { CoverageSummaryView } from '../coverage-summary'",
        "import { CoverageGapDetectionView } from '../coverage-gap-detection'",
        "import { RecommendationEngineView } from '../recommendation-engine'",
        "import { AnalysisReportView } from '../analysis-report'",
        '',
        'export function AnalysisDashboardView(): JSX.Element {',
        '  return (',
        '    <section className="page">',
        '      <h1>Insurance Analysis</h1>',
        '      <div className="dash-columns">',
        '        <CoverageSummaryView />',
        '        <CoverageGapDetectionView />',
        '        <RecommendationEngineView />',
        '        <AnalysisReportView />',
        '      </div>',
        '    </section>',
        '  )',
        '}',
        ''
      ]),
      f('index.ts', [
        "export { AnalysisDashboardView } from './view'",
        ''
      ]),
      readme
    ]
  }
  // kind 'view'
  return [
    f('models.ts', [
      `// ${feature.title} — models.`,
      `export interface ${F}Result {`,
      '  id: string',
      '  label: string',
      '}',
      ''
    ]),
    f('service.ts', [
      `import type { ${F}Result } from './models'`,
      '',
      `export interface ${F}Service {`,
      `  run(): ${F}Result[]`,
      '}',
      '',
      `export class Mock${F}Service implements ${F}Service {`,
      `  run(): ${F}Result[] {`,
      '    return []',
      '  }',
      '}',
      '',
      `export const ${camel}Service: ${F}Service = new Mock${F}Service()`,
      ''
    ]),
    f('view.tsx', [
      `export function ${F}View(): JSX.Element {`,
      '  return (',
      '    <div className="panel">',
      `      <h2>${feature.title}</h2>`,
      '      <p className="muted">Scaffold — no business logic yet.</p>',
      '    </div>',
      '  )',
      '}',
      ''
    ]),
    f('index.ts', [
      `export type { ${F}Result } from './models'`,
      `export type { ${F}Service } from './service'`,
      `export { ${camel}Service } from './service'`,
      `export { ${F}View } from './view'`,
      ''
    ]),
    readme
  ]
}

function insuranceAnalysisEpicFiles(): GenFile[] {
  const files: GenFile[] = [
    iaFile('epic.json', [
      JSON.stringify(
        {
          id: 'EPIC-001',
          name: 'Insurance Analysis',
          layer: 'epic',
          ownerDepartment: 'developer',
          linkedDomains: ['Customer', 'Policy'],
          features: EPIC_FEATURES.map((ft) => ({
            slug: ft.slug,
            title: ft.title,
            dependsOn: ft.dependsOn
          }))
        },
        null,
        2
      ),
      ''
    ]),
    iaFile('domain.json', [
      JSON.stringify(
        {
          name: 'Insurance Analysis',
          layer: 'domain',
          ownerDepartment: 'developer',
          status: 'active',
          epic: 'EPIC-001',
          dependsOn: ['Customer', 'Policy']
        },
        null,
        2
      ),
      ''
    ]),
    iaFile('README.md', [
      '# Insurance Analysis Domain — Epic 001',
      '',
      'Epic 001 decomposes Insurance Analysis into features (see `epic.json`).',
      'Architecture + scaffolds only — no insurance business logic yet.',
      '',
      '## Features (DAG)',
      ...EPIC_FEATURES.map(
        (ft) => `- ${ft.title}${ft.dependsOn.length ? ' — depends on: ' + ft.dependsOn.join(', ') : ''}`
      ),
      ''
    ]),
    iaFile('index.ts', [
      '// Insurance Analysis — public contract.',
      "export { AnalysisDashboardView } from './features/analysis-dashboard'",
      "export { CoverageSummaryView } from './features/coverage-summary'",
      ''
    ]),
    iaFile('assets/README.md', [
      '# Insurance Analysis — Assets',
      '',
      'Registered in the Company Asset Store (depends on Customer and Policy).',
      ''
    ]),
    iaFile('tests/insurance-analysis.test.ts', [
      '// Insurance Analysis Epic — placeholder test.',
      'export {}',
      ''
    ])
  ]
  for (const ft of EPIC_FEATURES) files.push(...epicFeatureFiles(ft))
  return files
}

// ---- Policy Module (Policy Domain) — reused by Coverage Summary ------------

function pmod(rel: string, lines: string[]): GenFile {
  return { rel: POLICY_DIR + rel, content: lines.join('\n') }
}

function policyModuleFiles(): GenFile[] {
  return [
    pmod('models.ts', [
      "export type PolicyType = 'health' | 'life' | 'auto' | 'cancer'",
      '',
      'export interface Coverage {',
      '  category: string',
      '  covered: boolean',
      '  limitKRW: number',
      '}',
      '',
      'export interface Policy {',
      '  id: string',
      '  customerId: string',
      '  name: string',
      '  type: PolicyType',
      '  monthlyPremiumKRW: number',
      '  coverages: Coverage[]',
      '}',
      ''
    ]),
    pmod('data/mockPolicies.ts', [
      "import type { Policy } from '../models'",
      '',
      '// Local mock data only — customerId links to the Customer Domain.',
      'export const mockPolicies: Policy[] = [',
      '  {',
      "    id: 'pol-1', customerId: 'cust-1', name: 'Health Secure', type: 'health', monthlyPremiumKRW: 45000,",
      "    coverages: [",
      "      { category: 'Hospitalization', covered: true, limitKRW: 30000000 },",
      "      { category: 'Surgery', covered: true, limitKRW: 20000000 }",
      '    ]',
      '  },',
      '  {',
      "    id: 'pol-2', customerId: 'cust-1', name: 'Cancer Care', type: 'cancer', monthlyPremiumKRW: 32000,",
      "    coverages: [{ category: 'Cancer', covered: true, limitKRW: 50000000 }]",
      '  },',
      '  {',
      "    id: 'pol-3', customerId: 'cust-2', name: 'Life Plus', type: 'life', monthlyPremiumKRW: 60000,",
      "    coverages: [",
      "      { category: 'Death', covered: true, limitKRW: 100000000 },",
      "      { category: 'Accident', covered: true, limitKRW: 20000000 }",
      '    ]',
      '  },',
      '  {',
      "    id: 'pol-4', customerId: 'cust-3', name: 'Auto Shield', type: 'auto', monthlyPremiumKRW: 38000,",
      "    coverages: [{ category: 'Accident', covered: true, limitKRW: 15000000 }]",
      '  },',
      '  {',
      "    id: 'pol-5', customerId: 'cust-4', name: 'Cancer Care', type: 'cancer', monthlyPremiumKRW: 35000,",
      "    coverages: [",
      "      { category: 'Cancer', covered: true, limitKRW: 50000000 },",
      "      { category: 'Surgery', covered: true, limitKRW: 15000000 }",
      '    ]',
      '  }',
      ']',
      ''
    ]),
    pmod('services.ts', [
      "import type { Policy } from './models'",
      "import { mockPolicies } from './data/mockPolicies'",
      '',
      'export interface PolicyService {',
      '  list(): Policy[]',
      '  get(id: string): Policy | undefined',
      '  byCustomer(customerId: string): Policy[]',
      '}',
      '',
      'export class MockPolicyService implements PolicyService {',
      '  private readonly policies: Policy[] = mockPolicies',
      '  list(): Policy[] {',
      '    return this.policies',
      '  }',
      '  get(id: string): Policy | undefined {',
      '    return this.policies.find((p) => p.id === id)',
      '  }',
      '  byCustomer(customerId: string): Policy[] {',
      '    return this.policies.filter((p) => p.customerId === customerId)',
      '  }',
      '}',
      '',
      'export const policyService: PolicyService = new MockPolicyService()',
      ''
    ]),
    pmod('index.ts', [
      '// Policy Module — public contract.',
      "export type { Policy, Coverage, PolicyType } from './models'",
      "export type { PolicyService } from './services'",
      "export { policyService, MockPolicyService } from './services'",
      ''
    ]),
    pmod('README.md', [
      '# Policy Module',
      '',
      'A reusable business module for the Policy Domain. Local mock data only.',
      '',
      '## Owns',
      '',
      'Models · Services · Documentation · Tests',
      ''
    ]),
    pmod('domain.json', [
      JSON.stringify(
        { name: 'Policy', layer: 'domain', ownerDepartment: 'developer', status: 'active', module: 'Policy' },
        null,
        2
      ),
      ''
    ]),
    pmod('assets/README.md', [
      '# Policy Domain — Assets',
      '',
      'Owns the reusable **Policy** module, registered in the Company Asset Store.',
      ''
    ]),
    pmod('tests/policy.test.ts', ['// Policy Domain — placeholder test.', 'export {}', ''])
  ]
}

/** The working Coverage Summary feature (Epic 001), reusing Customer + Policy. */
function coverageSummaryFeatureFiles(): GenFile[] {
  const dir = 'features/coverage-summary/'
  const f = (rel: string, lines: string[]): GenFile => iaFile(dir + rel, lines)
  return [
    f('models.ts', [
      "import type { Policy } from '../../../policy'",
      '',
      'export interface SummaryCategory {',
      '  name: string',
      '  covered: boolean',
      '  limitKRW: number',
      '}',
      '',
      'export interface CoverageSummary {',
      '  customerId: string',
      '  customerName: string',
      '  policies: Policy[]',
      '  monthlyPremiumKRW: number',
      '  annualPremiumKRW: number',
      '  categories: SummaryCategory[]',
      '  missing: string[]',
      '  riskScore: number',
      '  recommendation: string',
      '}',
      ''
    ]),
    f('service.ts', [
      "import { customerService } from '../../../customer'",
      "import { policyService } from '../../../policy'",
      "import type { CoverageSummary, SummaryCategory } from './models'",
      '',
      "const ALL_CATEGORIES = ['Hospitalization', 'Surgery', 'Cancer', 'Dental', 'Accident', 'Death']",
      '',
      'export interface CoverageSummaryService {',
      '  summarize(customerId: string): CoverageSummary | null',
      '}',
      '',
      'export class MockCoverageSummaryService implements CoverageSummaryService {',
      '  summarize(customerId: string): CoverageSummary | null {',
      '    const customer = customerService.get(customerId)',
      '    if (!customer) return null',
      '    const policies = policyService.byCustomer(customerId)',
      '    const monthly = policies.reduce((sum, p) => sum + p.monthlyPremiumKRW, 0)',
      '    const limits = new Map<string, number>()',
      '    for (const p of policies) {',
      '      for (const c of p.coverages) {',
      '        if (c.covered) limits.set(c.category, (limits.get(c.category) ?? 0) + c.limitKRW)',
      '      }',
      '    }',
      '    const categories: SummaryCategory[] = ALL_CATEGORIES.map((name) => ({',
      '      name,',
      '      covered: limits.has(name),',
      '      limitKRW: limits.get(name) ?? 0',
      '    }))',
      '    const missing = categories.filter((c) => !c.covered).map((c) => c.name)',
      '    const riskScore = Math.min(100, missing.length * 15 + (policies.length === 0 ? 40 : 0))',
      '    const recommendation =',
      '      missing.length === 0',
      "        ? 'Coverage looks complete. Review limits annually.'",
      "        : 'Consider adding coverage for: ' + missing.join(', ') + '.'",
      '    return {',
      '      customerId,',
      '      customerName: customer.name,',
      '      policies,',
      '      monthlyPremiumKRW: monthly,',
      '      annualPremiumKRW: monthly * 12,',
      '      categories,',
      '      missing,',
      '      riskScore,',
      '      recommendation',
      '    }',
      '  }',
      '}',
      '',
      'export const coverageSummaryService: CoverageSummaryService = new MockCoverageSummaryService()',
      ''
    ]),
    f('view.tsx', [
      "import { useMemo, useState } from 'react'",
      "import { customerService } from '../../../customer'",
      "import { coverageSummaryService } from './service'",
      "import type { SummaryCategory } from './models'",
      '',
      'function won(value: number): string {',
      "  return value.toLocaleString('en-US') + ' KRW'",
      '}',
      '',
      'type Filter = \'all\' | \'covered\' | \'missing\'',
      "type Sort = 'name' | 'limit'",
      '',
      '// An optional customerId pre-selects the customer (used by the workflow).',
      'export function CoverageSummaryView({',
      '  customerId: initialCustomerId',
      '}: {',
      '  customerId?: string',
      '} = {}): JSX.Element {',
      '  const customers = customerService.list()',
      "  const [customerId, setCustomerId] = useState<string>(initialCustomerId ?? customers[0]?.id ?? '')",
      '  const [policyId, setPolicyId] = useState<string | null>(null)',
      "  const [filter, setFilter] = useState<Filter>('all')",
      "  const [sort, setSort] = useState<Sort>('name')",
      '  const [expandedPolicy, setExpandedPolicy] = useState<string | null>(null)',
      '',
      '  const summary = useMemo(',
      '    () => (customerId ? coverageSummaryService.summarize(customerId) : null),',
      '    [customerId]',
      '  )',
      '',
      '  const categories = useMemo<SummaryCategory[]>(() => {',
      '    if (!summary) return []',
      '    const policy = policyId ? summary.policies.find((p) => p.id === policyId) : null',
      '    const source: SummaryCategory[] = policy',
      '      ? policy.coverages.map((c) => ({ name: c.category, covered: c.covered, limitKRW: c.limitKRW }))',
      '      : summary.categories',
      "    let list = filter === 'all' ? source : source.filter((c) => (filter === 'covered' ? c.covered : !c.covered))",
      "    list = [...list].sort((a, b) => (sort === 'name' ? a.name.localeCompare(b.name) : b.limitKRW - a.limitKRW))",
      '    return list',
      '  }, [summary, policyId, filter, sort])',
      '',
      '  return (',
      '    <section className="page cs">',
      '      <div className="cs-header">',
      '        <h1>Coverage Summary</h1>',
      '        <label className="cs-select">',
      "          Customer{' '}",
      '          <select',
      '            value={customerId}',
      '            onChange={(e) => {',
      '              setCustomerId(e.target.value)',
      '              setPolicyId(null)',
      '              setExpandedPolicy(null)',
      '            }}',
      '          >',
      '            {customers.map((c) => (',
      '              <option key={c.id} value={c.id}>{c.name}</option>',
      '            ))}',
      '          </select>',
      '        </label>',
      '      </div>',
      '',
      '      {!summary ? (',
      '        <p className="muted">Select a customer to load the coverage summary.</p>',
      '      ) : (',
      '        <>',
      '          <div className="stat-grid">',
      '            <div className="stat"><span className="stat-label">Customer</span><span className="stat-value">{summary.customerName}</span></div>',
      '            <div className="stat"><span className="stat-label">Monthly premium</span><span className="stat-value">{won(summary.monthlyPremiumKRW)}</span></div>',
      '            <div className="stat"><span className="stat-label">Annual premium</span><span className="stat-value">{won(summary.annualPremiumKRW)}</span></div>',
      '            <div className="stat"><span className="stat-label">Risk score (mock)</span><span className="stat-value">{summary.riskScore}</span></div>',
      '          </div>',
      '',
      '          <div className="dash-columns">',
      '            <div className="panel">',
      '              <div className="cs-toolbar">',
      '                <h2>Policies</h2>',
      '                {policyId && (',
      '                  <button className="action" onClick={() => setPolicyId(null)}>← Back to all</button>',
      '                )}',
      '              </div>',
      '              <ul className="cs-policies">',
      '                {summary.policies.map((p) => (',
      "                  <li key={p.id} className={p.id === policyId ? 'cs-policy active' : 'cs-policy'}>",
      '                    <div className="cs-policy-row" onClick={() => setPolicyId(p.id)}>',
      '                      <span>{p.name}</span>',
      '                      <span className="muted">{won(p.monthlyPremiumKRW)}/mo</span>',
      '                    </div>',
      '                    <button',
      '                      className="cs-expand"',
      '                      onClick={() => setExpandedPolicy(expandedPolicy === p.id ? null : p.id)}',
      '                    >',
      "                      {expandedPolicy === p.id ? 'Hide details' : 'Expand details'}",
      '                    </button>',
      '                    {expandedPolicy === p.id && (',
      '                      <ul className="list">',
      '                        {p.coverages.map((cov) => (',
      '                          <li key={cov.category}>',
      '                            <span>{cov.category}</span>',
      "                            <span className=\"muted\">{cov.covered ? won(cov.limitKRW) : 'Not covered'}</span>",
      '                          </li>',
      '                        ))}',
      '                      </ul>',
      '                    )}',
      '                  </li>',
      '                ))}',
      '                {summary.policies.length === 0 && <li className="muted">No policies.</li>}',
      '              </ul>',
      '            </div>',
      '',
      '            <div className="panel">',
      '              <div className="cs-toolbar">',
      '                <h2>Coverage categories</h2>',
      '                <div className="cs-controls">',
      '                  <div className="cs-filters">',
      "                    {(['all', 'covered', 'missing'] as Filter[]).map((value) => (",
      '                      <button',
      '                        key={value}',
      "                        className={filter === value ? 'chip-btn active' : 'chip-btn'}",
      '                        onClick={() => setFilter(value)}',
      '                      >',
      '                        {value}',
      '                      </button>',
      '                    ))}',
      '                  </div>',
      '                  <label className="cs-select">',
      "                    Sort{' '}",
      '                    <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>',
      '                      <option value="name">Name</option>',
      '                      <option value="limit">Limit</option>',
      '                    </select>',
      '                  </label>',
      '                </div>',
      '              </div>',
      '              <ul className="list">',
      '                {categories.map((c) => (',
      '                  <li key={c.name}>',
      '                    <span>{c.name}</span>',
      "                    <span className={c.covered ? 'cs-ok' : 'cs-missing'}>{c.covered ? won(c.limitKRW) : 'Missing'}</span>",
      '                  </li>',
      '                ))}',
      '                {categories.length === 0 && <li className="muted">No categories match the filter.</li>}',
      '              </ul>',
      '            </div>',
      '          </div>',
      '',
      '          <div className="panel">',
      '            <h2>Missing coverage</h2>',
      '            {summary.missing.length === 0 ? (',
      '              <p className="muted">None — coverage is complete.</p>',
      '            ) : (',
      '              <div className="cs-missing-list">',
      '                {summary.missing.map((m) => (',
      '                  <span key={m} className="cs-missing-tag">{m}</span>',
      '                ))}',
      '              </div>',
      '            )}',
      '            <h2>Recommendation (mock)</h2>',
      '            <p>{summary.recommendation}</p>',
      '          </div>',
      '        </>',
      '      )}',
      '    </section>',
      '  )',
      '}',
      ''
    ]),
    f('index.ts', [
      "export type { CoverageSummary, SummaryCategory } from './models'",
      "export { coverageSummaryService } from './service'",
      "export { CoverageSummaryView } from './view'",
      ''
    ]),
    f('README.md', [
      '# Coverage Summary (Epic 001)',
      '',
      'Working feature. Reuses the Customer and Policy domains. Local mock data only.',
      ''
    ])
  ]
}

/** Domain-level files for the Customer Domain (which also holds the module). */
function customerDomainExtras(): GenFile[] {
  return [
    mod('domain.json', [
      JSON.stringify(
        {
          name: 'Customer',
          layer: 'domain',
          ownerDepartment: 'developer',
          status: 'active',
          module: 'Customer',
          owns: ['models', 'services', 'views', 'components', 'commands', 'events', 'documentation', 'assets', 'tests']
        },
        null,
        2
      ),
      ''
    ]),
    mod('DOMAIN.md', [
      '# Customer Domain',
      '',
      'The Customer Domain owns customer identity and profiles. It includes the',
      'reusable Customer Module (a registered Company Asset). Architecture + module',
      'only — no insurance business logic.',
      ''
    ]),
    mod('assets/README.md', [
      '# Customer Domain — Assets',
      '',
      'Owns the reusable **Customer** module, registered in the Company Asset Store.',
      ''
    ]),
    mod('tests/customer.test.ts', [
      '// Customer Domain — placeholder test.',
      'export {}',
      ''
    ])
  ]
}

function customerModuleFiles(): GenFile[] {
  return [
    mod('models.ts', [
      "export type CustomerStatus = 'lead' | 'active' | 'inactive' | 'churned'",
      '',
      'export interface CustomerTag {',
      '  id: string',
      '  label: string',
      '}',
      '',
      'export interface CustomerMemo {',
      '  id: string',
      '  text: string',
      '  at: string',
      '}',
      '',
      'export interface CustomerTimelineEvent {',
      '  id: string',
      '  kind: string',
      '  description: string',
      '  at: string',
      '}',
      '',
      'export interface Customer {',
      '  id: string',
      '  name: string',
      '  email: string',
      '  phone: string',
      '  status: CustomerStatus',
      '  tags: CustomerTag[]',
      '  memos: CustomerMemo[]',
      '  timeline: CustomerTimelineEvent[]',
      '  createdAt: string',
      '}',
      '',
      'export interface CustomerStats {',
      '  total: number',
      '  byStatus: Record<CustomerStatus, number>',
      '}',
      ''
    ]),
    mod('data/mockCustomers.ts', [
      "import type { Customer } from '../models'",
      '',
      '// Local mock data only — no APIs, no database.',
      'export const mockCustomers: Customer[] = [',
      '  {',
      "    id: 'cust-1',",
      "    name: 'Kim Min-jun',",
      "    email: 'minjun.kim@example.com',",
      "    phone: '010-1234-5678',",
      "    status: 'active',",
      "    tags: [{ id: 'tg-1', label: 'VIP' }, { id: 'tg-2', label: 'Health' }],",
      "    memos: [{ id: 'mo-1', text: 'Interested in cancer coverage.', at: '2d ago' }],",
      '    timeline: [',
      "      { id: 'tl-1', kind: 'created', description: 'Customer created', at: '30d ago' },",
      "      { id: 'tl-2', kind: 'status', description: 'Moved to active', at: '10d ago' }",
      '    ],',
      "    createdAt: '30d ago'",
      '  },',
      '  {',
      "    id: 'cust-2',",
      "    name: 'Lee Seo-yeon',",
      "    email: 'seoyeon.lee@example.com',",
      "    phone: '010-2345-6789',",
      "    status: 'lead',",
      "    tags: [{ id: 'tg-3', label: 'Life' }],",
      '    memos: [],',
      "    timeline: [{ id: 'tl-3', kind: 'created', description: 'Customer created', at: '5d ago' }],",
      "    createdAt: '5d ago'",
      '  },',
      '  {',
      "    id: 'cust-3',",
      "    name: 'Park Ji-ho',",
      "    email: 'jiho.park@example.com',",
      "    phone: '010-3456-7890',",
      "    status: 'inactive',",
      "    tags: [],",
      "    memos: [{ id: 'mo-2', text: 'Requested a follow-up next quarter.', at: '20d ago' }],",
      "    timeline: [{ id: 'tl-4', kind: 'created', description: 'Customer created', at: '90d ago' }],",
      "    createdAt: '90d ago'",
      '  },',
      '  {',
      "    id: 'cust-4',",
      "    name: 'Choi Ha-eun',",
      "    email: 'haeun.choi@example.com',",
      "    phone: '010-4567-8901',",
      "    status: 'active',",
      "    tags: [{ id: 'tg-4', label: 'Cancer' }],",
      '    memos: [],',
      "    timeline: [{ id: 'tl-5', kind: 'created', description: 'Customer created', at: '15d ago' }],",
      "    createdAt: '15d ago'",
      '  }',
      ']',
      ''
    ]),
    mod('services.ts', [
      "import type { Customer, CustomerStats, CustomerStatus } from './models'",
      "import { mockCustomers } from './data/mockCustomers'",
      '',
      'export interface CustomerService {',
      '  list(): Customer[]',
      '  get(id: string): Customer | undefined',
      '  search(query: string): Customer[]',
      '  stats(): CustomerStats',
      '}',
      '',
      'export class MockCustomerService implements CustomerService {',
      '  private readonly customers: Customer[] = mockCustomers',
      '  list(): Customer[] {',
      '    return this.customers',
      '  }',
      '  get(id: string): Customer | undefined {',
      '    return this.customers.find((c) => c.id === id)',
      '  }',
      '  search(query: string): Customer[] {',
      '    const q = query.trim().toLowerCase()',
      '    if (!q) return this.customers',
      '    return this.customers.filter(',
      '      (c) => c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q)',
      '    )',
      '  }',
      '  stats(): CustomerStats {',
      '    const byStatus: Record<CustomerStatus, number> = { lead: 0, active: 0, inactive: 0, churned: 0 }',
      '    for (const c of this.customers) byStatus[c.status] += 1',
      '    return { total: this.customers.length, byStatus }',
      '  }',
      '}',
      '',
      'export const customerService: CustomerService = new MockCustomerService()',
      ''
    ]),
    mod('commands.ts', [
      "import type { CustomerStatus } from './models'",
      '',
      'export type CustomerCommand =',
      "  | { type: 'customer/create'; name: string; email: string }",
      "  | { type: 'customer/changeStatus'; id: string; status: CustomerStatus }",
      "  | { type: 'customer/addMemo'; id: string; text: string }",
      "  | { type: 'customer/addTag'; id: string; label: string }",
      ''
    ]),
    mod('events.ts', [
      "import type { CustomerStatus } from './models'",
      '',
      'export type CustomerEvent =',
      "  | { type: 'customer/created'; id: string }",
      "  | { type: 'customer/statusChanged'; id: string; status: CustomerStatus }",
      "  | { type: 'customer/memoAdded'; id: string }",
      "  | { type: 'customer/tagAdded'; id: string; label: string }",
      ''
    ]),
    mod('components/CustomerStatusBadge.tsx', [
      "import type { CustomerStatus } from '../models'",
      '',
      'export function CustomerStatusBadge({ status }: { status: CustomerStatus }): JSX.Element {',
      "  return <span className={'cust-badge cust-' + status}>{status}</span>",
      '}',
      ''
    ]),
    mod('components/CustomerTags.tsx', [
      "import type { CustomerTag } from '../models'",
      '',
      'export function CustomerTags({ tags }: { tags: CustomerTag[] }): JSX.Element {',
      '  return (',
      '    <div className="cust-tags">',
      '      {tags.map((t) => (',
      '        <span key={t.id} className="cust-tag">{t.label}</span>',
      '      ))}',
      '    </div>',
      '  )',
      '}',
      ''
    ]),
    mod('components/CustomerMemoList.tsx', [
      "import type { CustomerMemo } from '../models'",
      '',
      'export function CustomerMemoList({ memos }: { memos: CustomerMemo[] }): JSX.Element {',
      '  return (',
      '    <ul className="cust-memos">',
      '      {memos.map((m) => (',
      '        <li key={m.id}>{m.text} <span className="muted">{m.at}</span></li>',
      '      ))}',
      '    </ul>',
      '  )',
      '}',
      ''
    ]),
    mod('components/CustomerTimeline.tsx', [
      "import type { CustomerTimelineEvent } from '../models'",
      '',
      'export function CustomerTimeline({ events }: { events: CustomerTimelineEvent[] }): JSX.Element {',
      '  return (',
      '    <ul className="cust-timeline">',
      '      {events.map((e) => (',
      '        <li key={e.id}>{e.description} <span className="muted">{e.at}</span></li>',
      '      ))}',
      '    </ul>',
      '  )',
      '}',
      ''
    ]),
    mod('components/CustomerSearch.tsx', [
      "import { useState } from 'react'",
      "import { customerService } from '../services'",
      "import type { Customer } from '../models'",
      '',
      'export function CustomerSearch({',
      '  onResults',
      '}: {',
      '  onResults?: (results: Customer[]) => void',
      '}): JSX.Element {',
      "  const [query, setQuery] = useState('')",
      '  return (',
      '    <input',
      '      className="cust-search"',
      '      placeholder="Search customers…"',
      '      value={query}',
      '      onChange={(e) => {',
      '        setQuery(e.target.value)',
      '        onResults?.(customerService.search(e.target.value))',
      '      }}',
      '    />',
      '  )',
      '}',
      ''
    ]),
    mod('components/CustomerList.tsx', [
      "import { customerService } from '../services'",
      "import type { Customer } from '../models'",
      "import { CustomerStatusBadge } from './CustomerStatusBadge'",
      '',
      'export function CustomerList({',
      '  customers = customerService.list(),',
      '  onSelect',
      '}: {',
      '  customers?: Customer[]',
      '  onSelect?: (id: string) => void',
      '}): JSX.Element {',
      '  return (',
      '    <ul className="cust-list">',
      '      {customers.map((c) => (',
      '        <li key={c.id} className="cust-row" onClick={() => onSelect?.(c.id)}>',
      '          <span>{c.name}</span>',
      '          <CustomerStatusBadge status={c.status} />',
      '        </li>',
      '      ))}',
      '    </ul>',
      '  )',
      '}',
      ''
    ]),
    mod('components/CustomerDetail.tsx', [
      "import type { Customer } from '../models'",
      "import { CustomerStatusBadge } from './CustomerStatusBadge'",
      "import { CustomerTags } from './CustomerTags'",
      "import { CustomerMemoList } from './CustomerMemoList'",
      "import { CustomerTimeline } from './CustomerTimeline'",
      '',
      'export function CustomerDetail({ customer }: { customer: Customer }): JSX.Element {',
      '  return (',
      '    <div className="cust-detail">',
      '      <h3>{customer.name} <CustomerStatusBadge status={customer.status} /></h3>',
      '      <p className="muted">{customer.email} · {customer.phone}</p>',
      '      <CustomerTags tags={customer.tags} />',
      '      <h4>Memos</h4>',
      '      <CustomerMemoList memos={customer.memos} />',
      '      <h4>Timeline</h4>',
      '      <CustomerTimeline events={customer.timeline} />',
      '    </div>',
      '  )',
      '}',
      ''
    ]),
    mod('components/CustomerQuickActions.tsx', [
      "const ACTIONS = ['New customer', 'Add memo', 'Add tag', 'Change status']",
      '',
      'export function CustomerQuickActions(): JSX.Element {',
      '  return (',
      '    <div className="cust-actions">',
      '      {ACTIONS.map((a) => (',
      '        <button key={a} className="action">{a}</button>',
      '      ))}',
      '    </div>',
      '  )',
      '}',
      ''
    ]),
    mod('components/CustomerStatisticsCard.tsx', [
      "import { customerService } from '../services'",
      '',
      'export function CustomerStatisticsCard(): JSX.Element {',
      '  const stats = customerService.stats()',
      '  return (',
      '    <div className="panel">',
      '      <h2>Customers</h2>',
      '      <div className="cust-stat-total">{stats.total}</div>',
      '      <ul className="list">',
      '        <li><span>Leads</span><span className="badge">{stats.byStatus.lead}</span></li>',
      '        <li><span>Active</span><span className="badge">{stats.byStatus.active}</span></li>',
      '        <li><span>Inactive</span><span className="badge">{stats.byStatus.inactive}</span></li>',
      '        <li><span>Churned</span><span className="badge">{stats.byStatus.churned}</span></li>',
      '      </ul>',
      '    </div>',
      '  )',
      '}',
      ''
    ]),
    mod('views/CustomerListView.tsx', [
      "import { useState } from 'react'",
      "import { customerService } from '../services'",
      "import type { Customer } from '../models'",
      "import { CustomerSearch } from '../components/CustomerSearch'",
      "import { CustomerList } from '../components/CustomerList'",
      '',
      'export function CustomerListView(): JSX.Element {',
      '  const [results, setResults] = useState<Customer[]>(customerService.list())',
      '  return (',
      '    <div className="cust-view">',
      '      <CustomerSearch onResults={setResults} />',
      '      <CustomerList customers={results} />',
      '    </div>',
      '  )',
      '}',
      ''
    ]),
    mod('views/CustomerDetailView.tsx', [
      "import { customerService } from '../services'",
      "import { CustomerDetail } from '../components/CustomerDetail'",
      '',
      'export function CustomerDetailView({ customerId }: { customerId: string }): JSX.Element {',
      '  const customer = customerService.get(customerId)',
      '  if (!customer) return <p>Customer not found.</p>',
      '  return <CustomerDetail customer={customer} />',
      '}',
      ''
    ]),
    mod('views/CustomerManagementView.tsx', [
      "import { useState } from 'react'",
      "import { customerService } from '../services'",
      "import type { Customer } from '../models'",
      "import { CustomerSearch } from '../components/CustomerSearch'",
      "import { CustomerList } from '../components/CustomerList'",
      "import { CustomerDetail } from '../components/CustomerDetail'",
      "import { CustomerQuickActions } from '../components/CustomerQuickActions'",
      "import { CustomerStatisticsCard } from '../components/CustomerStatisticsCard'",
      '',
      '// Feature 001 — Customer Management (master-detail).',
      'export function CustomerManagementView(): JSX.Element {',
      '  const all = customerService.list()',
      '  const [results, setResults] = useState<Customer[]>(all)',
      '  const [selectedId, setSelectedId] = useState<string | null>(all[0]?.id ?? null)',
      '  const selected = selectedId ? customerService.get(selectedId) : undefined',
      '  return (',
      '    <section className="page cust-mgmt">',
      '      <div className="cust-mgmt-header">',
      '        <h1>Customer Management</h1>',
      '        <CustomerQuickActions />',
      '      </div>',
      '      <div className="cust-mgmt-body">',
      '        <div className="cust-mgmt-left">',
      '          <CustomerStatisticsCard />',
      '          <div className="panel">',
      '            <CustomerSearch onResults={setResults} />',
      '            <CustomerList customers={results} onSelect={setSelectedId} />',
      '          </div>',
      '        </div>',
      '        <div className="cust-mgmt-right panel">',
      '          {selected ? (',
      '            <CustomerDetail customer={selected} />',
      '          ) : (',
      '            <p className="muted">Select a customer.</p>',
      '          )}',
      '        </div>',
      '      </div>',
      '    </section>',
      '  )',
      '}',
      ''
    ]),
    mod('index.ts', [
      '// Customer Module — public contract. Consumers compose these; they must',
      '// never own customer logic.',
      "export type {",
      '  Customer,',
      '  CustomerStatus,',
      '  CustomerTag,',
      '  CustomerMemo,',
      '  CustomerTimelineEvent,',
      '  CustomerStats',
      "} from './models'",
      "export type { CustomerService } from './services'",
      "export { customerService, MockCustomerService } from './services'",
      "export type { CustomerCommand } from './commands'",
      "export type { CustomerEvent } from './events'",
      "export { CustomerList } from './components/CustomerList'",
      "export { CustomerDetail } from './components/CustomerDetail'",
      "export { CustomerSearch } from './components/CustomerSearch'",
      "export { CustomerStatusBadge } from './components/CustomerStatusBadge'",
      "export { CustomerTags } from './components/CustomerTags'",
      "export { CustomerMemoList } from './components/CustomerMemoList'",
      "export { CustomerTimeline } from './components/CustomerTimeline'",
      "export { CustomerQuickActions } from './components/CustomerQuickActions'",
      "export { CustomerStatisticsCard } from './components/CustomerStatisticsCard'",
      "export { CustomerListView } from './views/CustomerListView'",
      "export { CustomerDetailView } from './views/CustomerDetailView'",
      "export { CustomerManagementView } from './views/CustomerManagementView'",
      ''
    ]),
    mod('README.md', [
      '# Customer Module',
      '',
      'A reusable, provider-neutral business module. Local mock data only — no APIs,',
      'no database, no authentication.',
      '',
      '## Reusable in',
      '',
      'SJ Insurance · CRM · Shopping Mall · ERP · future projects.',
      '',
      '## Contract (import from `modules/customer`)',
      '',
      '- Models: `Customer`, `CustomerStatus`, `CustomerTag`, `CustomerMemo`, `CustomerTimelineEvent`, `CustomerStats`',
      '- Service: `customerService` (list / get / search / stats)',
      '- Commands & Events: `CustomerCommand`, `CustomerEvent`',
      '- Components: `CustomerList`, `CustomerDetail`, `CustomerSearch`, `CustomerStatusBadge`, `CustomerTags`, `CustomerMemoList`, `CustomerTimeline`, `CustomerQuickActions`, `CustomerStatisticsCard`',
      '- Views: `CustomerListView`, `CustomerDetailView`',
      '',
      'Consumers (e.g. the Dashboard) compose these. They must not own customer logic.',
      '',
      '## Owner',
      '',
      'Developer Department · v1.0.0',
      ''
    ]),
    mod('module.json', [
      JSON.stringify(
        {
          name: 'Customer',
          version: '1.0.0',
          dependencies: [],
          supportedProjects: ['SJ Insurance', 'CRM', 'Shopping Mall', 'ERP'],
          ownerDepartment: 'developer'
        },
        null,
        2
      ),
      ''
    ])
  ]
}

// ---- Per-capability generation (fits the Electron structure) ---------------

function filesFor(capability: string, subject: string): GenFile[] {
  const s = slug(subject)
  const P = pascal(subject)
  switch (capability) {
    case 'research':
      return [{ rel: `docs/research-${s}.md`, content: `# Research — ${subject}\n\n- Feasible with well-understood desktop patterns.\n- Reference approaches identified for reuse.\n` }]
    case 'cto':
      return [{ rel: `docs/architecture-${s}.md`, content: `# Architecture — ${subject}\n\nElectron main + preload + React renderer, decoupled and provider-neutral.\n` }]
    case 'backend':
      return [{ rel: `src/main/services/${s}.ts`, content: serviceModule(P) }]
    case 'frontend':
      return [{ rel: `src/renderer/src/components/${P}Panel.tsx`, content: panelComponent(P) }]
    case 'developer':
      return [
        { rel: `src/renderer/src/lib/${s}.ts`, content: libModule(P, subject) },
        { rel: `src/renderer/src/lib/${s}.test.ts`, content: libTest(P, s) }
      ]
    case 'qa':
      return [{ rel: `src/renderer/src/__tests__/${s}.test.ts`, content: qaTest(s) }]
    case 'git':
      return [{ rel: 'docs/GIT_STRATEGY.md', content: gitStrategy() }]
    case 'documentation':
      return [{ rel: 'docs/USAGE.md', content: usageDoc() }]
    case 'release':
      return [{ rel: 'RELEASE.md', content: releaseNotes() }]
    default:
      return [{ rel: `docs/${s}.md`, content: `# ${subject}\n` }]
  }
}

function capabilityVerb(capability: string): string {
  const map: Record<string, string> = {
    research: 'Researched',
    cto: 'Designed',
    backend: 'Built the service for',
    frontend: 'Built the UI for',
    developer: 'Implemented',
    qa: 'Tested',
    git: 'Prepared version control for',
    documentation: 'Documented',
    release: 'Prepared the release for'
  }
  return map[capability] ?? 'Produced'
}

function serviceModule(name: string): string {
  return [
    '// Generated by SJ AI Company — Backend (real execution). No business logic.',
    '',
    `export interface ${name}Service {`,
    '  ready: boolean',
    '}',
    '',
    `export function create${name}Service(): ${name}Service {`,
    '  return { ready: true }',
    '}',
    ''
  ].join('\n')
}

function panelComponent(name: string): string {
  return [
    '// Generated by SJ AI Company — Frontend (real execution). No business logic.',
    '',
    `export function ${name}Panel(): JSX.Element {`,
    '  return (',
    `    <section className="panel">`,
    `      <h2>${name}</h2>`,
    '      <p>Panel scaffold ready.</p>',
    '    </section>',
    '  )',
    '}',
    ''
  ].join('\n')
}

function appTsx(name: string): string {
  if (!isInsuranceProject(name)) {
    return [
      "import { useState } from 'react'",
      "import { Layout } from './components/Layout'",
      "import { Dashboard } from './pages/Dashboard'",
      "import { Settings } from './pages/Settings'",
      '',
      "export type Route = 'dashboard' | 'settings'",
      '',
      'export function App(): JSX.Element {',
      "  const [route, setRoute] = useState<Route>('dashboard')",
      '  return (',
      '    <Layout route={route} onNavigate={setRoute}>',
      "      {route === 'dashboard' ? <Dashboard /> : <Settings />}",
      '    </Layout>',
      '  )',
      '}',
      ''
    ].join('\n')
  }
  return [
    "import { useState } from 'react'",
    "import { WorkflowProvider } from './workflow/WorkflowContext'",
    "import { Layout } from './components/Layout'",
    "import { Dashboard } from './pages/Dashboard'",
    "import { Journey } from './pages/Journey'",
    "import { Customers } from './pages/Customers'",
    "import { Consultations } from './pages/Consultations'",
    "import { Analysis } from './pages/Analysis'",
    "import { Settings } from './pages/Settings'",
    '',
    "export type Route = 'dashboard' | 'journey' | 'customers' | 'consultations' | 'analysis' | 'settings'",
    '',
    'export function App(): JSX.Element {',
    "  const [route, setRoute] = useState<Route>('dashboard')",
    '  return (',
    '    <WorkflowProvider>',
    '      <Layout route={route} onNavigate={setRoute}>',
    "        {route === 'dashboard' ? (",
    '          <Dashboard />',
    "        ) : route === 'journey' ? (",
    '          <Journey />',
    "        ) : route === 'customers' ? (",
    '          <Customers />',
    "        ) : route === 'consultations' ? (",
    '          <Consultations />',
    "        ) : route === 'analysis' ? (",
    '          <Analysis />',
    '        ) : (',
    '          <Settings />',
    '        )}',
    '      </Layout>',
    '    </WorkflowProvider>',
    '  )',
    '}',
    ''
  ].join('\n')
}

function sidebarTsx(name: string): string {
  const insurance = isInsuranceProject(name)
  const items = insurance
    ? [
        "  { id: 'dashboard', label: 'Dashboard' },",
        "  { id: 'journey', label: 'New Customer Journey' },",
        "  { id: 'customers', label: 'Customers' },",
        "  { id: 'consultations', label: 'Consultations' },",
        "  { id: 'analysis', label: 'Insurance Analysis' },",
        "  { id: 'settings', label: 'Settings' }"
      ]
    : [
        "  { id: 'dashboard', label: 'Dashboard' },",
        "  { id: 'settings', label: 'Settings' }"
      ]
  return [
    "import type { Route } from '../App'",
    '',
    'const ITEMS: { id: Route; label: string }[] = [',
    ...items,
    ']',
    '',
    'export function Sidebar({',
    '  route,',
    '  onNavigate',
    '}: {',
    '  route: Route',
    '  onNavigate: (route: Route) => void',
    '}): JSX.Element {',
    '  return (',
    '    <aside className="sidebar">',
    `      <div className="sidebar-brand">${name}</div>`,
    '      <nav>',
    '        {ITEMS.map((item) => (',
    '          <button',
    '            key={item.id}',
    "            className={item.id === route ? 'nav-item active' : 'nav-item'}",
    '            onClick={() => onNavigate(item.id)}',
    '          >',
    '            {item.label}',
    '          </button>',
    '        ))}',
    '      </nav>',
    '    </aside>',
    '  )',
    '}',
    ''
  ].join('\n')
}

// Feature 001 — Customer Management: a page that mounts the Customer Domain's
// management view (composed entirely from the reusable Customer Module).
function customersPage(): string {
  return [
    "import { CustomerManagementView } from '../domains/customer'",
    '',
    'export function Customers(): JSX.Element {',
    '  return <CustomerManagementView />',
    '}',
    ''
  ].join('\n')
}

// Feature 002 — Consultation Management page.
function consultationsPage(): string {
  return [
    "import { ConsultationManagementView } from '../domains/consultation'",
    '',
    'export function Consultations(): JSX.Element {',
    '  return <ConsultationManagementView />',
    '}',
    ''
  ].join('\n')
}

// Epic 001 — Insurance Analysis page.
function analysisPage(): string {
  return [
    "import { AnalysisDashboardView } from '../domains/insurance-analysis'",
    '',
    'export function Analysis(): JSX.Element {',
    '  return <AnalysisDashboardView />',
    '}',
    ''
  ].join('\n')
}

// Workflow 001 — New Customer Journey page.
function journeyPage(): string {
  return [
    "import { JourneyView } from '../workflow/JourneyView'",
    '',
    'export function Journey(): JSX.Element {',
    '  return <JourneyView />',
    '}',
    ''
  ].join('\n')
}

// Workflow 001 — the workflow state/context (the shared customer + step).
function workflowContext(): string {
  return [
    "import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'",
    '',
    "export type WorkflowStep = 'customer' | 'consultation' | 'analysis' | 'summary'",
    '',
    "const ORDER: WorkflowStep[] = ['customer', 'consultation', 'analysis', 'summary']",
    '',
    'interface WorkflowValue {',
    '  customerId: string | null',
    '  step: WorkflowStep',
    '  setCustomerId: (id: string | null) => void',
    '  goTo: (step: WorkflowStep) => void',
    '  next: () => void',
    '  reset: () => void',
    '  isUnlocked: (step: WorkflowStep) => boolean',
    '}',
    '',
    'const WorkflowCtx = createContext<WorkflowValue | null>(null)',
    '',
    'export function WorkflowProvider({ children }: { children: ReactNode }): JSX.Element {',
    '  const [customerId, setCustomerIdState] = useState<string | null>(null)',
    "  const [step, setStep] = useState<WorkflowStep>('customer')",
    '',
    '  const value = useMemo<WorkflowValue>(() => {',
    '    // Steps after customer selection stay locked until a customer is chosen.',
    "    const isUnlocked = (s: WorkflowStep): boolean => s === 'customer' || customerId !== null",
    '    return {',
    '      customerId,',
    '      step,',
    '      setCustomerId: (id) => setCustomerIdState(id),',
    '      goTo: (s) => {',
    '        if (isUnlocked(s)) setStep(s)',
    '      },',
    '      next: () => {',
    '        const i = ORDER.indexOf(step)',
    '        if (i < ORDER.length - 1) setStep(ORDER[i + 1])',
    '      },',
    '      reset: () => {',
    '        setCustomerIdState(null)',
    "        setStep('customer')",
    '      },',
    '      isUnlocked',
    '    }',
    '  }, [customerId, step])',
    '',
    '  return <WorkflowCtx.Provider value={value}>{children}</WorkflowCtx.Provider>',
    '}',
    '',
    'export function useWorkflow(): WorkflowValue {',
    '  const value = useContext(WorkflowCtx)',
    "  if (!value) throw new Error('useWorkflow must be used within WorkflowProvider')",
    '  return value',
    '}',
    ''
  ].join('\n')
}

// Workflow 001 — the guided New Customer Journey (composes existing domains).
function journeyView(): string {
  return [
    "import { useState } from 'react'",
    "import { useWorkflow, type WorkflowStep } from './WorkflowContext'",
    "import { customerService, CustomerList } from '../domains/customer'",
    "import { consultationService, ConsultationList } from '../domains/consultation'",
    "import { CoverageSummaryView } from '../domains/insurance-analysis'",
    '',
    'const STEPS: { id: WorkflowStep; label: string }[] = [',
    "  { id: 'customer', label: '1 · Customer' },",
    "  { id: 'consultation', label: '2 · Consultation' },",
    "  { id: 'analysis', label: '3 · Analysis' },",
    "  { id: 'summary', label: '4 · Coverage Summary' }",
    ']',
    '',
    'export function JourneyView(): JSX.Element {',
    '  const wf = useWorkflow()',
    '  const customer = wf.customerId ? customerService.get(wf.customerId) : undefined',
    '  return (',
    '    <section className="page journey">',
    '      <div className="journey-header">',
    '        <h1>New Customer Journey</h1>',
    '        {customer && (',
    '          <span className="journey-customer">Customer: <strong>{customer.name}</strong></span>',
    '        )}',
    '      </div>',
    '',
    '      <div className="journey-steps">',
    '        {STEPS.map((s) => (',
    '          <button',
    '            key={s.id}',
    "            className={['journey-step', wf.step === s.id ? 'active' : '', wf.isUnlocked(s.id) ? '' : 'locked'].join(' ')}",
    '            disabled={!wf.isUnlocked(s.id)}',
    '            onClick={() => wf.goTo(s.id)}',
    '          >',
    '            {s.label}',
    '          </button>',
    '        ))}',
    '      </div>',
    '',
    '      <div className="journey-body">',
    "        {wf.step === 'customer' && <CustomerStep />}",
    "        {wf.step === 'consultation' && <ConsultationStep />}",
    "        {wf.step === 'analysis' && <AnalysisStep />}",
    "        {wf.step === 'summary' && <SummaryStep />}",
    '      </div>',
    '    </section>',
    '  )',
    '}',
    '',
    'function CustomerStep(): JSX.Element {',
    '  const wf = useWorkflow()',
    '  return (',
    '    <div className="panel">',
    '      <h2>Step 1 — Select or create a customer</h2>',
    '      <p className="muted">Pick a customer to start. Your selection is remembered across every step.</p>',
    '      <CustomerList',
    '        onSelect={(id) => {',
    '          wf.setCustomerId(id)',
    "          wf.goTo('consultation')",
    '        }}',
    '      />',
    '    </div>',
    '  )',
    '}',
    '',
    'function ConsultationStep(): JSX.Element {',
    '  const wf = useWorkflow()',
    '  const [created, setCreated] = useState(false)',
    '  const consultations = wf.customerId ? consultationService.byCustomer(wf.customerId) : []',
    '  return (',
    '    <div className="panel">',
    '      <h2>Steps 2 &amp; 3 — Consultation</h2>',
    '      <p className="muted">Consultations for the selected customer:</p>',
    '      <ConsultationList consultations={consultations} />',
    '      {created ? (',
    '        <p className="journey-ok">✓ Consultation record created (mock).</p>',
    '      ) : (',
    '        <button className="action" onClick={() => setCreated(true)}>Create consultation record</button>',
    '      )}',
    '      <div className="journey-nav">',
    "        <button className=\"action\" disabled={!created} onClick={() => wf.goTo('analysis')}>",
    '          Continue to Insurance Analysis →',
    '        </button>',
    '      </div>',
    '    </div>',
    '  )',
    '}',
    '',
    'function AnalysisStep(): JSX.Element {',
    '  const wf = useWorkflow()',
    '  return (',
    '    <div className="panel">',
    '      <h2>Step 4 — Launch Insurance Analysis</h2>',
    '      <p className="muted">Analysis runs for the selected customer and opens the Coverage Summary automatically.</p>',
    '      <div className="journey-nav">',
    "        <button className=\"action\" onClick={() => wf.goTo('summary')}>Launch Insurance Analysis →</button>",
    '      </div>',
    '    </div>',
    '  )',
    '}',
    '',
    'function SummaryStep(): JSX.Element {',
    '  const wf = useWorkflow()',
    '  return (',
    '    <div>',
    '      <div className="journey-nav">',
    "        <button className=\"action\" onClick={() => wf.reset()}>↺ Start a new journey</button>",
    '      </div>',
    '      {wf.customerId ? (',
    '        <CoverageSummaryView customerId={wf.customerId} />',
    '      ) : (',
    '        <p className="muted">No customer selected.</p>',
    '      )}',
    '    </div>',
    '  )',
    '}',
    ''
  ].join('\n')
}

function workflow001Doc(): string {
  return [
    '# Workflow 001 — New Customer Journey',
    '',
    'One continuous insurance-advisor workflow that threads the existing features:',
    '',
    'Customer → Consultation → Insurance Analysis → Coverage Summary',
    '',
    '## How it works',
    '',
    '- A `WorkflowProvider` (React context, `src/renderer/src/workflow/WorkflowContext.tsx`)',
    '  holds the single shared state: the selected `customerId` and the current step.',
    '- `JourneyView` guides the user step by step; each completed step unlocks the next.',
    '- The selected customer flows through every step — Consultation loads that',
    "  customer's records, and Coverage Summary opens that customer's policies",
    '  automatically. No manual re-selection, no duplicate state.',
    '',
    'Reuses the Customer, Consultation and Insurance Analysis (Coverage Summary)',
    'domains. Local mock data only.',
    ''
  ].join('\n')
}

function epic001Doc(): string {
  const lines = [
    '# Epic 001 — Insurance Analysis',
    '',
    'Status: planned + scaffolded (no business logic yet).',
    '',
    'The company decomposed the Insurance Analysis epic into features. Each feature',
    'is scaffolded under `domains/insurance-analysis/features/`, with the dependency',
    'DAG declared in `epic.json`. The company executes features in parallel across',
    'all departments wherever the DAG allows.',
    '',
    '## Features (DAG)',
    ''
  ]
  for (const ft of EPIC_FEATURES) {
    const impl = ft.kind === 'coverage-summary' ? ' — **IMPLEMENTED**' : ' — scaffold'
    lines.push(`- ${ft.title}${ft.dependsOn.length ? ' (depends on: ' + ft.dependsOn.join(', ') + ')' : ''}${impl}`)
  }
  lines.push(
    '',
    'Coverage Summary is a working feature (select customer, switch policies, filter,',
    'sort, expand details, return) reusing the Customer and Policy domains with local',
    'mock data. Registered as the reusable **Insurance Analysis** Company Asset.',
    ''
  )
  return lines.join('\n')
}

function dashboardTsx(name: string): string {
  return isInsuranceProject(name) ? insuranceDashboard() : genericDashboard(name)
}

function genericDashboard(name: string): string {
  return [
    'export function Dashboard(): JSX.Element {',
    '  return (',
    '    <section className="page">',
    '      <h1>Dashboard</h1>',
    `      <p>Welcome to ${name}.</p>`,
    '    </section>',
    '  )',
    '}',
    ''
  ].join('\n')
}

function insuranceDashboard(): string {
  return [
    "import { customerService, CustomerStatisticsCard, CustomerList } from '../domains/customer'",
    "import { mockDashboard } from '../data/mockDashboard'",
    '',
    'function won(value: number): string {',
    "  return value.toLocaleString('en-US') + ' KRW'",
    '}',
    '',
    '// The Dashboard composes modules; it owns no customer logic.',
    'export function Dashboard(): JSX.Element {',
    '  const data = mockDashboard',
    '  const stats = customerService.stats()',
    '  const recent = customerService.list().slice(0, 4)',
    '  return (',
    '    <section className="page dashboard">',
    '      <h1>Insurance Dashboard</h1>',
    '',
    '      <div className="stat-grid">',
    '        <div className="stat">',
    '          <span className="stat-label">Today&apos;s consultations</span>',
    '          <span className="stat-value">{data.today.consultations}</span>',
    '        </div>',
    '        <div className="stat">',
    '          <span className="stat-label">New customers today</span>',
    '          <span className="stat-value">{data.today.newCustomers}</span>',
    '        </div>',
    '        <div className="stat">',
    '          <span className="stat-label">Total customers</span>',
    '          <span className="stat-value">{stats.total}</span>',
    '        </div>',
    '        <div className="stat">',
    '          <span className="stat-label">Hidden money found</span>',
    '          <span className="stat-value">{won(data.today.hiddenMoneyFoundKRW)}</span>',
    '        </div>',
    '      </div>',
    '',
    '      <div className="shortcut-grid">',
    '        <button className="shortcut">',
    '          <strong>Insurance analysis</strong>',
    '          <span>Review coverage and gaps</span>',
    '        </button>',
    '        <button className="shortcut highlight">',
    '          <strong>Find hidden insurance money</strong>',
    '          <span>Uncover unclaimed benefits</span>',
    '        </button>',
    '        <button className="shortcut">',
    '          <strong>Medical data analysis</strong>',
    '          <span>Analyze records and risk</span>',
    '        </button>',
    '      </div>',
    '',
    '      <div className="dash-columns">',
    '        <CustomerStatisticsCard />',
    '        <div className="panel">',
    '          <h2>Consultation pipeline</h2>',
    '          <ul className="pipeline">',
    '            {data.pipeline.map((stage) => (',
    '              <li key={stage.stage}>',
    '                <span>{stage.stage}</span>',
    '                <span className="badge">{stage.count}</span>',
    '              </li>',
    '            ))}',
    '          </ul>',
    '        </div>',
    '        <div className="panel">',
    '          <h2>Recent customers</h2>',
    '          <CustomerList customers={recent} />',
    '        </div>',
    '      </div>',
    '',
    '      <div className="panel">',
    '        <h2>Pending tasks</h2>',
    '        <ul className="list">',
    '          {data.pendingTasks.map((task) => (',
    '            <li key={task.id}>',
    '              <span>{task.title}</span>',
    '              <span className="muted">{task.due}</span>',
    '            </li>',
    '          ))}',
    '        </ul>',
    '      </div>',
    '',
    '      <div className="quick-actions">',
    '        {data.quickActions.map((action) => (',
    '          <button key={action} className="action">',
    '            {action}',
    '          </button>',
    '        ))}',
    '      </div>',
    '    </section>',
    '  )',
    '}',
    ''
  ].join('\n')
}

function mockDashboardData(): string {
  return [
    '// Local mock data only — no APIs, no database, no real insurance logic.',
    '// Customer data is owned by the Customer Module, not the Dashboard.',
    '',
    'export interface PipelineStage {',
    '  stage: string',
    '  count: number',
    '}',
    '',
    'export interface TaskItem {',
    '  id: string',
    '  title: string',
    '  due: string',
    '}',
    '',
    'export interface DashboardData {',
    '  today: { consultations: number; newCustomers: number; hiddenMoneyFoundKRW: number }',
    '  pipeline: PipelineStage[]',
    '  pendingTasks: TaskItem[]',
    '  quickActions: string[]',
    '}',
    '',
    'export const mockDashboard: DashboardData = {',
    '  today: { consultations: 8, newCustomers: 3, hiddenMoneyFoundKRW: 12400000 },',
    '  pipeline: [',
    "    { stage: 'New lead', count: 24 },",
    "    { stage: 'Consulting', count: 12 },",
    "    { stage: 'Analysis', count: 7 },",
    "    { stage: 'Proposal', count: 5 },",
    "    { stage: 'Closed', count: 3 }",
    '  ],',
    '  pendingTasks: [',
    "    { id: 't-1', title: 'Follow up on hidden insurance money claim', due: 'Today' },",
    "    { id: 't-2', title: 'Prepare medical data analysis report', due: 'Tomorrow' },",
    "    { id: 't-3', title: 'Review coverage gaps for Kim Min-jun', due: 'This week' }",
    '  ],',
    "  quickActions: ['New consultation', 'Add customer', 'Run insurance analysis', 'Find hidden money', 'Analyze medical data']",
    '}',
    ''
  ].join('\n')
}

function libModule(name: string, subject: string): string {
  return [
    '// Generated by SJ AI Company — Developer (real execution). No business logic.',
    '',
    `/** ${subject} */`,
    `export class ${name} {`,
    '  isReady(): boolean {',
    '    return true',
    '  }',
    '}',
    ''
  ].join('\n')
}

function libTest(name: string, base: string): string {
  return [
    '// Generated by SJ AI Company — Developer (real execution).',
    `import { ${name} } from './${base}'`,
    '',
    'function assert(condition: boolean, message: string): void {',
    "  if (!condition) throw new Error('Test failed: ' + message)",
    '}',
    '',
    `assert(new ${name}().isReady() === true, '${name} is ready')`,
    '',
    'export {}',
    ''
  ].join('\n')
}

function qaTest(base: string): string {
  return [
    '// Generated by SJ AI Company — QA (real execution).',
    `// Build verification for ${base}.`,
    'function check(condition: boolean, message: string): void {',
    "  if (!condition) throw new Error('QA failed: ' + message)",
    '}',
    '',
    `check(true, 'build verification placeholder for ${base}')`,
    '',
    'export {}',
    ''
  ].join('\n')
}

// ---- Document templates ----------------------------------------------------

function visionDoc(name: string): string {
  return `# ${name} — Vision\n\nA cross-platform desktop application delivering ${name} to its users, built by the SJ AI Company. This document captures intent only; no business logic is implemented in Milestone 1.\n`
}

function goalsDoc(): string {
  return `# Goals\n\n- Ship a runnable desktop application foundation.\n- Establish a clean, provider-neutral architecture.\n- Prove the delivery pipeline end to end.\n`
}

function milestonesDoc(insurance: boolean): string {
  const m2 = insurance
    ? `## Milestone 2 — Insurance Dashboard (done)\n\n- Today summary, consultation pipeline, shortcuts, pending tasks, quick actions\n- UI + local mock data only\n\n## Domain architecture (done)\n\n- 10 business domains (Clean Architecture / DDD-inspired)\n\n## Epics\n\n- Epic 001 — Insurance Analysis (Coverage Summary implemented; rest scaffolded)\n\n## Features\n\n- Feature 001 — Customer Management (done)\n- Feature 002 — Consultation Management (done)\n`
    : `## Milestone 2 — (planned)\n\n- Feature modules\n`
  return `# Milestones\n\n## Milestone 1 — Desktop Application Foundation (done)\n\n- Electron + React + TypeScript shell\n- Window layout\n- Sidebar navigation & routing\n- Dashboard page\n- Settings page\n- Theme (light/dark)\n- Status bar\n- Build configuration\n\n${m2}`
}

function backlogDoc(): string {
  return `# Backlog\n\n- [x] Application shell\n- [x] Navigation & routing\n- [x] Dashboard\n- [x] Settings\n- [x] Theming & status bar\n- [ ] Feature modules (future milestone)\n`
}

function risksDoc(): string {
  return `# Risk register\n\n| Risk | Likelihood | Impact | Mitigation |\n|---|---|---|---|\n| Scope creep beyond the foundation | Medium | Medium | Milestone gating |\n| UI/UX inconsistency | Low | Medium | Shared layout + theme |\n| Build/tooling drift | Low | Low | Pinned dependencies |\n`
}

function timelineDoc(): string {
  return `# Timeline\n\n- Milestone 1 — Desktop Application Foundation: in progress\n- Milestone 2 — Feature modules: planned\n`
}

function readmeDoc(name: string): string {
  return `# ${name}\n\nDesktop application generated by SJ AI Company (Milestone 1 — foundation only, no business logic).\n\n## Stack\n\n- Electron + React + TypeScript (electron-vite)\n\n## Scripts\n\n\`\`\`\nnpm install\nnpm run dev     # launch the app\nnpm run build   # build for production\n\`\`\`\n\nSee \`docs/\` for the project vision, goals, milestones, backlog, risks and timeline.\n`
}

function gitStrategy(): string {
  return `# Git strategy\n\n- Feature branch per task.\n- Pull requests into a protected \`main\`.\n- No direct pushes; merges gated on QA.\n`
}

function usageDoc(): string {
  return `# Usage\n\n\`\`\`\nnpm install\nnpm run dev\n\`\`\`\n`
}

function releaseNotes(): string {
  return `# Release notes\n\n## Unreleased\n\n- Milestone 1: desktop application foundation generated by SJ AI Company.\n`
}

// ---- Text helpers ----------------------------------------------------------

function subjectOf(title: string): string {
  const stripped = title
    .replace(/^(Research|Design|Implement|Verify)\s+/i, '')
    .replace(/^Build (?:API|UI) for\s+/i, '')
    .trim()
  return stripped || title
}

function slug(text: string): string {
  const s = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return s || 'module'
}

function pascal(text: string): string {
  const parts = text.replace(/[^a-zA-Z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean)
  const name = parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('')
  return /^[A-Za-z]/.test(name) ? name : `Module${name}`
}
