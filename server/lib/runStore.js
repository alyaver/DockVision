const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const { readTestScript } = require("./test-script/readTestScript");

const CLEANUP_POLICY = {
  maxCompletedRuns: 20,
  maxAgeDays: 7,
};


const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled"]);

const SHARED_ROOT = path.resolve(
  __dirname,
  "..",
  "..",
  "WindowsVm",
  "shared"
);
const ACTIVE_ROOT = path.join(SHARED_ROOT, "active");
const RUNS_ROOT = path.join(SHARED_ROOT, "runs");
const CURRENT_RUN_POINTER_PATH = path.join(ACTIVE_ROOT, "current-run.json");
const HEARTBEAT_PATH = path.join(SHARED_ROOT, "agent-heartbeat.json");

function nowIso() {
  return new Date().toISOString();
}

function isTerminalStatus(status) {
  return TERMINAL_STATUSES.has(String(status || "").toLowerCase());
}

function buildContainerName(runId) {
  return `atlas-smoke-${String(runId)
    .toLowerCase()
    .replace(/[^a-z0-9_.-]/g, "-")
    .slice(0, 50)}`;
}

function getRunPaths(runId) {
  const runRoot = path.join(RUNS_ROOT, runId);
  const logsRoot = path.join(runRoot, "logs");
  const screenshotsRoot = path.join(runRoot, "screenshots");
  const artifactsRoot = path.join(runRoot, "artifacts");
  const scriptsRoot = path.join(runRoot, "scripts");

  return {
    runRoot,
    logsRoot,
    screenshotsRoot,
    artifactsRoot,
    uploadedRunnerPath: path.join(runRoot, "uploaded-runner.py"),
    uploadedPowerShellRunnerPath: path.join(runRoot, "uploaded-runner.ps1"),
    uploadedPlanPath: path.join(runRoot, "uploaded-task-plan.json"),
    scriptsRoot,
    metaPath: path.join(runRoot, "meta.json"),
    taskPath: path.join(runRoot, "task.json"),
    taskPlanPath: path.join(runRoot, "task-plan.json"),
    resultPath: path.join(runRoot, "result.json"),
    taskLogPath: path.join(logsRoot, "task.log"),
  };
}

async function ensureBaseLayout() {
  await Promise.all([
    fs.mkdir(SHARED_ROOT, { recursive: true }),
    fs.mkdir(ACTIVE_ROOT, { recursive: true }),
    fs.mkdir(RUNS_ROOT, { recursive: true }),
  ]);
}

async function ensureRunLayout(runId) {
  const runPaths = getRunPaths(runId);

  await Promise.all([
    fs.mkdir(runPaths.runRoot, { recursive: true }),
    fs.mkdir(runPaths.logsRoot, { recursive: true }),
    fs.mkdir(runPaths.screenshotsRoot, { recursive: true }),
    fs.mkdir(runPaths.artifactsRoot, { recursive: true }),
    fs.mkdir(runPaths.scriptsRoot, { recursive: true }),
  ]);

  return runPaths;
}

