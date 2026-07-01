# SJ OS — Software Architecture Document (SAD)

| Field | Value |
|---|---|
| **Project** | SJ OS — Autonomous AI Operating System for Insurance Operations |
| **Document type** | Software Architecture Document (SAD) |
| **Version** | 0.1 (Draft for approval) |
| **Status** | Awaiting approval — no source code to be written until approved |
| **Author** | Lead Software Architect |
| **Date** | 2026-06-30 |

---

## 0. Approved Baseline Decisions

These were ratified before this document and constrain every design choice below.

| # | Decision | Choice | Consequence |
|---|---|---|---|
| D-1 | Desktop framework | **Electron + React + TypeScript** | Node-native kernel; clean integration with Playwright, MCP, Computer Use, Claude Agent SDK. |
| D-2 | Engine isolation | **Process per engine** | Each company runs as a managed child process: crash, credential, and session isolation. |
| D-3 | Autonomy posture | **Human-approval gated by default** | Policy engine + audit log are Phase-1 mandatory; every sensitive Driver action is gated. |
| D-4 | First reference engine | **Samsung** | Phase 6 proves the Engine SDK end-to-end on Samsung before scaling. |

Recorded formally as ADRs in `docs/adr/` (to be created on approval).

---

## 1. High-Level Architecture

### 1.1 Architectural Style

SJ OS is a **layered, event-driven, process-isolated desktop system** that models itself as an operating system. The human is the supervisor; the OS executes autonomous work through a kernel.

| OS concept | SJ OS realization |
|---|---|
| Kernel | Orchestration core (scheduler, agent runtime, model router, policy, engine manager) |
| Processes | Tasks (units of autonomous work with a state machine) |
| Drivers | Capability adapters (Playwright, Computer Use, Python, GitHub, FS) |
| System services | MCP host, scheduler, audit log, secrets vault, GitHub sync, event bus |
| Applications | Company Engines (Samsung, DB, KB, Hyundai, Meritz, future) |
| Shell | Electron renderer (React UI) |

### 1.2 System Context Diagram

```
                         ┌──────────────────────────┐
                         │        OPERATOR          │
                         │  (human supervisor)      │
                         └────────────▲─────────────┘
                                      │ approve / inspect / command
┌─────────────────────────────────────┴───────────────────────────────┐
│                              SJ OS (Desktop)                          │
│                                                                       │
│   SHELL (Renderer) ─── IPC ─── KERNEL (Main) ─── SERVICES             │
│                                     │                                 │
│        ┌────────────────────────────┼────────────────────────┐       │
│        ▼                            ▼                         ▼       │
│   INTELLIGENCE                   TOOLS/DRIVERS            ENGINES      │
│   (Claude, GPT)                  (Playwright,            (Samsung…)   │
│                                   ComputerUse,                        │
│                                   Python, Git)                       │
└───────────┬───────────────┬──────────────────┬───────────────┬───────┘
            │               │                  │               │
            ▼               ▼                  ▼               ▼
      Anthropic /      Insurance          Local files /    GitHub
      OpenAI APIs      company portals    Windows apps     (source of truth)
```

### 1.3 Architectural Principles

1. **Supervisor-in-the-loop** — autonomous, not unsupervised. Sensitive actions gate on policy.
2. **Provider-agnostic intelligence** — models sit behind one interface; swapping/adding providers never touches callers.
3. **Engines are plugins** — adding a company is a drop-in package, zero kernel change.
4. **Isolation by default** — process, credential, and browser-context isolation per engine.
5. **Everything observable** — every model call, tool call, and decision emits events and is audited.
6. **Local-first data** — PII stays on the machine; only chosen artifacts sync to GitHub.
7. **Reversibility & kill switch** — a global pause halts all autonomous execution instantly.

---

## 2. Folder Structure

