@echo off
REM Double-click this file (Windows) to start Chart School, then open
REM http://localhost:8123 in your browser. Close this window to stop.
cd /d "%~dp0"
echo.
echo   Starting Chart School...  (open http://localhost:8123 once it's running)
echo.
node server.js
pause
