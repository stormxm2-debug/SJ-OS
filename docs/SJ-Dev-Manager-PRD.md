# SJ Dev Manager — Product Specification Document

| Field | Value |
|---|---|
| **Product** | SJ Dev Manager — AI Software Development Manager |
| **Document type** | Product Specification (PRD) |
| **Version** | 0.1 (Draft for approval) |
| **Status** | Awaiting approval — no source code until approved |
| **Date** | 2026-06-30 |
| **Relationship to SJ OS** | SJ Dev Manager is now **Product 1**. SJ OS architecture (`docs/SAD.md`) is deferred to a later product; its orchestration/process-isolation patterns are reusable here. |

---

## 1. Vision

**One sentence:** A user describes *what* they want to build; SJ Dev Manager coordinates a team of specialized AI workers to design, build, test, document, and ship it to GitHub as finished software.

```
USER  →  SJ DEV MANAGER  →  AI WORKERS  →  GITHUB  →  FINISHED SOFTWARE
(intent)   (the manager)    (the team)    (truth)     (the product)
```

SJ Dev Manager is **not** an IDE, **not** a chatbot, and **not** a single coding assistant. It is an **AI engineering organization in a box** — a manager that owns the software development lifecycle (SDLC) and delegates each phase to the right specialist worker, exactly as a human engineering manager coordinates a CTO, engineers, QA, tech writers, and release engineers.

The user operates at the level of **intent and approval**, not implementation. They say "build me X"; they review and approve at meaningful checkpoints; the system does the engineering.

**What "done" looks like:** a working, tested, documented software project committed to a GitHub repository, with a release artifact, produced from a natural-language description and a handful of human approvals.

---

## 2. Core Philosophy

1. **The user describes; the system builds.** The only required human input is intent. Everything downstream is delegated.
2. **Manager, not monolith.** A coordinator orchestrates specialized workers. No single model does everything; each worker is the best tool for its phase.
3. **Right brain for the right job.** ChatGPT plans/architects; Claude Code engineers; dedicated agents test, document, and release. Workers are swappable behind role interfaces.
4. **GitHub is the single source of truth.** Every artifact — code, tests, docs, releases — lives in version control. The repo *is* the product state.
5. **Human-in-the-loop at checkpoints, not keystrokes.** Approvals gate consequential transitions (architecture sign-off, merge, release) — not every line.
6. **Verifiable progress.** Every phase produces an inspectable artifact (a plan, a PR, a test report, docs, a release). Progress is never a black box.
7. **Reversible and auditable.** Branch-per-feature, PR-based merges, and a full activity log mean any step can be reviewed and rolled back.
8. **Enterprise from day one.** Multi-project, role-based approvals, audit trails, and secret hygiene are first-class, not afterthoughts.

---

## 3. System Architecture

### 3.1 Conceptual model

SJ Dev Manager is a **central orchestrator** that drives a roster of **AI workers** through an SDLC **workflow**, persisting all output to **GitHub**, under **human approval gates**, observed through a **desktop UI**.

```
┌──────────────────────────────────────────────────────────────────────┐
│                         DESKTOP UI (Shell)                            │
│   Project intake · Pipeline board · Approval center · Live activity   │
└───────────────────────────────▲──────────────────────────────────────┘
                                 │ typed IPC
┌────────────────────────────────┴──────────────────────────────────────┐
│                     SJ DEV MANAGER — ORCHESTRATOR                       │
│  ┌───────────┐ ┌────────────┐ ┌──────────────┐ ┌───────────────────┐   │
│  │ Project   │ │ Workflow   │ │ Worker       │ │ Approval / Policy  │   │
│  │ Manager   │ │ Engine     │ │ Router       │ │ Gates              │   │
│  └───────────┘ └────────────┘ └──────────────┘ └───────────────────┘   │
│  ┌───────────┐ ┌────────────┐ ┌──────────────┐ ┌───────────────────┐   │
│  │ Shared    │ │ Artifact   │ │ Event Bus /  │ │ Secrets / Audit    │   │
│  │ Context   │ │ Store       │ │ Activity Log │ │                    │   │
│  └───────────┘ └────────────┘ └──────────────┘ └───────────────────┘   │
└───────┬──────────┬──────────┬──────────┬──────────┬──────────┬─────────┘
        ▼          ▼          ▼          ▼          ▼          ▼
   ┌─────────┐┌─────────┐┌─────────┐┌─────────┐┌─────────┐┌─────────┐
   │  CTO    ││Engineer ││   QA    ││  Docs   ││ Release ││ GitHub  │
   │(ChatGPT)││(Claude  ││ Agent   ││ Agent   ││ Agent   ││ Worker  │
   │         ││  Code)  ││         ││         ││         ││         │
   └─────────┘└─────────┘└─────────┘└─────────┘└─────────┘└─────────┘
```

