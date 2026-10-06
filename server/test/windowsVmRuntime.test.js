const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..", "..");
const sourcePath = path.join(root, "docs", "pywinauto-vm-notepad-demo", "vm-notepad-runner.py");
const deployedPath = path.join(root, "WindowsVm", "shared", "vm-notepad-runner.py");
const installerPath = path.join(root, "WindowsVm", "shared", "install-agent.bat");

test("VM deployment bundle contains the selected single-file Python agent", () => {
  assert.equal(fs.readFileSync(deployedPath, "utf8"), fs.readFileSync(sourcePath, "utf8"));
});

test("VM installer deploys and schedules the Python agent without launching PowerShell", () => {
  const installer = fs.readFileSync(installerPath, "utf8");

  assert.match(installer, /vm-notepad-runner\.py/);
  assert.match(installer, /-m pip install --disable-pip-version-check pywinauto Pillow/);
  assert.match(installer, /-c "import pywinauto; from PIL import Image"/);
  assert.match(installer, /start "" \/B "%PYTHON_EXE%" "%AGENT_PATH%" --agent/);
  assert.match(installer, /schtasks \/Create[\s\S]*%PYTHON_EXE%[\s\S]*%AGENT_PATH%[\s\S]*--agent/);
  assert.match(installer, /\*DockVisionAgent\.ps1\*/);
  assert.doesNotMatch(installer, /-File "C:\\DockVision\\agent\\DockVisionAgent\.ps1"/);
});