```
sj-os/
├── apps/
│   └── desktop/                 # Electron application
│       ├── main/                # kernel host (main process entrypoint)
│       ├── preload/             # secure, typed IPC bridge
│       └── renderer/            # React UI (shell)
├── packages/
│   ├── kernel/                  # scheduler, agent runtime, policy, engine manager
│   ├── model-providers/         # ModelProvider interface + Claude/GPT adapters + router
│   ├── brain/                   # planning, reasoning policies, context assembly
│   ├── tools/                   # Driver framework + Playwright/ComputerUse/GitHub/FS
│   ├── python-bridge/           # JSON-RPC client to Python workers
│   ├── mcp-host/                # MCP client + server
│   ├── engine-sdk/              # Engine contract, base classes, conformance harness
│   ├── memory/                  # short/long-term memory + vector store abstraction
│   ├── events/                  # event bus + typed event catalog
│   ├── audit/                   # append-only, tamper-evident audit log
│   ├── secrets/                 # vault wrapper (Windows DPAPI / Credential Manager)
│   ├── shared/                  # types, zod schemas, IPC contracts, utils
│   └── config/                  # config loading, env, feature flags
├── engines/
│   ├── samsung/                 # reference engine (Phase 6)
│   ├── db/
│   ├── kb/
│   ├── hyundai/
│   └── meritz/
├── python/                      # Python workers (separate runtime)
│   ├── excel/
│   ├── pdf/
│   ├── reporting/
│   └── rpc/                     # JSON-RPC server scaffolding
├── playbooks/                   # versioned procedures (per company + shared)
├── prompts/                     # versioned system prompts
├── docs/
│   ├── SAD.md                   # this document
│   └── adr/                     # architecture decision records
├── scripts/                     # dev/build/release tooling
├── .github/                     # CI workflows
├── pnpm-workspace.yaml
├── turbo.json
└── CLAUDE.md                    # guidance for future Claude Code sessions
```

**Boundary rule:** dependencies flow *inward* — `engines/*` and `apps/desktop` depend on `packages/*`; `packages/*` never depends on `engines/*` or `apps/*`. The kernel knows the Engine *contract*, never a concrete engine.

---

## 3. Core Modules

> Every module below is specified as **Purpose · Responsibilities · Dependencies · Interfaces · Future extension points**. Interfaces are contracts (type signatures), not implementations.

### 3.1 Kernel (`packages/kernel`)

**Purpose** — The orchestration core. The single authority that turns operator intent into governed, observable execution.

**Responsibilities**
- Own the Task lifecycle and scheduling (the "process table").
- Host the Agent Runtime loop.
- Route every sensitive action through the Policy engine.
- Manage Engine processes via the Engine Manager.
- Emit lifecycle events and write audit entries.

**Dependencies** — `model-providers`, `brain`, `tools`, `engine-sdk`, `memory`, `events`, `audit`, `secrets`, `config`, `shared`.

**Interfaces**
```
interface Kernel {
  submitTask(spec: TaskSpec): Promise<TaskId>
  cancelTask(id: TaskId): Promise<void>
  getTask(id: TaskId): Promise<TaskRecord>
  pauseAll(): void          // global kill switch
  resumeAll(): void
}
```

**Future extension points** — pluggable scheduling strategies (priority, fair-share across engines), distributed kernel (multi-machine) behind the same interface, task-graph (DAG) execution.

### 3.2 Configuration (`packages/config`)

**Purpose** — Single source for runtime configuration and feature flags.

**Responsibilities** — Load layered config (defaults → file → env → operator overrides), validate via schema, expose typed accessors, hot-reload non-secret config.

**Dependencies** — `shared` (schemas).

**Interfaces**
```
interface Config {
  get<T>(key: ConfigKey): T
  flag(name: FeatureFlag): boolean
  onChange(key: ConfigKey, cb: (v: unknown) => void): Unsubscribe
}
```

**Future extension points** — remote/managed config, per-engine config overlays, A/B feature rollout.

### 3.3 Shared (`packages/shared`)

