# Staff installation / update guide center

Generates clear installation/update instructions from a registered distribution
package and tracks each staff member's install status. **Guide + local tracking
only** — it never remote-installs, sends files, uploads, publishes, runs installer
files, or builds installers.

## Purpose

After an installer package is registered (with its version + SHA-256), staff need a
readable Korean guide (what to install, how, how to verify, what to do on problems)
plus a per-staff status board.

## Install guide generation

`generateInstallGuide(pkg)` (renderer) builds a `StaffInstallationGuide` from a
registered `StaffDistributionPackage`: version, installer file name, SHA-256,
release note, plus default **설치 전 확인 / 설치 순서 / 업데이트 체크리스트 / 설치 후 확인 /
문제 해결** sections. Guides persist in `localStorage`.

## Registered packages → guide

The panel lists registered distribution packages (from the registry). Selecting one
and clicking **설치 안내 생성** creates/refreshes its guide. If none are registered:
*"등록된 직원 배포 패키지가 없습니다. 먼저 '직원 배포 패키지 기록' 센터에서 설치파일을
등록해주세요."*

## Checksum usage

The guide includes the package's **SHA-256** so staff can verify the installer file
matches before running it.

## Staff install status tracking

Local only (`localStorage`). Add a record (직원명 / 직책·팀) and set its status:
시작 전 / 안내 발송 / 설치 중 / 설치 완료 / 실패 / 제외. **No message is sent, no email, no
KakaoTalk/Slack, no upload** — a manual tracking board.

## Copy guide

**안내문 복사** copies the full plain-text guide (`[SJ OS 설치/업데이트 안내]` …
version / file / SHA-256 / release note / 설치 전 확인 / 설치 순서 / 설치 후 확인 / 문제
발생 시 / 문제 해결 가이드).

## Troubleshooting (safe)

설치파일 실행이 안 될 때 · Windows 보안 경고가 뜰 때 · 앱 실행 후 흰 화면일 때 · 자비스가 안
열릴 때 · 클릭이 안 될 때 · 버전이 이전 버전으로 보일 때. **No risky commands** — it never
tells staff to edit system files or disable antivirus; instead: *"보안 경고가
반복되면 관리자에게 문의하세요."*

## No remote install / no auto send

This center generates text and tracks status. It never runs an installer, never
remote-controls a PC, never sends/uploads anything, and never builds installers.

## Future (disabled)

카카오톡/이메일 안내 자동 발송 · 설치 완료 자동 보고 · 자동 업데이트 · 직원 PC 원격 배포 ·
롤백 설치 안내 are shown as a disabled/planned section, not implemented here.
