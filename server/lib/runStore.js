const fs = require("fs/promises");
const path = require("path");

const CLEANUP_POLICY = {
  maxCompletedRuns: 20,
  maxAgeDays: 7,
};


const TERMINAL_STATUSES = new Set([                                         //start of lifecycle definitions
  "completed",
  "failed",
  "cancelled",
]);

const RUN_STATUSES = new Set([
  "queued",
  "running",
  "cancelling",
  "completed",
  "failed",
  "cancelled",
]);

const RUN_TRANSITIONS = {
  queued: new Set([
    "running",
    "cancelled",
    "failed",
  ]),

  running: new Set([
    "cancelling",
    "completed",
    "failed",
  ]),

  cancelling: new Set([
    "cancelled",
    "failed",
  ]),

  completed: new Set(),
  failed: new Set(),
  cancelled: new Set(),
};                                                                                //end of lifecycle definition

function canTransitionRunStatus(currentStatus, nextStatus) {                      //validate transition from state to state
  const current = String(currentStatus || "").toLowerCase();
  const next = String(nextStatus || "").toLowerCase();

  if (!RUN_STATUSES.has(current)) {
    return false;
  }

  if (!RUN_STATUSES.has(next)) {
    return false;
  }

  if (current === next) {
    return true;
  }

  return RUN_TRANSITIONS[current]?.has(next) || false;
}

function assertRunStatusTransition(currentStatus, nextStatus) {
  if (!canTransitionRunStatus(currentStatus, nextStatus)) {
    const error = new Error(
      `Invalid run status transition: '${currentStatus}' -> '${nextStatus}'.`
    );

    error.code = "INVALID_RUN_TRANSITION";
    throw error;
  }
}

async function readCancellationRequest(runId) {
  const runPaths = getRunPaths(runId);
  return readJsonIfExists(runPaths.cancelRequestPath);
}

async function requestRunCancellation(runId) {
  const run = await readRun(runId);

  if (!run) {
    return null;
  }

  if (["completed", "failed", "cancelled"].includes(String(run.status || "").toLowerCase())) {
    return run;
  }

  const runPaths = getRunPaths(runId);
  const requestedUtc = nowIso();

  await writeJson(runPaths.cancelRequestPath, {
    runId,
    requestedUtc,
    status: "requested",
  });

  await updateMetaFile(runId, {
    status: "cancelling",
    cancelRequestedUtc: requestedUtc,
  });

  await appendRunLog(runId, "Cancellation requested.");

  return readRun(runId);
}

// DOCKVISION_SHARED_ROOT redirects the store for isolated verification runs
const SHARED_ROOT = process.env.DOCKVISION_SHARED_ROOT
  ? path.resolve(process.env.DOCKVISION_SHARED_ROOT)
  : path.resolve(__dirname, "..", "..", "WindowsVm", "shared");
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

function getRunPaths(runId) {
  const runRoot = path.join(RUNS_ROOT, runId);
  const logsRoot = path.join(runRoot, "logs");
  const screenshotsRoot = path.join(runRoot, "screenshots");
  const artifactsRoot = path.join(runRoot, "artifacts");
  const scriptsRoot = path.join(runRoot, "scripts");
  const iterationsRoot = path.join(runRoot, "iterations");

  return {
    runRoot,
    logsRoot,
    screenshotsRoot,
    artifactsRoot,
    scriptsRoot,
    iterationsRoot,

    metaPath: path.join(runRoot, "meta.json"),
    taskPath: path.join(runRoot, "task.json"),
    taskPlanPath: path.join(runRoot, "task-plan.json"),
    resultPath: path.join(runRoot, "result.json"),
    cancelRequestPath: path.join(runRoot, "cancel-request.json"),
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
    fs.mkdir(runPaths.iterationsRoot, { recursive: true }),
  ]);

  return runPaths;
}

// Run-level files describe the overall launch. Execution-owned channels live
// under an iteration so results and artifacts from separate attempts never mix.
function getIterationPaths(runId, iterationNumber) {
  const runPaths = getRunPaths(runId);

  const iterationRoot = path.join(
    runPaths.iterationsRoot,
    String(iterationNumber)
  );

  return {
    iterationRoot,
    taskPath: path.join(iterationRoot, "task.json"),
    resultPath: path.join(iterationRoot, "result.json"),
    logsRoot: path.join(iterationRoot, "logs"),
    screenshotsRoot: path.join(iterationRoot, "screenshots"),
    artifactsRoot: path.join(iterationRoot, "artifacts"),
  };
}

async function ensureIterationLayout(runId, iterationNumber) {
  const paths = getIterationPaths(runId, iterationNumber);

  await Promise.all([
    fs.mkdir(paths.iterationRoot, { recursive: true }),
    fs.mkdir(paths.logsRoot, { recursive: true }),
    fs.mkdir(paths.screenshotsRoot, { recursive: true }),
    fs.mkdir(paths.artifactsRoot, { recursive: true }),
  ]);

  return paths;
}

