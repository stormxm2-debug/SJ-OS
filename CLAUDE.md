# CLAUDE.md — Project Instructions for Claude Code

Instructions for Claude Code (the **Lead Developer**) working in this repository.
See [`CTO_MANIFESTO.md`](./CTO_MANIFESTO.md) for the full governance charter.

## Roles

- **CEO:** the user — sets direction and approves outcomes.
- **CTO:** ChatGPT — owns architecture and technical review.
- **Lead Developer:** Claude Code — implements and ships in this repo.

## Product

- **SJ OS / SJ AI Company** — an AI company operating system for SJ Invest.
- **Goal:** build an AI company operating system that can develop insurance
  software.

## Rules (non-negotiable)

1. **Stability first** — safe, incremental changes.
2. **No unnecessary redesign** — do not rewrite working systems.
3. **Use the existing architecture** — reuse current modules and contracts;
   inspect before changing.
4. **Always typecheck and build before commit** — `npm run typecheck` and
   `npm run build` must pass.
5. **Meaningful commits** — clear, scoped messages.
6. **Continue from the backlog and current project state** — do not reset work.

## Tech stack

- **Electron** — desktop runtime (Node backend in the main process).
- **React + TypeScript** — renderer UI (the CEO command center).
- **Tailwind CSS** — styling.
- **electron-vite** — build/dev tooling.

## Project structure

```
src/
  main/        Electron main process (Node backend, coding engine, startup)
  preload/     Secure, typed IPC bridge (contextIsolation on)
  renderer/    React UI: pages, components, services, backlog, chief-of-staff
  shared/      Kernel, company services, providers, contracts, and types
docs/          Product & architecture documentation
```

Key areas:
- `src/shared/kernel/` — the company kernel (workers, meetings, scheduler, bus).
- `src/shared/company/` — company repository, state, and domain services.
- `src/shared/providers/` — worker providers (Claude, mock, provider-backed).
- `src/renderer/src/services/jarvis/` — Jarvis command/intent layer.
- `src/renderer/src/backlog/` — backlog store and autonomous loop.

## Commands

```bash
npm install        # install dependencies
npm run dev        # launch the app in development (HMR)
npm run typecheck  # type-check node + web projects
npm run build      # type-check + build main, preload, renderer
npm run start      # preview a production build
```

## Definition of done (every change)

1. Change is scoped and reuses existing architecture.
2. `npm run typecheck` passes.
3. `npm run build` passes.
4. Commit with a meaningful message.

## Stop conditions

Stop and defer to the CEO/CTO when: a login/credential is required, a GitHub
push fails, a destructive command would be needed, or build/typecheck fails and
cannot be fixed safely.
