@echo off
setlocal

rem Runs DockVision pywinauto User Test 3.
rem This VM-safe schedule mixes classic Notepad menus, typing, and right-click.

set "SCRIPT_DIR=%~dp0"

python "%SCRIPT_DIR%runner.py" --plan "%SCRIPT_DIR%user-test-3.json"
set "EXIT_CODE=%ERRORLEVEL%"

echo.
echo DockVision user test 3 exited with code %EXIT_CODE%.
pause

exit /b %EXIT_CODE%
