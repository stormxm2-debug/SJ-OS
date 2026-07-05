# Staff distribution package registry

Tracks desktop installer packages for staff releases: which file belongs to which
version, its size + SHA-256, the linked tag/commit/release note, and per-staff
distribution status. **Registry + tracking only** — it never uploads, publishes,
sends files, or builds installers.

## Safe package output inspection

`inspectPackageOutputs()` (main) validates the workspace, then inspects **only**
the fixed output folders (top-level of each), lists files with an allowed installer
extension, and returns each file's relative path, name, size, modified date, and
type. It **does not** scan the whole computer, and the renderer passes **no path**.

## Folders inspected

`release/`, `dist/`, `out/`, `build/`, `dist-electron/` — inside the workspace only.

## File types detected

`.exe`, `.msi`, `.zip`, `.dmg`, `.AppImage` (→ `exe`/`msi`/`zip`/`dmg`/`appimage`).

## SHA-256 checksum

On **패키지 등록**, the renderer sends only a `detectedId` (from the last
inspection). Main resolves it from the remembered safe list, re-validates the file
is still inside a safe output folder + allowed extension + under a 4 GB cap, then
computes SHA-256 by **streaming** the file through `crypto.createHash('sha256')`.
It **never** hashes an arbitrary path supplied by the renderer.

## Staff distribution records

Local only (renderer `localStorage`). Add a record (직원명 / 직책·팀) and set its
status: 발송 전 / 발송 완료 / 설치 확인 / 실패 / 제외. **No message is sent, no email, no
file upload** — this is a manual tracking board.

## Copy

**패키지 정보 복사** copies version/file/size/SHA-256/tag/commit/release-note/status;
**체크섬 복사** copies just the SHA-256.

## Blocking / empty state

Registration is blocked when the file is outside the safe folders, has a
disallowed extension, disappeared, exceeds the size cap, or the version is invalid.
If no installer files are found: *"아직 감지된 설치파일이 없습니다. 설치파일 패키지 센터에서
빌드를 먼저 진행해주세요."* (This is the current state — no installer has been built.)

## No upload / publish / build

This sprint never runs `npm run dist/package/make/electron:build`, `npm run
deploy`, any upload/publish command, or `npm install`. **Generated installer
binaries are never committed** — only the metadata records are stored locally.

## Future (disabled)

직원별 다운로드 링크 · 자동 업데이트 · 설치 완료 자동 보고 · 사내 NAS/공유폴더 연동 · 롤백
배포 are shown as a disabled/planned section and not implemented here.