**Purpose** — Cross-cutting types, zod schemas, and IPC contracts shared by all packages.

**Responsibilities** — Define canonical domain types (Task, Approval, Event, EngineDescriptor), validation schemas, and the typed IPC contract between main and renderer.

**Dependencies** — none (leaf package).

**Interfaces** — exported type definitions and schema objects only.

**Future extension points** — code-generated clients from schemas; versioned contract negotiation.

---

## 4. AI Brain Architecture (`packages/brain` + `packages/model-providers`)

**Purpose** — The reasoning and planning layer. Decides *what* to do and *which intelligence* to use, separate from *how* to call a model (providers) and *how* to act (drivers).

**Responsibilities**
- **Context assembly** — gather task goal, relevant memory, engine capabilities, and playbooks into a model-ready context.
- **Planning** — decompose a goal into an ordered/branching plan of steps.
- **Model routing** — pick provider + model tier per step (cost/latency/difficulty aware).
- **Reasoning policy** — decide when to call a tool, when to ask for approval, when to stop.
- **Reflection** — evaluate step results and replan on failure.

**Design — two-engine brain**
- **Coding engine: Claude** (via Claude Agent SDK) — primary execution intelligence. Tiering: **Opus 4.8** for hard reasoning/coding, **Sonnet 4.6** for routine steps, **Haiku 4.5** for cheap/fast steps. Exact model IDs are config-driven.
- **Planning engine: GPT** (Phase 9) — high-level decomposition. Added behind the same `ModelProvider` interface; the router decides plan→GPT, build→Claude.

```
              ┌────────────────────────────────────────┐
              │                BRAIN                    │
              │  ContextAssembler → Planner → Router    │
              │            ↘ ReasoningPolicy ↙          │
              └───────────────┬────────────────────────┘
                              ▼
                    ModelRouter (provider-agnostic)
                     ├── ClaudeProvider (Opus/Sonnet/Haiku)
                     └── GptProvider     (Phase 9+)
```

**Dependencies** — `memory`, `engine-sdk` (capability descriptors), `config`, `events`, `shared`.

**Interfaces**
```
interface ModelProvider {
  id: ProviderId
  complete(req: CompletionRequest): Promise<CompletionResult>
  stream(req: CompletionRequest): AsyncIterable<CompletionChunk>
  withTools(tools: ToolSpec[]): ModelProvider
}

interface ModelRouter {
  select(step: PlanStep, context: RouteContext): ProviderSelection
}

interface Planner {
  plan(goal: Goal, context: BrainContext): Promise<Plan>
  replan(plan: Plan, failure: StepFailure): Promise<Plan>
}
```

**Future extension points** — additional providers (local LLMs, Gemini) as new adapters; learned routing from historical task outcomes; ensemble/critic models for self-verification; per-engine model preferences.

---

## 5. Task Orchestration (`packages/kernel` — Scheduler + Agent Runtime)

**Purpose** — Convert intent into governed execution and keep it observable, resumable, and cancellable.

**Responsibilities**
- Maintain the Task state machine and queue.
- Drive the agent loop (model ↔ tools ↔ context) until done or blocked.
- Enforce timeouts, retries, and cancellation.
- Persist task state so a crash can resume.
- Surface `awaiting-approval` to the Shell.

**Task state machine**
```
pending → planning → executing ⇄ awaiting-approval → done
                         │                         �‖
                         └────────► failed ◄───────┘   (with retry/replan)
                                       │
                                   cancelled
```

**Dependencies** — `brain`, `tools`, `engine-sdk`, `events`, `audit`, `memory`, `shared`.

**Interfaces**
```
interface TaskSpec {
  goal: string
  engineId?: EngineId          // optional binding to a company engine
  policyProfile?: PolicyProfile
  schedule?: ScheduleSpec      // for autonomous/cron tasks
}

interface TaskRecord {
  id: TaskId
  state: TaskState
  plan?: Plan
  steps: StepRecord[]
  approvals: ApprovalRecord[]
  artifacts: ArtifactRef[]
}

interface AgentRuntime {
  run(task: TaskRecord): AsyncIterable<TaskEvent>
}
```

