@echo off
chcp 65001 >nul
rem SJ OS — PC 데스크톱 설치본(.exe) 빌드. 바탕화면의 "SJ OS 앱 배포" 런처가 호출한다.
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
title SJ OS 앱(.exe) 배포
echo ============================================
echo   SJ OS 데스크톱 설치본(.exe) 빌드
echo ============================================
echo.
call npm run dist
if errorlevel 1 (
  echo.
  echo [실패] 빌드 오류가 발생했습니다. 위 로그를 확인하세요.
) else (
  echo.
  echo [완료] release 폴더의 "SJ INVEST Setup ....exe" 파일을 설치할 PC로 옮기면 됩니다.
  start "" explorer "%cd%\release"
)
echo.
pause
