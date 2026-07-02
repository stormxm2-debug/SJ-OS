# OpenAI Proxy Setup — SJ OS Jarvis GPT Brain

This document describes how to run the **SJ OS AI Proxy** (`sj-ai-proxy/`) that
gives Jarvis a GPT "brain" while keeping the OpenAI API key completely out of the
Electron renderer/frontend.

## Why a proxy is required

- **The OpenAI API key must never reach the client.** Electron renderer code
  (and any bundled frontend) is inspectable by the user. Anything shipped there
  — env vars included — is effectively public.
- The proxy is a tiny backend that holds the key server-side, adds it to the
  upstream OpenAI call, and returns only the completion text to the renderer.
- The renderer only ever knows the **proxy URL** and an **enabled flag**. It
  never sees, stores, or transmits the API key.

> **Never** put `OPENAI_API_KEY` in the renderer, in `VITE_*` variables, or in
> any file committed to the repo. Never commit a real `.env`.

## Architecture

```
Renderer (JarvisGptBrainService)
    │  POST /ai/chat  { message, mode, context, localSnapshot, conversationId? }
    ▼
sj-ai-proxy (Express, server.mjs)  ── holds OPENAI_API_KEY ──►  OpenAI API
    │  { success, answer, mode, model, usage? }
    ▼
Renderer renders the answer (source = gpt | fallback | disabled | error)
```

The renderer sends only a **sanitized** local snapshot built by
`ContextBuilder` — aggregate counts and status, never customer names or other
personal/sensitive data.

## Local environment variables

### Backend proxy — `sj-ai-proxy/.env` (copy from `.env.example`, never commit)

| Variable            | Default        | Purpose                                                      |
| ------------------- | -------------- | ------------------------------------------------------------ |
| `OPENAI_ENABLED`    | `false`        | Master switch. When `false`, `/ai/chat` returns a fallback.  |
| `OPENAI_API_KEY`    | _(empty)_      | Your OpenAI key. **Server-side only.**                       |
| `OPENAI_MODEL`      | `gpt-4o-mini`  | Model used for completions.                                  |
| `PORT`              | `8787`         | Port the proxy listens on.                                   |
| `CORS_ORIGIN`       | `*`            | Allowed renderer origin(s). Use a specific origin in prod.   |
| `OPENAI_TIMEOUT_MS` | `20000`        | Upstream request timeout.                                    |

### Renderer — root `.env` (copy from root `.env.example`, non-secret only)

| Variable                    | Default                     | Purpose                                        |
| --------------------------- | --------------------------- | ---------------------------------------------- |
| `VITE_AI_PROXY_ENABLED`     | `false`                     | Whether the renderer attempts to call the proxy. |
| `VITE_AI_PROXY_URL`         | `http://localhost:8787`     | Proxy base URL.                                |
| `VITE_AI_PROXY_MODEL_LABEL` | `gpt-4o-mini (server-side)` | Display-only label shown in Settings.          |

## Running the proxy locally

```bash
cd sj-ai-proxy
npm install                 # installs express + openai
cp .env.example .env        # then edit .env: set OPENAI_ENABLED=true and OPENAI_API_KEY
npm start                   # listens on :8787
```

Then, in the SJ OS root, set `VITE_AI_PROXY_ENABLED=true` (and the URL if not
default) in `.env` and run `npm run dev`.

## Render deployment env variables

`render.yaml` defines a `sj-ai-proxy` web service. Set secrets in the **Render
dashboard** (marked `sync: false`), not in the file:

- `OPENAI_ENABLED=true`
- `OPENAI_API_KEY=<your key>`  ← dashboard only, never committed
- `OPENAI_MODEL=gpt-4o-mini`
- `CORS_ORIGIN=<your renderer origin>`

Health check path is `/health`.

## Testing

### `/health`

```bash
curl http://localhost:8787/health
# { "ok": true, "service": "sj-ai-proxy", "enabled": false, "model": "gpt-4o-mini" }
```

`enabled` is `true` only when `OPENAI_ENABLED=true` **and** a key is present.

### `/ai/chat`

```bash
curl -X POST http://localhost:8787/ai/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"오늘 조직 상황 브리핑 해줘","mode":"business-briefing","localSnapshot":{}}'
```

- **Disabled / no key:** returns `{ success: true, source: "fallback", disabled: true, ... }`
  with a Korean setup message. No upstream call is made.
- **Enabled:** returns `{ success: true, source: "gpt", answer, model, usage }`.

## Fallback behavior

The system is **safe by default**:

- Proxy `OPENAI_ENABLED=false` (default) → `/ai/chat` returns the fallback
  message; no OpenAI call, no key needed.
- Renderer `VITE_AI_PROXY_ENABLED=false` (default) → Jarvis never calls the proxy
  and shows setup guidance instead. All local command-router features keep
  working unchanged.
- Timeouts and proxy/network errors return a Korean error message with a safe
  **retry** option in the Jarvis UI.

## GPT modes

`JarvisGptBrainService` selects a mode and the proxy maps it to a system prompt:

| Mode                     | Example command                             |
| ------------------------ | ------------------------------------------- |
| `business-briefing`      | "오늘 조직 상황 브리핑 해줘"                 |
| `data-question`          | "이번 달 실적에서 문제점 알려줘"             |
| `implementation-planning`| "이 기능 구현하려면 어떤 Sprint로 나눠야 해?" |
| `general-assistant`      | (default for free-form questions)           |
| `unknown-fallback`       | ambiguous/unrecognized commands             |