**Future extension points** — task DAGs and sub-tasks, multi-engine orchestration in one task, durable workflow engine for long-running jobs, human-task assignment (route a step to a person).

---

## 6. Permission System (`packages/kernel` — Policy Engine + `packages/audit`)

**Purpose** — The safety spine. Decide whether a sensitive action proceeds automatically, requires human approval, or is denied — and record the decision immutably.

**Responsibilities**
- Classify actions by sensitivity (read vs. login vs. data-egress vs. irreversible).
- Evaluate policy: `auto-allow | require-approval | deny`.
- Suspend the task and request operator approval when required.
- Record every decision + approver + context to the audit log.
- Honor the global kill switch.

**Policy model**
```
PolicyProfile → rules[]:  (capability, sensitivity, context) → Decision
Default profile (D-3): all sensitive actions → require-approval
Operators relax specific capabilities to auto-allow over time.
```

**Dependencies** — `events`, `audit`, `secrets` (scoped credential release on approval), `config`, `shared`.

**Interfaces**
```
interface PolicyEngine {
  evaluate(action: SensitiveAction, ctx: PolicyContext): Decision
  requestApproval(req: ApprovalRequest): Promise<ApprovalOutcome>
}

interface AuditLog {
  append(entry: AuditEntry): Promise<void>   // append-only, hash-chained
  query(filter: AuditFilter): AsyncIterable<AuditEntry>
}
```

**Future extension points** — role-based approvals (maker/checker), multi-approver thresholds for high-risk actions, time-boxed standing approvals, anomaly-triggered auto-deny, exportable compliance reports.

---

## 7. Plugin System (`packages/engine-sdk` + general plugin host)

**Purpose** — Make the OS extensible without core changes. Engines are the primary plugin type; the same mechanism supports tool plugins and report templates.

**Responsibilities**
- Define the plugin contract and lifecycle (discover → validate → load → start → stop).
- Validate plugin manifests and declared capabilities/permissions.
- Provide a sandboxed runtime and a capability-scoped API surface.
- Version and compatibility checks against the host.

**Dependencies** — `kernel` (lifecycle), `events`, `config`, `shared`.

**Interfaces**
```
interface Plugin {
  manifest: PluginManifest          // id, version, capabilities, permissions
  activate(ctx: PluginContext): Promise<void>
  deactivate(): Promise<void>
}

interface PluginHost {
  discover(): Promise<PluginManifest[]>
  load(id: PluginId): Promise<Plugin>
  start(id: PluginId): Promise<void>
  stop(id: PluginId): Promise<void>
}
```

**Future extension points** — a signed plugin marketplace, third-party engines, hot-reload, capability negotiation, per-plugin resource quotas.

---

## 8. MCP Integration (`packages/mcp-host`)

**Purpose** — Interoperate with the Model Context Protocol ecosystem — both consuming external MCP servers (tools/data) and exposing SJ OS capabilities as an MCP server.

**Responsibilities**
- **Client**: connect to configured MCP servers, enumerate their tools/resources, surface them to the Brain as callable tools (subject to the Policy engine).
- **Server**: expose selected SJ OS capabilities (engine actions, Python services) as MCP tools for external clients.
- Manage transports (stdio, HTTP), handshakes, and lifecycle.

**Dependencies** — `tools` (to register MCP tools as Drivers), `kernel` (policy gating), `events`, `config`, `shared`.

**Interfaces**
```
interface McpClient {
  connect(server: McpServerConfig): Promise<McpSession>
  listTools(session: McpSession): Promise<McpTool[]>
  call(session: McpSession, tool: string, args: unknown): Promise<unknown>
}

interface McpServer {
  expose(capability: CapabilityRef): void
  start(transport: McpTransport): Promise<void>
}
```

