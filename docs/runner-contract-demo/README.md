# DockVision Runner Contract Demo

This folder demonstrates the first runner contract prototype:

```text
task-plan.json = ordered task list
runner.ps1 = interpreter for that task list
run-demo.bat = double-clickable launcher for Windows
```

Use `run-demo.bat` if you want to launch the demo from File Explorer.

If you run it from PowerShell, use:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\runner.ps1 -ConfigPath .\task-plan.json
```

Do not double-click `runner.ps1` directly. Windows may open `.ps1` files in
Notepad or another editor instead of executing them.
