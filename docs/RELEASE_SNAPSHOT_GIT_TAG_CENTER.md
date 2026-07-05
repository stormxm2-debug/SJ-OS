# Release snapshot / Git tag center

Creates a reliable release history by tagging staff release versions in Git. After a
version is approved and applied, the user can create an annotated tag (`vX.Y.Z`) and
— as a second explicit step — push it. Nothing is tagged or pushed automatically.

## Why snapshots exist

A Git tag pins a version to a commit so the release history is auditable and
reproducible. This center makes that safe and approval-gated.

## Tag naming

`tagName = "v" + package.json version` (e.g. version `1.1.0` → `v1.1.0`). The tag
name is **derived in main from package.json** — never from the renderer. The
version must be valid semver `X.Y.Z`.

## Readiness

`inspectTagReadiness()` (main, read-only) runs `git rev-parse HEAD`, `git tag
--list`, `git status --short`, reads the package.json version, and reports: version,
tag name, commit hash, whether the tag already exists, and validity. If the tag
already exists → *"이미 같은 버전의 Git 태그가 존재합니다."* (blocked). A dirty working tree
is noted (the tag points to HEAD) but doesn't block.

## Tag creation approval (step by step)

1. **스냅샷 준비 확인** (`inspectTagReadiness`)
2. **태그 생성 승인** (local confirm)
3. **Git 태그 생성** → main runs `git tag -a <vX.Y.Z> -m "SJ OS <vX.Y.Z> - Staff
   release snapshot"` (a **fixed** message; annotated tag; never `-f`).

## Tag push approval (second, separate)

4. **태그 push 승인** (local confirm)
5. **Git 태그 push** → main runs `git push origin <vX.Y.Z>` — a **single tag ref** to
   `origin`. **Never** `git push --tags`, `--force`, or an arbitrary remote/branch.

## Renderer never runs git

The renderer sends only a snapshot id (+ optional display metadata for the report);
all git runs in `src/main/releaseSnapshot.ts` via `child_process.spawn` with fixed
args (no shell string). The tag name/message are main-derived.

## Snapshot copy

**릴리즈 스냅샷 복사** copies a plain-text snapshot (tag, commit, release note,
verification, manual tests, tag-pushed yes/no).

## Not done here

No `npm version`, no `git tag -f`, no `git push --tags`, no `--force`, no installer
build (`dist`/`package`/`make`/`electron:build`), no publish, no external upload.
Old history is never rewritten.