**Future extension points** — dynamic server discovery, per-server permission scoping, MCP resource subscriptions feeding memory, OAuth-secured remote MCP servers.

---

## 9. Playwright Integration (`packages/tools` — PlaywrightDriver)

**Purpose** — Browser automation driver for portal-based insurance workflows (login, navigation, form fill, extraction, downloads).

**Responsibilities**
- Manage browser lifecycle and **isolated contexts per engine** (no cookie/session bleed across companies).
- Provide high-level actions: navigate, fill, click, wait, extract, download.
- Capture evidence (screenshots, DOM snapshots) for audit and debugging.
- Surface every navigation/submit as a policy-checkable action.

**Dependencies** — Playwright (Node), `kernel` (policy), `events`, `audit`, `secrets`, `shared`.

**Interfaces**
```
interface PlaywrightDriver extends Driver {
  openContext(engineId: EngineId): Promise<BrowserContextHandle>
  act(ctx: BrowserContextHandle, action: BrowserAction): Promise<ActionResult>
  extract(ctx: BrowserContextHandle, query: ExtractQuery): Promise<Extracted>
  close(ctx: BrowserContextHandle): Promise<void>
}
```

**Future extension points** — self-healing selectors (AI-assisted), recorded-flow playback, parallel contexts per engine, CAPTCHA/2FA human-handoff hooks, headful debugging mode.

---

## 10. Computer Use Integration (`packages/tools` — ComputerUseDriver)

**Purpose** — Native Windows automation for tasks the browser can't reach (desktop insurer clients, legacy apps), via Claude Computer Use (screenshot → reason → click/type).

**Responsibilities**
- Capture screen state and feed it to the model.
- Translate model intents into OS-level input (mouse/keyboard), scoped and rate-limited.
- Enforce strict policy gating (native input is high-sensitivity by default).
- Record action evidence for audit.

**Dependencies** — Claude provider (vision/computer-use), `kernel` (policy — gated hard), `events`, `audit`, `shared`. OS input layer.

**Interfaces**
```
interface ComputerUseDriver extends Driver {
  screenshot(): Promise<Screen>
  perform(intent: ComputerIntent): Promise<ActionResult>   // click/type/scroll
  withBounds(region: ScreenRegion): ComputerUseDriver       // restrict action area
}
```

**Future extension points** — action allow-lists per application, virtual-desktop sandboxing, OCR/element-tree fusion for reliability, dry-run/preview mode before committing input.

---

## 11. Python Service (`packages/python-bridge` + `python/`)

**Purpose** — Offload Excel, PDF, and reporting to Python, where the best libraries live, via stateless workers over a typed RPC bridge.

**Responsibilities**
- Spawn and supervise Python worker processes.
- Provide a JSON-RPC request/response (and streaming) bridge from the Node kernel.
- Offer services: Excel read/write (openpyxl/pandas), PDF parse/generate (pdfplumber/PyMuPDF/reportlab), report rendering from templates.
- Keep workers stateless and sandboxed; pass data by file/handle, not ambient state.

**Dependencies (Node side)** — `kernel`, `events`, `audit`, `shared`. **(Python side)** — its own runtime/venv, pinned requirements.

**Interfaces**
```
interface PythonBridge {
  call<T>(service: PyService, method: string, args: unknown): Promise<T>
  stream(service: PyService, method: string, args: unknown): AsyncIterable<unknown>
}
// Python services: "excel" | "pdf" | "reporting"
```

**Future extension points** — worker pool with autoscaling, additional services (OCR, data science/ML, statistical actuarial models), gRPC transport for large payloads, GPU workers.

---

## 12. Insurance Engine Architecture (`packages/engine-sdk` + `engines/*`)

**Purpose** — The product's core: each insurance company is an independent, isolated **Engine** implementing a uniform contract with company-specific portal flows, data shapes, and playbooks.

