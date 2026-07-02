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
    │  POST /ai/chat  { message, mode, context: { app, role, snapshot } }
    ▼
sj-ai-proxy (Express, server.mjs)  ── holds OPENAI_API_KEY ──►  OpenAI API
    │  { success, answer, mode, model, usage? }
    ▼
Renderer renders the answer (source = openai | fallback | disabled | backend | error)
```

The renderer sends only a **sanitized** local snapshot built by
`ContextBuilder` — aggregate counts and status, never customer names or other
personal/sensitive data.

## How Jarvis decides local vs GPT (hybrid router)

Jarvis is **local-first**. `IntentClassifier` inspects the command and routes it
in this order:

1. **GPT-needed?** — reasoning/analysis/strategy/planning language routes to the
   GPT brain (mode `gpt`). Triggers include `왜`, `분석해`, `전략`, `추천`,
   `문제점`, `개선점`, `브리핑`, `로드맵`, or a planning phrase (`스프린트`,
   `다음 기능`, `만들려면`) combined with a question suffix (`뭐야`, `할까`, `?`).
   These markers are chosen so they never steal a concrete build command.
2. **Implementation request** — concrete "do it" verbs (`추가해`, `구현해`,
   `수정해`, `스프린트로 올려`, …) create a routed implementation request locally.
3. **External action** — approved links (`유튜브 켜줘`, `SJ OS 깃허브 열어줘`).
4. **Briefing / control / navigation / answerable business question** — served
   locally from mock repository summaries (`오늘 일정`, `이번 달 실적`, `FCOS`).
5. **Unknown** — if the GPT brain is enabled, the command falls back to GPT;
   otherwise Jarvis shows local setup guidance.

The GPT sub-mode is one of: `business-briefing`, `strategy`, `data-question`,
`implementation-planning`, `general-assistant`.

Examples:

| Command                                        | Route                          |
| ---------------------------------------------- | ------------------------------ |
| `오늘 일정`                                     | local · answer                 |
| `유튜브켜줘` / `FCOS` / `오토파일럿열어줘`       | local · external / navigation  |
| `FC OS에 팀별 필터 추가해`                       | local · implementation-request |
| `오늘 조직 상황 브리핑 해줘`                     | GPT · business-briefing        |
| `이번 달 실적에서 문제점 분석해줘`               | GPT · data-question            |
| `미활동 FC 관리 전략 짜줘`                       | GPT · strategy                 |
| `우리 회사 앱 다음 기능 추천해줘`                | GPT · implementation-planning  |
| `자비스를 더 똑똑하게 만들려면 다음 스프린트 뭐야?` | GPT · implementation-planning  |

## Local environment variables

### Backend proxy — `sj-ai-proxy/.env` (copy from `.env.example`, never commit)

| Variable            | Default                                            | Purpose                                                     |
| ------------------- | -------------------------------------------------- | ----------------------------------------------------------- |
| `OPENAI_ENABLED`    | `false`                                            | Master switch. When `false`, `/ai/chat` returns a fallback. |
| `OPENAI_API_KEY`    | _(empty)_                                          | Your OpenAI key. **Server-side only.** Never commit.        |
| `OPENAI_MODEL`      | `gpt-4o-mini`                                      | Model used for completions.                                 |
| `OPENAI_TIMEOUT_MS` | `30000`                                            | Upstream request timeout (ms).                              |
| `ALLOWED_ORIGINS`   | `http://localhost:5173,http://localhost:5174`      | Comma-separated CORS allowlist. Legacy `CORS_ORIGIN` still honored. |
| `PORT`              | `8787`                                             | Port the proxy listens on.                                  |
| `NODE_ENV`          | `development`                                      | Reported as `environment` in `/health` and `/ai/status`.    |

### Renderer — root `.env` (copy from root `.env.example`, non-secret only)

| Variable                    | Default                     | Purpose                                        |
| --------------------------- | --------------------------- | ---------------------------------------------- |
| `VITE_AI_PROXY_ENABLED`     | `false`                     | Whether the renderer attempts to call the proxy. |
| `VITE_AI_PROXY_URL`         | `http://localhost:8787`     | Proxy base URL.                                |
| `VITE_AI_PROXY_MODEL_LABEL` | `gpt-4o-mini (server-side)` | Display-only label shown in Settings.          |

## One-command local dev (`npm run dev:all`)

The root package exposes a launcher that starts the proxy **and** the SJ OS app
together, plus helper scripts so you don't have to hunt PIDs or ports.

**First-time setup** (once):

```powershell
cd C:\Users\GalaxyBook5\.vscode\SJ-OS\sj-ai-proxy
copy .env.example .env
# open .env in an editor and set (backend .env ONLY — never the frontend):
#   OPENAI_ENABLED=true
#   OPENAI_API_KEY=sk-...       (your real key)
cd C:\Users\GalaxyBook5\.vscode\SJ-OS
```

**Daily startup** (from the repo root):

```powershell
npm run dev:all
```

