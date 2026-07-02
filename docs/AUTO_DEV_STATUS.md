# SJ OS — Auto Dev Status

A running status log of the Jarvis / OpenAI-proxy workstream. Newest first.
No secrets are ever recorded here.

## Proxy env-loading fix (2026-07-02)

**Problem:** with `sj-ai-proxy/.env` set (`OPENAI_ENABLED=true`, key present),
`npm run dev` still logged `enabled=false` / `keyConfigured=false` — `server.mjs`
read `process.env` without loading the `.env` file.

**Fix:** added `dotenv` and load `sj-ai-proxy/.env` resolved relative to the
server file (via `import.meta.url`) before any `process.env` read, so it works
regardless of the launch cwd.

- ✅ Verified: startup log → `enabled=true keyConfigured=true ready=true`;
  `GET /ai/status` → `enabled: true, apiKeyConfigured: true, ready: true`.
- ✅ Startup log still prints booleans only — the key is never logged or exposed.
- ✅ No `.env` committed; no key in the diff.

## Sprint 3C-4 — Local proxy verification (2026-07-02)

**Goal:** run and verify the SJ AI Proxy locally; document exact safe steps for
the CEO to add `OPENAI_API_KEY` without exposing secrets.

- ✅ `sj-ai-proxy` dependencies installed (`npm install` → 90 packages,
  0 vulnerabilities). `package-lock.json` created.
- ✅ `npm run check` (`node --check server.mjs`) passes.
- ✅ Proxy started locally on **:8787** and endpoints verified with defaults
  (no key):
  - `GET /health` → `status: "ok"`, `openaiEnabled: false`,
    `apiKeyConfigured: false`, `model: "gpt-4o-mini"`, `environment: "development"`.
  - `GET /ai/status` → `enabled: false`, `apiKeyConfigured: false`,
    `ready: false`, Korean disabled message.
  - `POST /ai/chat` → `success: true`, `source: "fallback"`, `disabled: true`
    (safe fallback; no upstream call).
- ✅ No secrets exposed by any endpoint; no `.env` committed.
- ✅ Docs updated with Windows PowerShell exact steps (`OPENAI_PROXY_SETUP.md`).
- ✅ Renderer proxy client default URL confirmed as `http://localhost:8787`
  (`VITE_AI_PROXY_URL`), matching the proxy port.

**Not done (by design / needs CEO):** real OpenAI call — requires the CEO to set
`OPENAI_ENABLED=true` and a real `OPENAI_API_KEY` in `sj-ai-proxy/.env` locally
(backend only). GPT stays disabled by default.

## Status snapshot

| Area                         | State                                            |
| ---------------------------- | ------------------------------------------------ |
| Proxy `/health`, `/ai/status`| ✅ verified locally (disabled defaults)          |
| Proxy dependencies           | ✅ installed, lockfile committed                 |
| GPT brain (enabled)          | ⏳ awaiting CEO local key (backend `.env`)       |
| Secrets in repo              | ✅ none — `.env` gitignored, key never committed |
| `npm run typecheck` / `build`| ✅ passing                                       |
