const fs = require("fs/promises");
const path = require("path");

//define retention limits independently from ownership; callers must still supply a safe scope
const CLEANUP_POLICY = {
  maxTerminalRuns: 30,
  maxAgeHours: 720,
};

//serialize cleanup per shared root without treating this process-local queue as a distributed lock
const cleanupQueues = new Map();


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

function getRunPaths(runId, runsRoot = RUNS_ROOT) {
  const runRoot = path.join(runsRoot, runId);
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

async function ensureBaseLayout({
  sharedRoot = SHARED_ROOT,
  activeRoot = ACTIVE_ROOT,
  runsRoot = RUNS_ROOT,
} = {}) {
  await Promise.all([
    fs.mkdir(sharedRoot, { recursive: true }),
    fs.mkdir(activeRoot, { recursive: true }),
    fs.mkdir(runsRoot, { recursive: true }),
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

async function clearActiveChannel() {
  // Remove the old active-run pointer before starting a new run.
  // This keeps the shared folder pointed at only one run.
  await ensureBaseLayout();
  // Do not fail if there is no old pointer to remove.
  await fs.rm(CURRENT_RUN_POINTER_PATH, { force: true });
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
  //keep the user-facing policy description aligned with the selection constants above
  return `Retain up to ${CLEANUP_POLICY.maxTerminalRuns} terminal runs for ${CLEANUP_POLICY.maxAgeHours} hours from terminal completion when a safe ownership scope is available.`;
}

function compareRunIds(left, right) {
  //provide a stable secondary sort order when terminal completion times are identical
  if (left === right) {
    return 0;
  }

  return left < right ? -1 : 1;
}

function selectRunsForRetention(records, { now = Date.now } = {}) {
  //select removable run IDs from an already-scoped collection without reading or deleting files
  const nowMs = now();
  if (!Number.isFinite(nowMs)) {
    throw new TypeError("Cleanup clock must return a finite timestamp.");
  }

  //calculate the inclusive completion-time cutoff from the injected clock for repeatable selection
  const expiryCutoff = nowMs - CLEANUP_POLICY.maxAgeHours * 60 * 60 * 1000;
  const completedRuns = records
    .filter((record) => {
      //retention only considers confirmed, inactive terminal records from the supplied scope
      return record &&
        typeof record.runId === "string" &&
        !record.active &&
        !record.indeterminate &&
        isTerminalStatus(record.status);
    })
    .map((record) => ({
      runId: record.runId,
      finishedMs: Date.parse(record.finishedUtc || ""),
    }))
    .filter((record) => {
      //missing completion time is indeterminate, so it cannot be age- or count-selected
      return !Number.isNaN(record.finishedMs);
    });

  completedRuns.sort((left, right) => {
    //equal completion times use the run ID so retention selection remains reproducible
    return right.finishedMs - left.finishedMs || compareRunIds(left.runId, right.runId);
  });

  return completedRuns
    .filter((record, index) => {
      //count and age eligibility are independent: either condition selects the record
      return record.finishedMs <= expiryCutoff || index >= CLEANUP_POLICY.maxTerminalRuns;
    })
    .map((record) => record.runId);
}

function hasRemainingIterations(meta) {
  //metadata is the aggregate source of truth. the selected iteration may have
  //a terminal result while later requested iterations have not been published
  const totalIterations = toPositiveInteger(meta?.iterationState?.total);
  const completedIterations = toNonNegativeInteger(meta?.iterationState?.completed);
  return totalIterations !== null &&
    (completedIterations === null || completedIterations < totalIterations);
}

function normalizeAggregateStatus(meta, candidateStatus) {
  const normalizedStatus = String(candidateStatus || "queued").toLowerCase();
  const metaStatus = String(meta?.status || "").toLowerCase();

  //cancellation or failure may terminate a sequence before every requested
  // iteration runs. a completed current iteration must not reopen that run
  if (metaStatus === "cancelled" || metaStatus === "failed") {
    return metaStatus;
  }

  if (normalizedStatus === "completed" && hasRemainingIterations(meta)) {
    //a stale per-iteration success must not make history, retention, or the
    // launch gate treat the whole sequence as complete during supervisor handoff
    return metaStatus === "cancelling"
      ? "cancelling"
      : "running";
  }

  return normalizedStatus;
}

async function readCurrentRunPointer({
  sharedRoot = SHARED_ROOT,
  activeRoot = ACTIVE_ROOT,
  runsRoot = RUNS_ROOT,
  currentRunPointerPath = CURRENT_RUN_POINTER_PATH,
} = {}) {
  await ensureBaseLayout({ sharedRoot, activeRoot, runsRoot });
  return readJsonIfExists(currentRunPointerPath);
}

function deriveRunStatus(meta, task, result, heartbeat, isActiveRun) {
  const resultStatus = String(result?.status || "").toLowerCase();
  if (resultStatus === "completed") {
    //an iteration result is not the run result. the supervisor advances the
    // completed count after observing it, and only the final count is terminal
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
  // and total, completed must not be restricted to positive integers
  const completedIterations = toNonNegativeInteger(iterationState.completed);

  //custom runners currently emit steps at the result root, while built-in
  // result writers may nest them under details. this maps persisted telemetry
  // only; null step fields tell the UI that the runner has not published it
  const resultSteps = Array.isArray(result?.steps)
    ? result.steps
    : Array.isArray(result?.details?.steps)
      ? result.details.steps
      : null;
  //result writers append steps in observation order, making the final entry
  // the current step for active runs and the last-observed step after completion
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

  //the guest agent watches this run-scoped marker while executing
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
    const mapArtifact = (artifactPath) => {
      const relativePath = normalizeArtifactRelativePath(runId, artifactPath);

      return {
        rawPath: artifactPath,
        relativePath,
        url: relativePath ? buildRunFileUrl(runId, relativePath) : null,
        fileName: relativePath ? path.posix.basename(relativePath) : null,
      };
    };

    mappedArtifacts[name] = Array.isArray(rawPath)
      ? rawPath.map(mapArtifact)
      : mapArtifact(rawPath);
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

async function listIterationScreenshotArtifacts(runId, iterationsRoot) {
  let iterationEntries;

  try {
    iterationEntries = await fs.readdir(iterationsRoot, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") {
      return {};
    }

    throw error;
  }

  const artifacts = {};
  const iterationNumbers = iterationEntries
    .filter((entry) => entry.isDirectory() && /^\d+$/.test(entry.name))
    .map((entry) => Number(entry.name))
    .sort((left, right) => left - right);

  for (const iterationNumber of iterationNumbers) {
    const screenshotsRoot = path.join(
      iterationsRoot,
      String(iterationNumber),
      "screenshots"
    );
    let screenshotEntries;

    try {
      screenshotEntries = await fs.readdir(screenshotsRoot, { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") {
        continue;
      }

      throw error;
    }

    const screenshotNames = screenshotEntries
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".png"))
      .map((entry) => entry.name)
      .sort();

    for (const fileName of screenshotNames) {
      const relativePath = `iterations/${iterationNumber}/screenshots/${fileName}`;
      const artifactKey = `screenshot-${iterationNumber}-${fileName}`;

      artifacts[artifactKey] = {
        rawPath: relativePath,
        relativePath,
        url: buildRunFileUrl(runId, relativePath),
        fileName,
      };
    }
  }

  return artifacts;
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
  const iterationScreenshotArtifacts = await listIterationScreenshotArtifacts(
    runId,
    runPaths.iterationsRoot
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
      ...iterationScreenshotArtifacts,
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
  const preparedRunner = prepareRunnerScript(options);

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
  const uploadedInputs = await writeUploadedScriptRunnerInputs(runPaths, options);
  const taskType = uploadedInputs ? "script_runner" : "task_sequence";

  const task = {
    runId,
    taskId,
    taskType,
    status: "queued",
    createdUtc,
    payload: uploadedInputs
        ? buildUploadedScriptRunnerPayload(uploadedInputs, options)
        : preparedRunner.plan,
  };

  const runnerScriptPath = preparedRunner ? path.posix.join("scripts", preparedRunner.fileName) : null;

  const meta = {
    runId,
    taskId,
    testName: options.testName || "Untitled Test Run",
    runnerScriptName: preparedRunner?.fileName || options.runnerScriptName || null, runnerScriptPath,
    taskPlanPath: preparedRunner ? "task-plan.json" : null,
    configFileName: options.configFileName || null,
    runnerScriptLanguage: uploadedInputs?.language || options.runnerScriptLanguage || null,
    taskType: task.taskType,
    status: "queued",
    createdUtc,
    updatedUtc: createdUtc,
    containerId: null,
    cleanupPolicy: describeCleanupPolicy(),
  };

  const currentRunPointer = buildCurrentRunPointer(runId, createdUtc);

  const pendingWrites = [
    writeJson(runPaths.metaPath, meta),
    writeJson(runPaths.taskPath, task),
    writeJson(CURRENT_RUN_POINTER_PATH, currentRunPointer),
  ];

  if (preparedRunner) {
    pendingWrites.push(
      fs.writeFile(
        path.join(runPaths.scriptsRoot, preparedRunner.fileName),
        preparedRunner.content,
        "utf8"
      ),
      writeJson(runPaths.taskPlanPath, preparedRunner.plan)
    );
  }

  await Promise.all(pendingWrites);

  await appendRunLog(runId, "Run created and queued in the active channel.");

  return {
    runId,
    taskId,
    meta,
    task,
    paths: runPaths,
  };
}
// The alternate launch endpoint uses the same parsed task-plan contract.
async function createRunRecord2(options = {}) {
  // create an alternate-route run using the same shared-folder lifecycle contract as the primary creator
  const preparedRunner = prepareRunnerScript(options);

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
  const settings = normalizeRunSettings(options);                                                   //normalize iteration, timeout, and screenshot-capture settings for this run
  const uploadedInputs = await writeUploadedScriptRunnerInputs(runPaths, options);


  const taskType = uploadedInputs ? "script_runner" : "task_sequence";
  const payload = uploadedInputs
    ? buildUploadedScriptRunnerPayload(uploadedInputs, options)
    : preparedRunner.plan;

  const task = {
    runId,
    taskId,
    taskType,
    status: "queued",
    createdUtc,
    settings,
    runOptions: settings,
    payload,
  };

  const runnerScriptPath = preparedRunner ? path.posix.join("scripts", preparedRunner.fileName) : null;

  const meta = {
    runId,
    taskId,
    testName: options.testName || "Untitled Test Run",
    runnerScriptName: preparedRunner?.fileName || options.runnerScriptName || null,
    runnerScriptPath,
    taskPlanPath: preparedRunner ? "task-plan.json" : null,
    configFileName: options.configFileName || null,
    taskType: task.taskType,
    settings,
    runOptions: settings,
    iterationState: {
      total: settings.iterations,
      current: 0,
      completed: 0,
      failed: 0,
    },
    status: "queued",
    createdUtc,
    updatedUtc: createdUtc,
    containerId: null,
    cleanupPolicy: describeCleanupPolicy(),
  };

  const FIRST_ITERATION_NUMBER = 1;
  const currentRunPointer = buildIterationRunPointer( runId, createdUtc, FIRST_ITERATION_NUMBER);
  const pendingWrites = [
    writeJson(runPaths.metaPath, meta),
    writeJson(runPaths.taskPath, task),
    writeJson(CURRENT_RUN_POINTER_PATH, currentRunPointer),
  ];

  if (preparedRunner) {
    pendingWrites.push(
      fs.writeFile(
        path.join(runPaths.scriptsRoot, preparedRunner.fileName),
        preparedRunner.content,
        "utf8"
      ),
      writeJson(runPaths.taskPlanPath, preparedRunner.plan)
    );
  }

  await Promise.all(pendingWrites);

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

//build one process-local queue key for each shared storage root
function getCleanupQueueKey(sharedRoot) {
  //normalize windows paths so case-only variants share one cleanup queue
  const resolvedSharedRoot = path.resolve(sharedRoot);
  return process.platform === "win32"
    ? resolvedSharedRoot.toLowerCase()
    : resolvedSharedRoot;
}

//scan select and delete only records from an explicit cleanup scope
async function pruneScopedCompletedRuns({
  sharedRoot = SHARED_ROOT,
  activeRoot,
  runsRoot,
  currentRunPointerPath,
  runIds,
  now = Date.now,
  removeRun = fs.rm,
} = {}) {
  //resolve dependent storage paths from the supplied root so fixture cleanup never reaches live storage
  const resolvedSharedRoot = path.resolve(sharedRoot);
  const storagePaths = {
    sharedRoot: resolvedSharedRoot,
    activeRoot: activeRoot || path.join(resolvedSharedRoot, "active"),
    runsRoot: runsRoot || path.join(resolvedSharedRoot, "runs"),
  };
  storagePaths.currentRunPointerPath = currentRunPointerPath || path.join(
    storagePaths.activeRoot,
    "current-run.json"
  );

  //ensure the scoped layout exists before examining candidate run directories
  await ensureBaseLayout(storagePaths);

  const entries = await fs.readdir(storagePaths.runsRoot, { withFileTypes: true });
  //ignore non-string IDs and use a set for membership checks while scanning disk
  const scopedRunIds = new Set(runIds.filter((runId) => typeof runId === "string"));
  const currentRunPointer = await readCurrentRunPointer(storagePaths);
  const currentRunId = currentRunPointer?.runId || null;
  const retentionRecords = [];

  for (const entry of entries) {
    //never inspect files outside the explicitly supplied scope
    if (!entry.isDirectory() || !scopedRunIds.has(entry.name)) {
      continue;
    }

    //the active pointer always wins over terminal-looking files during lifecycle handoff
    if (entry.name === currentRunId) {
      continue;
    }

    const runPaths = getRunPaths(entry.name, storagePaths.runsRoot);
    const [meta, result] = await Promise.all([
      readJsonIfExists(runPaths.metaPath),
      readJsonIfExists(runPaths.resultPath),
    ]);

    //normalize aggregate state before selection so incomplete multi-iteration runs remain protected
    const status = normalizeAggregateStatus(meta, result?.status || meta?.status || "queued");
    const metaStatus = String(meta?.status || "").toLowerCase();
    const resultStatus = String(result?.status || "").toLowerCase();
    const contradictory = Boolean(metaStatus && resultStatus && metaStatus !== resultStatus);
    //prefer a valid terminal result time, then use terminal metadata when the result time is unavailable
    const resultFinishedMs = Date.parse(result?.finishedUtc || "");
    const finishedUtc = Number.isNaN(resultFinishedMs)
      ? meta?.finishedUtc || null
      : result.finishedUtc;

    retentionRecords.push({
      runId: entry.name,
      status,
      active: false,
      finishedUtc,
      //a disagreement between persisted lifecycle views must not trigger deletion
      indeterminate: contradictory,
    });
  }

  //keep selection pure and limit this function to scoped record loading plus filesystem deletion
  const selectedRunIds = selectRunsForRetention(retentionRecords, { now });
  const removedRunIds = [];
  const failedRunIds = [];
  const deletionFailures = [];

  for (const runId of selectedRunIds) {
    //delete only run directories selected from the explicit scope above
    const runPaths = getRunPaths(runId, storagePaths.runsRoot);
    try {
      await removeRun(runPaths.runRoot, { recursive: true, force: true });
      removedRunIds.push(runId);
    } catch (error) {
      //another cleanup may have removed the selected directory after this operation scanned it
      if (error?.code === "ENOENT") {
        removedRunIds.push(runId);
        continue;
      }

      //keep failed candidates on disk so a later scoped cleanup can retry them
      failedRunIds.push(runId);
      deletionFailures.push({
        runId,
        code: error?.code || "CLEANUP_DELETE_FAILED",
        message: error?.message || "Unable to remove the run directory.",
      });
    }
  }

  return {
    skipped: false,
    reason: null,
    removedRunIds,
    failedRunIds,
    deletionFailures,
  };
}

//fail closed for unscoped calls and serialize scoped cleanup by shared root
async function pruneCompletedRuns(options = {}) {
  const { sharedRoot = SHARED_ROOT, runIds } = options;

  //refuse destructive cleanup until a caller provides the run IDs it safely owns
  if (!Array.isArray(runIds)) {
    return {
      skipped: true,
      reason: "OWNERSHIP_SCOPE_REQUIRED",
      removedRunIds: [],
      failedRunIds: [],
      deletionFailures: [],
    };
  }

  const key = getCleanupQueueKey(sharedRoot);
  const previous = cleanupQueues.get(key) || Promise.resolve();
  //continue after a prior unexpected failure so one cleanup does not permanently block later retries
  const pending = previous.catch(() => {}).then(() => pruneScopedCompletedRuns(options));
  cleanupQueues.set(key, pending);

  try {
    return await pending;
  } finally {
    //only remove this queue entry when no newer scoped cleanup is waiting behind it
    if (cleanupQueues.get(key) === pending) {
      cleanupQueues.delete(key);
    }
  }
}

async function listRuns({ sharedRoot = SHARED_ROOT } = {}) {
  const resolvedSharedRoot = path.resolve(sharedRoot);
  const activeRoot = path.join(resolvedSharedRoot, "active");
  const runsRoot = path.join(resolvedSharedRoot, "runs");
  const currentRunPointerPath = path.join(activeRoot, "current-run.json");
  const storagePaths = { sharedRoot: resolvedSharedRoot, activeRoot, runsRoot, currentRunPointerPath };

  await ensureBaseLayout(storagePaths);
  await pruneCompletedRuns(storagePaths);

  const currentRunPointer = await readCurrentRunPointer(storagePaths);
  const activeRunId = currentRunPointer?.runId || null;
  const entries = await fs.readdir(runsRoot, { withFileTypes: true });
  const runs = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const runPaths = getRunPaths(entry.name, runsRoot);
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
      meta?.status || result?.status || task?.status || "queued"
    );

    const totalIterations =
      Number(meta?.iterationState?.total) ||
      Number(meta?.settings?.iterations) ||
      Number(task?.runOptions?.iterations) ||
      Number(task?.settings?.iterations) ||
      1;

    runs.push({
      runId: entry.name,
      testName: meta?.testName || "Untitled Test Run",
      taskType: task?.taskType || meta?.taskType || "unknown",
      status,
      active: activeRunId === entry.name,
      totalIterations,
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
  //keep these older run creators available for the older server routes.
  createRunRecord,
  createRunRecord2,
  readRun,
  requestRunCancellation,
  listRuns,
  resolveRunFilePath,
  pruneCompletedRuns,
  selectRunsForRetention,
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
  buildArtifactMap,
};
