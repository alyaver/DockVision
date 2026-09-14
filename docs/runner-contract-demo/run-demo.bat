@echo off
setlocal

rem Double-click this file to run the DockVision runner contract demo.
rem Directly double-clicking runner.ps1 may open the script in Notepad instead
rem of executing it, depending on local Windows file association settings.

set "SCRIPT_DIR=%~dp0"

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%runner.ps1" -ConfigPath "%SCRIPT_DIR%task-plan.json"
set "EXIT_CODE=%ERRORLEVEL%"

echo.
echo DockVision runner exited with code %EXIT_CODE%.
pause

exit /b %EXIT_CODE%
