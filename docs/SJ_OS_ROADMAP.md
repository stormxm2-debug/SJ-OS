# SJ OS — Roadmap

| Field | Value |
|---|---|
| **Product** | SJ OS / SJ AI Company |
| **Goal** | An AI company operating system that can develop insurance software |
| **CEO** | The user |
| **CTO** | ChatGPT |
| **Lead Developer** | Claude Code |
| **Status** | Active — MVP shell + kernel and company layers in progress |

> Governance: [`../CTO_MANIFESTO.md`](../CTO_MANIFESTO.md),
> [`../CLAUDE.md`](../CLAUDE.md).
> Companion docs: [`ROADMAP.md`](./ROADMAP.md) (SJ Dev Manager product roadmap),
> [`ARCHITECTURE.md`](./ARCHITECTURE.md), [`PRODUCT_SPEC.md`](./PRODUCT_SPEC.md),
> [`AI_WORKERS.md`](./AI_WORKERS.md), [`SECURITY.md`](./SECURITY.md).

## Guiding principles

- **Stability first.** Each step ends with a runnable, type-safe, buildable tree.
- **No unnecessary redesign.** Build on the existing kernel, company, and
  provider layers.
- **Continue from the backlog and current state.** Advance work; do not reset it.

## Vision

SJ OS is the operating system for an AI company. The CEO gives an instruction;
a company of specialized AI workers plans, builds, reviews, and ships software.
The first proving ground is **insurance software** for SJ Invest, delivered
through the SJ Dev Manager product running on the SJ OS kernel.

## Current state (as of 2026-07-02)

Foundations are in place and building cleanly:

- **Kernel** (`src/shared/kernel/`) — workers, meetings, scheduler, message bus,
  asset store, and state.
- **Company layer** (`src/shared/company/`) — repository, state, events, and
  domain services (activity, approvals, tasks, notifications, sales, policy,
  customers, schedule, FC).
- **Providers** (`src/shared/providers/`) — Claude Code, mock, and
  provider-backed workers behind a common contract.
- **Renderer** — command center UI: dashboard, kernel views, worker pages,
  approval center, backlog, autonomous loop, and the Jarvis command layer.
- **Chief of Staff** (`src/shared/chief-of-staff/`) — classification, task
  planning, work queue, and status reporting.

## Phased plan

The SJ Dev Manager product roadmap (Phase 0 → Phase 10) in
[`ROADMAP.md`](./ROADMAP.md) remains the detailed delivery plan. SJ OS tracks it
at the platform level:

| Stage | Focus | Outcome |
|---|---|---|
| **Foundation** | Kernel, company layer, providers, UI shell | App launches; core layers build and typecheck. |
| **Orchestration** | Chief of Staff, backlog, autonomous loop | Instructions become planned, tracked work. |
| **Insurance delivery** | SJ Dev Manager pipeline on the kernel | Intent → architecture → code → PR, human-gated. |
| **Full team** | QA, Docs, Release workers; multi-project | Quality and shipping automated. |
| **Autonomy & governance** | Enterprise controls, extensible workers | Supervised autonomy at scale. |

## Working agreement

1. Inspect repository state and backlog before each change.
2. Reuse existing architecture; keep changes small and safe.
3. Verify with `npm run typecheck` and `npm run build`.
4. Commit with meaningful messages and push.
5. Stop and escalate on credentials, push failures, destructive steps, or
   unfixable build/typecheck breaks.
