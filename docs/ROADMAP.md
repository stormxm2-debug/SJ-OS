# SJ Dev Manager — Roadmap

| Field | Value |
|---|---|
| **Product** | SJ Dev Manager |
| **Document** | Development Roadmap (Phase 0 → Phase 10) |
| **Version** | 1.0 (Draft for approval) |
| **Status** | Documentation only — no source code until approved |
| **Date** | 2026-06-30 |

> Companion documents: `PRODUCT_SPEC.md`, `ARCHITECTURE.md`, `AI_WORKERS.md`, `SECURITY.md`.

---

## Guiding principle

**MVP first, automation later.** Each phase ends with something runnable and demoable, building strictly on the previous one. We prove the core human-supervised loop before adding workers, then add autonomy and scale only once the foundation is trustworthy.

```
Phases 0–4  →  MVP  (intent → architecture → code → PR, human-gated)
Phases 5–7  →  Full team  (QA, Docs, Release; multi-project)
Phases 8–10 →  Automation & enterprise  (autonomy, governance, scale)
```

---

## Phase 0 — Foundations
**Theme:** Project skeleton and guardrails.
- Monorepo scaffold (pnpm + Turborepo), TypeScript/lint/test config, CI.
- Empty Electron shell that launches to a blank workspace.
- Secrets vault, audit log, and event bus skeletons.
**Exit:** the app launches; foundations exist; no business logic yet.

## Phase 1 — Orchestrator Core
**Theme:** The manager's spine.
- Project Manager (create project, bind GitHub repo).
- Workflow Engine state machine + Shared Context store.
- Approval Gates framework + global kill switch.
**Exit:** a project can be created and walked through an empty pipeline with working gates.

## Phase 2 — First Worker: CTO Agent (ChatGPT)
**Theme:** Intent → architecture.
- ChatGPT provider behind the Worker role interface.
- Intake screen + Architecture phase + architecture approval gate.
**Exit:** user describes intent → CTO Agent returns an architecture + task breakdown → user approves.

## Phase 3 — Engineering Worker: Claude Developer Agent
**Theme:** Architecture → code.
- Claude provider (model tiering by difficulty).
- Engineering phase: implement a task into the project workspace.
**Exit:** an approved task is implemented as code in a feature branch.

## Phase 4 — Git Manager Agent + MVP Complete
**Theme:** Code → pull request on GitHub.
- Git Manager Agent: branch, commit, open PR; merge gate.
- Pipeline Board + Approval Center + Activity Log wired end-to-end.
**Exit (MVP):** intent → architecture → code → PR → approved merge to `main`, fully visible and audited.

## Phase 5 — QA Agent
**Theme:** Quality loop.
- QA Agent: test plan, automated tests, execution reports.
- Automatic loop-back to engineering on failure; quality gate before merge.
**Exit:** no PR merges until QA passes (configurable).

## Phase 6 — Documentation Agent
**Theme:** Understandable software.
- Docs Agent: README, usage/API docs, changelog, inline doc review.
**Exit:** every merged feature is documented automatically.

## Phase 7 — Release Agent + Multi-Project
**Theme:** Shipping and scale-out.
- Release Agent: versioning, release notes, build artifact, GitHub Release (release gate).
- Multiple concurrent projects; parallel engineering for independent tasks.
**Exit:** full intake-to-release pipeline; more than one project at a time.

## Phase 8 — Enterprise Controls
**Theme:** Governance.
- Role-based approvals (maker/checker), multi-approver thresholds.
- Audit export, policy profiles per project, SSO/identity integration.
**Exit:** the platform meets enterprise governance and compliance needs.

## Phase 9 — Extensible Workers
**Theme:** Openness.
- Worker marketplace: swap/add providers per role; custom roles.
- Versioned provider adapters and compatibility checks.
**Exit:** new workers and providers can be added without core changes.

## Phase 10 — Automation & Autonomy
**Theme:** Hands-off delivery.
- Scheduled/triggered builds, self-healing QA loops, longer autonomous runs.
- Hardening, packaging/signing, v1 release.
- (Convergence path: run SJ Dev Manager as an application on the SJ OS kernel.)
**Exit:** supervised autonomy — the system can take intent to shipped software with minimal human touch, safely.

---

## Phase → Worker map

| Phase | Workers active |
|---|---|
| 0–1 | (none — foundations + orchestrator) |
| 2 | CTO Agent |
| 3 | CTO + Claude Developer |
| 4 | CTO + Claude Developer + Git Manager **(MVP)** |
| 5 | + QA Agent |
| 6 | + Documentation Agent |
| 7 | + Release Agent (full team) |
| 8–10 | full team + governance, extensibility, autonomy |

---

*End of Roadmap — awaiting approval. No source code will be created until approved.*
