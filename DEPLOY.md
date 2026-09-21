# SJ OS 배포 가이드

두 갈래로 배포합니다.
- **PC (대표/관리자)** → 데스크톱 설치본 `.exe`
- **모바일 (직원)** → 웹 PWA (폰 브라우저 → 홈 화면에 추가)

---

## 1. PC 데스크톱 앱 (.exe)

### 자동 배포 (기본)

**`package.json` 의 `version` 을 올려서 `main` 에 push 하면** GitHub Actions
(`.github/workflows/release-desktop.yml`)가 검사 → 설치본 빌드 → GitHub Releases 업로드까지
합니다. 직원 PC의 앱은 다음에 켤 때 새 버전을 자동으로 받습니다.

```
1) package.json 의 "version" 을 올린다   (예: 1.0.44 → 1.0.45)
2) main 에 push
```

Secret 을 따로 등록할 필요가 없습니다. GitHub 가 주는 토큰으로 릴리스를 만듭니다.

`package.json` 이 바뀐 push 에서만 깨어나고, 그중에서도 **`version` 이 실제로 올라간
push 에서만** 배포합니다. 스크립트만 고친 push 로는 배포되지 않습니다.

**왜 버전을 올려야만 배포되나** — 앱이 `autoUpdater.autoDownload = true` 라, 릴리스가
올라가는 순간 직원 PC가 곧바로 새 버전을 내려받습니다. push 한 번마다 배포하면 사고가
나므로, "버전을 올린다"는 분명한 행동을 배포 스위치로 삼았습니다.

- `package.json` 이 바뀐 push 에서만 동작합니다. 코드만 고친 push 로는 배포되지 않습니다
- 이미 같은 버전의 릴리스가 있으면 아무 것도 하지 않습니다(중복 배포 방지)
- 타입검사·테스트를 통과하지 못하면 빌드하지 않습니다
- 릴리스 업로드가 실패해도 설치본은 Actions 의 Artifacts 에 30일간 남습니다
- 진행 상황: GitHub 저장소 → **Actions** 탭 → **데스크톱 앱 배포**

같은 버전을 다시 만들어야 하면 Actions 탭에서 **Run workflow** → `force` 체크.

### 설치본 만들기 (수동 — 급할 때)
```bash
npm run dist
```
- 결과물: **`release/SJ OS Setup 0.0.0.exe`** (약 79MB)
- `dist:dir`(언팩, 설치 없이 실행 테스트): `release/win-unpacked/SJ OS.exe`

### 설치·실행
1. `SJ OS Setup 0.0.0.exe` 를 대표님 PC로 옮겨 더블클릭 → 설치 위치 선택 → 설치.
2. 바탕화면 **SJ OS** 아이콘으로 실행.

### 참고
- ⚠️ **코드 서명이 안 돼 있어** 설치 시 Windows SmartScreen "알 수 없는 게시자" 경고가 뜹니다 → **추가 정보 → 실행**으로 진행(정상). 정식 배포 시 코드서명 인증서를 넣으면 사라집니다.
- 아이콘은 기본 Electron 아이콘입니다. 브랜드 아이콘(.ico)을 원하면 넣어 드립니다.
- 버전 올릴 때: `package.json`의 `version` 수정 후 `npm run dist`.

---

## 2. 모바일 웹 PWA (직원 폰)

**실제 운영 주소: https://sj-invest.pages.dev (Cloudflare Pages, 직접 업로드 방식)**

### SJ 앱에서 배포 (버튼 한 번)

SJ INVEST 앱의 배포 화면에서 바로 올릴 수 있습니다. 앱이 `npm run deploy` 를 실행하고,
그 스크립트가 웹을 빌드해 Cloudflare Pages 로 올립니다.

```
npm run deploy
= npm run build:web && npx wrangler pages deploy dist --project-name=sj-invest --branch=main
```

- **이 PC의 wrangler 로그인**을 그대로 씁니다. 토큰을 따로 만들 필요가 없습니다
  (최초 1회만 `npx wrangler login`)
- 앱이 먼저 `npm run typecheck` 와 `npm run build` 로 점검(preflight)한 뒤,
  **사장님이 승인해야** 실행합니다
- 터미널에서 `npm run deploy` 로 직접 돌려도 같습니다

### 자동 배포 (GitHub Actions)

`main` 에 push 하면 GitHub Actions(`.github/workflows/deploy-web.yml`)가
**타입검사 → 테스트 → 빌드 → Cloudflare Pages 배포**까지 알아서 합니다.
검사를 통과하지 못하면 배포하지 않으므로, 깨진 화면이 직원 폰까지 가지 않습니다.

- 진행 상황: GitHub 저장소 → **Actions** 탭
- 문서(`*.md`, `docs/`)만 고친 커밋은 배포하지 않습니다(화면이 안 바뀌므로).
  그래도 올리고 싶으면 Actions 탭에서 **Run workflow** 로 직접 실행하세요.

**최초 1회 설정** — 저장소 Settings → Secrets and variables → Actions 에 2개 등록:

| Secret | 어디서 얻나 |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | Cloudflare → My Profile → API Tokens → Create Token → **Cloudflare Pages: Edit** 권한 |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare 대시보드 우측의 **Account ID** |

Supabase 키는 넣지 않아도 됩니다. 웹 빌드는 `__SJ_WEB_BUILD__` 가 true 라
`supabaseClient.ts` 에 내장된 공개 anon 키로 항상 SJ 프로젝트에 접속합니다.

