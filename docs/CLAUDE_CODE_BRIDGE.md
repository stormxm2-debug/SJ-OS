# Claude Code Bridge (foundation)

SJ OS generates Claude Code-ready development prompts. The Claude Code Bridge lets
the user **copy** a prompt or **export** it to a safe local `.md` file so it can be
pasted into the Claude Code CLI. **Actual Claude Code execution is intentionally
NOT implemented yet** — this is the safe preparation layer only.

## Flow

1. Jarvis or the Developer Prompt Center generates a `DeveloperPromptPacket`.
2. In the Developer Prompt Center, the **Claude Code 브릿지 · 전달 대기** panel lists
   each prompt with a safety scan and two actions:
   - **프롬프트 복사** — copies the prompt to the clipboard (works everywhere).
   - **Claude용 파일 저장** — asks the Electron main process to write the prompt to
     a `.md` file (desktop app only).
3. The user pastes the prompt (or opens the file) into Claude Code and runs it.

## Copy

Uses the guarded `navigator.clipboard.writeText`
(`services/claude-code/claudeCodeBridge.ts`). No shell, no IPC.

## Export

Renderer → preload (`window.sj.claude.exportPrompt`) → main
(`ipcMain 'sj-claude:export-prompt'` → `src/main/claudeExport.ts`).

- The **write root is main-controlled** (`app.getAppPath()`), never the
  renderer-supplied path — path traversal is impossible.
- Files are written to `<workspace>/.sj-os/claude-prompts/`.
- Filenames are **sanitized + timestamped**, e.g.
  `2026-07-04-1530-쇼핑몰-업무-자동화.md`.
- A `.env`-style filename is refused; the process never writes secrets and never
  runs a shell command.

Allowed workspace: `C:\Users\GalaxyBook5\.vscode\SJ-OS`.

Exported prompts live under `.sj-os/` which is git-ignored, so they are never
committed.

## Safety scan

`scanPromptText` (`src/shared/claudeCode.ts`, shared by main + renderer) flags:

- **위험 명령** — destructive command patterns: `git reset --hard`, `git clean -fd`,
  `git push --force` / `-f`, `rm -rf`, `Remove-Item -Recurse`, `del /s`, `format`.
- **.env / 키 언급** — `.env`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `sk-`.

Because SJ OS's own prompts mention these in "금지" safety rules, matches are
treated as **review warnings** shown as chips (위험 명령 감지 / 승인 필요). Copy is
always allowed; **export requires an explicit confirm** when a dangerous command
pattern is present. The main process additionally enforces write-location safety.

## Future: approved execution

A disabled **Claude Code 자동 실행** section is shown as a placeholder. Real CLI
execution will only be added later, behind: CEO approval, a restricted working
folder, full logging, and a dangerous-command blocklist. **The renderer must never
execute shell commands** — any future execution will live in the Electron main
process behind those guards.
