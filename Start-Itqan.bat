@echo off
rem One click: installs what is missing, starts Itqan and opens it in the browser.
rem Close this window (or press Ctrl+C) to stop the server. Everything runs through PowerShell.
setlocal
cd /d "%~dp0"
set "PSH=powershell"
where pwsh >nul 2>nul && set "PSH=pwsh"
%PSH% -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start.ps1" %*
if errorlevel 1 (
  echo.
  echo Itqan did not start or stopped with an error. The reason is printed above.
  pause
)
endlocal