### 3.2 Core orchestrator components

| Component | Role |
|---|---|
| **Project Manager** | Owns a project's identity, repo binding, state, and history. Multiple projects run concurrently. |
| **Workflow Engine** | Drives the SDLC pipeline as a state machine; advances phases, handles retries/replanning, enforces gates. |
| **Worker Router** | Maps each phase/task to a worker *role* and a concrete *provider* (e.g., role "CTO" → ChatGPT). Providers are swappable. |
| **Shared Context** | The project's living memory: requirements, architecture decisions, code map, test status, open questions — passed to workers as scoped context. |
| **Approval / Policy Gates** | Suspends the pipeline at consequential transitions for human approval; records the decision. |
| **Artifact Store** | Tracks every produced artifact (plan, PR, test report, docs, release) with provenance and links to GitHub. |
| **Event Bus / Activity Log** | Streams all worker and pipeline events to the UI and audit trail. |
| **Secrets / Audit** | API keys and GitHub credentials in OS keychain; append-only audit of every action. |

### 3.3 Worker abstraction

Every worker — regardless of provider — implements one **Worker** role contract: it receives a scoped task + shared context, does its job, and returns a typed result plus artifacts. This makes ChatGPT, Claude Code, and the QA/Docs/Release agents interchangeable behind their roles and independently upgradable.

```
Worker (role contract):
  describe()                  → role, capabilities, required inputs
  execute(task, context)      → WorkerResult { output, artifacts[], handoff }
  status()                    → health, current task
```

### 3.4 Reuse from SJ OS

The orchestration spine — worker/provider abstraction, approval gates, event bus, audit, secrets vault, GitHub-as-truth — is directly inherited from the SJ OS design (`docs/SAD.md`). SJ Dev Manager is a focused application of those patterns to the SDLC domain.

---

## 4. AI Worker Responsibilities

Each worker is a **role**, fulfilled by a concrete provider, coordinated by the manager. Workers never talk to each other directly — they **hand off through the manager** and the shared context, so the manager retains full control and observability.

### 4.1 CTO / Architecture Worker — *ChatGPT*
- **Mandate:** Turn user intent into a buildable plan.
- **Produces:** requirements clarification, system architecture, tech-stack proposal, task breakdown, acceptance criteria.
- **Hands off to:** Engineer (with an approved architecture + task list).
- **Gate:** architecture sign-off by the user before engineering begins.

### 4.2 Software Engineer Worker — *Claude Code*
- **Mandate:** Implement the approved plan, task by task.
- **Produces:** source code, unit tests, commits on a feature branch, a pull request per feature/task.
- **Hands off to:** QA (for verification) and Docs (for documentation).
- **Gate:** PR review/approval before merge to main.

### 4.3 QA / Testing Worker — *QA Agent*
- **Mandate:** Verify the engineer's work meets acceptance criteria.
- **Produces:** test plans, automated tests, test execution reports, defect reports filed back to the Engineer.
- **Hands off to:** Manager (pass → proceed; fail → loop back to Engineer with defects).
- **Gate:** quality gate — merge blocked until QA passes (configurable).

