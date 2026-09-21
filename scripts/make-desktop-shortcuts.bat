@echo off
chcp 65001 >nul
rem SJ INVEST — 바탕화면에 배포 런처(바로가기)를 만든다.
rem 한글이 깨지지 않도록 실제 작업은 같은 폴더의 .ps1 이 한다.
title SJ OS 바탕화면 런처 만들기
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0make-desktop-shortcuts.ps1"
if errorlevel 1 (
  echo.
  echo [실패] 런처를 만들지 못했습니다. 위 메시지를 확인하세요.
  pause
)
