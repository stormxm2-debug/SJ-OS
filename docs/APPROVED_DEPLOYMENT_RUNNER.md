# Approved deployment runner

The last step: an approved release item can run a **controlled deployment**. It runs
**only** the existing `npm run deploy` script (if `package.json` defines one), from
Electron main, after explicit approval and a passing preflight. Nothing deploys
automatically.

## Eligibility

Deployment is allowed only when:

- the release item status is **release-ready** (only these appear in 배포 실행),
- `package.json` contains a `scripts.deploy` entry,
- the workspace is exactly `C:\Users\GalaxyBook5\.vscode\SJ-OS`,
- preflight passes (typecheck + build),
- the user explicitly clicks **배포 승인** then **배포 실행**.

If there is **no deploy script**:
*"package.json에 deploy 스크립트가 없어 자동 배포를 실행할 수 없습니다."* (This is the
current state of this repo, so deployment is blocked here by design.)

## Preflight

**배포 전 검사** / the run itself execute fixed checks in main:
`npm run typecheck`, `npm run build`, `git status --short`, plus a read-only
`package.json` inspection for `scripts.deploy` (it is **never executed** during
inspection). If any fail → `preflight-failed`, deploy stays disabled, logs shown.

## Safe execution

The renderer calls `deploy.runApproved(releaseItemId)` with a **release item id
only** — no command, script name, cwd, or args. Main validates workspace +
deploy-script + preflight, then spawns the **fixed** command `npm run deploy` via
`child_process.spawn` (args array, Windows `.cmd` handled by the shared resolver —
no shell string). No `--force`, no destructive command, no platform/.env/secret
change.

## Logs + secret masking

stdout/stderr stream into the run's log panel (last 200 lines). Every line is
**masked** (`maskSecrets`) so `sk-…`, `sk-ant-…`, and `OPENAI_API_KEY=…` /
`ANTHROPIC_API_KEY=…` never appear.

## Status

Exit 0 → `deployed` ("배포가 완료되었습니다."). Non-zero → `failed` ("배포가
실패했습니다. 로그를 확인해주세요."). **No automatic retry.** **배포 중지** kills only the
process this app started.

## No platform changes

This runner only invokes the existing deploy script. It never edits Render /
Netlify / Vercel / Cloudflare settings, environment variables, or secrets.

## No auto-deploy

Two explicit clicks are always required (배포 승인 → 배포 실행 with a confirm). Nothing
deploys on its own.
