const fs = require("fs/promises");
const path = require("path");
const { randomUUID } = require("crypto");
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
    let records;
    try {
      records = await Promise.all(["meta.json", "task.json", "result.json"].map((name) => readJson(path.join(runRoot, name))));
    } catch {
      const error = new LaunchError(409, "ACTIVE_RUN_STATE_INVALID", "Active-run records are unreadable. Recovery is required.");
      error.activeRunId = pointer.runId;
      throw error;
    }
    const [meta, task, result] = records;
    // A final result is authoritative. Before that, any nonterminal record blocks.
    // Admission never repairs, cancels, or replaces in-flight work.
    if (terminal.has(result?.status)) return;
    if (!result && meta && task && terminal.has(meta.status) && meta.status === task.status) return;
    const error = new LaunchError(409, "RUN_ACTIVE", `Run '${pointer.runId}' is active or awaiting recovery.`);
    error.activeRunId = pointer.runId;
    throw error;
  }
  async function publish(request, containerId) {
    const runId = `run-${Date.now()}-${randomUUID()}`;
    const taskId = `${runId}-task`;
    const createdUtc = new Date().toISOString();
    const runRoot = path.join(root, "runs", runId);
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
      configFileName: request.configFileName, taskPlanPath: configPath,
      runnerScriptName: request.runnerScriptName || null,
      runnerScriptLanguage: request.runnerScriptLanguage || null,
      runnerScriptPath: runnerPath,
    };
    const pointer = {
      runId, createdUtc, updatedUtc: createdUtc,
      channel: {
        taskPath: `runs/${runId}/task.json`, resultPath: `runs/${runId}/result.json`,
        logsDir: `runs/${runId}/logs`, screenshotsDir: `runs/${runId}/screenshots`,
        artifactsDir: `runs/${runId}/artifacts`,
      },
    };
    const writeJson = (file, data) => io.writeFile(file, `${JSON.stringify(data, null, 2)}\n`, "utf8");
    try {
      await io.mkdir(activeRoot, { recursive: true });
      await io.mkdir(runRoot, { recursive: true });
      for (const directory of ["logs", "screenshots", "artifacts", "scripts"]) {
        await io.mkdir(path.join(runRoot, directory));
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