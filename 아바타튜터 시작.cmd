@echo off
chcp 65001 >nul
title 아바타튜터 개발 서버
cd /d "%~dp0"
echo.
echo  ================================================
echo   아바타튜터 서버를 시작합니다...
echo   이 창을 닫으면 서버도 함께 꺼집니다.
echo   잠시 후 브라우저가 자동으로 열립니다.
echo  ================================================
echo.
start "" cmd /c "timeout /t 6 >nul & start http://localhost:3000"
npm run dev
pause
