# Jarvis Voice Mode

Push-to-talk voice input (STT) and optional voice output (TTS) for the SJ OS
Jarvis command layer. This document explains how it works, its safety model, why
the built-in Web Speech engine can be unreliable inside Electron, and the path to
a stable production STT engine via the backend proxy.

## Safety model (v1)

- **Push-to-talk only.** No always-on listening, no wake word.
- **No audio saved.** Web Speech mode returns a transcript string only — no audio
  is recorded, buffered, or stored anywhere.
- **No external AI/API in the default path.** Web Speech uses the browser/Electron
  built-in `SpeechRecognition` capability. It never calls the SJ OS proxy.
- **Audio leaves the device ONLY in explicit STT proxy mode.** That mode is
  disabled by default (`VITE_STT_PROXY_ENABLED=false`) and must be turned on
  deliberately. Even then, the OpenAI API key lives only in the backend.
- **No API key in the renderer/frontend, ever.** The key belongs solely in the
  backend proxy environment.

## Engines

Voice Mode reports a **voice engine mode** so the UI is honest about what is
actually working:

| Engine | Meaning |
| --- | --- |
| `web-speech` | Built-in browser/Electron `SpeechRecognition` is supported and working. Default. |
| `stt-proxy-disabled` | Web Speech is unusable here (failed or unsupported); the stable path is the backend STT proxy, which is currently off. |
| `stt-proxy-ready` | STT proxy mode is explicitly enabled (`VITE_STT_PROXY_ENABLED=true`). |
| `unavailable` | Neither recognition nor synthesis exists in this environment. |

### Why Web Speech can fail in Electron

Chromium's `webkitSpeechRecognition` (which Electron inherits) can depend on a
**remote Google speech service**. In some Electron builds / networks / regions
that service is not reachable, and recognition fails immediately with a
`network` error:

> 브라우저 음성 인식 서비스 연결에 실패했습니다. Electron/Web Speech 환경에서는 이
> 오류가 발생할 수 있습니다. STT 프록시 모드를 사용하거나 다시 시도해 주세요.

This is an environment limitation, **not** a bug in SJ OS. When it happens Voice
Mode does **not** crash: it marks Web Speech as failed, recommends STT proxy
mode, and keeps text input fully usable.

### Stable production mode: backend STT proxy

For reliable, production-grade transcription, use the backend STT proxy instead
of the browser engine. Web Speech depends on a remote browser service that can be
blocked in Electron; the STT proxy runs transcription through OpenAI server-side
with the key kept in the backend env — so it is **more stable** and works
wherever the backend can reach OpenAI.

**Flow (push-to-talk → transcript → command):**

1. CEO selects the **STT Proxy** engine and clicks the mic button.
2. The renderer records a short clip with `MediaRecorder` — memory only, no file
   saved, `audio/webm` preferred (safe fallback if unsupported).
3. Recording stops on click or auto-stops after `MAX_AUDIO_SECONDS` (default 10s).
4. The client first checks backend readiness (`GET /ai/status`) and uploads the
   clip to `POST /ai/transcribe` as `multipart/form-data` **only** when STT is
   enabled and a key is configured — otherwise no audio leaves the device.
5. The backend reads `OPENAI_API_KEY` from the environment, calls the OpenAI
   transcription model, and returns Korean transcript text.
6. Jarvis routes the transcript through the **same local command router** as
   typed input, shows the transcript + result, and (if TTS is on) speaks the reply.

- Renderer capture: `src/renderer/src/services/jarvis/AudioRecorder.ts`.
- Renderer client: `src/renderer/src/services/jarvis/SttProxyClient.ts`
  (`transcribeAudio(blob) → TranscriptResult` with `transcript`, `source`,
  `model`, `durationMs`, `errorCode`, `errorMessage`).
- Backend endpoint: `POST /ai/transcribe` in `sj-ai-proxy/server.mjs`.

**Endpoint behavior:**

