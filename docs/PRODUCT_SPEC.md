# SJ Dev Manager — Product Specification

| Field | Value |
|---|---|
| **Product** | SJ Dev Manager |
| **Document** | Product Specification |
| **Version** | 1.0 (Draft for approval) |
| **Status** | Documentation only — no source code until approved |
| **Date** | 2026-06-30 |

> Companion documents: `ARCHITECTURE.md`, `ROADMAP.md`, `AI_WORKERS.md`, `SECURITY.md`.

---

## 1. What SJ Dev Manager Is

SJ Dev Manager is an **AI software development manager** — a desktop application that coordinates a team of specialized AI workers to take a project from a plain-language description to finished, version-controlled software.

The user describes **what** they want to build. SJ Dev Manager owns the **how**: it delegates architecture, engineering, testing, documentation, and release to the right AI worker, keeps GitHub as the single source of truth, and pauses for human approval at the moments that matter.

```
USER  →  SJ DEV MANAGER  →  AI WORKERS  →  GITHUB  →  FINISHED SOFTWARE
(intent)   (the manager)     (the team)    (truth)     (the product)
```

It is **not** an IDE, **not** a chatbot, and **not** a single coding assistant. It is a **manager** that runs an AI engineering team.

---

## 2. Target User

| Segment | Description | Why they need it |
|---|---|---|
| **Primary — Non-engineer builders** | Founders, product owners, domain experts (e.g., insurance operators) who know *what* they want but cannot build it. | Turns intent into shipped software without hiring an engineering team. |
| **Secondary — Solo developers & small teams** | Engineers who want to multiply their output by supervising AI workers instead of writing every line. | Acts as a force multiplier — they manage, the workers build. |
| **Tertiary — Enterprises** | Teams needing repeatable, auditable, governed AI-assisted delivery. | Provides approval gates, audit trails, and GitHub-of-record out of the box. |

**The user's role:** describe intent, review artifacts, approve at checkpoints. Not writing code.

---

## 3. Main Problem

Building software still requires a coordinated team of specialists — architects, engineers, testers, technical writers, release engineers — plus the management to keep them aligned. This is **slow, expensive, and inaccessible** to the people who most often know what needs to be built.

Existing AI coding tools address only *one seat* on that team (the engineer) and still demand an engineer to drive them. **No one is doing the management** — turning intent into a plan, delegating across specialized workers, enforcing quality, and shipping.

**The gap:** there is an AI for coding, but no AI *engineering manager* that coordinates the whole lifecycle on the user's behalf.

---

## 4. Core Value

1. **Describe, don't build.** The only required input is intent; the system does the engineering.
2. **A whole team, not one tool.** Specialized workers for each SDLC phase, coordinated by one manager.
3. **GitHub as the source of truth.** Every artifact is versioned, reviewable, and reversible.
4. **Control without keystrokes.** Human approval at consequential gates (architecture, merge, release) — not every line.
5. **Transparent and auditable.** Every worker action is visible and logged — enterprise-ready governance.
6. **Provider-agnostic.** Workers are roles; the AI behind each role is swappable and upgradable.

**The promise:** *You describe it. SJ Dev Manager builds, tests, documents, and ships it — and you stay in control.*

---

## 5. MVP Scope

**MVP goal:** Prove the core loop end-to-end — *user intent → architecture → code → pull request on GitHub* — with real AI workers and human approval gates.

### In scope (MVP)
- **Single project**, bound to one GitHub repository.
- **Three workers:** CTO Agent (architecture), Claude Developer Agent (engineering), Git Manager Agent (version control).
- **Pipeline:** Intake → Architecture *(gated)* → Engineering → Pull Request *(gated merge)*.
- **Desktop UI:** Intake, Pipeline Board, Approval Center, Activity Log.
- **Foundations:** orchestrator, event/activity log, audit, secrets vault, shared project context.

### Out of scope (MVP — deferred)
- QA, Documentation, and Release workers.
- Multi-project and parallel engineering.
- Role-based / multi-approver workflows, SSO.
- Worker marketplace and custom roles.
- Scheduled or autonomous unattended runs.

### MVP success criteria
1. The user describes a small app in plain language.
2. The CTO Agent produces an architecture + task breakdown the user approves.
3. The Claude Developer Agent implements at least one task and opens a PR on GitHub.
4. The user approves the PR and it merges to `main`.
5. Every step is visible in the UI and recorded in the audit log.

---

*End of Product Specification — awaiting approval. No source code will be created until approved.*