function buildIterationRunPointer(
  runId,
  createdUtc,
  iterationNumber,
  iterationPaths
) {
  return {
    runId,
    iterationNumber,
    createdUtc,
    updatedUtc: nowIso(),

    channel: {
      taskPath: `runs/${runId}/iterations/${iterationNumber}/task.json`,
      resultPath: `runs/${runId}/iterations/${iterationNumber}/result.json`,
      logsDir: `runs/${runId}/iterations/${iterationNumber}/logs`,
      screenshotsDir: `runs/${runId}/iterations/${iterationNumber}/screenshots`,
      artifactsDir: `runs/${runId}/iterations/${iterationNumber}/artifacts`,
    },
  };
}

async function writeCurrentRunPointer(pointer) {
  await ensureBaseLayout();
  await writeJson(CURRENT_RUN_POINTER_PATH, pointer);
  return pointer;
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

function hasRemainingIterations(meta) {
  // Metadata is the aggregate source of truth. The selected iteration may have
  // a terminal result while later requested iterations have not been published.
  const totalIterations = toPositiveInteger(meta?.iterationState?.total);
  const completedIterations = toNonNegativeInteger(meta?.iterationState?.completed);
  return totalIterations !== null &&
    (completedIterations === null || completedIterations < totalIterations);
}

function normalizeAggregateStatus(meta, candidateStatus) {
  const normalizedStatus = String(candidateStatus || "queued").toLowerCase();
  const metaStatus = String(meta?.status || "").toLowerCase();

  // Cancellation or failure may terminate a sequence before every requested
  // iteration runs. A completed current iteration must not reopen that run.
  if (metaStatus === "cancelled" || metaStatus === "failed") {
    return metaStatus;
  }

  if (normalizedStatus === "completed" && hasRemainingIterations(meta)) {
    // A stale per-iteration success must not make history, retention, or the
    // launch gate treat the whole sequence as complete during supervisor handoff.
    return metaStatus === "cancelling"
      ? "cancelling"
      : "running";
  }

  return normalizedStatus;
}

async function readCurrentRunPointer() {
  await ensureBaseLayout();
  return readJsonIfExists(CURRENT_RUN_POINTER_PATH);
}

function deriveRunStatus(meta, task, result, heartbeat, isActiveRun) {
  const resultStatus = String(result?.status || "").toLowerCase();
  if (resultStatus === "completed") {
    // An iteration result is not the run result. The supervisor advances the
    // completed count after observing it, and only the final count is terminal.
    return normalizeAggregateStatus(meta, resultStatus);
  }

  if (resultStatus && isTerminalStatus(resultStatus)) {
    return resultStatus;
  }

  if (String(meta?.status || "").toLowerCase() === "cancelling") {
    return "cancelling";
  }

  if (result?.status) {
    return result.status;
  }

  if (meta?.status === "cancelling" || task?.status === "cancelling") {
    return "cancelling";
  }

  if (task?.status) {
    return task.status;
  }

  if (isActiveRun && heartbeat?.agent?.status === "running") {
    return "running";
  }

  return meta?.status || "queued";
}

function toNonNegativeInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : null;
}

function toPositiveInteger(value) {
  const number = toNonNegativeInteger(value);
  return number !== null && number > 0 ? number : null;
}

