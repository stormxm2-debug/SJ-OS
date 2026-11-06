# 원격 작업 수신 러너 (이슈 #76)

Codex가 GitHub 이슈에 작업을 등록하면, **지정한 PC 한 대**의 SJ-OS 앱이 그 작업만 수신해
기존 Claude 실행기로 코드를 작성·검증하고, **검토용 PR과 결과 댓글**을 자동으로 남긴다.
사용자는 지시문·파일·PR 링크를 두 채팅 사이에서 옮기지 않아도 된다.

> ⚠️ 이 기능은 **자동 병합·운영 배포·운영 DB 변경을 하지 않는다.** 작업 브랜치 + 검토용 PR 까지만 만든다.

## 구성 요소

- `src/shared/remoteTask.ts` — 지시 파싱·검증·중복상태·오류분류·공개 리댁션·결과 댓글(순수, 단위테스트).
- `src/shared/remoteTaskPoll.ts` — `pollOnce` 오케스트레이터(순수, deps 주입, 단위테스트).
- `src/main/remoteTaskRunner.ts` — 실제 gh/git CLI + 기존 러너(`claudeAutoBuild`) 연동, 상태 영속화, 타이머, IPC.
- IPC: `remote-task:get-config` / `set-config` / `status` / `start` / `stop` (기본 비활성).

## 보안 모델

- 공개 저장소이므로 **이슈/댓글 전체를 명령으로 취급하지 않는다.** 아래 `sj-run` 지시 블록 + 필수 필드가 있을 때만 작업으로 인식.
- **허용 작성자(allowlist)** + **지정 runner id** + **repo 일치** 를 모두 만족해야 실행. 그 외는 실행하지 않고 1회 `rejected` 로만 기록.
- 작업 본문은 **셸 문자열로 실행하지 않는다.** 러너의 고정 CLI 경로(`createAutoBuildJob` → Claude `-p`, stdin 전달)로만 전달된다.
- **중복 실행 방지 + 무한 재시도 방지(복구 우선)**: 처리한 task id 를 `remote-task-state.json` 에 영속화한다. **상태가 남아 있는 task id 는 자동으로 다시 실행하지 않는다**(완료·실패·거부·진행 중 모두). 같은 작업이 실패·시간초과를 반복하며 매 폴링마다 재실행되는 악순환을 막는다. 재개는 **새 task id** 를 쓰거나 해당 항목을 상태 파일에서 명시적으로 지운다.
- **미커밋 변경은 절대 삭제하지 않는다(복구 우선)**: 작업 폴더가 더티면 — 이전 원격작업(`claude/remote-*`)의 잔여물은 `git clean` 으로 삭제하지 않고 **복구 가능한 named stash**(`sj-remote-autostash:…`, 추적/비추적 모두 포함)로 보존한 뒤 진행한다(보존이 확인되지 않으면 삭제 없이 중단). 사용자가 `main` 등에서 작업 중이면 **건드리지 않고 거부**한다. 보존본은 `git stash list` / `git stash apply` 로 복구한다.
- **시간초과(15분) 즉시 인식**: 러너 실행은 `claudeAutoBuild` 의 15분 하드 리밋으로 종료되며, `waitForJob` 가 `timed-out`/`needs-review`/`skipped` 를 **즉시** 종료로 인식한다(추가 대기 없음, 상한 16분). 결과 댓글에 정확한 실패 상태·사유를 남긴다.
- **명시적 정지 유지**: `remote-task:stop` 은 `enabled=false` 를 영속화하여 **앱을 재시작해도 자동으로 다시 켜지지 않는다.** 다시 받으려면 명시적으로 `start`(또는 설정에서 활성화).
- **오프라인·로그인 만료·검증 실패를 성공으로 표시하지 않는다**(gh/git 오류 분류).
- 공개 이슈/PR 에 **자격정보·고객정보·전체 실행 로그를 게시하지 않는다**(토큰·주민번호 등 패턴 리댁션 + 길이 제한).
- gh/git 는 **PC 의 기존 로그인(CLI)** 을 재사용한다. 자격정보를 코드·설정·대화에 넣지 않는다.

## 최초 1회 PC 설정 (선행 조건)

클라우드(Codex) 환경에는 사용자 PC 제어 연결이 없으므로, **이 수신 기능의 최초 연결은 PC 에서 한 번** 필요하다.

1. 지정 PC 에 이 저장소를 클론하고 SJ-OS 앱(또는 개발 빌드)을 실행한다.
2. `gh auth login` 및 `git` 자격을 PC 에 설정한다(앱은 이 로그인을 재사용).
3. `node -e "console.log(require('electron').app.getPath('userData'))"` 위치의
   `remote-task-config.json` 을 아래처럼 설정하거나 IPC(`remote-task:set-config`)로 설정한다:

   ```json
   {
     "enabled": true,
     "repo": "stormxm2-debug/SJ-OS",
     "issueNumber": 76,
     "allowedAuthors": ["stormxm2-debug"],
     "runnerId": "PC-대표-01",
     "pollSeconds": 60
   }
   ```

4. `remote-task:start` 를 호출(또는 앱 시작 시 자동)하면 60초 간격으로 이슈 #76 댓글을 확인한다.

## Codex 가 작업을 등록하는 방법 (이슈 댓글)

허용 작성자가 이슈 #76 에 아래 형식의 댓글을 남긴다. `runner` 는 위에서 정한 `runnerId` 와 **정확히** 일치해야 한다.

<pre>
```sj-run
task: hr-smoke-001
runner: PC-대표-01
title: 원격 실행 스모크 테스트
---
docs/REMOTE_SMOKE.md 파일을 새로 만들고 "remote runner ok" 한 줄만 작성하세요.
기존 파일은 수정하지 마세요. 커밋·푸시는 러너가 처리합니다.
```
</pre>

- `task`: 고유 id(영숫자 `._-`, 3~64자). 같은 id 는 한 번만 실행된다.
- `runner`: 이 작업을 실행할 지정 PC id.
- `title`: 짧은 제목(PR/결과 제목에 사용).
- `branch`(선택): 지정 안 하면 `claude/remote-<task>`.
- `---` 아래: 작업 범위·완료 기준 본문(러너에 그대로 전달).

## 결과

러너는 작업별 브랜치에서 코드를 작성하고 typecheck/build 를 돌린 뒤,
**검토용 PR** 을 만들고 이슈 #76 에 결과 댓글(작업 id · 브랜치 · PR 링크 · 검사 결과 · 변경 파일 · 미완료)을 남긴다.
Codex 는 그 PR/이슈를 읽어 결과를 확인한다.

## 한계 / 미검증

- **실제 PC 연결·종단간(end-to-end) 실행은 지정 PC 에서만** 동작·검증된다. 클라우드/CI 에서는 gh/git/Claude CLI 가 없어 미검증이다.
- 순수 로직(파싱·검증·중복·오류분류·리댁션·오케스트레이터)은 `test/remoteTask.test.mjs` 로 단위검증했다.
- 최초 PC 설치·연결과 종단간 1건 통과 전에는 "자동화 완료"로 보지 않는다.
