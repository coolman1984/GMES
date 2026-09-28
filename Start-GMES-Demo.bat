@echo off
rem One click: the DEMONSTRATION plant (invented TV plant, 14 production days) on http://localhost:4701/.
rem Its data lives in data-demo\ and never mixes with the real plant (Start-GMES.bat, data\).
rem The logins are in data-demo\DEMO-LOGINS.txt. Add -Reseed to rebuild the demo up to this minute.
setlocal
cd /d "%~dp0"
set "PSH=powershell"
where pwsh >nul 2>nul && set "PSH=pwsh"
%PSH% -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start.ps1" -Demo %*
if errorlevel 1 (
  echo.
  echo The GMES demo did not start or stopped with an error. The reason is printed above.
  pause
)
endlocal
