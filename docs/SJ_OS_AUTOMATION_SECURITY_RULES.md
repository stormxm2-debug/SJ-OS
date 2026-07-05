# SJ OS — 자동화 보안 규칙

Claude Code CLI 자동 실행 러너(및 배포/패키징 러너)의 보안 경계입니다. 구현은
`src/main/claudeAutoBuild.ts` 외 메인 프로세스 모듈에 있으며, 렌더러는 typed IPC만
사용합니다.

## 허용되는 명령 (메인 프로세스 고정)

- `npx @anthropic-ai/claude-code --permission-mode acceptEdits` (헤드리스, cwd=projectRoot)
- 검증: `npm run typecheck`, `npm run build`, `npm run build:web`
- 읽기 전용 git: `git status --short`, `git diff`, `git rev-parse HEAD`,
  `git log --oneline`, `git branch`, `git tag --list`
- 승인된 쓰기 git: `git add <safe files>`, `git commit -m`, `git push origin <branch>`
  (force 아님), `git tag -a`, `git worktree add/merge --no-ff`

이 명령들은 **메인 프로세스가 결정**합니다. 렌더러는 명령 문자열을 셸로 보내지 않습니다.

## 승인이 필요한 동작

- Claude Code의 **파일 수정** 실행 → owner/admin 승인.
- **git add / commit / push** → 명시적 승인. (검증 통과한 완료 작업만 커밋 가능)
- **리페어(자동 수정) 재실행** → 승인 후 진행.
- 커밋 전 게이트: `.env` 변경 감지 / 시크릿 값 감지 / `git diff --check` 실패 시 **차단**.

## 항상 차단되는 명령 (프롬프트 스캐너 + 실행 게이트)

- `git reset --hard`, `git clean -fd`, `git push --force` / `-f`
- `rm -rf`, `Remove-Item -Recurse`, `del /s`, `format`
- `.env` / `.env.local` 편집
- `service_role` 키 노출, RLS 비활성화, 인증 제거, 보안 규칙 무시
- 프로젝트 파일/`src`/`docs`/패키지 파일 삭제

`scanAutoBuildPrompt`가 생성 프롬프트를 검사해 위 의도가 있으면
**"안전 규칙 위반으로 실행이 차단되었습니다."** (상태: 차단됨)로 막습니다. "금지 명령
목록"으로 문서에 나열된 경우(실행 지시가 아님)는 오탐 방지 로직으로 허용합니다.

## 왜 .env를 건드리면 안 되는가

`.env`/`.env.local`에는 런타임 시크릿(예: Supabase anon/URL, 기타 키)이 담길 수 있습니다.
자동화가 이를 수정/커밋하면 시크릿 유출·설정 파손 위험이 있으므로, 편집·커밋을 모두
차단합니다. 커밋 diff에 `.env`가 포함되면 커밋 자체를 막습니다.

## 왜 service_role은 렌더러에 없어야 하는가

`service_role` 키는 **RLS를 우회**하는 관리자 키입니다. 렌더러(Electron/웹/PWA)는 공격
표면이 넓어 이 키가 노출되면 전체 데이터가 위험합니다. 따라서 렌더러/프론트엔드/저장소에는
절대 두지 않고, 서버(Edge Function) 환경에만 둡니다. 렌더러는 anon public key만 사용합니다.

## 왜 파괴적 명령을 차단하는가

`reset --hard`/`clean -fd`/`rm -rf`/`format` 등은 커밋되지 않은 작업·파일·히스토리를
되돌릴 수 없게 파괴합니다. 자동화가 이를 실행하면 프로젝트 손실 위험이 크므로 항상
차단합니다. 되돌리기 필요 시에는 사람이 직접, 안전한 대안으로 처리합니다.

## 실행 환경 제한

- **Electron 데스크톱 owner/admin 전용.** Web/PWA는 실행 불가("데스크톱 앱에서만 가능").
- FC/팀장은 자동화 화면 접근 불가(admin 라우트 → AccessDenied, 모바일 숨김).
- 자동 실행 기본값 OFF. ON이어도 한 번에 하나, 실패 시 중단.

## 로그 안전

로그에 env·토큰·세션·시크릿·`.env` 전체·비밀번호·고객 데이터를 남기지 않습니다. 커밋 diff에
시크릿처럼 보이는 문자열이 있으면 커밋을 차단합니다.
