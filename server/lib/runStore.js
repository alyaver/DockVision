const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");

const CLEANUP_POLICY = {
  maxCompletedRuns: 20,
  maxAgeDays: 7,
};

// Treat a run as abandoned only after several missed heartbeats and a minimum
// amount of host-observed inactivity. The extra floor protects us from noisy
// file-share timing while still letting the next run recover automatically.
const HEARTBEAT_STALE_MISSED_INTERVALS = 3;
const HEARTBEAT_STALE_MIN_MS = 60 * 1000;

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

function buildRunId() {
  return `run-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
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

  return {
    runRoot,
    logsRoot,
    screenshotsRoot,
    artifactsRoot,
    metaPath: path.join(runRoot, "meta.json"),
    taskPath: path.join(runRoot, "task.json"),
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

function buildDefaultTaskPayload(runId, options = {}) {
  const testName = options.testName || "Untitled Test Run";
  const runnerScriptName = options.runnerScriptName || "No runner script uploaded";
  const configFileName = options.configFileName || "No config uploaded";

  return {
    text: [
      "DockVision isolated run proof",
      `Run ID: ${runId}`,
      `Test Run Name: ${testName}`,
      `Runner Script: ${runnerScriptName}`,
      `Config File: ${configFileName}`,
      `Queued UTC: ${nowIso()}`,
    ].join("\r\n"),
    captureScreenshot: true,
    saveFile: true,
    closeAfter: true,
    fileName: `${runId}-notepad-proof.txt`,
  };
}

function buildCurrentRunPointer(runId, createdUtc) {
  return {
    runId,
    createdUtc,
    updatedUtc: createdUtc,
    channel: {
      taskPath: `runs/${runId}/task.json`,
      resultPath: `runs/${runId}/result.json`,
      logsDir: `runs/${runId}/logs`,
      screenshotsDir: `runs/${runId}/screenshots`,
      artifactsDir: `runs/${runId}/artifacts`,
    },
  };
}

async function readCurrentRunPointer() {
  await ensureBaseLayout();
  return readJsonIfExists(CURRENT_RUN_POINTER_PATH);
}

async function clearActiveChannel() {
  await ensureBaseLayout();
  await fs.rm(CURRENT_RUN_POINTER_PATH, { force: true });
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

function getHeartbeatGraceMs(heartbeat) {
  const intervalSeconds = Number(heartbeat?.agent?.intervalSeconds);
  const intervalMs =
    Number.isFinite(intervalSeconds) && intervalSeconds > 0
      ? intervalSeconds * 1000
      : 0;

  return Math.max(
    HEARTBEAT_STALE_MIN_MS,
    intervalMs * HEARTBEAT_STALE_MISSED_INTERVALS
  );
}

async function readFileMtimeMs(filePath) {
  if (!filePath) {
    return null;
  }

  try {
    const fileStats = await fs.stat(filePath);
    return fileStats.mtimeMs;
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

function getHeartbeatHealth(run) {
  const heartbeat = run?.heartbeat || null;
  return {
    runId: String(heartbeat?.agent?.runId || ""),
    status: String(heartbeat?.agent?.status || "").toLowerCase(),
    timestampUtc: heartbeat?.machine?.timestampUtc || null,
  };
}

async function getObservedRunHealth(run) {
  // Use host-side file modification times instead of trusting guest-written
  // timestamps. Host and guest clocks can drift, which is exactly what caused
  // the earlier false "still running" state after the Windows guest vanished.
  const [heartbeatMtimeMs, taskMtimeMs, metaMtimeMs, taskLogMtimeMs] =
    await Promise.all([
      readFileMtimeMs(HEARTBEAT_PATH),
      readFileMtimeMs(run?.paths?.taskPath),
      readFileMtimeMs(run?.paths?.runRoot ? path.join(run.paths.runRoot, "meta.json") : null),
      readFileMtimeMs(
        run?.paths?.runRoot ? path.join(run.paths.runRoot, "logs", "task.log") : null
      ),
    ]);

  const graceMs = getHeartbeatGraceMs(run?.heartbeat);
  const heartbeatFresh =
    heartbeatMtimeMs !== null && Date.now() - heartbeatMtimeMs <= graceMs;
  const observedRunActivityMs = [taskMtimeMs, metaMtimeMs, taskLogMtimeMs]
    .filter((value) => value !== null)
    .reduce((latest, value) => Math.max(latest, value), 0);
  const runActivityStale =
    observedRunActivityMs > 0 && Date.now() - observedRunActivityMs > graceMs;

  return {
    graceMs,
    heartbeatFresh,
    heartbeatMtimeUtc:
      heartbeatMtimeMs !== null ? new Date(heartbeatMtimeMs).toISOString() : null,
    observedRunActivityUtc:
      observedRunActivityMs > 0 ? new Date(observedRunActivityMs).toISOString() : null,
    runActivityStale,
  };
}

async function shouldRecoverAbandonedRun(run) {
  if (!run?.active || run.status !== "running") {
    return false;
  }

  const heartbeatHealth = getHeartbeatHealth(run);
  const observedHealth = await getObservedRunHealth(run);
  // A run is healthy only when the heartbeat is fresh, still reports "running",
  // and still belongs to the active run we are evaluating.
  const heartbeatHealthy =
    observedHealth.heartbeatFresh &&
    heartbeatHealth.status === "running" &&
    heartbeatHealth.runId === run.runId;

  if (heartbeatHealthy) {
    return false;
  }

  return observedHealth.runActivityStale;
}

function buildAbandonedRunMessage(run, observedHealth = null) {
  const heartbeatHealth = getHeartbeatHealth(run);
  const messageParts = [
    "Run stopped receiving a healthy guest-agent heartbeat before the task finished.",
  ];

  if (observedHealth?.heartbeatMtimeUtc) {
    messageParts.push(`Heartbeat file last changed at ${observedHealth.heartbeatMtimeUtc}.`);
  }

  if (heartbeatHealth.timestampUtc) {
    messageParts.push(`Last heartbeat UTC: ${heartbeatHealth.timestampUtc}.`);
  } else {
    messageParts.push("No heartbeat timestamp was available.");
  }

  if (heartbeatHealth.status && heartbeatHealth.status !== "running") {
    messageParts.push(`Heartbeat status was '${heartbeatHealth.status}'.`);
  }

  if (heartbeatHealth.runId && heartbeatHealth.runId !== run.runId) {
    messageParts.push(`Heartbeat belonged to run '${heartbeatHealth.runId}'.`);
  }

  messageParts.push("The Windows guest or backing container likely exited unexpectedly.");
  return messageParts.join(" ");
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

async function writeTaskFile(runId, task) {
  const runPaths = await ensureRunLayout(runId);
  await writeJson(runPaths.taskPath, task);
  return task;
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
      resultPath: runPaths.resultPath,
      logsRoot: runPaths.logsRoot,
      screenshotsRoot: runPaths.screenshotsRoot,
      artifactsRoot: runPaths.artifactsRoot,
    },
  };
}

async function failAbandonedRun(run) {
  // Convert an orphaned in-flight run into a terminal failure and clear the
  // active pointer so future runs are not blocked behind stale shared state.
  const runId = run.runId;
  const runPaths = await ensureRunLayout(runId);
  const finishedUtc = nowIso();
  const observedHealth = await getObservedRunHealth(run);
  const message = buildAbandonedRunMessage(run, observedHealth);
  const task = {
    ...(run.task || {}),
    runId,
    taskId: run.taskId || run.task?.taskId || `${runId}-task`,
    status: "failed",
    completedUtc: finishedUtc,
  };

  await Promise.all([
    writeTaskFile(runId, task),
    writeJson(runPaths.resultPath, {
      runId,
      taskId: task.taskId,
      status: "failed",
      finishedUtc,
      message,
      artifacts: {},
      details: {
        source: "backend-heartbeat-recovery",
        heartbeatStatus: run.heartbeat?.agent?.status || null,
        heartbeatRunId: run.heartbeat?.agent?.runId || null,
        heartbeatTimestampUtc: run.heartbeat?.machine?.timestampUtc || null,
        heartbeatFileUpdatedUtc: observedHealth.heartbeatMtimeUtc,
        lastObservedRunActivityUtc: observedHealth.observedRunActivityUtc,
      },
    }),
    updateMetaFile(runId, {
      status: "failed",
      finishedUtc,
    }),
  ]);

  await appendRunLog(
    runId,
    "Run was marked failed because its guest heartbeat became stale or mismatched."
  );

  const currentRunPointer = await readCurrentRunPointer();
  if (currentRunPointer?.runId === runId) {
    await clearActiveChannel();
  }

  return readRun(runId);
}

async function getBlockingActiveRun() {
  const currentRunPointer = await readCurrentRunPointer();
  if (!currentRunPointer?.runId) {
    return null;
  }

  const currentRun = await readRun(currentRunPointer.runId);
  if (!currentRun) {
    await clearActiveChannel();
    return null;
  }

  if (isTerminalStatus(currentRun.status)) {
    await clearActiveChannel();
    return null;
  }

  // Self-heal abandoned runs before enforcing the single-active-run rule.
  if (await shouldRecoverAbandonedRun(currentRun)) {
    await failAbandonedRun(currentRun);
    return null;
  }

  return currentRun;
}

async function archiveQueuedRun(run) {
  const runId = run.runId;
  const runPaths = await ensureRunLayout(runId);
  const finishedUtc = nowIso();
  const task = {
    ...(run.task || {}),
    runId,
    status: "cancelled",
    completedUtc: finishedUtc,
  };

  await Promise.all([
    writeTaskFile(runId, task),
    writeJson(runPaths.resultPath, {
      runId,
      taskId: run.taskId || task.taskId || `${runId}-task`,
      status: "cancelled",
      finishedUtc,
      message: "Queued run was superseded by a newer run before execution.",
      artifacts: {},
      details: {
        source: "backend-run-replacement",
      },
    }),
    updateMetaFile(runId, {
      status: "cancelled",
      finishedUtc,
    }),
  ]);

  await appendRunLog(
    runId,
    "Queued run was archived because a newer run replaced the active channel."
  );
}

async function createRunRecord(options = {}) {
  await ensureBaseLayout();
  await pruneCompletedRuns();

  const activeRun = await getBlockingActiveRun();
  if (activeRun) {
    if (activeRun.status === "queued") {
      await archiveQueuedRun(activeRun);
    } else {
      const error = new Error(
        `Run '${activeRun.runId}' is still ${activeRun.status}. Wait for it to finish before starting a new one.`
      );
      error.code = "RUN_ACTIVE";
      error.activeRunId = activeRun.runId;
      throw error;
    }
  }

  await clearActiveChannel();

  const runId = buildRunId();
  const taskId = `${runId}-task`;
  const createdUtc = nowIso();
  const runPaths = await ensureRunLayout(runId);

  const task = {
    runId,
    taskId,
    taskType: options.taskType || "notepad_lifecycle",
    status: "queued",
    createdUtc,
    payload: options.payload || buildDefaultTaskPayload(runId, options),
  };

  const meta = {
    runId,
    taskId,
    testName: options.testName || "Untitled Test Run",
    runnerScriptName: options.runnerScriptName || null,
    configFileName: options.configFileName || null,
    taskType: task.taskType,
    status: "queued",
    createdUtc,
    updatedUtc: createdUtc,
    containerId: null,
    cleanupPolicy: describeCleanupPolicy(),
  };

  const currentRunPointer = buildCurrentRunPointer(runId, createdUtc);

  await Promise.all([
    writeJson(runPaths.metaPath, meta),
    writeJson(runPaths.taskPath, task),
    writeJson(CURRENT_RUN_POINTER_PATH, currentRunPointer),
  ]);

  await appendRunLog(runId, "Run created and queued in the active channel.");

  return {
    runId,
    taskId,
    meta,
    task,
    paths: runPaths,
  };
}

async function attachContainerId(runId, containerId) {
  const nextMeta = await updateMetaFile(runId, {
    containerId,
  });

  await appendRunLog(runId, `Launcher container attached to run: ${containerId}`);

  return nextMeta;
}

async function markRunLaunchFailure(runId, message) {
  const runPaths = await ensureRunLayout(runId);
  const meta = (await readJsonIfExists(runPaths.metaPath)) || { runId };
  const finishedUtc = nowIso();

  await Promise.all([
    writeJson(runPaths.resultPath, {
      runId,
      taskId: meta.taskId || `${runId}-task`,
      status: "failed",
      finishedUtc,
      message,
      artifacts: {},
      details: {
        source: "backend-launch",
      },
    }),
    updateMetaFile(runId, {
      status: "failed",
      finishedUtc,
    }),
  ]);

  await appendRunLog(runId, `Run failed before agent execution: ${message}`);
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
  createRunRecord,
  attachContainerId,
  markRunLaunchFailure,
  readRun,
  resolveRunFilePath,
};
