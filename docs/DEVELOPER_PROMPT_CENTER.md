# Developer Prompt Center

The Developer Prompt Center is the **safe bridge before fully-autonomous code
execution**. Jarvis never edits source files directly. Instead it turns a CEO
development command into a structured Claude Code prompt packet, the CEO copies
that prompt into Claude Code, and the packet's status is tracked back inside
SJ OS.

## Flow

1. **CEO gives Jarvis a development command.**
   - Build command → Universal App Builder: `"쇼핑몰 시스템 만들어"`,
     `"학원 관리 프로그램 만들어"`, `"병원 예약 시스템 만들어"`,
     `"AI 영상 광고 제작 시스템 만들어"`.
   - Developer command → Implementation Request: `"FC OS에 팀별 필터 만들어"`,
     `"실적 화면에 팀장별 순위 추가해"`, `"고객 워크스페이스 개선해"`.
2. **Jarvis generates a structured prompt packet.** The prompt contains mission,
   target workspace/app type, required features, files to inspect, safety rules,
   no-.env / no-API-key rules, verification commands, git add guidance, commit
   message, and stop conditions. Universal build commands reuse the Universal App
   Builder prompt generator; developer commands use a dedicated implementation
   prompt generator.
3. **CEO copies the prompt into Claude Code.** The Jarvis response card and the
   Developer Prompt Center page both expose a "프롬프트 복사" button (with a
   selectable textarea fallback when the Clipboard API is unavailable).
4. **Claude Code performs the code changes** in this repository, following the
   pasted prompt's safety rules and verification steps.
5. **Status is tracked inside SJ OS.** Each packet moves through:
   `생성됨 → 복사됨 → Claude 전달됨 → 개발 중 → 완료` (with `차단됨` / `반려됨` as
   off-ramps).

## Entity — DeveloperPromptPacket

Persisted locally (localStorage key `sj-os:developer-prompt:v1`) in the same
repository + state + event-bus + persistence style as the other SJ OS modules.

| Field | Meaning |
| --- | --- |
| `id` | Packet id |
| `sourceType` | `developer-command` / `universal-build-project` / `implementation-request` |
| `sourceId` | Id of the originating implementation request / build project |
| `title` | Short title |
| `targetWorkspace` | Korean label of the target workspace / app type |
| `interpretedGoal` | Jarvis's local interpretation (no AI call) |
| `promptText` | The full Claude Code-ready prompt the CEO pastes |
| `status` | `draft` / `generated` / `copied` / `sent-to-claude` / `in-development` / `verified` / `completed` / `blocked` / `rejected` |
| `priority` | `P0`–`P3` |
| `riskLevel` | `low` / `medium` / `high` / `critical` |
| `approvalRequired` | Whether CEO approval is required |
| `copiedAt` / `sentToClaudeAt` / `completedAt` | Lifecycle timestamps (nullable) |
| `createdAt` / `updatedAt` | Record timestamps |
| `verificationChecklist` | Steps to run after Claude Code finishes |
| `commitMessage` | Suggested commit message |
| `notes` | Free-form CEO notes |

## Where it appears

- **Jarvis panel** — every build/developer command response shows the mode,
  target, interpreted goal, risk, approval requirement, generated prompt preview
  and a copy button, plus a link into the center.
- **개발 프롬프트 센터** page (sidebar → 개발 프롬프트 센터) — columns for
  대기 중인 개발 프롬프트 / Claude 전달 대기 / 개발 중 / 완료 / 차단됨, each packet with
  copy / mark-sent / mark-completed actions and a prompt preview.
- **오토파일럿** — read-only counts: pending prompts, next prompt waiting for
  Claude, blocked prompts, completed prompts. Autopilot does not edit files or
  auto-promote packets in this sprint.
- **PM 플래너** — prompt-ready / waiting-for-Claude / completed counts.
- **CTO 룸** — high-risk prompt count (plus in-development / blocked / completed).
- **개발 OS (DevOS)** — references the generated prompt packets (read-only).

## Safety

- No API keys in the renderer/frontend; `.env` / `.env.local` are never touched.
- No external API calls, no database — local-first (localStorage) only.
- Jarvis does not edit source files; it only generates and tracks prompts.
- The existing insurance OS and Universal App Builder are preserved.
