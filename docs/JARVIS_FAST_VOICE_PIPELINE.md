# Jarvis Fast Voice Pipeline

Voice Mode is optimized so the CEO can speak a command and have it execute with
minimal delay. The whole path is local-first: audio is captured in the renderer,
transcribed by the **Electron Main AI Gateway** (the OpenAI key lives only in the
main process), and the transcript is routed through the **same** Jarvis command
router as typed input. No sj-ai-proxy, no `localhost:8787`, no key in the renderer.

## True push-to-talk

The mic button (recorder engines: Electron Gateway / legacy proxy) is now
**hold-to-talk**:

- `pointerdown` → start recording immediately (UI shows `듣는 중` in the same event)
- `pointerup` → stop and send immediately
- `pointerleave` / `pointercancel` → stop safely so the mic is never left open
- `Space` / `Enter` held while the button is focused → same (keyboard accessibility)

No `onClick` is attached to the recorder button, so the trailing click after a
pointer gesture can never double-trigger. Web Speech (browser-local recognition)
keeps its click toggle, since it is continuous recognition.

UI text: `마이크 (누르고 있는 동안 듣습니다)` → `듣는 중 · 손을 떼면 전사` → `전사 중…` →
`명령 실행 중` (via the command timeline).

## Short command max duration

`AudioRecorder` uses two caps (`src/renderer/src/services/jarvis/AudioRecorder.ts`):

- **commandMaxSeconds = 5** — if the user keeps holding, recording auto-stops and
  sends after 5s, showing `최대 녹음 시간 도달, 전사합니다`. This keeps short commands
  (`유튜브 켜줘`, `오늘 일정`, `FCOS`) fast.
- **hardMaxSeconds = 10** — an absolute safety backstop; the mic is never held open
  beyond this even if the command timer is missed.

Silence detection is intentionally out of scope for this sprint.

## Gateway status cache

`ElectronAiGateway.checkStatus()` caches the main-process readiness for **30s**
(`src/renderer/src/services/jarvis/ElectronAiGateway.ts`), so Jarvis does **not**
do an IPC status round-trip before every voice command:

- Automatic checks (on panel open) use the cached path.
- If a cached status reports `ready`, transcription proceeds directly.
- `forceCheckStatus()` (manual refresh button / engine switch) bypasses and
  refreshes the cache.
- A failed transcription invalidates the cache and forces a fresh probe, so a
  `disabled` / `key missing` state is reflected immediately, then the error shows.

## STT does not block the UI

`transcribeAndRoute` wraps transcription in `try/finally` and always clears the
`transcribing` state, so the mic and the rest of the UI stay usable even on error.
As soon as the transcript text exists it is shown immediately, normalized with the
shared Jarvis helper, and submitted to the same command handler as typed input —
short local commands (navigation / external action / local answer) execute
immediately with no GPT planning delay.

Errors surfaced (UI stays clickable, retry immediately): quota exceeded, API key
missing, audio too short, mic permission blocked, unsupported MIME type, gateway
disabled.

## TTS does not block the UI

When 음성 출력 is ON, the answer is spoken **after** the result is shown. TTS is
fire-and-forget (`speechSynthesis.speak`) and wrapped in a guard, so a speech
error can never block the UI or future commands.

## Timing diagnostics

After each voice command a compact line shows the measured timing, e.g.:

```
음성 처리 1.8초 · 녹음 0.9초 · 전사 0.6초 · 실행 0.3초
```

- `recordingMs` — capture duration (from the recorder)
- `transcriptionMs` — time in the gateway/transcription call
- `routingMs` — time to route + execute the command locally
- `totalMs` — sum of the above

These confirm the pipeline improvement without cluttering the UI.

## AI Core phases

The AI Core orb reacts to voice phases: `듣는 중` (listening, rose) → `전사 중`
(transcribing, cyan) → then the normal command timeline (`명령 분석 중` → … → `완료`).

## Manual test checklist (microphone)

Hold the mic button and speak, then release:

- [ ] `듣는 중` appears instantly on press.
- [ ] Releasing sends immediately; `전사 중` appears.
- [ ] Transcript appears quickly, then the command timeline + result.
- [ ] No UI lock; sidebar and Jarvis stay clickable; repeated commands work.

Commands: `유튜브켜줘`, `오늘 일정`, `오토파일럿열어줘`, `FCOS`, `쇼핑몰 업무 자동화해`,
`FC OS에 팀별 필터 만들어`.