**Responsibilities**
- Declare capabilities and required credentials (`describe()`).
- Authenticate to the company portal using vault-scoped credentials.
- Execute capabilities (fetch claims, issue policy, download statements, reconcile) via Drivers.
- Report health and last-sync state.
- Run as an **isolated child process** (D-2): own credentials, own browser context, own failure domain.

**Engine contract**
```
interface InsuranceEngine {
  describe(): EngineDescriptor                 // id, capabilities[], requiredCreds
  authenticate(creds: ScopedCredentials): Promise<Session>
  run(task: EngineTask, ctx: EngineRuntime): Promise<EngineResult>
  health(): Promise<EngineHealth>
}

interface EngineRuntime {            // capability-scoped API handed to engine
  drivers: { browser: PlaywrightDriver; computer: ComputerUseDriver }
  python: PythonBridge
  memory: ScopedMemory
  emit(event: EngineEvent): void
}
```

**Dependencies** — `engine-sdk` (contract + base classes + conformance harness), `tools`, `python-bridge`, `memory`, `events`, `secrets` (scoped), `shared`. Engines **never** import the kernel directly — they receive a scoped `EngineRuntime`.

**Isolation model**
```
Kernel ──spawn──► [ Engine process: samsung ]  own creds · own browser ctx
       ──spawn──► [ Engine process: db      ]  crash here ≠ crash elsewhere
       ──spawn──► [ Engine process: kb      ]
                  ...                            communication via IPC/RPC
```

**Future extension points** — drop-in new companies (Phase 7+) with zero kernel change; shared base playbooks with per-company overrides; capability versioning; engine conformance certification before activation; multi-region/multi-locale engines.

---

## 13. Memory Architecture (`packages/memory`)

**Purpose** — Give the Brain and engines durable, scoped recall — short-term working memory within a task and long-term knowledge across tasks — without leaking data across companies.

**Responsibilities**
- **Working memory**: per-task context window assembly and step history.
- **Long-term memory**: durable facts, playbook learnings, prior task outcomes.
- **Semantic memory**: vector store abstraction for retrieval.
- **Scoping**: per-engine and per-operator partitions; strict isolation between companies.
- **Local-first**: PII-bearing memory stays on the machine.

**Dependencies** — `config`, `events`, `shared`. Pluggable storage backends (local KV + vector index).

**Interfaces**
```
interface Memory {
  scope(s: MemoryScope): ScopedMemory          // by engine/operator/task
}
interface ScopedMemory {
  remember(item: MemoryItem): Promise<void>
  recall(query: MemoryQuery): Promise<MemoryItem[]>
  forget(filter: MemoryFilter): Promise<void>   // GDPR/PIPA erasure
}
```

**Future extension points** — pluggable vector backends, summarization/compaction policies, memory TTL & retention controls, cross-task knowledge graph, encrypted-at-rest stores.

---

## 14. Event System (`packages/events`)

**Purpose** — The nervous system. A typed, in-process event bus that decouples producers (kernel, drivers, engines) from consumers (UI, audit, memory, metrics).

**Responsibilities**
- Publish/subscribe with a typed event catalog (TaskEvent, ApprovalEvent, DriverEvent, EngineEvent, SystemEvent).
- Guarantee ordering per task stream.
- Fan out to UI (via IPC), audit log, and metrics without coupling.
- Provide replayable event history per task.

**Dependencies** — `shared` (event catalog). Leaf-ish; depended on by nearly everything.

**Interfaces**
```
interface EventBus {
  publish<E extends DomainEvent>(event: E): void
  subscribe<E extends DomainEvent>(type: E["type"], h: Handler<E>): Unsubscribe
  stream(filter: EventFilter): AsyncIterable<DomainEvent>
}
```

**Future extension points** — persistent event store / event sourcing, cross-process event bridge, external sinks (SIEM, observability), backpressure policies.

---

