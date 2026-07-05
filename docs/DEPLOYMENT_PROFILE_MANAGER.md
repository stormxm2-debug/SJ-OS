# Deployment profile / deploy-script manager

The approved deployment runner only runs `npm run deploy` **if package.json defines
a `deploy` script**. This manager lets the user safely detect, choose, and — after
explicit approval — create that script. **It never deploys** and never runs
`npm run deploy`.

## Why a deploy script is required

The runner deliberately never invents commands — it only runs the existing
`scripts.deploy`. If there is none, deployment is blocked. This manager fills that
gap under approval.

## Inspecting package.json

The renderer calls `deploy.inspectPackageScripts()` (no args). Main reads
package.json (read-only) and returns whether `deploy` / `build` / `typecheck`
scripts exist, their values, and the detected deploy tool (netlify / vercel /
render / cloudflare / local-build / custom). If a deploy script exists it is shown;
otherwise the profile selector appears.

## Profiles

- **로컬 빌드 확인용** (`local-build`) → proposes `npm run build`. **Low risk** and the
  only profile applied automatically — it just builds locally (no external deploy),
  giving the runner a controlled placeholder.
- **기존 외부 배포 스크립트 연결** (`custom-existing-script`) → the user types a script;
  it is validated and can be applied only if safe.
- **Netlify / Render / Vercel / Cloudflare** → **draft-only**. They are saved as a
  planning draft (localStorage); **package.json is not modified**. "CLI 설치와 로그인
  상태가 필요할 수 있어 실제 명령은 대표님 확인 후 별도 단계에서 설정합니다."

## Which profiles can update package.json

Only **local-build** (auto proposal `npm run build`) and a **validated custom**
script. External providers never write package.json in this sprint.

## Approved write (renderer never writes files)

Flow: select profile → see the proposal → **deploy 스크립트 적용 승인** →
**package.json에 적용**. Only then does main call `applyDeployScript(script)`, which
**validates** the script, then writes `scripts.deploy` with preserved 2-space JSON
formatting. The renderer never touches package.json or the filesystem.

## Script validation (blocks unsafe)

`validateDeployScript` blocks scripts containing destructive commands
(`rm -rf`, `del /s`, `format`, `git reset --hard`, `git clean -fd`, `push --force`
/ `-f`, `Remove-Item`, `-Recurse`, …), `.env` edits, secret-looking values
(`sk-…`, `OPENAI_API_KEY=`, `ANTHROPIC_API_KEY=`), or secret-bearing `curl`. Unsafe
scripts are refused with the reasons shown.

## No deploy, no installs, no secrets

This sprint configures scripts only. It never runs `npm run deploy`, never installs
packages, never runs external CLIs, and never asks for or stores secrets.

## Connection to the runner

After a script is applied: "deploy 스크립트가 준비되었습니다. 배포 실행기에서 배포 전
검사를 진행하세요." The runner then sees the `deploy` script and its 배포 전 검사 /
배포 승인 / 배포 실행 flow becomes available (still two-approval, main-only).