### 한 번에 배포 (수동 — 급할 때)
```bash
scripts\deploy-web.bat        # 빌드 + Cloudflare Pages 배포까지 자동
```
- 바탕화면의 "SJ OS 웹 배포" 런처가 이 스크립트를 실행합니다.
- 최초 1회만 이 PC에서 `npx wrangler login` 으로 Cloudflare 인증이 필요합니다.
- 프로젝트 루트의 `.env.web`(커밋 안 됨)에 `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`
  두 줄이 있으면 Supabase 연동 빌드가 됩니다.
- 배포되면 직원 폰의 앱이 다음에 열릴 때 자동으로 새 버전으로 업데이트됩니다
  (빌드마다 생성되는 `version.json`을 앱이 폴링).

### 수동 배포
```bash
npm run build:web                                              # dist/ 생성
npx wrangler pages deploy dist --project-name=sj-invest --branch=main
```

### 직원 사용법
- 발급된 **https 주소**를 직원 폰 브라우저(크롬/사파리)로 열기
- **홈 화면에 추가** → 앱처럼 실행. 출퇴근 시 **카메라·GPS**가 브라우저 권한 요청 → 허용.
- ✅ HTTPS라서 카메라·GPS·사진 워터마크 정상 동작(로컬 http로는 카메라가 막힘).

---

## 3. (선택) AI 기능 켜기 — 자비스 / 보험금 청구비서

기본 배포는 **AI 없이도** 출퇴근·고객·상담·일정·실적·공지가 전부 동작합니다.
AI(자비스 대화, 청구비서 Claude 분석)를 켜려면 프록시를 서버에 올려야 합니다.

1. `sj-ai-proxy/` 를 Render/Railway/Fly.io 등 Node 호스트에 배포.
2. 프록시 환경변수(`sj-ai-proxy/.env`)에 키 입력:
   - `OPENAI_ENABLED=true`, `OPENAI_API_KEY=...` (음성/기본 AI)
   - `ANTHROPIC_ENABLED=true`, `ANTHROPIC_API_KEY=...` (청구비서, console.anthropic.com에서 발급)
3. 웹 앱: `VITE_AI_PROXY_ENABLED=true`, `VITE_AI_PROXY_URL=https://<프록시주소>` 로 빌드 +
   `src/renderer/index.html` 의 CSP `connect-src` 에 프록시 주소 추가.

> 현재 청구비서는 `ANTHROPIC_API_KEY` 미설정 상태(결제 이슈)라 대기 중입니다.

---

## 4. 직원 데이터 공유 — Supabase (DB 준비 완료 ✅)

전 직원의 출퇴근·고객·상담·일정·실적·공지를 **한곳에서** 보려면 Supabase를 씁니다.
아래는 **이미 적용 완료**된 것과 **대표님이 하실 일**입니다.

### 이미 완료 (자동 적용됨)
- 프로젝트: `stormxm2-debug's Project` (서울 리전)
- Project URL: `https://kmjnluubjgyxkppxxjel.supabase.co`
- 스키마: profiles·teams·attendance_records·customers·consultations·schedule_events·performance_records·notices·announcements(+reads) + 인덱스
- RLS 보안 정책(대표/관리자=전체, 팀장=팀, FC=본인) + 헬퍼 함수 권한 하드닝
- 앱: `@supabase/supabase-js` 설치 완료 (env만 넣으면 자동으로 Supabase 모드 전환)

### 대표님이 하실 일 (로그인 부트스트랩 — 앱에 회원가입이 없어 최초 계정은 수동)
1. Supabase Dashboard → **Authentication → Users → Add user** → 대표 이메일/비밀번호 입력, **Auto Confirm User** 체크 → 생성.
2. 생성된 사용자의 **UUID**를 복사해서 저에게 알려주시면, `profiles`에 대표(owner) 프로필을 넣어 드립니다. (또는 SQL Editor에서 아래 실행)
   ```sql
   insert into public.profiles (id, name, role, status)
   values ('<복사한-UUID>', '김세종 대표', 'owner', 'active');
   ```
3. 직원 계정도 같은 방식(1~2)으로 추가하되 `role`을 `fc`/`team-leader`로.

### env 설정 (배포 시)
- **Netlify(저장소 연동)**: 사이트 → Environment variables 에 아래 2개 추가 후 재배포:
  - `VITE_SUPABASE_URL` = `https://kmjnluubjgyxkppxxjel.supabase.co`
  - `VITE_SUPABASE_ANON_KEY` = (anon 공개키 — 채팅으로 전달드림. service_role은 절대 넣지 말 것)
- **드래그&드롭 배포**면 빌드 때 env가 들어가야 하므로, 로컬에서 아래로 빌드한 `dist/`를 올리세요:
  ```bash
  VITE_SUPABASE_URL=https://kmjnluubjgyxkppxxjel.supabase.co \
  VITE_SUPABASE_ANON_KEY=<anon키> npm run build:web
  ```
- ⚠️ 로컬 `npm run dev`(PC 데스크톱 개발)에 이 env를 **영구로 넣으면** 데모 로그인이 막히고 Supabase 로그인만 됩니다(계정 부트스트랩 전에는 잠김). 그래서 로컬 `.env`에는 넣지 않았습니다.

> 사진 저장(스토리지)·전화번호 로그인은 별도 SQL(`docs/supabase/…STORAGE…`, `…PHONE_LOGIN…`)이 준비돼 있고, 필요 시 이어서 적용합니다.

---

## 요약 체크리스트

| 대상 | 명령 | 산출물 | 다음 |
|---|---|---|---|
| PC 앱 | `npm run dist` | `release/SJ OS Setup 0.0.0.exe` | PC에 설치 |
| 모바일 웹 | `npm run build:web` | `dist/` | Netlify/Vercel 업로드 |
| AI (선택) | 프록시 호스팅 | — | 키 입력 + CSP |
| 데이터 공유 (선택) | Supabase | — | 환경변수 |