function deriveRunProgress(meta, task, result, selectedIterationNumber) {
  const iterationState = meta?.iterationState || {};
  const totalIterations =
    toPositiveInteger(iterationState.total) ||
    toPositiveInteger(meta?.settings?.iterations) ||
    toPositiveInteger(task?.runOptions?.iterations) ||
    toPositiveInteger(task?.settings?.iterations);
  const currentIteration =
    toPositiveInteger(iterationState.current) ||
    toPositiveInteger(selectedIterationNumber) ||
    toPositiveInteger(task?.iterationNumber);
  // Zero is a valid count before the first iteration finishes; unlike current
  // and total, completed must not be restricted to positive integers.
  const completedIterations = toNonNegativeInteger(iterationState.completed);

  // Custom runners currently emit steps at the result root, while built-in
  // result writers may nest them under details. This maps persisted telemetry
  // only; null step fields tell the UI that the runner has not published it.
  const resultSteps = Array.isArray(result?.steps)
    ? result.steps
    : Array.isArray(result?.details?.steps)
      ? result.details.steps
      : null;
  // Result writers append steps in observation order, making the final entry
  // the current step for active runs and the last-observed step after completion.
  const lastStep = resultSteps?.length ? resultSteps[resultSteps.length - 1] : null;

  return {
    currentIteration,
    totalIterations,
    completedIterations,
    currentStepNumber: resultSteps?.length || null,
    totalSteps: resultSteps?.length || null,
    completedSteps: resultSteps
      ? resultSteps.filter((step) => String(step?.status || "").toLowerCase() === "completed").length
      : null,
    currentStepId: lastStep?.id ?? null,
  };
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

async function requestRunCancellation2(runId) {
  const run = await readRun(runId);

  if (!run) {
    return null;
  }

  if (isTerminalStatus(run.status)) {
    return { run, terminal: true };
  }

  const runPaths = getRunPaths(runId);
  const requestedUtc = nowIso();

  // The guest agent watches this run-scoped marker while executing.
  await writeJson(path.join(runPaths.runRoot, "cancel.json"), {
    runId,
    requestedUtc,
  });

  await updateMetaFile(runId, {
    status: "cancelling",
    updatedUtc: requestedUtc,
  });

  const updatedRun = await readRun(runId);

  return {
    run: updatedRun,
    terminal: isTerminalStatus(updatedRun?.status),
  };
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

async function findLatestScreenshotArtifact(runId, screenshotsRoot, iterationNumber = null) {
  try {
    const entries = await fs.readdir(screenshotsRoot, { withFileTypes: true });

    const screenshots = entries
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".png"))
      .map((entry) => entry.name)
      .sort();

    if (!screenshots.length) {
      return null;
    }

    const fileName = screenshots[screenshots.length - 1];

    const relativePath =
      iterationNumber !== null
        ? `iterations/${iterationNumber}/screenshots/${fileName}`
        : `screenshots/${fileName}`;

    return {
      rawPath: relativePath,
      relativePath,
      url: buildRunFileUrl(runId, relativePath),
      fileName,
    };
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

async function syncMetaFromRunState(runId, snapshot) {
  if (!snapshot.meta) {
    return snapshot;
  }

  const nextStatus = snapshot.status;
  // finishedUtc belongs to the aggregate run. Clear an iteration-derived finish
  // time when reconciliation determines that the overall sequence is non-terminal.
  const nextFinishedUtc = isTerminalStatus(nextStatus)
    ? snapshot.result?.finishedUtc || snapshot.meta.finishedUtc || null
    : null;
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
  const [meta, currentRunPointer] = await Promise.all([
    readJsonIfExists(runPaths.metaPath),
    readCurrentRunPointer(),
  ]);

  const activeRunId = currentRunPointer?.runId || null;
  const isActiveRun = activeRunId === runId;
  const activeIterationNumber = isActiveRun && Number.isInteger(Number(currentRunPointer?.iterationNumber)) ? Number(currentRunPointer.iterationNumber) : null;
  // Once a run is no longer active, its pointer belongs to another run. Keep
  // reading the latest iteration recorded in metadata instead of falling back
  // to obsolete root-level task/result channels.
  const selectedIterationNumber =
    activeIterationNumber || toPositiveInteger(meta?.iterationState?.current);
  const selectedIterationPaths = selectedIterationNumber !== null
    ? getIterationPaths(runId, selectedIterationNumber)
    : null;
  const screenshotsRoot = selectedIterationPaths?.screenshotsRoot || runPaths.screenshotsRoot;

  const taskPath = selectedIterationPaths?.taskPath || runPaths.taskPath;
  const resultPath = selectedIterationPaths?.resultPath || runPaths.resultPath;
  const taskLogPath = selectedIterationPaths ? path.join(selectedIterationPaths.logsRoot, "task.log") : runPaths.taskLogPath;

  // Root-level fallback is retained only for pre-iteration records. Canonical
  // runs select their task/result/logs from the iteration chosen above.
  const [selectedTask, rootTask, result, heartbeat, taskLogLines] = await Promise.all([
    readJsonIfExists(taskPath),
    selectedIterationPaths ? readJsonIfExists(runPaths.taskPath) : Promise.resolve(null),
    readJsonIfExists(resultPath),
    readJsonIfExists(HEARTBEAT_PATH),
    readLogLines(taskLogPath),
  ]);

  const task = selectedTask || rootTask;

  if (!meta && !task && !result) {
    return null;
  }

  // Reconcile the selected iteration channel with aggregate metadata before the
  // snapshot is returned or persisted; neither source is sufficient on its own.
  const status = deriveRunStatus(meta, task, result, heartbeat, isActiveRun);

  const snapshot = await syncMetaFromRunState(runId, {
    meta,
    task,
    result,
    status,
  });

  const latestScreenshot = await findLatestScreenshotArtifact(
    runId,
    screenshotsRoot,
    selectedIterationNumber
  );

  const baseMeta = snapshot.meta || meta || {};
  const progress = deriveRunProgress(
    baseMeta,
    snapshot.task,
    snapshot.result,
    selectedIterationNumber
  );

  return {
    runId,
    taskId: snapshot.task?.taskId || baseMeta.taskId || null,
    testName: baseMeta.testName || "Untitled Test Run",
    runnerScriptName: baseMeta.runnerScriptName || null,
    runnerScriptPath: baseMeta.runnerScriptPath || null,
    taskPlanPath: baseMeta.taskPlanPath || null,
    taskType: baseMeta.taskType || snapshot.task?.taskType || "unknown",
    // executionMode and progress preserve the status contract consumed by TestPage.
    executionMode: baseMeta.executionMode || null,
    status: snapshot.status,
    settings: baseMeta.settings || snapshot.task?.settings || null,
    iterationState: baseMeta.iterationState || null,
    progress,
    activeIterationNumber,
    active: isActiveRun,
    cleanupPolicy: baseMeta.cleanupPolicy || describeCleanupPolicy(),
    containerId: baseMeta.containerId || null,
    createdUtc: baseMeta.createdUtc || snapshot.task?.createdUtc || null,
    startedUtc: baseMeta.startedUtc || snapshot.task?.startedUtc || null,
    finishedUtc: isTerminalStatus(snapshot.status)
      ? baseMeta.finishedUtc || snapshot.result?.finishedUtc || null
      : null,
    updatedUtc: baseMeta.updatedUtc || null,
    task: snapshot.task || null,
    result: snapshot.result
      ? {
          ...snapshot.result,
          artifacts: buildArtifactMap(runId, snapshot.result.artifacts),
        }
      : null,
    artifacts: {
      ...buildArtifactMap(runId, snapshot.result?.artifacts),
      ...(latestScreenshot
        ? { screenshot: latestScreenshot }
        : {}),
    },
    heartbeat: isActiveRun ? heartbeat : null,
    logs: {
      task: taskLogLines,
    },
    paths: {
      sharedRoot: SHARED_ROOT,
      runRoot: runPaths.runRoot,
      taskPath: selectedIterationPaths?.taskPath || runPaths.taskPath,
      taskPlanPath: runPaths.taskPlanPath,
      resultPath: selectedIterationPaths?.resultPath || runPaths.resultPath,
      logsRoot: selectedIterationPaths?.logsRoot || runPaths.logsRoot,
      screenshotsRoot: selectedIterationPaths?.screenshotsRoot || runPaths.screenshotsRoot,
      artifactsRoot: selectedIterationPaths?.artifactsRoot || runPaths.artifactsRoot,
      scriptsRoot: runPaths.scriptsRoot,
      iterationsRoot: runPaths.iterationsRoot,
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

    const status = normalizeAggregateStatus(meta, result?.status || meta?.status || "queued");
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

async function listRuns() {
  await ensureBaseLayout();
  await pruneCompletedRuns();

  const currentRunPointer = await readCurrentRunPointer();
  const activeRunId = currentRunPointer?.runId || null;
  const entries = await fs.readdir(RUNS_ROOT, { withFileTypes: true });
  const runs = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const runPaths = getRunPaths(entry.name);
    const [meta, task, result] = await Promise.all([
      readJsonIfExists(runPaths.metaPath),
      readJsonIfExists(runPaths.taskPath),
      readJsonIfExists(runPaths.resultPath),
    ]);

    if (!meta && !task && !result) {
      continue;
    }

    const status = normalizeAggregateStatus(
      meta,
      result?.status || task?.status || meta?.status || "queued"
    );

    runs.push({
      runId: entry.name,
      testName: meta?.testName || "Untitled Test Run",
      taskType: task?.taskType || meta?.taskType || "unknown",
      status,
      active: activeRunId === entry.name,
      createdUtc: meta?.createdUtc || task?.createdUtc || null,
      startedUtc: meta?.startedUtc || task?.startedUtc || null,
      finishedUtc: isTerminalStatus(status)
        ? meta?.finishedUtc || result?.finishedUtc || null
        : null,
      updatedUtc: meta?.updatedUtc || null,
    });
  }

  runs.sort((left, right) => runSortTimestamp(right) - runSortTimestamp(left));

  return runs;
}

function runSortTimestamp(run) {
  const candidate = run.createdUtc || run.finishedUtc || "";
  const parsed = Date.parse(candidate);
  return Number.isNaN(parsed) ? 0 : parsed;
}

module.exports = {
  SHARED_ROOT,
  readRun,
  requestRunCancellation,
  listRuns,
  resolveRunFilePath,
  pruneCompletedRuns,
  getIterationPaths,                       //for run supervisior
  buildIterationRunPointer,
  writeCurrentRunPointer,
  ensureIterationLayout,
  updateMetaFile,
  writeTaskFile,
  appendRunLog,
  assertRunStatusTransition,
  readCancellationRequest,
  requestRunCancellation2,
  readCurrentRunPointer,
  isTerminalStatus,
};
