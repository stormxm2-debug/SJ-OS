@echo off
chcp 65001 >nul
rem SJ OS — 모바일 웹(PWA) 빌드 + Cloudflare Pages(sj-invest.pages.dev) 배포.
rem 바탕화면의 "SJ OS 웹 배포" 런처가 호출한다. 최초 1회 `npx wrangler login` 필요.
rem Supabase 연동 빌드를 원하면 프로젝트 루트에 .env.web 파일을 만들고 (git에는 올라가지 않음)
rem   VITE_SUPABASE_URL=...
rem   VITE_SUPABASE_ANON_KEY=...
rem 두 줄을 넣어 둔다. 없으면 로컬 데이터 모드로 빌드된다.
cd /d "%~dp0.."

rem --- 처음 받은 폴더에서도 바로 되도록 준비 ---
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo [실패] Node.js 가 이 PC에 설치돼 있지 않습니다.
  echo        https://nodejs.org 에서 LTS 버전을 설치한 뒤 다시 실행하세요.
  echo.
  pause
  exit /b 1
)
if not exist "node_modules" (
  echo.
  echo [준비] 처음 실행이라 필요한 라이브러리를 내려받습니다. 몇 분 걸릴 수 있습니다...
  echo.
  call npm install
  if errorlevel 1 (
    echo.
    echo [실패] 라이브러리 설치에 실패했습니다. 인터넷 연결을 확인하세요.
    echo.
    pause
    exit /b 1
  )
)
rem --- 준비 끝 ---
title SJ OS 웹(PWA) 배포
echo ============================================
echo   SJ OS 모바일 웹(PWA) 빌드 + 배포
echo ============================================
echo.
if exist ".env.web" (
  echo [.env.web 발견] Supabase 키를 빌드에 주입합니다.
  for /f "usebackq eol=# tokens=* delims=" %%a in (".env.web") do set "%%a"
) else (
  echo [주의] .env.web 파일이 없어 Supabase 연동 없이 빌드됩니다.
  echo        직원 데이터 공유가 필요하면 프로젝트 폴더에 .env.web 을 만들고
  echo        VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY 두 줄을 넣으세요.
)
echo.
call npm run build:web
if errorlevel 1 (
  echo.
  echo [실패] 빌드 오류가 발생했습니다. 위 로그를 확인하세요.
  echo.
  pause
  exit /b 1
)
echo.
echo Cloudflare Pages(sj-invest)로 배포 중...
call npx wrangler pages deploy dist --project-name=sj-invest --branch=main
if errorlevel 1 (
  echo.
  echo [실패] 배포 오류. 처음이라면 `npx wrangler login` 으로 이 PC를 한 번 인증하세요.
) else (
  echo.
  echo [완료] https://sj-invest.pages.dev 에 배포되었습니다.
  echo 직원 폰의 앱은 다음에 열 때 자동으로 새 버전으로 업데이트됩니다.
)
echo.
pause
