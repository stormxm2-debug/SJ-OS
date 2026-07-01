# SJ Dev Manager — Security

| Field | Value |
|---|---|
| **Product** | SJ Dev Manager |
| **Document** | Security Architecture & Policy |
| **Version** | 1.0 (Draft for approval) |
| **Status** | Documentation only — no source code until approved |
| **Date** | 2026-06-30 |

> Companion documents: `PRODUCT_SPEC.md`, `ARCHITECTURE.md`, `ROADMAP.md`, `AI_WORKERS.md`.

---

## Security principles

1. **Least privilege** — every worker gets only the access its role requires, scoped and time-limited.
2. **Human-gated risk** — consequential and irreversible actions stop for human approval by default.
3. **Secrets never travel as plaintext** — not in the repo, not in logs, not in worker prompts.
4. **Everything is auditable** — every action and decision is recorded immutably.
5. **Reversible by design** — branch-per-task and PR-based merges mean any change can be reviewed and rolled back.
6. **Fail safe** — on doubt, deny; a global kill switch halts all autonomous activity instantly.

---

## 1. API Key Safety

**Scope:** Anthropic (Claude), OpenAI (ChatGPT), GitHub tokens, and any future provider credentials.

- **Storage:** OS keychain only — Windows DPAPI / Credential Manager. Never in source, config files, environment dumps, or the repository.
- **Access:** The main process is the **only** holder of keys. The renderer/UI never sees a key. Workers receive **scoped, short-lived handles**, not raw secrets.
- **In transit:** Keys are used only for direct provider/GitHub calls over TLS; never embedded in prompts, artifacts, or commit content.
- **Rotation & revocation:** Keys can be rotated/revoked from the vault without code changes; revocation takes effect immediately.
- **Redaction:** Any value matching a known key/token pattern is redacted before logging or display (see §5).
- **No echo:** Workers are prohibited from printing, committing, or returning credential material; outputs are scanned for secret patterns before persistence.

---

## 2. GitHub Safety

GitHub is the single source of truth, so write operations are tightly controlled.

- **Scoped tokens:** Use the narrowest token scope needed (repo-scoped, not org-wide). Tokens live in the vault (§1).
- **Protected `main`:** Direct writes to `main` are forbidden. All changes land on short-lived feature/task branches and reach `main` only via pull request.
- **Gated write actions:** `push`, `merge`, `tag`, and `release` are **approval-gated** by default (§3). Reads (clone/pull/PR view) are not gated.
- **Provenance:** Every commit/PR is linked to its originating task and audit entries; AI-authored commits carry a co-author trailer for traceability.
- **No force-push / no history rewrite** on shared branches without explicit, separate approval.
- **Local-first mirror:** Artifacts are mirrored locally so a GitHub outage never loses work; Git operations retry safely.
- **Repository allow-list:** A project can only write to the repository it is bound to; cross-repo writes require re-binding and approval.

---

## 3. Approval System

The human approval system is the platform's primary safety control.

**Decision model**
```
Action → classify sensitivity → Policy decision:
   auto-allow   | require-approval | deny
```

**Default gates (MVP and beyond)**
| Gate | Trigger |
|---|---|
| **Architecture sign-off** | Before engineering begins. |
| **Merge approval** | Before any PR merges to `main`. |
| **Release approval** | Before any GitHub Release. |
| **Sensitive-action approval** | Pushes, destructive commands, data egress, irreversible operations. |

**Behavior**
- On a gated action, the pipeline **suspends** and surfaces an approval request in the UI Approval Center.
- The operator approves or rejects **with comments**; the decision (who, when, context) is written to the audit log.
- Gates are **configurable per project** — operators may relax specific low-risk capabilities to auto-allow over time, but the safe default is require-approval.
- **Kill switch:** a global control immediately halts all autonomous execution across all projects.
- **Future:** role-based approvals (maker/checker) and multi-approver thresholds for high-risk actions (Roadmap Phase 8).

---

## 4. Dangerous Command Protection

AI workers (especially the Claude Developer Agent) may propose shell/file/Git operations. These are filtered before execution.

**Controls**
- **Workspace confinement:** File and command operations are restricted to the bound project workspace. Paths outside it are denied.
- **Deny-list (hard block):** Irrecoverable or system-level operations are blocked outright — e.g. recursive force deletes of system/home paths, disk-format/partition commands, ownership/permission wipes, fork bombs, piping remote scripts directly into a shell, and history-destroying Git operations on shared branches.
- **Gate-list (approval required):** Potentially destructive-but-legitimate actions require approval — e.g. force-push, branch deletion, dependency removal, bulk file deletion, network calls to non-allow-listed hosts.
- **Allow-list (auto):** Safe, reversible operations within the workspace (read files, run tests, create branches, write within the project) proceed without prompting.
- **Dry-run / preview:** High-impact actions can be previewed (what would change) before any approval is requested.
- **No silent escalation:** A worker cannot widen its own permissions; any privilege change is an explicit, audited operator action.
- **Timeouts & limits:** Long-running or runaway operations hit time/step/cost limits and escalate to a human rather than continuing unbounded.

---

## 5. Logging Rules

Logging serves observability and compliance — without becoming a leak channel.

- **Audit log (append-only):** Every model call, tool/command invocation, GitHub write, gate decision, and approval is recorded immutably, hash-chained, and queryable. This is the compliance record.
- **Activity stream:** A human-readable event feed mirrors pipeline progress to the UI in real time.
- **Secret redaction:** All log sinks pass through a redaction filter; values matching credential/token patterns are masked. **No raw secrets are ever logged.**
- **PII discipline:** Source code and project data stay local; logs avoid storing user data beyond what is needed for traceability. Logs support targeted deletion (right-to-erasure).
- **No sensitive content in commits/PRs:** Outputs are scanned for secrets/PII before they are committed or pushed.
- **Tamper evidence:** Audit entries are integrity-protected; gaps or alterations are detectable.
- **Retention & export:** Audit logs are retained per policy and exportable for enterprise review (Roadmap Phase 8). Operational logs follow a defined retention window.
- **Failure logging:** Denied actions, gate rejections, and limit-triggered halts are logged with reason, so security decisions are reviewable.

---

## Security responsibility map

| Concern | Owning component |
|---|---|
| Key storage & scoped release | Secrets Vault (main process) |
| Gate decisions | Approval / Policy Gates |
| Command filtering | Dangerous-command protection layer |
| GitHub write control | Git Manager Agent + Policy Gates |
| Immutable record | Audit Log |
| Real-time visibility | Event Bus / Activity Stream |
| Emergency stop | Global kill switch |

---

*End of Security Architecture & Policy — awaiting approval. No source code will be created until approved.*