This runs the proxy (`proxy:dev`) and the Electron/Vite app (`dev`) side by side
with prefixed logs. Closing the app or pressing Ctrl+C stops **both** (no more
orphaned proxy on port 8787).

**Helper scripts:**

| Script | What it does |
| --- | --- |
| `npm run dev:all` | Start proxy + SJ OS app together. |
| `npm run proxy:dev` | Start only the proxy (`sj-ai-proxy`). |
| `npm run proxy:env` | Preflight `sj-ai-proxy/.env` — prints `OPENAI_ENABLED`, whether a key is configured (**never the key**), and model labels. |
| `npm run proxy:status` | Probe `http://localhost:8787` and `http://127.0.0.1:8787` `/ai/status` and print readiness. |
| `npm run proxy:check` | `node --check` the proxy `server.mjs` (syntax). |
| `npm run proxy:kill` | Stop **only** the process listening on port 8787 (never a broad kill). |

**Troubleshooting flow:**

```powershell
npm run proxy:env       # is the backend .env set up? (no secrets printed)
npm run proxy:status    # is the proxy reachable + ready?
npm run proxy:kill      # free port 8787 if a stale proxy is stuck
npm run dev:all         # restart everything
```

## Running the proxy standalone

```bash
cd sj-ai-proxy
npm install                 # installs express + openai + dotenv
cp .env.example .env        # then edit .env: set OPENAI_ENABLED=true and OPENAI_API_KEY
npm start                   # listens on :8787
```

Then, in the SJ OS root, set `VITE_AI_PROXY_ENABLED=true` (and the URL if not
default) in `.env` and run `npm run dev`.

> **How `.env` is loaded:** `server.mjs` uses `dotenv` to load
> `sj-ai-proxy/.env` resolved **relative to the server file** (via
> `import.meta.url`), not the current working directory. So the proxy picks up
> `OPENAI_*` variables whether you run `npm run dev` from `sj-ai-proxy/`, the
> repo root, or an IDE task. If the startup log shows `enabled=false` /
> `keyConfigured=false` while your `.env` is set, confirm the file is at
> `sj-ai-proxy/.env` (not the repo root) and restart the proxy so it re-reads it.

## Enabling OpenAI locally (exact steps)

1. `cd sj-ai-proxy && npm install` (installs `express` + `openai`).
2. `cp .env.example .env` — creates a **gitignored** local env file.
3. In `.env`, set `OPENAI_ENABLED=true`.
4. In `.env`, set `OPENAI_API_KEY=sk-...` **manually** (server-side only; never
   paste it into SJ OS frontend or anywhere else).
5. In `.env`, set `OPENAI_MODEL` (default `gpt-4o-mini`).
6. Start the proxy: `npm start` (listens on `:8787`).
7. Start SJ OS: from the repo root, set `VITE_AI_PROXY_ENABLED=true` in root
   `.env`, then `npm run dev`.
8. Test `GET /health` and `GET /ai/status` (see below).
9. In Jarvis, run: `오늘 조직 상황 브리핑 해줘` → answer should come back with
   source `openai` and the header badge **GPT Ready**.

### Windows PowerShell — exact commands (CEO)

The proxy listens on **port 8787** (change with `PORT` in `.env`).

```powershell
# 1) Go to the proxy folder
cd C:\Users\GalaxyBook5\.vscode\SJ-OS\sj-ai-proxy

# 2) Install dependencies (first time only)
npm install

# 3) Create your local env file (gitignored — never committed)
copy .env.example .env
```

Then **open `.env` in an editor** (e.g. `notepad .env`) and set these values
manually. Do **not** paste the key into any chat/AI tool, terminal history, or
the SJ OS app — only into this `.env` file:

```
OPENAI_ENABLED=true
OPENAI_API_KEY=실제키는 여기에만 직접 입력   # sk-... (본인 키, 백엔드 전용)
OPENAI_MODEL=gpt-4o-mini
```

Start the proxy:

```powershell
npm run dev    # equivalent to npm start → node server.mjs (listens on :8787)
```

Verify in a browser or a second PowerShell window:

- http://localhost:8787/health
- http://localhost:8787/ai/status

With a valid key + `OPENAI_ENABLED=true`, `/ai/status` returns
`"ready": true`. To connect Jarvis, set `VITE_AI_PROXY_ENABLED=true` (and
`VITE_AI_PROXY_URL=http://localhost:8787` if not default) in the **repo-root**
`.env`, then run `npm run dev` from the repo root.

> Verified locally (Sprint 3C-4) with defaults (no key): `/health` →
> `status: "ok", openaiEnabled: false, apiKeyConfigured: false`; `/ai/status` →
> `ready: false`. No secrets are exposed by either endpoint.

## Render deployment env variables

`render.yaml` defines a `sj-ai-proxy` web service. Set secrets in the **Render
dashboard**, not in the file:

1. Open the Render Dashboard → the `sj-ai-proxy` service.
2. Go to **Environment**.
3. Add `OPENAI_ENABLED=true`.
4. Add `OPENAI_API_KEY=<your key>` (dashboard only; `sync: false`, never committed).
5. Add `OPENAI_MODEL=gpt-4o-mini`.
6. Add `ALLOWED_ORIGINS=<your renderer origin(s)>`.
7. **Redeploy**.
8. Test `GET /health` and `GET /ai/status` on the deployed URL.

