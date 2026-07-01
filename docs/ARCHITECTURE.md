# SJ Dev Manager — Architecture

| Field | Value |
|---|---|
| **Product** | SJ Dev Manager |
| **Document** | System Architecture |
| **Version** | 1.0 (Draft for approval) |
| **Status** | Documentation only — no source code until approved |
| **Date** | 2026-06-30 |

> Companion documents: `PRODUCT_SPEC.md`, `ROADMAP.md`, `AI_WORKERS.md`, `SECURITY.md`.

---

## 1. Overall System Structure

SJ Dev Manager is a **desktop application** with a **local orchestration backend** that coordinates **AI workers** and persists all output to **GitHub**, under **human approval gates**, observed through a **desktop UI**.

```
┌──────────────────────────────────────────────────────────────────────┐
│                       DESKTOP UI  (Renderer)                          │
│   Intake · Pipeline Board · Approval Center · Activity Log            │
└───────────────────────────────▲──────────────────────────────────────┘
                                 │ typed, validated IPC
┌────────────────────────────────┴──────────────────────────────────────┐
│                ORCHESTRATION BACKEND  (Main process)                   │
│  Project Manager · Workflow Engine · Worker Router · Shared Context    │
│  Approval Gates · Artifact Store · Event Bus · Audit · Secrets Vault   │
└───────┬─────────────────┬─────────────────────┬───────────────────────┘
        ▼                 ▼                     ▼
  ┌───────────┐    ┌──────────────┐      ┌──────────────┐
  │ AI WORKERS│    │  GITHUB       │      │  PROVIDERS   │
  │ (roles)   │    │  integration  │      │  Claude /GPT │
  └───────────┘    └──────────────┘      └──────────────┘
```

**Layering rule:** the UI talks only to the backend over a typed IPC bridge; the backend owns all privileged operations (provider calls, GitHub, secrets, filesystem). Workers never call each other — they hand off through the orchestrator.

---

## 2. Desktop App Architecture

**Framework:** Electron + React + TypeScript (single language across UI and backend).

```
┌──────────────── Electron ─────────────────┐
│ Renderer (React, sandboxed)                │
│   UI surfaces · no direct node/IO access   │
│        ▲ typed IPC (preload bridge only)   │
│ Preload  — minimal, validated API surface  │
│        ▲                                    │
│ Main process — Orchestration Backend        │
│   ├─ hosts workers & services               │
│   ├─ calls Claude / ChatGPT providers       │
│   ├─ calls GitHub                           │
│   └─ owns secrets & filesystem              │
└─────────────────────────────────────────────┘
```

- **Main process** — privileged: hosts the orchestrator, providers, GitHub integration, secrets, and audit. The only place with network/filesystem/credential access.
- **Preload** — exposes a minimal, typed, validated bridge; context isolation **on**, node integration **off** in the renderer.
- **Renderer** — pure UI; receives state via events, sends commands via the bridge. No secrets, no direct provider/GitHub calls.

---

## 3. Backend Architecture

The backend is the **orchestrator** — the AI engineering manager. Core components:

| Component | Responsibility |
|---|---|
| **Project Manager** | Owns each project's identity, GitHub binding, state, and history. |
| **Workflow Engine** | Drives the SDLC pipeline as a state machine; advances phases, runs loops/retries, enforces gates. |
| **Worker Router** | Maps each phase/task to a worker **role**, and each role to a concrete **provider**. |
| **Shared Context** | The project's living memory (requirements, architecture, code map, status, open questions) passed scoped to workers. |
| **Approval Gates** | Suspend the pipeline at consequential transitions; capture human decisions. |
| **Artifact Store** | Tracks every produced artifact (plan, PR, report, docs, release) with provenance and GitHub links. |
| **Event Bus** | Typed pub/sub streaming all pipeline and worker events to UI + audit. |
| **Audit Log** | Append-only, queryable record of every action and decision. |
| **Secrets Vault** | API keys and GitHub tokens in OS keychain; scoped release, never plaintext. |

**Worker contract (role abstraction):**
```
Worker:
  describe()              → role, capabilities, required inputs
  execute(task, context)  → WorkerResult { output, artifacts[], handoff }
  status()                → health, current task
```
Roles are fixed; providers behind them are swappable and independently upgradable.

