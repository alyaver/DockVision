const fs = require("fs/promises");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);

// Centralize Docker Compose access for the Windows guest so the rest of the
// backend can reason in terms of "status" and "ensure running" instead of
// shell command details.
const WINDOWS_VM_ROOT = path.resolve(__dirname, "..", "..", "WindowsVm");
const WINDOWS_VM_COMPOSE_PATH = path.join(WINDOWS_VM_ROOT, "docker-compose.yml");
const WINDOWS_VM_OS_ROOT = path.join(WINDOWS_VM_ROOT, "OS");
const WINDOWS_VM_SHARED_ROOT = path.join(WINDOWS_VM_ROOT, "shared");
const WINDOWS_VM_RUNTIME_PATH = path.join(
  WINDOWS_VM_SHARED_ROOT,
  "dockvision-runtime.json"
);
const WINDOWS_VM_SERVICE_NAME = "windows";
const WINDOWS_VM_CONTAINER_NAME = "windows";
const WINDOWS_VM_HOST_PORTS = {
  webConsole: 8006,
  rdpTcp: 3389,
  rdpUdp: 3389,
};
const RUNTIME_FILE_NAMES = [
  "DockVisionAgent.ps1",
  "agent.py",
  "dockvision_notepad_task.py",
  "install-agent.bat",
];

function nowIso() {
  return new Date().toISOString();
}

function normalizeDockerError(error, fallbackMessage) {
  const stderr = String(error?.stderr || "").trim();
  const stdout = String(error?.stdout || "").trim();
  const message = String(error?.message || "").trim();

  return stderr || stdout || message || fallbackMessage;
}

async function runDockerCommand(args) {
  try {
    return await execFileAsync("docker", args, {
      cwd: WINDOWS_VM_ROOT,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    });
  } catch (error) {
    const nextError = new Error(
      normalizeDockerError(error, "Docker command failed for the Windows VM launcher.")
    );
    nextError.cause = error;
    throw nextError;
  }
}

async function ensureWindowsVmLayout() {
  await Promise.all([
    fs.mkdir(WINDOWS_VM_ROOT, { recursive: true }),
    fs.mkdir(WINDOWS_VM_OS_ROOT, { recursive: true }),
    fs.mkdir(WINDOWS_VM_SHARED_ROOT, { recursive: true }),
  ]);
}

async function syncWindowsVmRuntimeManifest() {
  // Keep a lightweight host-side manifest for diagnostics and UI status views.
  // This is not the VM's source of truth; it simply records what runtime files
  // are present before we ask Docker Compose to start the guest.
  await ensureWindowsVmLayout();

  const files = [];
  for (const fileName of RUNTIME_FILE_NAMES) {
    try {
      await fs.access(path.join(WINDOWS_VM_SHARED_ROOT, fileName));
      files.push(fileName);
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
    }
  }

  const manifest = {
    syncedUtc: nowIso(),
    composeFile: WINDOWS_VM_COMPOSE_PATH,
    sharedRoot: WINDOWS_VM_SHARED_ROOT,
    serviceName: WINDOWS_VM_SERVICE_NAME,
    containerName: WINDOWS_VM_CONTAINER_NAME,
    files,
  };

  await fs.writeFile(
    WINDOWS_VM_RUNTIME_PATH,
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8"
  );

  return manifest;
}

async function getWindowsVmContainerId() {
  const { stdout } = await runDockerCommand([
    "compose",
    "-f",
    WINDOWS_VM_COMPOSE_PATH,
    "ps",
    "-q",
    WINDOWS_VM_SERVICE_NAME,
  ]);

  return stdout.trim() || null;
}

async function inspectWindowsVmContainer(containerReference) {
  if (!containerReference) {
    return null;
  }

  const { stdout } = await runDockerCommand([
    "inspect",
    containerReference,
    "--format",
    "{{json .State}}",
  ]);

  const normalizedValue = stdout.trim();
  return normalizedValue ? JSON.parse(normalizedValue) : null;
}

async function getWindowsVmStatus() {
  // Status calls should stay informative even when Docker itself is the problem,
  // so readiness polling receives a structured "docker-error" state instead of
  // a generic 500 whenever we can classify the failure locally.
  const runtime = await syncWindowsVmRuntimeManifest();

  let containerId = null;
  try {
    containerId = await getWindowsVmContainerId();
  } catch (error) {
    return {
      available: false,
      running: false,
      status: "docker-error",
      containerId: null,
      containerName: WINDOWS_VM_CONTAINER_NAME,
      serviceName: WINDOWS_VM_SERVICE_NAME,
      composeFile: WINDOWS_VM_COMPOSE_PATH,
      sharedRoot: WINDOWS_VM_SHARED_ROOT,
      hostPorts: WINDOWS_VM_HOST_PORTS,
      runtime,
      message: error.message,
    };
  }

  if (!containerId) {
    return {
      available: true,
      running: false,
      status: "not-created",
      containerId: null,
      containerName: WINDOWS_VM_CONTAINER_NAME,
      serviceName: WINDOWS_VM_SERVICE_NAME,
      composeFile: WINDOWS_VM_COMPOSE_PATH,
      sharedRoot: WINDOWS_VM_SHARED_ROOT,
      hostPorts: WINDOWS_VM_HOST_PORTS,
      runtime,
      message: "Windows VM service has not been created yet.",
    };
  }

  const state = await inspectWindowsVmContainer(containerId);
  const status = String(state?.Status || "unknown").toLowerCase();

  return {
    available: true,
    running: Boolean(state?.Running),
    status,
    containerId,
    containerName: WINDOWS_VM_CONTAINER_NAME,
    serviceName: WINDOWS_VM_SERVICE_NAME,
    composeFile: WINDOWS_VM_COMPOSE_PATH,
    sharedRoot: WINDOWS_VM_SHARED_ROOT,
    hostPorts: WINDOWS_VM_HOST_PORTS,
    runtime,
    startedAt: state?.StartedAt || null,
    finishedAt: state?.FinishedAt || null,
    exitCode: Number.isFinite(state?.ExitCode) ? state.ExitCode : null,
    message: state?.Running
      ? "Windows VM service is running."
      : `Windows VM service is ${status}.`,
  };
}

async function ensureWindowsVmRunning() {
  // `docker compose up -d` is intentionally idempotent here. We call it from
  // both "start run" and the standalone VM start route, and in both cases the
  // correct behavior is "create it if missing, otherwise reuse the running VM."
  await syncWindowsVmRuntimeManifest();

  await runDockerCommand([
    "compose",
    "-f",
    WINDOWS_VM_COMPOSE_PATH,
    "up",
    "-d",
    WINDOWS_VM_SERVICE_NAME,
  ]);

  const status = await getWindowsVmStatus();
  if (!status.containerId) {
    throw new Error("Docker Compose reported success, but the Windows VM container was not created.");
  }

  return status;
}

module.exports = {
  WINDOWS_VM_COMPOSE_PATH,
  WINDOWS_VM_CONTAINER_NAME,
  WINDOWS_VM_HOST_PORTS,
  WINDOWS_VM_SERVICE_NAME,
  ensureWindowsVmRunning,
  getWindowsVmStatus,
  syncWindowsVmRuntimeManifest,
};
