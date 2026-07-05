# Claude build completion report

After a Claude auto-build job succeeds (and optionally commits/pushes), SJ OS can
generate a readable **completion report** so the user never has to read raw logs.

## When reports are generated

On demand: in the **작업 완료 보고서** panel, click **보고서 생성** for a succeeded
job. (Commit/push state is reflected automatically — if the job was committed the
report reads the commit's changes; otherwise it reads the working tree.)

## What it includes

- 요청 내용 (original user command)
- 변경 요약 / release note
- 변경 파일 + diff stat
- 검증 결과 (typecheck / build)
- 커밋 해시 + push 상태 (`not-pushed` / `pushed` / `failed`)
- 수동 테스트 체크리스트 (generated from the command)
- 다음 권장 작업 + 리스크 메모

## Release note

`generateReleaseNote` (shared) produces a short Korean note: feature summary +
the original request + verification result + a reminder to run the manual tests.

## Manual test checklist

`generateManualTestChecklist` (shared) picks a checklist by keyword — 출퇴근 /
고객 / 실적 have tailored steps; everything else uses a generic fallback (open the
screen, click the new button, verify input/save, check existing features, open/close
Jarvis, refresh).

## Renderer does not run git

The renderer calls `generateCompletionReport(jobId)` with a **job id only**. Main
(`src/main/claudeAutoBuild.ts`) runs **fixed read-only** inspection: `git diff
--name-status HEAD~1..HEAD`, `git diff --stat HEAD~1..HEAD`, `git status --short`.
No writes, no deployment, no destructive commands.

## Copy report

**보고서 복사** copies a concise plain-text report (title, request, changed files,
verification, commit hash, checklist, next actions) — not raw logs.

## Release Center integration

**릴리즈 센터에 기록** records the report to a local persisted store
(`services/claude-auto-build/completionReports.ts`, `localStorage`). Surfacing
these inside the full Release Center page (`ReleaseRepository`) is a **documented
future step** — kept local now to avoid coupling risk.

## No deployment

This sprint reports only. It never deploys, merges, pushes automatically, or runs
any build/deploy pipeline.
