const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..", "..");
const sourcePath = path.join(root, "docs", "pywinauto-vm-notepad-demo", "vm-notepad-runner.py");
const deployedPath = path.join(root, "WindowsVm", "shared", "vm-notepad-runner.py");
const composePath = path.join(root, "WindowsVm", "docker-compose.yml");
const dockerfilePath = path.join(root, "WindowsVm", "Dockerfile.dockvision");
const publishWorkflowPath = path.join(root, ".github", "workflows", "publish-windows-base.yml");
const oemInstallerPath = path.join(root, "WindowsVm", "shared", "auto-install-agent.bat");
const preparerPath = path.join(root, "WindowsVm", "shared", "prepare-agent.ps1");
const runtimeSetupPath = path.join(root, "WindowsVm", "shared", "ensure-python-runtime.ps1");
const windowsVmRuntimePath = path.join(root, "server", "lib", "windowsVm.js");
const legacySupervisorPath = path.join(root, "WindowsVm", "shared", "DockVisionAgent.ps1");
const legacyNotepadHelperPath = path.join(root, "WindowsVm", "shared", "dockvision_notepad_task.py");
const normalizedText = (file) => fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");

test("VM deployment bundle contains the selected single-file Python agent", () => {
  // Windows deployment may use CRLF, but its executable content must match the source of truth.
  assert.equal(normalizedText(deployedPath), normalizedText(sourcePath));
});

test("VM deployment bundle excludes retired supervisor and duplicate Notepad runtimes", () => {
  // retired files must not return to the guest bundle after the Python migration
  assert.equal(fs.existsSync(legacySupervisorPath), false);
  assert.equal(fs.existsSync(legacyNotepadHelperPath), false);
});

test("Compose pulls the published DockVision image without changing persistent mounts", () => {
  const compose = fs.readFileSync(composePath, "utf8");
  assert.doesNotMatch(compose, /^\s*build:/m);
  assert.match(compose, /image: ghcr\.io\/alyaver\/dockvision-windows-base:0\.1\.0/);
  assert.match(compose, /pull_policy: always/);
  assert.match(compose, /- \.\/OS:\/storage/);
  assert.match(compose, /- \.\/shared:\/shared/);
});

test("custom image installs the automatic guest preparation bundle through OEM", () => {
  const dockerfile = fs.readFileSync(dockerfilePath, "utf8");
  assert.match(dockerfile, /^FROM dockurr\/windows/m);
  assert.match(dockerfile, /org\.opencontainers\.image\.source="https:\/\/github\.com\/alyaver\/DockVision"/);
  assert.match(dockerfile, /COPY shared\/auto-install-agent\.bat \/oem\/install\.bat/);
  assert.match(dockerfile, /COPY shared\/prepare-agent\.ps1 \/oem\/prepare-agent\.ps1/);
  assert.match(dockerfile, /COPY shared\/ensure-python-runtime\.ps1 \/oem\/ensure-python-runtime\.ps1/);
  assert.match(dockerfile, /COPY shared\/vm-notepad-runner\.py \/oem\/vm-notepad-runner\.py/);
  assert.match(fs.readFileSync(oemInstallerPath, "utf8"), /prepare-agent\.ps1/);
});

test("maintainer workflow publishes the versioned Windows base image to GHCR", () => {
  const workflow = fs.readFileSync(publishWorkflowPath, "utf8");
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /packages: write/);
  assert.match(workflow, /IMAGE_NAME: alyaver\/dockvision-windows-base/);
  assert.match(workflow, /context: WindowsVm/);
  assert.match(workflow, /file: WindowsVm\/Dockerfile\.dockvision/);
  assert.match(workflow, /push: true/);
  assert.match(workflow, /tags: \$\{\{ env\.REGISTRY \}\}\/\$\{\{ env\.IMAGE_NAME \}\}:\$\{\{ inputs\.version \}\}/);
});

test("guest preparation replaces one startup registration and publishes structured status", () => {
  const preparer = fs.readFileSync(preparerPath, "utf8");
  assert.match(preparer, /\$TaskName = "DockVisionAgent"/);
  assert.match(preparer, /Register-ScheduledTask[\s\S]*-TaskName \$TaskName[\s\S]*-Force/);
  assert.match(preparer, /-MultipleInstances IgnoreNew/);
  assert.match(preparer, /Start-ScheduledTask -TaskName \$TaskName/);
  assert.match(preparer, /guest-preparation\.json/);
  assert.match(preparer, /ValidateSet\("preparing", "ready", "failed"\)/);
  assert.doesNotMatch(preparer, /Unregister-ScheduledTask|schtasks \/Create/);
});

test("guest runtime installs every dependency required by the agent preparer", () => {
  const runtimeSetup = fs.readFileSync(runtimeSetupPath, "utf8");
  const preparer = fs.readFileSync(preparerPath, "utf8");

  assert.match(runtimeSetup, /Ensure-PythonPackage -PythonPath \$PythonPath -PackageName "pywinauto"/);
  assert.match(runtimeSetup, /Ensure-PythonPackage -PythonPath \$PythonPath -PackageName "Pillow"/);
  assert.match(runtimeSetup, /from PIL import Image/);
  assert.match(preparer, /from PIL import Image/);
});

test("VM runtime diagnostics list automatic preparation assets", () => {
  const runtimeModule = fs.readFileSync(windowsVmRuntimePath, "utf8");

  assert.match(runtimeModule, /const RUNTIME_FILE_NAMES = \[[\s\S]*"vm-notepad-runner\.py"/);
  assert.match(runtimeModule, /const RUNTIME_FILE_NAMES = \[[\s\S]*"prepare-agent\.ps1"/);
  assert.match(runtimeModule, /const RUNTIME_FILE_NAMES = \[[\s\S]*"auto-install-agent\.bat"/);
  assert.doesNotMatch(runtimeModule, /RUNTIME_FILE_NAMES = \[[\s\S]*"install-agent\.bat"/);
  assert.doesNotMatch(runtimeModule, /RUNTIME_FILE_NAMES = \[[\s\S]*DockVisionAgent\.ps1/);
  assert.doesNotMatch(runtimeModule, /RUNTIME_FILE_NAMES = \[[\s\S]*agent\.py/);
  assert.doesNotMatch(runtimeModule, /RUNTIME_FILE_NAMES = \[[\s\S]*dockvision_notepad_task\.py/);
});