@echo off
setlocal

mkdir C:\DockVision 2>nul
mkdir C:\DockVision\agent 2>nul

set "AGENT_SOURCE="
set "PYTHON_SOURCE="

if exist "\\host.lan\Data\DockVisionAgent.ps1" (
  set "AGENT_SOURCE=\\host.lan\Data\DockVisionAgent.ps1"
) else if exist "C:\Users\Docker\Desktop\Shared\DockVisionAgent.ps1" (
  set "AGENT_SOURCE=C:\Users\Docker\Desktop\Shared\DockVisionAgent.ps1"
) else if exist "C:\OEM\DockVisionAgent.ps1" (
  set "AGENT_SOURCE=C:\OEM\DockVisionAgent.ps1"
) else (
  exit /b 1
)

copy /Y "%AGENT_SOURCE%" "C:\DockVision\agent\DockVisionAgent.ps1" >nul

if exist "\\host.lan\Data\dockvision_notepad_task.py" (
  set "PYTHON_SOURCE=\\host.lan\Data\dockvision_notepad_task.py"
) else if exist "C:\Users\Docker\Desktop\Shared\dockvision_notepad_task.py" (
  set "PYTHON_SOURCE=C:\Users\Docker\Desktop\Shared\dockvision_notepad_task.py"
) else if exist "C:\OEM\dockvision_notepad_task.py" (
  set "PYTHON_SOURCE=C:\OEM\dockvision_notepad_task.py"
)

if defined PYTHON_SOURCE (
  copy /Y "%PYTHON_SOURCE%" "C:\DockVision\agent\dockvision_notepad_task.py" >nul
)

schtasks /End /TN "DockVisionAgent" >nul 2>nul

for /f %%P in ('powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-CimInstance Win32_Process ^| Where-Object { $_.CommandLine -like '*DockVisionAgent.ps1*' } ^| Select-Object -ExpandProperty ProcessId"') do (
  taskkill /F /PID %%P >nul 2>nul
)

timeout /t 1 /nobreak >nul

start "" powershell -WindowStyle Hidden -ExecutionPolicy Bypass -File "C:\DockVision\agent\DockVisionAgent.ps1"

schtasks /Create /TN "DockVisionAgent" /SC ONLOGON /RL HIGHEST /TR "powershell -WindowStyle Hidden -ExecutionPolicy Bypass -File C:\DockVision\agent\DockVisionAgent.ps1" /F

exit /b 0