async function readJsonIfExists(filePath) {
  try {
    const rawValue = await fs.readFile(filePath, "utf8");
    const normalizedValue = rawValue.replace(/^\uFEFF/, "");
    return normalizedValue.trim() ? JSON.parse(normalizedValue) : null;
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

async function writeJson(filePath, data) {
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

async function appendRunLog(runId, message) {
  const runPaths = await ensureRunLayout(runId);
  await fs.appendFile(
    runPaths.taskLogPath,
    `[${nowIso()}] ${message}\n`,
    "utf8"
  );
}

async function readLogLines(filePath, limit = 200) {
  try {
    const rawValue = await fs.readFile(filePath, "utf8");
    return rawValue
      .split(/\r?\n/)
      .map((line) => line.trimEnd())
      .filter(Boolean)
      .slice(-limit);
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

function describeCleanupPolicy() {
  return `Retain the latest ${CLEANUP_POLICY.maxCompletedRuns} completed or failed runs for up to ${CLEANUP_POLICY.maxAgeDays} days. Delete anything older or beyond that cap when a new run starts.`;
}

async function readCurrentRunPointer() {
  await ensureBaseLayout();
  return readJsonIfExists(CURRENT_RUN_POINTER_PATH);
}

function deriveRunStatus(meta, task, result, heartbeat, isActiveRun) {
  if (result?.status) {
    return result.status;
  }

  if (task?.status) {
    return task.status;
  }

  if (isActiveRun && heartbeat?.agent?.status === "running") {
    return "running";
  }

  return meta?.status || "queued";
}

async function updateMetaFile(runId, patch) {
  const runPaths = await ensureRunLayout(runId);
  const currentMeta = (await readJsonIfExists(runPaths.metaPath)) || { runId };
  const nextMeta = {
    ...currentMeta,
    ...patch,
    updatedUtc: patch.updatedUtc || nowIso(),
  };

  await writeJson(runPaths.metaPath, nextMeta);
  return nextMeta;
}

function normalizeArtifactRelativePath(runId, rawPath) {
  if (typeof rawPath !== "string" || !rawPath.trim()) {
    return null;
  }

  const normalized = rawPath.replace(/\\/g, "/").trim();
  const runMarker = `runs/${runId}/`;
  const markerIndex = normalized.toLowerCase().lastIndexOf(runMarker.toLowerCase());

  if (markerIndex >= 0) {
    return path.posix.normalize(normalized.slice(markerIndex + runMarker.length));
  }

  if (/^[a-zA-Z]:\//.test(normalized) || normalized.startsWith("//")) {
    return null;
  }

  const relativePath = path.posix.normalize(normalized).replace(/^\/+/, "");
  if (!relativePath || relativePath.startsWith("../") || relativePath === "..") {
    return null;
  }

  return relativePath;
}

function buildRunFileUrl(runId, relativePath) {
  const encodedPath = relativePath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");

  return `/api/runs/${encodeURIComponent(runId)}/files/${encodedPath}`;
}

function buildArtifactMap(runId, artifacts = {}) {
  const mappedArtifacts = {};

  for (const [name, rawPath] of Object.entries(artifacts)) {
    const relativePath = normalizeArtifactRelativePath(runId, rawPath);

    mappedArtifacts[name] = {
      rawPath,
      relativePath,
      url: relativePath ? buildRunFileUrl(runId, relativePath) : null,
      fileName: relativePath ? path.posix.basename(relativePath) : null,
    };
  }

  return mappedArtifacts;
}

async function syncMetaFromRunState(runId, snapshot) {
  if (!snapshot.meta) {
    return snapshot;
  }

  const nextStatus = snapshot.status;
  const nextFinishedUtc = snapshot.result?.finishedUtc || snapshot.meta.finishedUtc || null;
  const nextStartedUtc =
    snapshot.task?.startedUtc || snapshot.meta.startedUtc || snapshot.result?.startedUtc || null;

  if (
    snapshot.meta.status === nextStatus &&
    snapshot.meta.finishedUtc === nextFinishedUtc &&
    snapshot.meta.startedUtc === nextStartedUtc
  ) {
    return snapshot;
  }

  const nextMeta = await updateMetaFile(runId, {
    status: nextStatus,
    startedUtc: nextStartedUtc,
    finishedUtc: nextFinishedUtc,
  });

  return {
    ...snapshot,
    meta: nextMeta,
  };
}

async function readRun(runId) {
  await ensureBaseLayout();

  const runPaths = getRunPaths(runId);
  const [meta, task, result, heartbeat, currentRunPointer, taskLogLines] =
    await Promise.all([
      readJsonIfExists(runPaths.metaPath),
      readJsonIfExists(runPaths.taskPath),
      readJsonIfExists(runPaths.resultPath),
      readJsonIfExists(HEARTBEAT_PATH),
      readCurrentRunPointer(),
      readLogLines(runPaths.taskLogPath),
    ]);

  if (!meta && !task && !result) {
    return null;
  }

  const activeRunId = currentRunPointer?.runId || null;
  const isActiveRun = activeRunId === runId;
  const status = deriveRunStatus(meta, task, result, heartbeat, isActiveRun);

  const snapshot = await syncMetaFromRunState(runId, {
    meta,
    task,
    result,
    status,
  });

  const baseMeta = snapshot.meta || meta || {};

  return {
    runId,
    taskId: snapshot.task?.taskId || baseMeta.taskId || null,
    testName: baseMeta.testName || "Untitled Test Run",
    runnerScriptName: baseMeta.runnerScriptName || null,
    runnerScriptPath: baseMeta.runnerScriptPath || null,
    taskPlanPath: baseMeta.taskPlanPath || null,
    taskType: baseMeta.taskType || snapshot.task?.taskType || "unknown",
    status: snapshot.status,
    active: isActiveRun,
    cleanupPolicy: baseMeta.cleanupPolicy || describeCleanupPolicy(),
    containerId: baseMeta.containerId || null,
    createdUtc: baseMeta.createdUtc || snapshot.task?.createdUtc || null,
    startedUtc: baseMeta.startedUtc || snapshot.task?.startedUtc || null,
    finishedUtc: baseMeta.finishedUtc || snapshot.result?.finishedUtc || null,
    updatedUtc: baseMeta.updatedUtc || null,
    task: snapshot.task || null,
    result: snapshot.result
      ? {
          ...snapshot.result,
          artifacts: buildArtifactMap(runId, snapshot.result.artifacts),
        }
      : null,
    artifacts: buildArtifactMap(runId, snapshot.result?.artifacts),
    heartbeat: isActiveRun ? heartbeat : null,
    logs: {
      task: taskLogLines,
    },
    paths: {
      sharedRoot: SHARED_ROOT,
      runRoot: runPaths.runRoot,
      taskPath: runPaths.taskPath,
      taskPlanPath: runPaths.taskPlanPath,
      resultPath: runPaths.resultPath,
      logsRoot: runPaths.logsRoot,
      screenshotsRoot: runPaths.screenshotsRoot,
      artifactsRoot: runPaths.artifactsRoot,
      scriptsRoot: runPaths.scriptsRoot,
    },
  };
}

async function resolveRunFilePath(runId, relativePath) {
  const normalizedRelativePath = path.normalize(relativePath);
  const runPaths = getRunPaths(runId);
  const resolvedPath = path.resolve(runPaths.runRoot, normalizedRelativePath);
  const expectedPrefix = `${runPaths.runRoot}${path.sep}`;

  if (resolvedPath !== runPaths.runRoot && !resolvedPath.startsWith(expectedPrefix)) {
    throw new Error("Requested file is outside the run directory.");
  }

  return resolvedPath;
}

async function pruneCompletedRuns() {
  await ensureBaseLayout();

  const entries = await fs.readdir(RUNS_ROOT, { withFileTypes: true });
  const currentRunPointer = await readCurrentRunPointer();
  const currentRunId = currentRunPointer?.runId || null;
  const expiryCutoff = Date.now() - CLEANUP_POLICY.maxAgeDays * 24 * 60 * 60 * 1000;
  const completedRuns = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    if (entry.name === currentRunId) {
      continue;
    }

    const runPaths = getRunPaths(entry.name);
    const [meta, result] = await Promise.all([
      readJsonIfExists(runPaths.metaPath),
      readJsonIfExists(runPaths.resultPath),
    ]);

    const status = result?.status || meta?.status || "queued";
    if (!isTerminalStatus(status)) {
      continue;
    }

    const sortValue =
      Date.parse(result?.finishedUtc || meta?.finishedUtc || meta?.createdUtc || 0) || 0;

    completedRuns.push({
      runId: entry.name,
      finishedMs: sortValue,
      removeForAge: sortValue > 0 && sortValue < expiryCutoff,
    });
  }

  completedRuns.sort((left, right) => right.finishedMs - left.finishedMs);

  for (let index = 0; index < completedRuns.length; index += 1) {
    const candidate = completedRuns[index];
    const removeForCount = index >= CLEANUP_POLICY.maxCompletedRuns;

    if (!candidate.removeForAge && !removeForCount) {
      continue;
    }

    const runPaths = getRunPaths(candidate.runId);
    await fs.rm(runPaths.runRoot, { recursive: true, force: true });
  }
}

module.exports = {
  SHARED_ROOT,
  buildContainerName,
  readRun,
  resolveRunFilePath,
  pruneCompletedRuns,
};
