const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..", "..");
const sourcePath = path.join(root, "docs", "pywinauto-vm-notepad-demo", "vm-notepad-runner.py");
const deployedPath = path.join(root, "WindowsVm", "shared", "vm-notepad-runner.py");
const installerPath = path.join(root, "WindowsVm", "shared", "install-agent.bat");
const windowsVmRuntimePath = path.join(root, "server", "lib", "windowsVm.js");
const legacySupervisorPath = path.join(root, "WindowsVm", "shared", "DockVisionAgent.ps1");
const legacyNotepadHelperPath = path.join(root, "WindowsVm", "shared", "dockvision_notepad_task.py");

test("VM deployment bundle contains the selected single-file Python agent", () => {
  // the installer copy must stay identical to the selected source of truth
  assert.equal(fs.readFileSync(deployedPath, "utf8"), fs.readFileSync(sourcePath, "utf8"));
});

test("VM deployment bundle excludes retired supervisor and duplicate Notepad runtimes", () => {
  // retired files must not return to the guest bundle after the Python migration
  assert.equal(fs.existsSync(legacySupervisorPath), false);
  assert.equal(fs.existsSync(legacyNotepadHelperPath), false);
});

test("VM installer deploys and schedules only the Python agent", () => {
  // read the batch file as text because this regression test protects its launch contract
  const installer = fs.readFileSync(installerPath, "utf8");

  assert.match(installer, /vm-notepad-runner\.py/);
  assert.match(installer, /-m pip install --disable-pip-version-check pywinauto Pillow/);
  assert.match(installer, /-c "import pywinauto; from PIL import Image"/);
  assert.match(
    installer,
    /if exist "C:\\DockVision\\Python311\\python\.exe"[\s\S]*set "PYTHON_EXE=C:\\DockVision\\Python311\\python\.exe"[\s\S]*if not defined PYTHON_EXE[\s\S]*where python\.exe/,
  );
  assert.match(installer, /New-ScheduledTaskAction -Execute \$env:PYTHON_EXE -Argument \$arguments/);
  assert.match(installer, /New-ScheduledTaskTrigger -AtLogOn/);
  assert.match(installer, /New-ScheduledTaskSettingsSet[\s\S]*-RestartCount 999[\s\S]*-RestartInterval[\s\S]*-ExecutionTimeLimit \(\[TimeSpan\]::Zero\)/);
  assert.match(installer, /Register-ScheduledTask -TaskName 'DockVisionAgent'[\s\S]*-RunLevel Highest -Force/);
  assert.match(installer, /Start-ScheduledTask -TaskName 'DockVisionAgent'/);
  assert.doesNotMatch(installer, /schtasks \/Create/);
  assert.doesNotMatch(installer, /start "" \/B "%PYTHON_EXE%" "%AGENT_PATH%" --agent/);
  assert.doesNotMatch(installer, /DockVisionAgent\.ps1/i);
});

test("VM runtime diagnostics list only the active Python supervisor", () => {
  // runtime diagnostics must list only deployable supervisor files, not inactive prototypes
  const runtimeModule = fs.readFileSync(windowsVmRuntimePath, "utf8");

  assert.match(runtimeModule, /const RUNTIME_FILE_NAMES = \[[\s\S]*"vm-notepad-runner\.py"/);
  assert.doesNotMatch(runtimeModule, /RUNTIME_FILE_NAMES = \[[\s\S]*DockVisionAgent\.ps1/);
  assert.doesNotMatch(runtimeModule, /RUNTIME_FILE_NAMES = \[[\s\S]*agent\.py/);
  assert.doesNotMatch(runtimeModule, /RUNTIME_FILE_NAMES = \[[\s\S]*dockvision_notepad_task\.py/);
});