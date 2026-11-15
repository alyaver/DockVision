@echo off
setlocal

rem dockurr/windows runs this file from C:\OEM during the final step of a new
rem Windows installation. Keep the work in PowerShell so status and scheduler
rem updates are atomic and repeatable.

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0prepare-agent.ps1"
exit /b %ERRORLEVEL%