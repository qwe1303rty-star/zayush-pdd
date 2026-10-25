@echo off
echo ========================================
echo  Zayush PDD - Auto Deploy on VPS
echo ========================================
echo.
echo This will install Node.js, PostgreSQL, build and run the project.
echo Run as Administrator.
echo.
pause
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy-vps.ps1"
echo.
echo Done. Check logs in %~dp0logs
pause