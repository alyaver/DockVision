@echo off
setlocal

rem Bootstrap or refresh the single-file Python DockVision guest agent from the
rem mounted shared folder or OEM image, then start it now and at future logons.

mkdir C:\DockVision 2>nul
mkdir C:\DockVision\agent 2>nul

set "AGENT_SOURCE="
set "PYTHON_RUNTIME_SOURCE="
set "AGENT_PATH=C:\DockVision\agent\vm-notepad-runner.py"
set "INSTALL_LOG=%~dp0agent-install-log.txt"
set "AGENT_LOG=C:\DockVision\agent\agent-startup.log"
set "PYTHON_EXE="

call :log "Python agent installation started."

rem Prefer the live shared folder, then fall back to guest-local shared paths
rem or the OEM image if the host share is not currently available.
if exist "\\host.lan\Data\vm-notepad-runner.py" (
  set "AGENT_SOURCE=\\host.lan\Data\vm-notepad-runner.py"
) else if exist "C:\Users\Docker\Desktop\Shared\vm-notepad-runner.py" (
  set "AGENT_SOURCE=C:\Users\Docker\Desktop\Shared\vm-notepad-runner.py"
) else if exist "%~dp0vm-notepad-runner.py" (
  set "AGENT_SOURCE=%~dp0vm-notepad-runner.py"
) else if exist "C:\OEM\vm-notepad-runner.py" (
  set "AGENT_SOURCE=C:\OEM\vm-notepad-runner.py"
) else (
  call :log "ERROR: vm-notepad-runner.py was not found in a supported deployment location."
  exit /b 1
)

copy /Y "%AGENT_SOURCE%" "%AGENT_PATH%" >nul
if errorlevel 1 (
  call :log "ERROR: Failed to copy %AGENT_SOURCE% to %AGENT_PATH%."
  exit /b 1
)
call :log "Deployed Python agent from %AGENT_SOURCE%."

if exist "\\host.lan\Data\ensure-python-runtime.ps1" (
  set "PYTHON_RUNTIME_SOURCE=\\host.lan\Data\ensure-python-runtime.ps1"
) else if exist "C:\Users\Docker\Desktop\Shared\ensure-python-runtime.ps1" (
  set "PYTHON_RUNTIME_SOURCE=C:\Users\Docker\Desktop\Shared\ensure-python-runtime.ps1"
) else if exist "C:\OEM\ensure-python-runtime.ps1" (
  set "PYTHON_RUNTIME_SOURCE=C:\OEM\ensure-python-runtime.ps1"
)

if defined PYTHON_RUNTIME_SOURCE (
  copy /Y "%PYTHON_RUNTIME_SOURCE%" "C:\DockVision\agent\ensure-python-runtime.ps1" >nul
  powershell -NoProfile -ExecutionPolicy Bypass -File "C:\DockVision\agent\ensure-python-runtime.ps1" -SharedRoot "%~dp0."
  if errorlevel 1 (
    call :log "ERROR: DockVision Python runtime setup failed."
    exit /b 1
  )
)

for /f "delims=" %%P in ('where python.exe 2^>nul') do (
  if not defined PYTHON_EXE set "PYTHON_EXE=%%P"
)

if not defined PYTHON_EXE (
  call :log "ERROR: python.exe is not available after runtime setup; the Python agent was not started."
  exit /b 1
)

"%PYTHON_EXE%" --version >> "%AGENT_LOG%" 2>&1
if errorlevel 1 (
  call :log "ERROR: Configured Python runtime failed its version check: %PYTHON_EXE%."
  exit /b 1
)

"%PYTHON_EXE%" -m pip install --disable-pip-version-check pywinauto Pillow >> "%AGENT_LOG%" 2>&1
if errorlevel 1 (
  call :log "ERROR: Required Python dependencies could not be installed. See %AGENT_LOG%."
  exit /b 1
)

"%PYTHON_EXE%" -c "import pywinauto; from PIL import Image" >> "%AGENT_LOG%" 2>&1
if errorlevel 1 (
  call :log "ERROR: pywinauto or Pillow is unavailable after installation. See %AGENT_LOG%."
  exit /b 1
)
call :log "Verified Python runtime and required pywinauto dependencies."

rem Stop the existing scheduled task and any earlier agent process. The legacy
rem PowerShell filename below is a migration cleanup matcher only; it is never
rem copied, launched, or scheduled by this installer.
schtasks /End /TN "DockVisionAgent" >nul 2>nul
schtasks /Delete /TN "DockVisionAgent" /F >nul 2>nul

for /f %%P in ('powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-CimInstance Win32_Process ^| Where-Object { $_.CommandLine -like '*DockVisionAgent.ps1*' -or $_.CommandLine -like '*vm-notepad-runner.py*' } ^| Select-Object -ExpandProperty ProcessId"') do (
  taskkill /F /PID %%P >nul 2>nul
)

timeout /t 1 /nobreak >nul

start "" /B "%PYTHON_EXE%" "%AGENT_PATH%" --agent >> "%AGENT_LOG%" 2>&1
if errorlevel 1 (
  call :log "ERROR: Python agent launch command failed. See %AGENT_LOG%."
  exit /b 1
)

rem Re-register the task on every install so the startup command stays aligned
rem with the latest deployed agent path and flags.
schtasks /Create /TN "DockVisionAgent" /SC ONLOGON /RL HIGHEST /TR """%PYTHON_EXE%"" ""%AGENT_PATH%"" --agent" /F
if errorlevel 1 (
  call :log "ERROR: Failed to register the Python agent scheduled task."
  exit /b 1
)

call :log "Python agent started and scheduled for logon with %PYTHON_EXE%."

exit /b 0

:log
>> "%INSTALL_LOG%" echo [%date% %time%] %~1
exit /b 0
