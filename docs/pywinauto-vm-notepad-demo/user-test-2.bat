@echo off
setlocal

rem Runs DockVision pywinauto User Test 2.
rem This schedule clicks File, Edit, Format, View, and Help in order for three cycles.

set "SCRIPT_DIR=%~dp0"

python "%SCRIPT_DIR%runner.py" --plan "%SCRIPT_DIR%user-test-2.json"
set "EXIT_CODE=%ERRORLEVEL%"

echo.
echo DockVision user test 2 exited with code %EXIT_CODE%.
pause

exit /b %EXIT_CODE%
