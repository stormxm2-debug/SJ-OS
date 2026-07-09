@echo off
chcp 65001 >nul
rem SJ OS — 모바일 웹(PWA) 빌드 + Netlify 배포. 바탕화면의 "SJ OS 웹 배포" 런처가 호출한다.
rem Supabase 연동 빌드를 원하면 프로젝트 루트에 .env.web 파일을 만들고 (git에는 올라가지 않음)
rem   VITE_SUPABASE_URL=...
rem   VITE_SUPABASE_ANON_KEY=...
rem 두 줄을 넣어 둔다. 없으면 로컬 데이터 모드로 빌드된다.
cd /d "%~dp0.."
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
) else (
  echo.
  echo [완료] dist 폴더가 만들어졌습니다.
  echo 지금 열리는 Netlify Drop 페이지에 dist 폴더를 통째로 끌어다 놓으면 배포 끝.
  echo 배포되면 직원 폰의 앱은 다음에 열 때 자동으로 새 버전으로 업데이트됩니다.
  start "" explorer "%cd%\dist"
  start "" https://app.netlify.com/drop
)
echo.
pause
