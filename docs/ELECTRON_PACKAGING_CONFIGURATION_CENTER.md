# Electron packaging configuration center

The installer package center can only run an **existing** package script. This
center helps create that script safely: it detects the packaging tool, proposes
scripts/metadata, and — after approval — writes them to package.json **only when
the tool is already installed**. It never installs dependencies, never runs a
build, never publishes.

## Why it's needed

Without a `dist`/`package`/`make`/`electron:build` script, packaging is blocked.
This center fills the gap under approval, without inventing or installing anything.

## Tool detection

`inspectPackagingConfig()` (main, read-only) reads package.json and detects:

- **electron-builder**: `devDependencies`/`dependencies.electron-builder`, or a
  script containing `electron-builder`.
- **electron-forge**: `@electron-forge/cli` / `@electron-forge/maker-squirrel` /
  `@electron-forge/maker-zip`, or a script containing `electron-forge`.

It also reports the app name/version and which package scripts already exist.

## If electron-builder / electron-forge is missing

No package.json change. A **패키징 도구 필요** card shows the recommended manual
command as **copyable text only** (never executed):

```
npm install -D electron-builder
```

> "현재 package.json에서 electron-builder/electron-forge를 찾지 못했습니다. 자동 설치는
> 안전상 진행하지 않습니다." (This repo has no packaging tool, so this is the state
> here.)

## Proposed scripts (when a tool exists)

- **electron-builder** → `"dist": "electron-builder"` (only if `dist` is missing) +
  safe metadata if no `build` config: `productName: "SJ OS"`,
  `build.appId: "com.sjinvest.sjos"`, `build.directories.output: "release"`.
- **electron-forge** → `"make": "electron-forge make"` and/or
  `"package": "electron-forge package"` (only the missing ones).

Existing scripts and existing `build` config are **never overwritten**.

## Approval + write (renderer never writes files)

Flow: **패키징 설정 확인 → 설정 제안 보기 → 적용 승인 → package.json에 적용**. Only then does
main run `applyApprovedPackagingConfig`, which re-detects the tool, **validates**
every proposed script (blocks destructive/secret content), and writes only the
**missing** scripts/metadata (2-space JSON preserved). The renderer never touches
package.json.

## No installs, no build

This sprint configures package.json only. It never runs `npm install`/`add`,
`npm run dist/package/make/electron:build`, or any publish/upload command.

## Connection to the installer package center

After apply: "설치파일 빌드 스크립트가 준비되었습니다. 설치파일 패키지 센터에서 패키지 환경 확인
후 실행하세요." The installer package center then detects the script and its approve →
preflight → build flow becomes available.
