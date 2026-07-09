@echo off
chcp 65001 >nul
rem SJ OS — PC 데스크톱 설치본(.exe) 빌드. 바탕화면의 "SJ OS 앱 배포" 런처가 호출한다.
cd /d "%~dp0.."
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
