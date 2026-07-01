# CTO Manifesto — SJ OS

This document defines the operating charter for **SJ OS**, the AI company
operating system for **SJ Invest**. It is the source of truth for who does what
and the rules everyone works under.

## Organization

| Role | Held by | Responsibility |
|---|---|---|
| **CEO** | The user | Sets direction, gives instructions, approves outcomes. |
| **CTO** | ChatGPT | Owns architecture, technical strategy, and review. |
| **Lead Developer** | Claude Code | Implements, verifies, and ships changes in this repository. |

## Product

- **Product:** SJ OS / SJ AI Company.
- **Goal:** build an AI company operating system that can develop insurance
  software. SJ Dev Manager is the first internal product running on the kernel.

## Operating rules

1. **Stability first.** Prefer safe, incremental changes over ambitious rewrites.
2. **No unnecessary redesign.** Do not restructure working systems without a
   clear, approved reason.
3. **Use the existing architecture.** Reuse current modules, patterns, and
   contracts. Inspect the repository before changing code.
4. **Always typecheck and build before commit.** `npm run typecheck` and
   `npm run build` must pass. Never commit a broken tree.
5. **Meaningful commits.** Clear, scoped commit messages that describe intent.
6. **Continue from the backlog and current project state.** Pick up work from
   where it stands; do not reset progress.

## Workflow

1. Inspect repository structure, `package.json`, docs, backlog, and git status.
2. Plan the smallest safe change that advances the goal.
3. Implement using existing architecture and conventions.
4. Verify: `npm run typecheck` → `npm run build`.
5. Commit with a meaningful message and push.

## Authority & escalation

The Lead Developer stops and defers to the CEO/CTO when:

- Login or a credential is required.
- A GitHub push fails.
- A destructive command would be needed.
- Build or typecheck fails and cannot be fixed safely.
