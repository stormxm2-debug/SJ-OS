# Claude Auto Build — context-aware safety scanner

`scanAutoBuildPrompt` (`src/shared/claudeAutoBuild.ts`) decides whether a generated
prompt may run Claude Code. It distinguishes a dangerous command used as an
**execution instruction** (BLOCK) from one merely listed in a **forbidden / safety
section** (ALLOW), so SJ OS's own prompts — which include a "never use" list — are
not falsely blocked.

## How it works

The scan walks the prompt line by line and tracks whether it is inside a
forbidden/safety section:

- A line enters forbidden context when it contains a marker such as
  `Never use`, `Do not use`, `Do not run`, `Forbidden`, `Hard rules`,
  `Safety rules`, or Korean `금지`, `절대`, `말 것`, `사용하지`, `안전 규칙`,
  `안전 제약`, `금지 명령`, `금지사항`.
- List items (`-`, `*`, `•`, `1.`) and indented continuation lines **inherit** the
  current section context, so a multi-line "never use" list stays allowed.
- A blank line or a new non-list line without a marker ends the section.

A dangerous command inside forbidden context → `allowedSafetyMentions`.
A dangerous command outside it → `dangerousPatterns` (blocks).

## Result shape (`SafetyResult`)

- `blocked: boolean`
- `promptSafe: boolean`
- `dangerousPatterns: string[]` — execution-intent dangers (block)
- `allowedSafetyMentions: string[]` — dangers only in forbidden lists (allowed)
- `secretPatterns: string[]`
- `blockedReasons: string[]` / `blockedReason?: string`

## Secrets (still strict)

Blocks real secret values only: `sk-…` (16+ chars), `sk-ant-…`, and
`OPENAI_API_KEY` / `ANTHROPIC_API_KEY = <token>` assignments. It does **not** block
generic safety text like `Do not expose OPENAI_API_KEY` or `Do not touch .env`.

## UI messages

- Only safety-section mentions → green **금지 명령 안전 규칙 확인됨** (실행 차단 없음).
- No dangers at all → green **안전 검사 통과**.
- Real danger/secret → red **위험 명령 실행 지시 감지** + the blocked reasons.

## Test cases (verified)

| Case | Text | Result |
| --- | --- | --- |
| A | `Never use:` + `- git reset --hard` / `- rm -rf` list | ALLOW |
| B | `Hard rules:` + `Do not use git reset --hard.` | ALLOW |
| C | `Run git reset --hard.` | BLOCK |
| D | `Execute rm -rf.` | BLOCK |
| E | `Use git push --force to fix the branch.` | BLOCK |
| F | `Do not expose OPENAI_API_KEY.` | ALLOW |
| G | `OPENAI_API_KEY=sk-liveKeyValue…` | BLOCK |
| REAL | SJ OS prompt `파괴적 명령을 절대 사용하지 말 것: git reset --hard, …` | ALLOW |