| Condition | Code | Behavior |
| --- | --- | --- |
| `OPENAI_ENABLED` not `true` | `OPENAI_DISABLED` | Clear Korean fallback; no OpenAI call; no audio buffered. |
| Enabled but no key | `OPENAI_API_KEY_MISSING` | Explicit setup error; no secret exposure. |
| No `audio` field | `AUDIO_MISSING` | Rejected before any OpenAI call. |
| Upload over `MAX_AUDIO_UPLOAD_MB` | `AUDIO_TOO_LARGE` | Rejected by the size guard. |
| Enabled + key + audio | — | Transcribes and returns `{ success, text, model, durationMs }`. |

Audio is held **in memory only** (multer `memoryStorage`), never written to disk,
and the buffer is dropped after the request. **No audio content is ever logged.**

## Error diagnostics

`VoiceService` classifies `SpeechRecognition` errors and surfaces honest Korean
messages plus a recommended fix. Classified codes:

`no-speech`, `audio-capture`, `not-allowed`, `service-not-allowed`, `network`,
`aborted`, `language-not-supported`, `unknown`.

The Jarvis panel's **Voice diagnostics** card shows: SpeechRecognition /
webkitSpeechRecognition / speechSynthesis support, microphone permission status,
the current engine, the last error code + message, and the recommended fix.

## Microphone permission (Electron)

The main process (`src/main/index.ts`) restricts permissions:

- Only the **microphone** (audio `media`) is granted, and only to our own local
  origins: the packaged `file://` app and the `localhost` dev ports.
- Camera/video is denied even within a `media` request.
- All other permissions (geolocation, notifications, etc.) are default-denied.

If the OS blocks the mic, recognition reports `not-allowed`:

> 마이크 권한이 차단되었습니다. Windows 마이크 권한과 앱 권한을 확인해 주세요.

Fix on Windows: Settings → Privacy & security → Microphone → allow this app, then
restart.

## Command flow

A successful voice transcript (from **either** engine) is normalized with the
shared `normalizeCommand(...)` helper and routed through the **same local Jarvis
command router** as typed input — so voice and text behave identically, and the
transcript is saved to recent-command history. If voice output is on, the Jarvis
response is read aloud via `speechSynthesis` (Korean voice preferred). These
spoken commands all route correctly: `유튜브켜줘`, `오늘 일정`, `오토파일럿열어줘`,
`FCOS`, `FC OS에 팀별 필터 추가해`.

If transcription fails, a Korean error is shown, typed input stays usable, and
nothing crashes.

## Configuration

### Renderer (non-secret Vite env)

| Variable | Default | Purpose |
| --- | --- | --- |
| `VITE_AI_PROXY_URL` | `http://localhost:8787` | Proxy base URL (shared with the GPT brain). |
| `VITE_STT_PROXY_ENABLED` | `false` | Optional: default the voice engine to STT Proxy. Not required — selecting the STT Proxy engine in the UI and recording is itself the explicit opt-in, and audio is uploaded only after the backend reports it is enabled + keyed. |

### Backend (`sj-ai-proxy`, secrets — backend only)

| Variable | Default | Purpose |
| --- | --- | --- |
| `OPENAI_ENABLED` | `false` | Master switch. STT is disabled until this is `true`. |
| `OPENAI_API_KEY` | — | Server-side only. Never in the renderer. |
| `OPENAI_STT_MODEL` | `gpt-4o-mini-transcribe` | Transcription model. |
| `MAX_AUDIO_SECONDS` | `10` | Max push-to-talk length (renderer-enforced). |
| `MAX_AUDIO_UPLOAD_MB` | `10` | Max accepted upload size (backend guard). |

## Local setup (STT proxy)

```
cd C:\Users\GalaxyBook5\.vscode\SJ-OS\sj-ai-proxy
copy .env.example .env
```

Then edit `.env` (backend only) and set:

```
OPENAI_ENABLED=true
OPENAI_API_KEY=sk-...          # your real key — in .env ONLY, never committed
OPENAI_STT_MODEL=gpt-4o-mini-transcribe
```

Install and run the proxy:

```
npm install
npm run dev
```

`.env` is gitignored and must never be committed. See also
[`OPENAI_PROXY_SETUP.md`](./OPENAI_PROXY_SETUP.md).

> ⚠️ **Never paste your API key into ChatGPT, Claude, or any frontend UI.** The
> key belongs only in the backend `.env`. If a key ever leaks, rotate it
> immediately in the OpenAI dashboard.
