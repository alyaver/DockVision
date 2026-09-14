@echo off
setlocal

rem Runs DockVision pywinauto User Test 1.
rem This VM-safe schedule types 25 names and alternates Format -> Font styles.

set "SCRIPT_DIR=%~dp0"

python "%SCRIPT_DIR%runner.py" --plan "%SCRIPT_DIR%user-test-1.json"
set "EXIT_CODE=%ERRORLEVEL%"

echo.
echo DockVision user test 1 exited with code %EXIT_CODE%.
pause

exit /b %EXIT_CODE%
