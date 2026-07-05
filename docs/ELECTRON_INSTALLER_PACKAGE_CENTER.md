# Electron installer package center

Prepares desktop installer packages for staff PCs by running an **existing**
package script from Electron main, after explicit approval and a passing preflight.
It never invents a script, installs dependencies, publishes, or uploads.

## What it does

- Inspects package.json for packaging scripts + version/name/build config.
- Runs preflight (typecheck / build / git status).
- After 패키지 빌드 승인 → 설치파일 빌드 실행, runs the detected package script.
- Shows likely output folders (inside the workspace) and logs.

## Package script detection

`inspectPackageReadiness()` (main, read-only) reports whether `dist` / `package` /
`make` / `electron:build` scripts exist, the app name/version, `electron-builder` /
`electron-forge` references, and any `build` config. The **run priority** is:

1. `dist` → 2. `package` → 3. `make` → 4. `electron:build`

The first that exists is the `detectedPackageScript`.

## Package readiness

A package build is allowed only when: a package script exists, typecheck passes,
build passes, the workspace is exactly `C:\Users\GalaxyBook5\.vscode\SJ-OS`, and the
user explicitly approves + runs. Otherwise it is blocked.

## Preflight

Main runs fixed checks: `npm run typecheck`, `npm run build`, `git status --short`,
plus a read-only package.json inspection. If any fail → blocked, logs shown.

## Which script is selected

The highest-priority existing script (dist > package > make > electron:build). It
is run as the **fixed** command `npm run <script>` via `child_process.spawn` (args
array, Windows `.cmd` handled by the shared resolver — no shell string, no renderer
input).

## If no package script exists

Blocked: *"package.json에 설치파일 빌드 스크립트가 없습니다. 패키징 설정이 필요합니다."*
This repo currently has **no** package script, so packaging is blocked here by
design — and **no script is invented, and no packager is installed.**

## Logs + output hints

stdout/stderr stream into the panel (last 300 lines), secret-masked
(`sk-…`/`OPENAI_API_KEY=`/`ANTHROPIC_API_KEY=`). On success, existing output folders
among `dist` / `release` / `out` / `build` / `dist-electron` (workspace-only) are
listed: *"설치파일이 생성된 폴더를 확인하세요."*

## No publishing

*"이번 단계는 설치파일 생성까지만 진행합니다. 외부 업로드/자동 업데이트/직원 PC 배포는 다음
단계에서 진행됩니다."* Nothing is uploaded, published, or auto-updated.

## Future (disabled)

자동 업데이트 · 직원 PC 배포 · 버전 관리 · 롤백 · 설치파일 다운로드 링크 are shown as a
disabled/planned section and not implemented in this sprint.
