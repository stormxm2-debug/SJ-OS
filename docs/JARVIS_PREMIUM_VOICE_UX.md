# Jarvis Premium Voice UX

Jarvis is the signature feature of SJ OS: a premium AI control center with a
strong AI Core visual, fast push-to-talk, an **optional** wake mode, and a fast
local command pipeline. All voice work uses the **Electron Main AI Gateway** (the
OpenAI key lives only in the main process) or local Web Speech — no sj-ai-proxy,
no `localhost:8787`, no key in the renderer, and no audio is ever stored.

## Premium AI Core visual (CSS only)

`JarvisAiCore` renders a glowing, layered orb (radial aura + animated pulse ring +
mid ring + breathing halo + glossy core with a specular highlight) using only
Tailwind's `animate-ping` / `animate-pulse` — no animation libraries. Inside the
Jarvis panel a dark scrim, gradient control-center header, and glowing AI badge
make Jarvis stand out from the bright app.

State-based visuals + Korean status text:

| State | Text | Feel |
| --- | --- | --- |
| idle | 자비스 대기 중 | calm gray glow |
| wake | 호출 대기 중 | soft blue scanning pulse |
| listening | 듣는 중 | strong rose/blue pulse |
| transcribing | 전사 중 | cyan ring |
| analyzing | 명령 분석 중 | indigo energy |
| planning | 업무 자동화 설계 중 | violet energy |
| prompting | 개발 프롬프트 생성 중 | amber |
| executing | 실행 중 | gold pulse |
| completed | 완료 | emerald |
| failed | 오류 발생 | red/orange warning |

## Push-to-talk (누르고 말하기)

Hold the mic button to record, release to send:

- `pointerdown` starts recording immediately (shows `듣는 중`)
- `pointerup` stops + sends immediately
- `pointerleave` / `pointercancel` stop safely (mic never left open)
- `Space` / `Enter` hold works for keyboard
- **live elapsed time** is shown while holding (`듣는 중… 1.2초`)
- `commandMaxAudioSeconds = 5` (auto-stop + send), `hardMaxAudioSeconds = 10`
  (safety backstop)

On release it immediately shows `전사 중`, sends the audio, and routes the
transcript into the same command handler as typed input.

## Optional wake mode (자비스 호출 대기)

A toggle enables hands-free calling. **It is OFF by default and opt-in only.**

- Uses **local Web Speech** recognition to detect the wake word **"자비스"**.
- After the wake word, the rest of the phrase is routed as the command
  (e.g. "자비스 오늘 일정" → runs `오늘 일정`); if only "자비스" is heard it prompts
  `명령을 말씀하세요`.
- A **visible indicator** is always shown while enabled:
  `호출 대기 중` → `자비스 호출 감지` → `명령을 말씀하세요` → `명령 수신 완료`.
- If Web Speech is unavailable, wake mode is refused with:
  `이 환경에서는 호출 대기 모드가 제한됩니다. 누르고 말하기를 사용하세요.`
- Wake mode is disabled and the mic released whenever the Jarvis panel closes.

### Privacy / safety

- **Opt-in only** — default OFF; the user must enable it.
- **Visible listening indicator** whenever wake mode is on.
- **No audio saved** — Web Speech returns a transcript only; the push-to-talk
  recorder keeps audio in memory and drops it after one upload.
- **No hidden always-on OpenAI STT streaming** and **no hidden background
  recording**.
- **API key never exposed** — transcription happens in the Electron main process.

## Faster voice pipeline

- Gateway status is **cached 30s** — no IPC status check before every command.
- Audio is sent the instant recording stops; `전사 중` shows immediately.
- Transcript routes immediately into the local-first command handler (short
  commands like `유튜브 켜줘`, `오늘 일정`, `FCOS` execute with no GPT delay).
- **TTS never blocks** the UI and its errors never block future commands.
- Compact timing diagnostics: `음성 처리 2.5초 · 녹음 1.2초 · 전사 1.0초 · 실행 0.3초`.

## Command UX

Typed commands and voice transcripts both create an optimistic command session
with a live timeline (명령 수신 → 의도 분석 → 대상 분류 → 작업 계획 생성 → 실행/프롬프트 생성 →
완료) and structured result cards.

## Reset / refresh controls

The Jarvis header has:

- **자비스 리셋** — clears the current command session, timeline, voice transient
  state, errors and loading (no business data is wiped).
- **앱 새로고침** — reloads the renderer (persisted business data survives).
