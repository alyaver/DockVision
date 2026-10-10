const fs = require("fs/promises");
const path = require("path");
const { randomBytes } = require("crypto");
const { LaunchError } = require("./launchRequest");
const { publishPointer } = require("./publishPointer");

const DEFAULT_SHARED_ROOT = path.resolve(__dirname, "../../WindowsVm/shared");
const terminal = new Set(["completed", "failed", "cancelled"]);

function createLaunchStore({ sharedRoot = DEFAULT_SHARED_ROOT, io = fs } = {}) {
  const root = path.resolve(sharedRoot);
  const activeRoot = path.join(root, "active");
  const pointerPath = path.join(activeRoot, "current-run.json");
  async function readJson(file) {
    try {
      return JSON.parse((await io.readFile(file, "utf8")).replace(/^\uFEFF/, ""));
    } catch (error) {
      if (error.code === "ENOENT") return undefined;
      throw error;
    }
  }
  // The active pointer has one canonical shape: every channel path belongs to
  // the declared run and iteration. Exact matching keeps malformed, cross-run,
  // and pre-iteration pointers from being interpreted as valid active state.
  function resolveIterationPointer(pointer) {
    const iterationNumber = Number(pointer?.iterationNumber);
    if (!Number.isInteger(iterationNumber) || iterationNumber < 1 || !pointer?.channel) {
      return null;
    }

    const prefix = `runs/${pointer.runId}/iterations/${iterationNumber}`;
    const expectedChannel = {
      taskPath: `${prefix}/task.json`,
      resultPath: `${prefix}/result.json`,
      logsDir: `${prefix}/logs`,
      screenshotsDir: `${prefix}/screenshots`,
      artifactsDir: `${prefix}/artifacts`,
    };
    for (const [field, expected] of Object.entries(expectedChannel)) {
      if (pointer.channel[field]?.replace(/\\/g, "/") !== expected) return null;
    }

    return {
      iterationNumber,
      resultPath: path.join(root, ...expectedChannel.resultPath.split("/")),
    };
  }
  // A terminal iteration is not necessarily a terminal run. For multi-iteration
  // work, admission remains closed until metadata confirms every iteration ended.
  function pointerResultCompletesRun(pointer, meta, result) {
    if (!terminal.has(result?.status)) return false;

    // Cancellation and failure can intentionally stop a multi-iteration run
    // early. Their aggregate metadata is terminal even when the selected
    // iteration itself happened to finish successfully before the stop boundary.
    if (meta?.status === "cancelled" || meta?.status === "failed") return true;

    const totalIterations = Number(meta?.iterationState?.total);
    if (Number.isInteger(totalIterations) && totalIterations > 0) {
      if (result.status !== "completed") return terminal.has(meta?.status);
      return Number(meta?.iterationState?.completed) >= totalIterations;
    }

    return terminal.has(meta?.status);
  }
  async function assertAvailable() {
    let pointer;
    try {
      pointer = await readJson(pointerPath);
    } catch {
      throw new LaunchError(409, "ACTIVE_RUN_STATE_INVALID", "The active-run pointer cannot be read. Resolve its state before launching.");
    }
    if (pointer === undefined) return;
    if (!pointer || typeof pointer.runId !== "string" || !/^run-[a-zA-Z0-9-]+$/.test(pointer.runId)) {
      throw new LaunchError(409, "ACTIVE_RUN_STATE_INVALID", "The active-run pointer has an invalid run ID.");
    }
    const runRoot = path.join(root, "runs", pointer.runId);
    const rootResultPath = path.join(runRoot, "result.json");
    const iterationPointer = resolveIterationPointer(pointer);
    if (!iterationPointer) {
      const error = new LaunchError(409, "ACTIVE_RUN_STATE_INVALID", "The active-run pointer does not match the required iteration channel format.");
      error.activeRunId = pointer.runId;
      throw error;
    }
    let records;
    try {
      records = await Promise.all([
        readJson(path.join(runRoot, "meta.json")),
        readJson(path.join(runRoot, "task.json")),
        readJson(rootResultPath),
        readJson(iterationPointer.resultPath),
      ]);
    } catch {
      const error = new LaunchError(409, "ACTIVE_RUN_STATE_INVALID", "Active-run records are unreadable. Recovery is required.");
      error.activeRunId = pointer.runId;
      throw error;
    }
    const [meta, task, rootResult, pointerResult] = records;
    const result = rootResult || pointerResult;
    // A run-level terminal result is authoritative. An iteration result only
    // releases admission after metadata confirms that the full run is terminal.
    // Admission never repairs, cancels, or replaces in-flight work.
    if (terminal.has(rootResult?.status)) return;
    if (pointerResultCompletesRun(pointer, meta, pointerResult)) return;
    if (!result && meta && task && terminal.has(meta.status) && meta.status === task.status) return;
    const error = new LaunchError(409, "RUN_ACTIVE", `Run '${pointer.runId}' is active or awaiting recovery.`);
    error.activeRunId = pointer.runId;
    throw error;
  }
  async function publish(request, containerId) {
    // Keep IDs compact while retaining enough random entropy to avoid collisions
    // between launches created during the same millisecond.
    const runId = `run-${Date.now()}-${randomBytes(3).toString("hex")}`;
    const taskId = `${runId}-task`;
    const createdUtc = new Date().toISOString();
    const runRoot = path.join(root, "runs", runId);
    const iterationNumber = 1;
    const iterationRoot = path.join(runRoot, "iterations", String(iterationNumber));
    const temporaryPointer = path.join(activeRoot, `${runId}.tmp`);
    const custom = request.executionMode === "custom";
    const runnerPath = custom ? `uploaded-runner.${request.runnerScriptLanguage === "python" ? "py" : "ps1"}` : null;
    const configPath = custom ? "uploaded-task-plan.json" : "task-plan.json";
    const task = {
      runId, taskId, status: "queued", createdUtc,
      taskType: custom ? "script_runner" : "task_sequence",
      runOptions: request.runOptions,
      payload: custom ? {
        runnerPath, configPath,
        runnerScriptLanguage: request.runnerScriptLanguage,
        runnerScriptName: request.runnerScriptName,
        configFileName: request.configFileName,
      } : request.plan,
    };
    const meta = {
      runId, taskId, testName: request.testName, executionMode: request.executionMode,
      taskType: task.taskType, status: "queued", createdUtc, updatedUtc: createdUtc,
      startedUtc: null, finishedUtc: null, containerId, runOptions: request.runOptions,
      settings: request.runOptions,
      iterationState: {
        total: request.runOptions.iterations,
        current: iterationNumber,
        completed: 0,
        failed: 0,
      },
      configFileName: request.configFileName, taskPlanPath: configPath,
      runnerScriptName: request.runnerScriptName || null,
      runnerScriptLanguage: request.runnerScriptLanguage || null,
      runnerScriptPath: runnerPath,
    };
    const iterationTask = {
      ...task,
      taskId: `${runId}-iteration-${iterationNumber}`,
      parentTaskId: taskId,
      iterationNumber,
      settings: request.runOptions,
    };
    // Publish iteration 1 as the active channel from the start. The guest agent
    // follows these paths verbatim, so screenshots and results must never point
    // at the run-level folders when execution is supervised by iteration.
    const pointer = {
      runId, iterationNumber, createdUtc, updatedUtc: createdUtc,
      channel: {
        taskPath: `runs/${runId}/iterations/${iterationNumber}/task.json`,
        resultPath: `runs/${runId}/iterations/${iterationNumber}/result.json`,
        logsDir: `runs/${runId}/iterations/${iterationNumber}/logs`,
        screenshotsDir: `runs/${runId}/iterations/${iterationNumber}/screenshots`,
        artifactsDir: `runs/${runId}/iterations/${iterationNumber}/artifacts`,
      },
    };
    const writeJson = (file, data) => io.writeFile(file, `${JSON.stringify(data, null, 2)}\n`, "utf8");
    try {
      await io.mkdir(activeRoot, { recursive: true });
      await io.mkdir(runRoot, { recursive: true });
      for (const directory of ["logs", "screenshots", "artifacts", "scripts"]) {
        await io.mkdir(path.join(runRoot, directory));
      }
      await io.mkdir(iterationRoot, { recursive: true });
      for (const directory of ["logs", "screenshots", "artifacts"]) {
        await io.mkdir(path.join(iterationRoot, directory));
      }
      // Sequential writes simplify rollback: no outstanding writes can recreate deleted files.
      await io.writeFile(path.join(runRoot, "uploaded-config.json"), request.configContent, "utf8");
      if (custom) {
        await io.writeFile(path.join(runRoot, runnerPath), request.runnerScriptContent, "utf8");
        await io.writeFile(path.join(runRoot, configPath), request.configContent, "utf8");
      } else {
        await writeJson(path.join(runRoot, configPath), request.plan);
      }
      await writeJson(path.join(runRoot, "meta.json"), meta);
      await writeJson(path.join(runRoot, "task.json"), task);
      await writeJson(path.join(iterationRoot, "task.json"), iterationTask);
      await io.writeFile(path.join(runRoot, "logs/task.log"), `[${createdUtc}] Run prepared for admission.\n`, "utf8");
      await writeJson(temporaryPointer, pointer);
      // Same-directory rename is the publication commit point. Never unlink the old pointer first.
      await publishPointer(temporaryPointer, pointerPath, { io });
    } catch (error) {
      await io.rm(temporaryPointer, { force: true }).catch(() => {});
      await io.rm(runRoot, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
    return { runId, containerId };
  }
  return { sharedRoot: root, assertAvailable, publish };
}

module.exports = { DEFAULT_SHARED_ROOT, createLaunchStore };