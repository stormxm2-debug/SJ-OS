# SJ Dev Manager — AI Workers

| Field | Value |
|---|---|
| **Product** | SJ Dev Manager |
| **Document** | AI Worker Definitions |
| **Version** | 1.0 (Draft for approval) |
| **Status** | Documentation only — no source code until approved |
| **Date** | 2026-06-30 |

> Companion documents: `PRODUCT_SPEC.md`, `ARCHITECTURE.md`, `ROADMAP.md`, `SECURITY.md`.

---

## Model

Each worker is a **role** with a fixed responsibility, fulfilled by a swappable **provider**, and coordinated by the orchestrator. **Workers never communicate directly** — they receive a task + scoped shared context from the manager and return a result plus a declared handoff. The manager decides what happens next.

**Common worker contract**
```
Worker:
  describe()              → role, capabilities, required inputs
  execute(task, context)  → WorkerResult { output, artifacts[], handoff }
  status()                → health, current task
```

Each worker below is specified as **Purpose · Responsibilities · Inputs · Outputs · Provider · Gate · Handoff**.

---

## 1. CEO Interface
*The human-facing layer — the user's seat at the table.*

- **Purpose:** Capture the user's intent and surface decisions back to them. This is where the user "describes what they want to build" and approves at gates.
- **Responsibilities:** Project intake (plain-language description + optional constraints/repo target); present artifacts for review; collect approvals/rejections with comments; expose pipeline status.
- **Inputs:** User intent, constraints, approval decisions.
- **Outputs:** A structured project request; resolved approval outcomes.
- **Provider:** The human (assisted by the UI). Not an AI model — it is the command surface for the operator.
- **Gate:** N/A (it *is* the gate-resolution surface).
- **Handoff:** → CTO Agent (a new/updated project request); ← receives gate requests from any worker.

---

## 2. CTO Agent
*Architecture and planning.*

- **Purpose:** Translate user intent into a buildable plan.
- **Responsibilities:** Clarify requirements; design system architecture; choose technology; produce a sequenced task breakdown with acceptance criteria.
- **Inputs:** Project request from the CEO Interface; shared context.
- **Outputs:** Architecture document, tech-stack proposal, task backlog, acceptance criteria.
- **Provider:** ChatGPT (OpenAI), behind the swappable Worker interface.
- **Gate:** **Architecture sign-off** by the user before engineering begins.
- **Handoff:** → Claude Developer Agent (approved architecture + first task).

---

## 3. Claude Developer Agent
*Software engineering.*

- **Purpose:** Implement the approved plan, task by task.
- **Responsibilities:** Write source code and unit tests; follow the architecture and acceptance criteria; commit to feature branches; prepare pull requests.
- **Inputs:** An approved task + scoped context (architecture, code map, criteria).
- **Outputs:** Source code, unit tests, commits, a pull request (written through the Git Manager Agent).
- **Provider:** Anthropic Claude — model tiering by difficulty (Opus 4.8 hard, Sonnet 4.6 routine, Haiku 4.5 cheap), config-driven.
- **Gate:** Sensitive/irreversible actions (push, destructive commands) flow through approval + dangerous-command protection (`SECURITY.md`).
- **Handoff:** → Git Manager Agent (commits/PR); → QA Agent (work to verify); → Documentation Agent (work to document).

---

## 4. Git Manager Agent
*Version control — the system of record.*

- **Purpose:** Make GitHub the single source of truth; all artifact writes flow through here.
- **Responsibilities:** Repo creation/binding; branch management; commits; pull requests; merges; tags; releases; artifact persistence with provenance.
- **Inputs:** Change sets and artifacts from other workers; merge/release approvals.
- **Outputs:** Branches, commits, PRs, merges, tags, GitHub Releases.
- **Provider:** GitHub (REST/GraphQL + Git), driven programmatically; tokens from the secrets vault.
- **Gate:** **Push / merge / release are gated actions** — never automatic by default.
- **Handoff:** → returns repo state to the manager; merge completion advances the pipeline.

---

## 5. QA Agent
*Testing and verification.*

- **Purpose:** Verify the engineer's work meets acceptance criteria before it merges.
- **Responsibilities:** Produce test plans; write/run automated tests; report results; file defects back to the engineer.
- **Inputs:** A pull request + acceptance criteria + shared context.
- **Outputs:** Test plan, test suite, execution report, defect reports.
- **Provider:** Claude or GPT behind the Worker interface (decided per worker when built).
- **Gate:** **Quality gate** — merge blocked until QA passes (configurable).
- **Handoff:** PASS → manager proceeds to merge; FAIL → loops back to Claude Developer Agent with defects.

---

## 6. Documentation Agent
*Keeping the project understandable.*

- **Purpose:** Ensure every shipped feature is documented.
- **Responsibilities:** Maintain README, usage/API docs, architecture notes, changelog entries; review inline documentation.
- **Inputs:** Merged code + architecture + change history.
- **Outputs:** Updated documentation and changelog (committed through the Git Manager Agent).
- **Provider:** Claude or GPT behind the Worker interface.
- **Gate:** None by default (documentation is non-destructive); commits still flow through version control.
- **Handoff:** → Release Agent (docs ready for the release bundle).

---

## 7. Release Agent
*Shipping.*

- **Purpose:** Turn merged, tested, documented work into a release.
- **Responsibilities:** Version bump; generate release notes; produce the build/release artifact; create the GitHub Release.
- **Inputs:** Merged main branch + docs + changelog.
- **Outputs:** Version tag, release notes, release artifact, GitHub Release.
- **Provider:** Claude or GPT behind the Worker interface, plus the Git Manager Agent for the actual release.
- **Gate:** **Release approval** by the user.
- **Handoff:** → manager marks the milestone/project done; archives state.

---

## Worker interaction summary

```
CEO Interface ──intent──► CTO Agent ──(arch gate)──► Claude Developer Agent
      ▲                                                    │
      │ approvals/gates                                    ▼
      │                                          Git Manager Agent ◄──── all writes
      │                                                    │
      │                          QA Agent ◄── verify ──────┤
      │                          (fail → loop back to Developer)
      │                                                    ▼
      └──────────── Release Agent ◄── Documentation Agent ─┘
                    (release gate)

Rule: workers hand off ONLY through the manager + shared context.
```

---

*End of AI Worker Definitions — awaiting approval. No source code will be created until approved.*
