# SJ OS 배포 가이드

두 갈래로 배포합니다.
- **PC (대표/관리자)** → 데스크톱 설치본 `.exe`
- **모바일 (직원)** → 웹 PWA (폰 브라우저 → 홈 화면에 추가)

---

## 1. PC 데스크톱 앱 (.exe)

### 설치본 만들기
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

### 웹 빌드 만들기
```bash
npm run build:web
```
- 결과물: **`dist/`** 폴더 (정적 파일: index.html + assets + manifest)

### 호스팅 (둘 중 하나 — 계정은 직접 만드셔야 함)

**A. Netlify (가장 쉬움, 드래그&드롭)**
1. https://app.netlify.com 로그인 → **Add new site → Deploy manually**
2. `dist/` 폴더를 통째로 드래그&드롭 → 끝. `https://<이름>.netlify.app` 주소 발급.

**B. Vercel**
1. https://vercel.com → New Project → 이 저장소 연결
2. 빌드 명령 `npm run build:web`, 출력 디렉터리 `dist` 로 설정 → Deploy.

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

## 4. (선택) 직원 데이터 공유 — Supabase

지금은 **기기별 로컬 저장**이라 폰마다 데이터가 따로입니다(테스트엔 충분).
대표가 전 직원 출퇴근·고객을 **한곳에서 보려면** Supabase 연결이 필요합니다.

1. https://supabase.com 프로젝트 생성 → 테이블/RLS 설정(attendance_records 등).
2. 웹 빌드 환경변수: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` 입력(Netlify/Vercel 환경변수).
3. 앱이 자동으로 로컬-목 → Supabase 공용 DB 모드로 전환됩니다.

---

## 요약 체크리스트

| 대상 | 명령 | 산출물 | 다음 |
|---|---|---|---|
| PC 앱 | `npm run dist` | `release/SJ OS Setup 0.0.0.exe` | PC에 설치 |
| 모바일 웹 | `npm run build:web` | `dist/` | Netlify/Vercel 업로드 |
| AI (선택) | 프록시 호스팅 | — | 키 입력 + CSP |
| 데이터 공유 (선택) | Supabase | — | 환경변수 |