Health check path is `/health`.

## Testing

### `/health`

```bash
curl http://localhost:8787/health
```

```json
{
  "service": "SJ OS AI Proxy",
  "status": "ok",
  "openaiEnabled": false,
  "apiKeyConfigured": false,
  "model": "gpt-4o-mini",
  "environment": "development",
  "timestamp": "2026-07-02T00:00:00.000Z"
}
```

### `/ai/status` (diagnostic — never calls OpenAI, never exposes the key)

```bash
curl http://localhost:8787/ai/status
# { "enabled": false, "apiKeyConfigured": false, "model": "gpt-4o-mini", "ready": false, "message": "..." }
```

`ready` is `true` only when `OPENAI_ENABLED=true` **and** a key is present. The
SJ OS Settings → "AI · GPT Brain" panel calls this endpoint and shows a
**GPT Ready / GPT Disabled / Key Missing / Proxy Offline** badge with a refresh
button.

### `/ai/chat`

```bash
curl -X POST http://localhost:8787/ai/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"오늘 조직 상황 브리핑 해줘","mode":"business-briefing","context":{"app":"SJ OS","role":"CEO command center","snapshot":{}}}'
```

- **Disabled (`OPENAI_ENABLED=false`):** `{ success: true, source: "fallback", disabled: true, ... }`.
  No upstream call is made.
- **Enabled but no key:** HTTP 503 `{ success: false, source: "backend", code: "OPENAI_API_KEY_MISSING", ... }`.
- **Enabled with key:** `{ success: true, source: "openai", answer, model, usage }`.

## Testing the GPT fallback (no key needed)

You do **not** need an API key to verify the hybrid behavior:

1. Leave everything default (`OPENAI_ENABLED=false`, `VITE_AI_PROXY_ENABLED=false`).
2. In the app, run a GPT-style command, e.g. `오늘 조직 상황 브리핑 해줘` or
   `미활동 FC 관리 전략 짜줘`.
3. Jarvis shows a clearly labeled **`[GPT proxy disabled fallback]`** answer:
   - A business briefing degrades to the **local** briefing summary (real local
     numbers) plus a note that deep analysis needs GPT enabled.
   - Other GPT modes show Korean setup guidance: GPT proxy is not enabled yet;
     `OPENAI_ENABLED` and `OPENAI_API_KEY` must be set on the **backend only**;
     local command mode is still available.
4. The header shows the **GPT Disabled** status badge and a **Fallback** source
   badge. Local commands (`오늘 일정`, `FCOS`, `유튜브켜줘`) keep working as
   `Local`.

## Fallback behavior

The system is **safe by default**:

- Proxy `OPENAI_ENABLED=false` (default) → `/ai/chat` returns the fallback
  message; no OpenAI call, no key needed.
- Renderer `VITE_AI_PROXY_ENABLED=false` (default) → Jarvis never calls the proxy
  and shows the labeled `[GPT proxy disabled fallback]` guidance instead. All
  local command-router features keep working unchanged.
- Timeouts and proxy/network errors return a Korean error message with a safe
  **retry** option in the Jarvis UI (header shows **Proxy Error**).

## What NOT to do with API keys

- **Never** put `OPENAI_API_KEY` in the renderer, in any `VITE_*` variable, in
  `CompanySettings`, or anywhere in frontend code — it would ship to users.
- **Never** paste your API key into ChatGPT (or any chat/LLM), a screenshot, or
  an issue/PR.
- **Never** commit a real `.env`. Only `.env.example` templates are committed
  (`.gitignore` enforces this: `.env`, `.env.local`, `.env.production`, `*.env`).
- The proxy **never logs the full key** — startup logs only booleans
  (`keyConfigured`, `ready`) and labels, never the secret.
- The frontend has **no** API-key input field by design; Settings only shows
  enabled/URL/model, live proxy status, and server-side-only guidance.
- **If a key leaks, rotate it immediately** in the OpenAI dashboard and update
  the backend/Render env — do not attempt to "hide" a leaked key.

## GPT modes

`JarvisGptBrainService` selects a mode and the proxy maps it to a system prompt:

| Mode                     | Example command                             |
| ------------------------ | ------------------------------------------- |
| `business-briefing`      | "오늘 조직 상황 브리핑 해줘"                 |
| `strategy`               | "미활동 FC 관리 전략 짜줘"                   |
| `data-question`          | "이번 달 실적에서 문제점 분석해줘"           |
| `implementation-planning`| "우리 회사 앱 다음 기능 추천해줘"            |
| `general-assistant`      | (default for free-form questions)           |
| `unknown-fallback`       | ambiguous/unrecognized commands             |

The proxy composes a shared CEO-perspective base instruction (Korean, concise,
action-oriented, grounded only in the provided `context.snapshot`, says when
data is missing, never invents real-world numbers) with the per-mode prompt.
