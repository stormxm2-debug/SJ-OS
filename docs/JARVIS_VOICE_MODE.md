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
of the browser engine. The renderer records audio (only while enabled) and sends
it to the proxy, which runs transcription server-side and returns text. The API
key never touches the frontend.

- Renderer interface: `src/renderer/src/services/jarvis/SttProxyClient.ts`
  (`transcribeAudio(blob) → TranscriptResult`).
- Backend endpoint: `POST /ai/transcribe` in `sj-ai-proxy/server.mjs`.

Current status: the endpoint is a **safe, disabled-by-default stub**. Real
Whisper transcription (multipart upload handling) is intentionally deferred to a
future sprint to avoid adding upload dependencies prematurely. Responses today:

| Condition | Code | Behavior |
| --- | --- | --- |
| `OPENAI_ENABLED` not `true` | `STT_DISABLED` | Clear Korean fallback; no OpenAI call. |
| Enabled but no key | `OPENAI_API_KEY_MISSING` | Explicit setup error; no secret exposure. |
| Enabled + key present | `STT_NOT_IMPLEMENTED` | Honest "deferred to next sprint" message. |

The stub does **not** parse, read, log, or store the uploaded audio.

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

A successful voice transcript is normalized with the shared
`normalizeCommand(...)` helper and routed through the **same local Jarvis command
router** as typed input — so voice and text behave identically, and the
transcript is saved to recent-command history. If voice output is on, the Jarvis
response is read aloud via `speechSynthesis` (Korean voice preferred).

## Configuration (non-secret renderer env)

| Variable | Default | Purpose |
| --- | --- | --- |
| `VITE_STT_PROXY_ENABLED` | `false` | Opt into sending recorded audio to the backend STT proxy. |
| `VITE_AI_PROXY_URL` | `http://localhost:8787` | Proxy base URL (shared with the GPT brain). |

Backend (`sj-ai-proxy`) secrets live only in the backend env — see
[`OPENAI_PROXY_SETUP.md`](./OPENAI_PROXY_SETUP.md). **Never put `OPENAI_API_KEY`
in the renderer.**
