# Jarvis AI Gateway (Electron Main Process)

Jarvis AI/STT for the **desktop app** runs through the **Electron main process**,
which acts as the local AI gateway. This removes the local `sj-ai-proxy`
dependency for desktop development: no separate server, no `localhost:8787`, no
`VITE_AI_PROXY_URL`, no CORS, and no two-terminal setup.

## Architecture

```
Renderer UI (React)
  → Preload safe bridge (window.sj.ai)
  → Electron Main Process (AI gateway, holds the key)
  → OpenAI API
  → Renderer result (transcript / status only)
```

- The **OpenAI API key lives ONLY in the Electron main process**, read from the
  SJ OS root `.env` (or `process.env`). It is never sent to, stored in, logged
  by, or readable from the renderer or preload.
- The renderer sends **audio bytes** over IPC and receives back **only** a
  transcript string plus sanitized status flags.
- Audio is held **in memory only** for the single request — never written to
  disk, never logged.

Key files:

- `src/shared/aiGateway.ts` — shared IPC contract (`AiGatewayStatus`,
  `AiTranscribeRequest`, `AiTranscribeResult`). Never carries the key.
- `src/main/services/ai-gateway/env.ts` — loads the root `.env` + `process.env`
  (tiny parser, no dotenv dependency).
- `src/main/services/ai-gateway/index.ts` — `getAiGatewayStatus()` and
  `transcribeAudio()`; calls OpenAI with the Node global `fetch` (no SDK
  dependency needed).
- `src/main/index.ts` — registers the `sj-ai:status` and `sj-ai:transcribe` IPC
  handlers.
- `src/preload/index.ts` — exposes the narrow `window.sj.ai` bridge
  (`getStatus`, `transcribeAudio`).
- `src/renderer/src/services/jarvis/ElectronAiGateway.ts` — renderer client.
- `src/renderer/src/components/jarvis/JarvisPanel.tsx` — Voice Mode UI; defaults
  to the Electron AI Gateway engine.

## IPC surface

`sj-ai:status` → returns:

```ts
{
  mode: 'electron-main',
  enabled: boolean,
  apiKeyConfigured: boolean,   // boolean only — never the key
  ready: boolean,              // enabled AND apiKeyConfigured
  model: string,
  sttModel: string,
  maxAudioSeconds: number,
  message: string,             // Korean, UI-ready
  checkedAt: string            // ISO timestamp
}
```

`sj-ai:transcribe` → input `{ audioBuffer, mimeType, fileName?, language? }`,
returns:

```ts
{
  success: boolean,
  transcript?: string,
  model?: string,
  source: 'electron-main-openai',
  errorCode?: string,          // e.g. OPENAI_DISABLED, OPENAI_API_KEY_MISSING
  errorMessage?: string        // Korean, UI-ready
}
```

The main handler validates the enable/key gates, the MIME type (`audio/*`
only), and the byte size **before** any OpenAI call. When disabled it returns a
Korean setup message; when the key is missing it returns
`OPENAI_API_KEY_MISSING`. It never saves audio, never logs audio, and never
exposes the key.

## Local setup

1. In the SJ OS **root**, copy `.env.example` to `.env`.
2. Set `OPENAI_ENABLED=true`.
3. Set `OPENAI_API_KEY` **manually in the root `.env` only** (never in a VITE_
   variable, renderer/frontend code, or any chat message).
4. Set `OPENAI_STT_MODEL=gpt-4o-mini-transcribe` (default).
5. Run `npm run dev`.
6. Open Jarvis (Ctrl + Space).
7. In Voice Mode the engine defaults to **Electron AI Gateway** and should show
   **OpenAI 준비됨** ("OpenAI ready"). No separate proxy server is required.

That is the entire desktop flow — **only `npm run dev`** is needed.

## Voice Mode engine priority

The Voice Mode selector offers three engines, in preference order:

- **A. Electron AI Gateway** — default desktop path (this document).
- **B. Legacy Proxy** — the optional `sj-ai-proxy` path, kept for legacy /
  deployment scenarios only. Desktop Jarvis no longer fails just because the
  proxy is not running.
- **C. Web Speech** — the browser-local offline fallback (no external API).

### UI status wording

- Ready: **OpenAI 준비됨** · **API 키는 Main Process에만 존재** · **별도 프록시 서버
  필요 없음** · **npm run dev만 필요**.
- Key missing: `OpenAI API 키가 설정되지 않았습니다. SJ OS 루트 .env 에만 직접
  입력하세요.`
- Disabled: `OPENAI_ENABLED=false 상태입니다.`

## Legacy sj-ai-proxy

`sj-ai-proxy` is **not** removed. It remains an optional legacy / deployment
path (`docs/OPENAI_PROXY_SETUP.md`), selectable in Voice Mode as **Legacy
Proxy**. It is no longer part of the default desktop developer loop, and Jarvis
desktop mode does not depend on it.

## Security checklist

- OpenAI key only in the root `.env` / `process.env`, read by the main process.
- Never expose the key through the renderer or preload.
- Never log the full API key (or any part of it).
- Never commit `.env` or `.env.local` (both are gitignored).
- Never stage audio files; audio stays in memory and is dropped after each
  request.
