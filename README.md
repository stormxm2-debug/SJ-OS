# SJ AI Company

A desktop **AI engineering organization**. The CEO (the user) gives one instruction;
a company of specialized AI workers does the rest. SJ Dev Manager is the first
internal product of SJ AI Company.

> This repository currently contains the **MVP shell only** — desktop UI and
> project structure. No AI implementation, business logic, or automation yet.
> See [`docs/`](./docs) for the product spec, architecture, roadmap, worker
> definitions, and security model.

## Tech stack

- **Electron** — desktop runtime (Node backend in the main process)
- **React + TypeScript** — renderer UI
- **Tailwind CSS** — styling
- **electron-vite** — build/dev tooling

## Project structure

```
src/
  main/        Electron main process (Node backend)
  preload/     Secure, typed IPC bridge (contextIsolation on)
  renderer/    React UI (the CEO command center)
  shared/      Cross-cutting types + provider/plugin contracts (structure only)
docs/          Product & architecture documentation
```

## Commands

```bash
npm install        # install dependencies
npm run dev        # launch the app in development (HMR)
npm run build      # type-check + build main, preload, renderer
npm run typecheck  # type-check only
npm run start      # preview a production build
```

## Status

Milestone 1 — Foundation & shell frame. Subsequent milestones build the CEO
Dashboard panels and the six AI workers (UI only), then wire orchestration.