---

## 4. AI Worker Orchestration

The orchestrator runs the SDLC pipeline and delegates each phase to a worker. **All coordination is centralized** — workers communicate only through the manager and the shared context.

```
INTAKE → ARCHITECTURE (gate) → PLANNING → ENGINEERING → QA →
  REVIEW/MERGE (gate) → DOCUMENTATION → RELEASE (gate) → DONE
```

- **Delegation:** the Workflow Engine asks the Worker Router for the role that owns the current phase; the router resolves the provider and dispatches the task with scoped context.
- **Handoff:** a worker returns a `handoff` declaring what it produced and which role should act next; the **manager decides** the actual next step based on workflow state and gates.
- **Loops:** QA failures route back to engineering automatically until criteria pass or a human intervenes; loop limits trigger human escalation.
- **Observability:** every dispatch, result, and gate emits an event to the UI and the audit log.
- **Resumability:** pipeline state persists; the app can close and resume mid-pipeline.

*(Worker roles are defined in `AI_WORKERS.md`.)*

---

## 5. GitHub Integration

GitHub is the **single source of truth**. All artifact-producing workers write *through* the Git Manager Agent so version control is uniform and policy-gated.

**Responsibilities**
- Create or bind a project to a repository.
- Branch management (feature/task branches), commits, pull requests, merges, tags, releases.
- Persist artifacts (code, reports, docs, releases) with provenance linking back to tasks and audit entries.

**Branch & review model**
```
main          ← protected, source of truth, release-tagged
  └─ feat/* , fix/* , task/*   ← short-lived working branches
Commits: conventional commits; AI-authored commits carry a co-author trailer.
PRs: required to reach main; merge is an approval-gated action.
```

**Safety**
- Pushes, merges, and releases are **gated actions** (see `SECURITY.md`).
- GitHub tokens come from the secrets vault, scoped, never logged.
- Local-first artifact store mirrors state so Git outages don't lose work.

---

## 6. Claude Code Integration (Software Engineer)

**Role:** Claude Developer Agent — the primary engineering worker.

- **Provider:** Anthropic Claude. Model tiering is config-driven — **Opus 4.8** for hard reasoning/coding, **Sonnet 4.6** for routine tasks, **Haiku 4.5** for cheap/fast steps. Exact model IDs live in configuration, not code.
- **Inputs:** an approved task (from the CTO Agent's breakdown) + scoped shared context (architecture, code map, acceptance criteria).
- **Outputs:** source code, unit tests, commits on a feature branch, a pull request — written through the Git Manager Agent.
- **Boundaries:** operates within the project workspace; sensitive/irreversible actions (push, destructive commands) flow through approval gates and dangerous-command protection (`SECURITY.md`).
- **Swappability:** sits behind the Worker role interface — the underlying model can be upgraded without changing the workflow.

---

## 7. ChatGPT Integration (CTO / Architecture)

**Role:** CTO Agent — the planning and architecture worker.

- **Provider:** OpenAI / ChatGPT, behind the same swappable Worker role interface as every other worker.
- **Inputs:** the user's plain-language intent + any constraints (target stack, repo).
- **Outputs:** requirements clarification, system architecture, technology choices, a sequenced task breakdown, and acceptance criteria — handed off to the Claude Developer Agent after the architecture gate.
- **Gate:** architecture sign-off by the user before engineering begins.
- **Provider-agnostic:** the CTO role can be fulfilled by a different provider via configuration without workflow changes.

---

## 8. Provider Abstraction (cross-cutting)

Both Claude and ChatGPT — and future QA/Docs/Release providers — sit behind one **ModelProvider** boundary so the orchestrator stays provider-agnostic.

```
Worker (role)  →  Worker Router  →  ModelProvider
                                     ├─ ClaudeProvider  (Opus/Sonnet/Haiku)
                                     └─ GptProvider      (ChatGPT)
```

Adding or swapping a provider is configuration, not a code change to callers. This keeps the system free of lock-in and ready for new roles and models.

---

*End of Architecture — awaiting approval. No source code will be created until approved.*