## 15. Desktop Application Architecture (`apps/desktop`)

**Purpose** — The Electron shell: a secure boundary between the React UI (renderer) and the kernel (main process), and the operator's window into the OS.

**Responsibilities**
- **Main process**: host the kernel and all services; own privileged operations.
- **Preload**: expose a *minimal, typed, validated* IPC surface (context isolation on, node integration off in renderer).
- **Renderer**: React UI — workspace, company dashboards, task console, approval center, live logs, artifact viewer.
- Window/lifecycle management, auto-update, crash reporting.

**Process model**
```
┌───────────── Electron ─────────────┐
│ Renderer (React, sandboxed)         │
│        ▲ typed IPC (preload bridge) │
│ Main process ── Kernel + Services   │
│        ├─ spawns Engine processes   │
│        └─ spawns Python workers     │
└─────────────────────────────────────┘
```

**Dependencies** — `kernel` and all services (main); `shared` IPC contracts (preload/renderer). React + UI libs (renderer).

**Interfaces**
```
// Preload-exposed, typed, validated — the ONLY renderer→main surface
interface SjBridge {
  tasks: { submit(spec): Promise<TaskId>; get(id): Promise<TaskRecord>; cancel(id): Promise<void> }
  approvals: { list(): Promise<ApprovalRequest[]>; resolve(id, outcome): Promise<void> }
  events: { subscribe(filter, cb): Unsubscribe }
  system: { pauseAll(): void; resumeAll(): void }
}
```

**Future extension points** — multi-window workspaces, remote/headless kernel mode (UI connects to a separate machine), theming/plugin UI surfaces, mobile companion (read-only approvals).

---

## 16. Git Workflow (`packages/tools` — GitHubDriver + repository conventions)

**Purpose** — GitHub is the single source of truth for engines, prompts, playbooks, configs, and selected task artifacts. The GitHubDriver is how the OS reads and writes that truth.

**Responsibilities**
- Clone/pull/commit/push under policy control (pushes are sensitive → gated).
- Sync prompts, playbooks, and engine packages from the canonical repo.
- Persist chosen task artifacts (reports, reconciliations) with provenance.
- Enforce branch and review conventions.

**Branching & review model**
```
main         ← protected, source of truth, release-tagged
  └─ phase/*    ← phase delivery branches (Phase 0…10)
       └─ feat/*, fix/*, engine/<company>/*   ← short-lived working branches
Commits: conventional commits. Co-authored trailer for AI-generated commits.
PRs: required for main; code-review gate before merge.
Artifacts: committed under a provenance path with task id + audit ref.
```

**Dependencies** — `kernel` (policy gating on push), `secrets` (Git credentials), `audit`, `events`, `shared`. Git CLI / API.

**Interfaces**
```
interface GitHubDriver extends Driver {
  sync(target: SyncTarget): Promise<SyncResult>
  commit(change: ChangeSet): Promise<CommitRef>
  push(branch: Branch): Promise<PushResult>     // policy-gated
  openPullRequest(pr: PullRequestSpec): Promise<PrRef>
}
```

**Future extension points** — GitOps-style engine deployment, signed commits, automated changelog/release, per-engine repositories, PR-driven engine review.

---

## 17. Security Architecture (cross-cutting; `packages/secrets`, `packages/audit`, Policy engine)

**Purpose** — Protect credentials, PII, and operations to a standard fit for insurance/regulatory contexts (e.g., Korean PIPA), with defense in depth.

**Responsibilities & controls**
- **Secrets vault** — credentials in Windows DPAPI / Credential Manager; engines receive *scoped, short-lived* handles, never raw secrets.
- **Process isolation** — per-engine processes; blast-radius containment; least privilege per process.
- **Policy gating** — sensitive/irreversible actions require approval by default (D-3).
- **Audit log** — append-only, hash-chained, queryable; covers every model call, tool call, approval, and data access.
- **Data minimization & local-first** — PII stays local; only chosen artifacts leave the machine.
- **Right-to-erasure** — memory and artifacts support targeted deletion (PIPA/GDPR).
- **Kill switch** — global immediate halt of autonomous execution.
- **IPC hardening** — context isolation on, no node integration in renderer, validated typed bridge only.

