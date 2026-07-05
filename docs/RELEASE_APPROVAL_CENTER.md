# Release Approval Center

After a Claude auto-build job is completed / committed / pushed / reported, the
**릴리즈 승인 센터** (in the Release Center page) lets the user decide whether it is
ready to release. This sprint is **approval only** — it never deploys, runs git, or
touches external services.

## Flow

1. From the panel, pick a **succeeded** job under "완료된 작업에서 릴리즈 항목 생성" to
   create a `ReleaseApprovalItem` (idempotent per job).
2. The item carries: 작업명, 요청 내용, 릴리즈 노트, 검증 결과, commit hash, push 상태,
   위험도, and a 수동 테스트 체크리스트 (generated from the command).
3. The user reviews and sets a status.

Items are grouped into: **승인 대기 / 수정 필요 / 승인 완료 / 릴리즈 준비 완료 / 반려**.

## Creation

`createReleaseApprovalFromJob(job)` builds the item from a succeeded job using the
shared generators (`generateReleaseNote`, `generateManualTestChecklist`) and
derives `riskLevel` from verification (both passed → low; a failure → high). Items
are persisted locally (`localStorage`). No shell, no git.

## Approve / needs-fix / reject

- **승인** → `approved` · "대표님 승인 완료. 릴리즈 준비 단계로 이동할 수 있습니다."
- **수정 필요** → `needs-fix` · use the auto-repair / manual review flow (not
  auto-run here).
- **반려** → `rejected` · the job and report are **not** deleted.

## Release-ready checklist

**릴리즈 준비 완료로 표시** is allowed only when nothing is missing:

- typecheck 통과 (auto, from verification)
- build 통과 (auto)
- 변경 파일 검토 (user toggle)
- 수동 테스트 완료 (user toggle, or all test items checked)
- 릴리즈 노트 확인 (user toggle)
- 대표 승인 완료 (auto, status = approved)
- push 상태 확인 (user toggle, or pushStatus = pushed)

If any are missing the button is blocked and lists them
("릴리즈 준비 미완료: …"). When satisfied → status `release-ready` · "릴리즈 준비
완료로 표시했습니다. 실제 배포는 다음 단계에서 진행됩니다."

## Manual test tracking

Each checklist item is a local, persisted checkbox. No sensitive data is sent
externally.

## Copy release note

**릴리즈 노트 복사** copies title + release note + verification + commit hash +
manual test checklist as plain text.

## No deployment

A disabled **배포 실행** section states: *"자동 배포는 다음 안정화 단계에서
활성화됩니다. 현재는 릴리즈 승인과 준비 상태만 관리합니다."* No deployment command, no
hosting change, no external service is touched.

## Future

A controlled deployment runner (behind approval, logging, and rollback) is a later
sprint. Deeper wiring of these items into the existing `ReleaseRepository` /
release-candidate list is also future.