### 4.4 Documentation Worker — *Documentation Agent*
- **Mandate:** Keep the project understandable.
- **Produces:** README, API/usage docs, architecture notes, changelog entries, inline doc review.
- **Hands off to:** Release (docs ready for the release bundle).

### 4.5 Release Worker — *Release Agent*
- **Mandate:** Ship.
- **Produces:** version bump, tagged release, release notes, build/release artifact, GitHub Release.
- **Gate:** release approval by the user.

### 4.6 Version Control Worker — *GitHub Worker*
- **Mandate:** Be the system of record.
- **Produces:** repo creation/binding, branch management, commits, PRs, merges, tags, releases.
- **Note:** every artifact-producing worker writes *through* the GitHub Worker, so version control is uniform and policy-gated (pushes/merges/releases are gated actions).

> **Provider mapping is configuration.** Roles are fixed; providers behind them are swappable (e.g., swap QA Agent's underlying model, or move architecture from ChatGPT to another planner) without changing the workflow.

---

## 5. Workflow

### 5.1 The SDLC pipeline

```
[1] INTAKE          User describes what to build
        │            → Manager creates Project, binds/creates GitHub repo
        ▼
[2] ARCHITECTURE    CTO (ChatGPT): requirements + architecture + task breakdown
        │            ⛔ GATE: user approves architecture
        ▼
[3] PLANNING        Manager turns tasks into a sequenced backlog
        ▼
[4] ENGINEERING     Engineer (Claude Code): implement task → branch → PR
        │            (loop per task)
        ▼
[5] QA              QA Agent: run acceptance tests on the PR
        │            ├─ FAIL → defects back to Engineer (loop to [4])
        │            └─ PASS → continue
        ▼
[6] REVIEW / MERGE  ⛔ GATE: user approves PR → GitHub Worker merges to main
        ▼
[7] DOCUMENTATION   Docs Agent: update README/docs/changelog
        ▼
[8] RELEASE         Release Agent: version, notes, artifact
        │            ⛔ GATE: user approves release → GitHub Release
        ▼
[9] DONE            Finished software in GitHub; project state archived
```

### 5.2 Control characteristics
- **Loops, not a straight line.** QA failures route back to engineering automatically until criteria pass or the user intervenes.
- **Approval gates** at three consequential points by default (architecture, merge, release); each is configurable per project.
- **Parallelism where safe.** Independent backlog tasks can run engineering concurrently; merges serialize through gates.
- **Resumable.** Pipeline state persists; closing the app and reopening resumes where it left off.
- **Every transition is an event** → visible in the UI and written to the audit log.

### 5.3 Handoff discipline
Workers communicate only via the manager and shared context. A worker's `handoff` field names the next role and the artifacts it produced; the manager decides what actually happens next based on workflow state and gates. This keeps a single point of control and a clean audit trail.

---

## 6. Desktop UI Concept

A supervisor's cockpit — calm, status-first, approval-driven. Not an IDE.

### 6.1 Primary surfaces

| Surface | Purpose |
|---|---|
| **Project Intake** | A single prompt: *"Describe what you want to build."* Plus optional repo target and constraints. This is the main entry point. |
| **Pipeline Board** | The SDLC pipeline (§5.1) as a live kanban/flow: each phase shows its worker, status, and current artifact. The heartbeat of the product. |
| **Worker Panels** | Per-worker live view: what the CTO/Engineer/QA/Docs/Release worker is doing right now, with streamed output. |
| **Approval Center** | The queue of pending gates (architecture, PR merge, release). One place to review the artifact and approve/reject with comments. |
| **Activity / Audit Log** | Chronological stream of every action across workers — searchable, exportable. |
| **Artifact & Repo View** | Links to the GitHub repo, branches, PRs, test reports, docs, releases produced by the project. |

### 6.2 Interaction model
```
┌───────────────────────────────────────────────────────────────┐
│  SJ Dev Manager                              ● 2 approvals due  │
├───────────────┬───────────────────────────────────────────────┤
│ PROJECTS      │  PIPELINE: "Inventory tracker app"             │
│ • Inventory   │  [Intake ✓]→[Arch ✓]→[Eng ◐]→[QA ·]→[Merge]…   │
│   tracker     │                                                 │
│ • Landing page│  WORKER: Engineer (Claude Code)                 │
│ + New project │   ▸ implementing: "CRUD API for items"          │
│               │   ▸ branch: feat/items-api  → PR #4 (draft)     │
│               │                                                 │
│               │  APPROVALS DUE                                  │
│               │   ⛔ Architecture sign-off — review & approve   │
└───────────────┴───────────────────────────────────────────────┘
```

### 6.3 Principles
- **Describe-once, supervise-thereafter.** The user types intent, then mostly approves.
- **Status over detail.** Surface what's happening and what needs a decision; deep detail on demand.
- **Approvals are unmissable.** Pending gates are always visible and quick to resolve.

---

## 7. Future Roadmap

| Phase | Theme | Outcome |
|---|---|---|
| **R0** | Foundations | Desktop shell, orchestrator skeleton, project + repo binding, event/audit/secrets. |
| **R1** | Two-worker core | CTO (ChatGPT) + Engineer (Claude Code) + GitHub Worker; intake → architecture → code → PR. |
| **R2** | Quality loop | QA Agent + automated test loop + merge gate. |
| **R3** | Docs & Release | Documentation Agent + Release Agent → full intake-to-release pipeline. |
| **R4** | Multi-project & parallelism | Concurrent projects; parallel safe-task engineering. |
| **R5** | Enterprise controls | Role-based approvals (maker/checker), audit export, policy profiles, SSO. |
| **R6** | Extensible workers | Pluggable worker marketplace; swap/add providers per role; custom roles. |
| **R7** | Autonomy & scheduling | Recurring/triggered builds, self-healing QA loops, longer autonomous runs. |
| **R8** | Convergence with SJ OS | Run SJ Dev Manager as an application on the SJ OS kernel; shared engine/worker substrate. |

---

## 8. MVP Scope

**MVP goal:** Prove the core loop — *user intent → architecture → code → PR on GitHub* — with real workers and human gates. The smallest thing that demonstrates the vision end-to-end.

### 8.1 In scope (MVP)
- **Single project** at a time, bound to one GitHub repository.
- **Three workers:** CTO (ChatGPT), Engineer (Claude Code), GitHub Worker.
- **Pipeline phases:** Intake → Architecture (gated) → Engineering → PR (gated merge).
- **Desktop UI:** Intake screen, Pipeline Board, Approval Center, Activity Log.
- **Approval gates:** architecture sign-off + PR merge.
- **Foundations:** event bus, audit log, secrets vault, shared context.

### 8.2 Out of scope (MVP — deferred)
- QA, Documentation, and Release workers (R2–R3).
- Multi-project and parallel engineering (R4).
- Role-based/multi-approver workflows, SSO (R5).
- Worker marketplace / custom roles (R6).
- Scheduling/autonomous runs (R7).

### 8.3 MVP success criteria
1. A user describes a small app in plain language.
2. ChatGPT produces an architecture + task breakdown the user approves.
3. Claude Code implements at least one task and opens a PR on GitHub.
4. The user approves the PR and it merges to `main`.
5. Every step is visible in the UI and recorded in the audit log.

---

## 9. Technical Stack Recommendation

| Layer | Recommendation | Rationale |
|---|---|---|
| **Desktop shell** | **Electron + React + TypeScript** | Consistent with SJ OS direction; Node-native integration with Claude/OpenAI SDKs, GitHub APIs, and tooling. One language across kernel and UI. |
| **Orchestrator core** | **TypeScript (Electron main process)** | Strong typing for worker/workflow contracts; shares process model with the shell. |
| **Architecture worker** | **OpenAI / ChatGPT API** | Planning/architecture role; behind a swappable provider interface. |
| **Engineer worker** | **Claude Code (Anthropic)** | Primary coding engine; Opus 4.8 for hard work, Sonnet 4.6 routine, Haiku 4.5 cheap steps — config-driven model IDs. |
| **QA/Docs/Release workers** | **Claude or GPT behind role interfaces** | Provider per role is configuration, decided per worker as built (R2–R3). |
| **Version control** | **GitHub (REST/GraphQL API + Git)** | Single source of truth; PRs, merges, releases. |
| **Worker abstraction** | **Role/Provider interfaces** | Roles fixed; providers swappable and independently upgradable. |
| **Persistence** | **Local-first store (project state, shared context, audit)** | Resumable pipelines; PII/code stays local except what goes to GitHub. |
| **Secrets** | **OS keychain (Windows DPAPI / Credential Manager)** | API keys + GitHub tokens never in plaintext or the repo. |
| **Monorepo tooling** | **pnpm workspaces + Turborepo** | Clean boundaries: orchestrator, workers, UI, shared. |
| **Eventing/observability** | **Typed in-process event bus + append-only audit** | Live UI updates + compliance trail. |

> Stack deliberately mirrors SJ OS so the two products converge (R8) without rework.

---

## 10. Risks and Mitigation

| # | Risk | Impact | Mitigation |
|---|---|---|---|
| R-1 | **Worker output quality varies** (bad architecture or buggy code) | Wrong or broken software | Acceptance criteria from CTO phase; QA loop (R2); human approval gates; replan-on-failure in the workflow engine. |
| R-2 | **Hallucinated/incorrect code merged** | Production defects | Default merge gate + QA gate; PR review surfaced in UI; nothing reaches `main` without approval. |
| R-3 | **Runaway cost / token spend** | Budget blowout | Per-project budgets, model tiering (Haiku/Sonnet/Opus by difficulty), step caps, cost visible in UI. |
| R-4 | **Credential/secret leakage** | Security incident | OS keychain vault, scoped tokens, secrets never in repo or logs, audit of access. |
| R-5 | **Multi-provider coupling / lock-in** | Hard to adapt | Role/provider abstraction; providers swappable behind interfaces; no worker imports another. |
| R-6 | **GitHub as single point of failure** | Work blocked | Local-first artifact store mirrors state; retries and offline queueing for Git operations. |
| R-7 | **Inter-worker coordination errors** | Stalled or looping pipeline | Workers never talk directly — all handoffs through the manager; explicit state machine; loop limits with human escalation. |
| R-8 | **Over-automation erodes trust** | Users disengage / fear loss of control | Human gates at consequential points; full transparency via activity log; everything reversible (branches/PRs). |
| R-9 | **Scope creep toward "an IDE"** | Diluted product, slow MVP | Strict MVP scope (§8); the product is a *manager/supervisor cockpit*, not an editor. |
| R-10 | **Compliance/auditability gaps** | Enterprise blockers | Append-only audit, approval records, exportable trails designed in from R0. |
| R-11 | **Long-running autonomy reliability** | Failed unattended runs | Phased autonomy (R7), resumable pipelines, health checks, kill switch. |
| R-12 | **Provider API changes/outages** | Pipeline breakage | Versioned provider adapters, graceful degradation, ret/fallback model config. |

---

## Appendix — Glossary

| Term | Meaning |
|---|---|
| **Worker** | An AI agent fulfilling one SDLC role (CTO, Engineer, QA, Docs, Release, GitHub). |
| **Role** | The fixed responsibility (e.g., "Engineer"); the provider behind it is swappable. |
| **Provider** | The concrete model/service implementing a role (ChatGPT, Claude Code, …). |
| **Gate** | A human-approval checkpoint that suspends the pipeline until resolved. |
| **Shared Context** | The project's living memory passed to workers (requirements, architecture, code map, status). |
| **Handoff** | A worker's declaration of what it produced and which role should act next — executed by the manager. |
| **Artifact** | Any concrete output (plan, PR, test report, docs, release) tracked with provenance. |

---

*End of Product Specification v0.1 — awaiting approval. No source code will be created until this is approved.*
