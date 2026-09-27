const fs = require("fs/promises");

const {
  readRun,
  ensureIterationLayout,
  updateMetaFile,
  appendRunLog,
  buildIterationRunPointer,
  writeCurrentRunPointer,
} = require("./runStore");

function sleep(ms) {                                                    //helpful for iterations and file managment 
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildIterationTask(run, iterationNumber) {
  return {
    runId: run.runId,
    taskId: `${run.runId}-iteration-${iterationNumber}`,
    parentTaskId: run.taskId,
    iterationNumber,

    taskType: run.task.taskType,
    status: "queued",

    createdUtc: new Date().toISOString(),

    settings: run.settings,
    payload: run.task.payload,
  };
}

async function waitForIterationResult(iterationPaths) {
  while (true) {
    try {
      const raw = await fs.readFile(iterationPaths.resultPath, "utf8");
      const normalized = raw.replace(/^\uFEFF/, "").trim();

      if (normalized) {
        try {
          return JSON.parse(normalized);
        } catch {
          await sleep(250);
          continue;
        }
      }
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
    }

    await sleep(250);
  }
}

async function superviseRun(runId) {
  const run = await readRun(runId);

  if (!run) {
    throw new Error(`Run '${runId}' was not found.`);
  }

  const settings =
    run.task?.settings ||
    run.settings ||
    {};

  const totalIterations =
    Number(settings.iterations) || 1;

  await appendRunLog(
    runId,
    `Supervisor starting ${totalIterations} iteration(s).`
  );

  for (
    let iterationNumber = 1;
    iterationNumber <= totalIterations;
    iterationNumber += 1
  ) {
    const iterationPaths =
      await ensureIterationLayout(
        runId,
        iterationNumber
      );

    const iterationTask =
      buildIterationTask(
        run,
        iterationNumber
      );

    await fs.writeFile(
      iterationPaths.taskPath,
      `${JSON.stringify(iterationTask, null, 2)}\n`,
      "utf8"
    );

await appendRunLog(runId, `Iteration ${iterationNumber} task written to ${iterationPaths.taskPath}.`);

const taskExists = await fs.access(iterationPaths.taskPath).then(() => true).catch(() => false);

if (!taskExists) {
  throw new Error(`Iteration ${iterationNumber} task file was not created at ${iterationPaths.taskPath}.`);
}

    await updateMetaFile(runId, {
      iterationState: {
        total: totalIterations,
        current: iterationNumber,
        completed: iterationNumber - 1,
        failed: 0,
      },
    });

    const pointer =
      buildIterationRunPointer(
        runId,
        run.createdUtc,
        iterationNumber,
        iterationPaths
      );

    await writeCurrentRunPointer(pointer);

    await appendRunLog(
      runId,
      `Starting iteration ${iterationNumber} of ${totalIterations}.`
    );

    const iterationResult =
      await waitForIterationResult(
        iterationPaths
      );

    if (
      iterationResult.status !==
      "completed"
    ) {
      await updateMetaFile(runId, {
        iterationState: {
          total: totalIterations,
          current: iterationNumber,
          completed: iterationNumber - 1,
          failed: 1,
        },
      });

      await appendRunLog(
        runId,
        `Iteration ${iterationNumber} failed. Stopping remaining iterations.`
      );

      break;
    }

    await updateMetaFile(runId, {
      iterationState: {
        total: totalIterations,
        current: iterationNumber,
        completed: iterationNumber,
        failed: 0,
      },
    });

    await appendRunLog(
      runId,
      `Iteration ${iterationNumber} completed successfully.`
    );
  }
}

module.exports = {
  superviseRun,
};