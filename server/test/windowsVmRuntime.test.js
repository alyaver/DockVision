const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..", "..");
const sourcePath = path.join(root, "docs", "pywinauto-vm-notepad-demo", "vm-notepad-runner.py");
const deployedPath = path.join(root, "WindowsVm", "shared", "vm-notepad-runner.py");
const installerPath = path.join(root, "WindowsVm", "shared", "install-agent.bat");
const windowsVmRuntimePath = path.join(root, "server", "lib", "windowsVm.js");

test("VM deployment bundle contains the selected single-file Python agent", () => {
  assert.equal(fs.readFileSync(deployedPath, "utf8"), fs.readFileSync(sourcePath, "utf8"));
});

test("VM installer deploys and schedules the Python agent while only cleaning up a legacy supervisor", () => {
  const installer = fs.readFileSync(installerPath, "utf8");

  assert.match(installer, /vm-notepad-runner\.py/);
  assert.match(installer, /-m pip install --disable-pip-version-check pywinauto Pillow/);
  assert.match(installer, /-c "import pywinauto; from PIL import Image"/);
  assert.match(installer, /start "" \/B "%PYTHON_EXE%" "%AGENT_PATH%" --agent/);
  assert.match(installer, /schtasks \/Create[\s\S]*%PYTHON_EXE%[\s\S]*%AGENT_PATH%[\s\S]*--agent/);
  assert.match(installer, /\*DockVisionAgent\.ps1\*/);
  assert.match(installer, /migration cleanup matcher only/);
  assert.doesNotMatch(installer, /copy[^\r\n]*DockVisionAgent\.ps1/i);
  assert.doesNotMatch(installer, /set "AGENT_SOURCE=[^\r\n]*DockVisionAgent\.ps1/i);
  assert.doesNotMatch(installer, /-File "C:\\DockVision\\agent\\DockVisionAgent\.ps1"/);
});

test("VM runtime diagnostics list only the active Python supervisor", () => {
  const runtimeModule = fs.readFileSync(windowsVmRuntimePath, "utf8");

  assert.match(runtimeModule, /const RUNTIME_FILE_NAMES = \[[\s\S]*"vm-notepad-runner\.py"/);
  assert.doesNotMatch(runtimeModule, /RUNTIME_FILE_NAMES = \[[\s\S]*DockVisionAgent\.ps1/);
  assert.doesNotMatch(runtimeModule, /RUNTIME_FILE_NAMES = \[[\s\S]*agent\.py/);
  assert.doesNotMatch(runtimeModule, /RUNTIME_FILE_NAMES = \[[\s\S]*dockvision_notepad_task\.py/);
});