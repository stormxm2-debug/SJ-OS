# Jarvis Fast Command UX

Jarvis should feel instant and visually powerful. When the CEO submits a command
(`쇼핑몰 업무 자동화해`, `쇼핑몰 시스템 만들어`, `FC OS에 팀별 필터 만들어`, …), the UI
must immediately show that the command was received, classified, and is being
processed — without waiting for heavy work to finish.

## Local-first command classification

Every command is classified **locally and synchronously** by the existing
`IntentClassifier` — no AI call, no API, no network. The fine-grained
`JarvisMode` is mapped to a coarse fast-UX category (`commandSession.categoryFor`):

| Category | Example |
| --- | --- |
| `universal-build-command` | `쇼핑몰 업무 자동화해`, `쇼핑몰 시스템 만들어`, `상세페이지 자동 제작 시스템 만들어` |
| `developer-command` | `FC OS에 팀별 필터 만들어`, `실적 화면에 팀장별 순위 추가해` |
| `navigation` | `오토파일럿 열어줘`, `FCOS` |
| `external-action` | `유튜브 켜줘` |
| `local-command` | `오늘 일정`, `오늘 브리핑` |
| `ai-needed` | reasoning/planning questions routed to the GPT brain |
| `unknown` | unrecognised commands |

## Optimistic UI

`runCommand` (in `JarvisPanel`) creates an optimistic command session **before**
awaiting any processing:

1. Instantly shows **명령 수신 완료**, the original command, a timestamp, and status
   `analyzing`.
2. Then awaits `jarvisService.executeCommand`, which finalizes the session.

Because classification and planning are local, the finalized session arrives
almost immediately; the timeline is then replayed progressively so the CEO sees
each step advance.

## Command session timeline

`JarvisCommandSession` (in `services/jarvis/commandSession.ts`) carries an ordered
list of `JarvisTimelineStep`s, each `pending` / `running` / `completed` / `failed`.
For a build/developer command the steps are:

1. 명령 수신
2. 의도 분석
3. 대상 시스템 분류
4. 작업 계획 생성
5. 개발 프롬프트 생성
6. 프롬프트 센터 저장
7. 다음 작업 대기

Other categories get a shorter, relevant timeline (navigation → 화면 이동 준비;
external → 외부 작업 실행; local → 데이터 조회 · 응답 생성; ai-needed → AI 코어 질의).
The panel reveals steps one at a time (~200 ms each) via a client-side animation,
so the timeline animates even though the underlying work is near-instant.

## AI Core visual

`JarvisAiCore` is a lightweight, **CSS-only** energy core — a glowing orb with
pulse rings built from Tailwind's `animate-ping` / `animate-pulse` (no animation
libraries). Its colour + status text track the current phase:

- `자비스 대기 중` (idle)
- `명령 분석 중` (analyzing)
- `업무 자동화 설계 중` (planning)
- `개발 프롬프트 생성 중` (prompting)
- `완료` (completed) / `실패` (failed)

## Shopping automation template

When a build command targets a shopping mall / commerce operation (`쇼핑몰`,
`업무 자동화`, `쇼핑몰 자동화`, `쇼핑몰 시스템`), the Universal App Builder applies a
focused automation plan (`services/universal-builder/shoppingAutomation.ts`):
상품/주문 관리 자동화, 재고, 쿠폰/프로모션, 상세페이지 자동 제작, 리뷰/문의, 광고 소재, 관리자
대시보드 — plus a planned AI-tool orchestration (OpenAI 기획/카피/자동응답 · Canva
배너/상세페이지 · Gamma 제안서 · Notion 작업보드 · Kling 영상 광고 · Suno 배경음악, 공식 API
확인 필요). These are **planned connectors only** — no external API is called.

## Developer Prompt Center integration

When a universal/developer command completes, Jarvis registers (or reuses) a
`DeveloperPromptPacket`. The AI Core card shows **개발 프롬프트 생성 완료**, a
프롬프트 센터로 이동 link, and the response card exposes the prompt preview + 프롬프트 복사
action (status `generated`).

## Heavy AI/API work must not block the UI

- Classification and planning are local and synchronous — nothing blocks on the
  network.
- `runCommand` wraps processing in `try/finally`, always resyncing from the
  authoritative service state so the panel can never be stuck showing `running`.
- The Jarvis overlay renders `null` when closed (no invisible full-screen
  blocker), so the sidebar and Jarvis stay clickable after any command.
- No microphone/STT/voice work and no OpenAI key are involved in this path.

## Where it renders (important)

The AI Core + command timeline card is rendered **directly under the command
input**, above the Voice mode card, inside `JarvisPanel` (the overlay opened by
the 자비스 button / `Ctrl + Space`). It also shows the immediate response text, so
command feedback is visible without scrolling. A small `Fast Command UX 활성화됨`
badge on the card header confirms the correct UI path is active. (Earlier the card
was placed below the ~370-line Voice mode card and fell off-screen — the fix moves
it up so it is always visible.)

The `assistant` route (`CommandCenterPage`) is a **separate** Chief-of-Staff
workflow screen — not Jarvis. Jarvis is always the `JarvisPanel` overlay.

## Live test checklist

Open Jarvis (자비스 button or `Ctrl + Space`), then for each command below confirm:

- [ ] **명령이 즉시 표시됨** — `명령 수신 완료` + the original command appears instantly
      under the input (no wait).
- [ ] **타임라인이 나타남** — the step list (명령 수신 → … → 다음 작업 대기) is visible
      and animates.
- [ ] **AI 코어가 보임** — the glowing orb + status text (`명령 분석 중` → … → `완료`)
      is visible without scrolling; the `Fast Command UX 활성화됨` badge is shown.
- [ ] **반복 명령 동작** — running several commands in a row keeps working.
- [ ] **사이드바 클릭 가능** — after a command, the sidebar and 자비스 open/close still
      respond (no click lock, no invisible overlay).

Commands to run:

| Command | Expect |
| --- | --- |
| `쇼핑몰 업무 자동화해` | 앱 빌드 timeline (7 steps) + `개발 프롬프트 생성 완료` + 프롬프트 센터로 이동 |
| `쇼핑몰 시스템 만들어` | same, automation-focused project |
| `FC OS에 팀별 필터 만들어` | developer-command timeline + prompt packet |
| `오늘 일정` | local-command timeline + schedule answer |
| `유튜브 켜줘` | external-action timeline + opens link |
| `오토파일럿 열어줘` | navigation timeline + jumps to Autopilot |

If a command fails, the timeline still shows `명령 수신 완료`, marks classification
`실패`, shows the error text, and offers `다시 시도` — the UI stays clickable.
