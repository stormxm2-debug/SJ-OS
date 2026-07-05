# SJ OS 모바일 PWA — Netlify 배포 가이드

SJ OS 모바일/웹 스태프 앱을 Netlify 정적 호스팅으로 배포하는 방법입니다. **데스크톱
Electron 앱은 그대로 유지됩니다.** 이 문서는 준비 안내이며, 실제 배포는 대표님이 직접
진행합니다. (이 스프린트에서 자동 배포/로그인은 하지 않습니다.)

## 개요

- 빌드 도구: Vite 웹 빌드 (`build:web`, electron-vite와 별개)
- 출력 폴더: `dist/`
- SPA 라우팅 폴백 + PWA 매니페스트 포함
- Supabase URL/anon key는 Netlify 환경변수로 **수동** 설정

## 1. Netlify 사이트 생성 + GitHub 연결

1. https://app.netlify.com 접속 → **Add new site → Import an existing project**.
2. GitHub 저장소(SJ-OS)를 연결합니다.
3. 브랜치는 `main`을 선택합니다.

## 2. 빌드 설정

- **Build command**: `npm run build:web`
- **Publish directory**: `dist`

(저장소의 `netlify.toml`에 동일하게 정의되어 있어 자동 인식될 수 있습니다.)

## 3. 환경 변수 (Netlify → Site settings → Environment variables)

| Key | Value |
|---|---|
| `VITE_SUPABASE_URL` | Supabase 프로젝트 URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon **public** key |

**절대 넣지 마세요:**
- `SUPABASE_SERVICE_ROLE_KEY` / service_role key — RLS를 우회하므로 프론트엔드에 절대 금지.
- 데이터베이스 비밀번호.
- OpenAI 등 다른 API 키 — 프론트엔드/모바일 PWA에는 넣지 않습니다(서버 게이트웨이가 있을
  때만 서버에서 사용).

> anon key는 공개되어도 되는 키입니다. 실제 데이터 보호는 **RLS**가 담당합니다.

## 4. 배포 + 접속 테스트

1. **Deploy** 실행 → 완료되면 `https://<사이트>.netlify.app` 주소가 생성됩니다.
2. 휴대폰 브라우저로 접속합니다.
3. 하단 탭(홈·출퇴근·고객·일정·더보기)이 보이는지 확인합니다.
4. 개발/릴리즈/배포 메뉴가 **보이지 않는지** 확인합니다.

## 5. 홈 화면에 추가 (PWA)

- iOS Safari: 공유 → **홈 화면에 추가**.
- Android Chrome: 메뉴 → **앱 설치 / 홈 화면에 추가**.
- 앱 이름은 **SJ OS**, 세로(standalone) 화면으로 실행됩니다.

## 6. Supabase 로그인 + 기능 테스트

1. Supabase Auth 이메일/비밀번호로 로그인 (프로필 필요).
2. 출퇴근 / 고객 / 상담 / 일정 사용.
3. 데이터 모드 배지가 **Supabase 공용 DB**인지 확인.

## 7. 문제 발생 시 확인할 것

- 흰 화면: 환경변수(`VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY`) 설정 여부 확인.
- 로그인 실패: Supabase profiles 행 존재/활성 상태 확인.
- 새로고침 시 404: `netlify.toml`의 SPA redirect가 적용됐는지 확인.
- 데이터가 안 보임: RLS 정책과 로그인 계정 권한 확인.

## 보안 요약

- 프론트엔드는 anon key만 사용. service_role key 금지.
- 서비스 워커/오프라인 캐시 없음 → 고객/상담/출퇴근 데이터는 오프라인에 저장되지 않습니다.
- `.env`/실제 키는 저장소에 커밋하지 않습니다.
