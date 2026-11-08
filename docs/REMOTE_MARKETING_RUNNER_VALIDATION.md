# 원격 마케팅 러너 검증 기록 (PR #104 테스트 보완)

- 날짜: 2026-11-09
- 대상: PR #104 head `cc429c8f3cb0b9088c2a33073eccaae83a996323`
- 적용 방식: 최신 `main`(`0e922c7`, PR 의 부모와 동일) 위에 `git cherry-pick --no-commit` — 충돌 없음.
  적용 결과가 `cc429c8f` 트리와 동일함을 `git diff --cached cc429c8f` (빈 diff) 로 확인. 원본 10개 파일 외 코드 변경 없음.
- 환경: Windows 11, Node v24.18.0
- 범위: 테스트 실제 실행·기록만. 기능 추가/리팩토링 없음. 기존 stash 2건은 건드리지 않음.

## 결과 요약

| 항목 | 명령 | 결과 |
|---|---|---|
| 신규 다중 저장소 테스트 | `node --test test/remoteProjects.test.mjs` | **54 / 54 통과**, 실패 0, skip 0 |
| 기존 remoteTask / remoteTaskPoll 테스트 | `node --test test/remoteTask.test.mjs` | Windows 에서 **로더 오류로 시작 전에 실패** (아래 참고) |
| 같은 21개 테스트, 로더 한 줄만 바꾼 임시 사본 | 아래 참고 | **21 / 21 통과**, 실패 0 |
| typecheck | `npm run typecheck` | 통과 (exit 0) |
| build | `npm run build` | 통과 (exit 0) |

### 기존 `remoteTask.test.mjs` 로더 오류 (PR #104 와 무관, 기존 문제)

- 오류: `ERR_UNSUPPORTED_ESM_URL_SCHEME` — 테스트 하네스의 `import(file)` 이 Windows 절대경로(`C:\...`)를 받음.
- PR #104 는 이 파일을 수정하지 않음(main 과 동일). PR 을 적용하지 않은 순수 `origin/main` 임시 worktree 에서도 같은 오류가 재현됨.
- 같은 원인으로 전체 `npm test` 에서 PR 범위 밖 테스트 파일 16개가 실패: 138건 중 120 통과, 16 실패, 2 skip. 16건 모두 이 오류이며 assertion 실패는 0건.
  범위 밖이라 이번에 수정하지 않음 (별도 작업 필요: `import(pathToFileURL(file).href)`).
- PR 코드의 기존 테스트 회귀 확인은 `import(pathToFileURL(file).href)` 한 줄만 바꾼 임시 사본으로 실행함
  (`node_modules/.sj-validate/`, git 무시 경로, 실행 후 삭제). 대상은 PR 적용 상태의 `src/shared/remoteTask.ts` / `remoteTaskPoll.ts` 이며 21 / 21 통과.

## 검토 요청 항목별 확인 (`remoteProjects.test.mjs`, 모두 mock CLI·합성 데이터)

- `requireRepoHeader=true`: "projectRunnerConfig … repo 헤더 필수", "지시 repo: 프로젝트 러너는 repo 헤더 없으면 거부" 통과.
  → 광고 이슈 #3 의 기존 첫 작업 댓글(repo 헤더 없음)은 새 러너에서 **거부됨**. 최초 활성화 후 새 task id 와 `repo:` 헤더를 넣어 별도로 스모크테스트해야 함. 기존 댓글은 바꾸지 않음.
- allowlist(repo / issue #3 / 작성자 / 브랜치 접두사 고정, 설정으로 변경 불가): "allowlist…", "sanitizeUserPatch…", "mock CLI: 허용되지 않은 작성자" 통과.
- 별도 workspace / branch 검증: "workspace: …"·"workspace 거부: …"(origin 불일치, 다른 브랜치, SJ-OS 접두사, detached HEAD, 폴더 겹침), "isSameOrInside", "작업 폴더 재검증 실패(바꿔치기)", "push 직전 재검증 실패", "지시 branch 가 접두사 밖이면 … 접두사 브랜치 강제" 통과.
- 타 저장소 댓글 거부: "지시 repo: 다른 저장소(SJ-OS) 대상 지시는 거부", "mock CLI: SJ-OS repo 를 지정한 지시는 마케팅에서 실행 안 함", "기존 SJ-OS 러너: 마케팅 repo 를 지정한 지시는 SJ-OS 에서 실행 안 함" 통과.
- processed state 분리: "상태 파일 분리"(`remote-task-state.marketing.json` ≠ `remote-task-state.json`), "상태 분리: SJ-OS 상태에 같은 task id 가 있어도 마케팅 상태와 무관" 통과.
- 중복 실행 방지: "중복(이미 처리됨)은 재실행 안 함", "중단(running)으로 남은 작업은 … 자동 재실행 안 함", "runLock: 한 번에 한 러너만" 통과.
- 기존 SJ-OS 작업 호환성: "기존 SJ-OS 러너: repo 헤더 없는 기존 지시는 그대로 통과(회귀 없음)" + 기존 remoteTask 21건(pollOnce 정상 1건 실행·PR·완료 포함) 통과.
- WIP 보존: "main 에 미커밋 변경 → stash/삭제 없이 거부", "이전 마케팅 원격 브랜치 잔여물 → named stash 로 보존", "같은 이름의 기존 브랜치는 덮어쓰지 않음" 통과.
- GitHub 오프라인 / 인증 실패: "mock CLI: 오프라인(gh 실패) → 성공 처리 안 함", "readiness: … 오프라인/로그인 만료" 통과. 둘 다 성공으로 표시되지 않음.

## 확인되지 않은 것 (성공으로 보고하지 않음)

- 실제 GitHub / gh / Claude CLI 호출은 하지 않았음(테스트는 모두 mock).
- 사용자 PC 에 새 빌드 설치, 광고 작업 폴더 지정, `runnerId` 설정, 연결 검사, 명시적 시작은 **아직 하지 않음**. 따라서 자동 연동은 **미검증**.
  PR merge 만으로 지금 실행 중인 러너가 새 러너로 바뀌지 않음.
