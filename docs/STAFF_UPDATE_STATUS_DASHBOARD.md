# Staff update status dashboard

Tracks installation/update progress by staff member and version: who received the
guide, who's installing, who completed, who failed, who's pending, plus the rollout
completion rate. **Dashboard + local tracking only** — no remote install, no
automatic sending, no upload, no publish, no installer execution/build.

## Purpose

After installer packages + install guides exist, this dashboard gives an at-a-glance
rollout view with a failed-staff focus so nobody is missed.

## How counts are calculated

`computeDashboard(records)` buckets each staff record by status:

- `totalStaff` = all records
- `guideSentCount` / `installingCount` / `installedCount` / `failedCount` /
  `skippedCount` = counts per status
- `pendingCount` = `not-started`
- `eligible` = total − skipped (skipped staff are excluded from the rate)

## Completion rate

`completionRate = round(installedCount / eligible × 100)` (0 if no eligible staff).

Dashboard status: **blocked** (no records) → **needs-attention** (any failed) →
**completed** (all eligible installed, 0 failed) → **mostly-complete** (≥80%) →
**active**.

## Editing staff statuses

Local only (`localStorage`). Add a record (직원명 / 팀·직책, target version), then set
its status with buttons: 시작 전 / 안내 발송 / 설치 중 / 설치 완료 / 실패 / 제외. Each
change updates counts + completion immediately. **No message is sent, no email, no
KakaoTalk/Slack, no upload.**

## Failed-staff focus

A **조치 필요 직원** section lists failed installs with the issue summary, last-updated
time, and **safe** next actions only: 화면 캡처 요청 · 오류 문구 확인 · 기존 SJ OS 종료
여부 확인 · 설치파일 버전 확인 · 관리자에게 전달. **No risky commands**, no
antivirus-disable, no registry/system-file edits.

## Guide → dashboard

If install guides exist, **안내 기록 가져오기** mirrors the latest guide's staff records
into the dashboard (deduped by name + version); records stay locally editable. If no
guide/package exists: *"설치 안내 또는 배포 패키지가 없습니다. 먼저 설치 안내를
생성해주세요."*

## Copy report

**현황 보고 복사** copies a plain-text report (`[SJ OS 직원 업데이트 현황]` → 버전 / 전체
대상 / 설치 완료 / 설치 중 / 실패 / 대기 / 완료율 / 조치 필요 / 설치 완료 직원).

## Not done here

No remote install, no automatic sending (email/KakaoTalk/Slack), no upload/publish,
no installer build or execution, no dependency install.

## Future (disabled)

카카오톡/이메일 안내 자동 발송 · 설치 완료 자동 보고 · 자동 업데이트 · 원격 배포 · 롤백
현황판 are shown as a disabled/planned section, not implemented here.