**Dependencies** — touches every layer; owns `secrets` and `audit`, drives Policy engine.

**Interfaces**
```
interface SecretsVault {
  grantScoped(req: CredentialRequest): Promise<ScopedCredentials>  // short-lived
  revoke(handle: CredentialHandle): Promise<void>
}
```

**Future extension points** — hardware-backed keys (TPM), SSO/identity provider integration, DLP scanning on egress, SIEM export, threat-model-driven red-team harness, encrypted memory-at-rest.

---

## 18. Future Scalability

**Purpose** — Ensure the architecture grows along three axes without rewrites: more companies, more intelligence, more scale.

**Scaling vectors & how the design absorbs them**

| Vector | Mechanism already in the design |
|---|---|
| **More companies** | Engines are drop-in plugins against a fixed contract (D-2, §12). New company = new package, zero kernel change. |
| **More intelligence** | `ModelProvider` interface (§4) — add GPT, local LLMs, others as adapters; router evolves independently. |
| **More tools** | `Driver` contract + MCP host (§8–11) — new capabilities register uniformly and inherit policy gating. |
| **More tasks/throughput** | Task scheduler abstracts execution; future priority/fair-share and DAG execution behind the same interface (§5). |
| **Distribution** | Kernel and event bus are interface-bounded; a future cross-process/cross-machine bridge fits behind them (§1, §14). |
| **Compliance growth** | Audit + policy + memory-erasure designed in from Phase 1, not retrofitted (§6, §17). |

**Explicit future extension points (roadmap-aligned)**
- Distributed/headless kernel; UI connects to a remote engine host.
- Engine marketplace with signed third-party engines.
- Learned model routing from historical outcomes; critic/ensemble verification.
- Durable workflow engine for long-running, multi-day autonomous jobs.
- Multi-operator, role-based approvals (maker/checker) and audit reporting.

---

## Appendix A — Module Dependency Summary

```
shared  ◄── (everyone)
config  ◄── kernel, brain, tools, engines, memory
events  ◄── kernel, tools, engines, memory, audit, mcp-host, desktop
audit   ◄── kernel(policy), tools, engines
secrets ◄── kernel(policy), engines, tools(git), brain(api keys)
model-providers ◄── brain ◄── kernel
tools, python-bridge, mcp-host, memory ◄── kernel, engines
engine-sdk ◄── engines, kernel(contract only)
apps/desktop ──► kernel + services (main), shared (renderer/preload)

Rule: dependencies flow inward. packages never import engines/ or apps/.
```

## Appendix B — Roadmap Cross-Reference (Phase 0 → 10)

| Phase | Primary modules delivered |
|---|---|
| 0 | repo scaffold, `config`, `shared`, empty `apps/desktop` shell |
| 1 | `kernel` (scheduler skeleton), `events`, `audit`, `secrets`, Policy engine, kill switch |
| 2 | `model-providers` (Claude), `brain` (basic), Agent Runtime end-to-end |
| 3 | `tools` (Driver framework, FS/GitHub), `python-bridge` + Python workers |
| 4 | PlaywrightDriver (§9) |
| 5 | ComputerUseDriver (§10) |
| 6 | `engine-sdk` + **Samsung** engine end-to-end (§12) |
| 7 | Engine Manager isolation + DB/KB/Hyundai/Meritz |
| 8 | `mcp-host` (§8) |
| 9 | GPT provider + multi-model router (§4) |
| 10 | scheduler/cron autonomy, GitHub sync hardening, packaging/signing, release |

---

*End of Software Architecture Document v0.1 — awaiting approval. No source code will be created until this is approved.*
