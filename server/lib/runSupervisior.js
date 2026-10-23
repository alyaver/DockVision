const fs = require("fs/promises");

const {
  readRun,
  ensureIterationLayout,
  updateMetaFile,
  appendRunLog,
  buildIterationRunPointer,
  writeCurrentRunPointer,
  readCancellationRequest,
  pruneOwnedCompletedRuns,
} = require("./runStore");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildIterationTask(run, iterationNumber) {
  return {
    runId: run.runId,
    taskId: `${run.runId}-iteration-${iterationNumber}`,
    parentTaskId: `${run.runId}-task`,
    iterationNumber,

    taskType: run.task.taskType,
    status: "queued",

    createdUtc: new Date().toISOString(),

    settings: run.settings,
    runOptions: run.task?.runOptions || run.settings,
    payload: run.task.payload,
  };
}

async function waitForIterationResult(iterationPaths) {
  // The guest may create or replace the result while it is being observed.
  // Retry missing, empty, or temporarily incomplete JSON, but surface other
  // filesystem failures because they cannot be resolved by continued polling.
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

//reports cleanup outcomes separately so terminal lifecycle persistence remains successful
function reportCleanupOutcome(event, details) {
  console.error(`RUN CLEANUP ${event}:`, details);
}

//supervises aggregate iterations and requests fail-closed cleanup after terminal state is durable
async function superviseRun(runId, {
  prune = pruneOwnedCompletedRuns,
  onCleanup = reportCleanupOutcome,
} = {}) {
  const run = await readRun(runId);

  if (!run) {
    throw new Error(`Run '${runId}' was not found.`);
  }

  const settings =
    run.task?.runOptions ||
    run.task?.settings ||
    run.settings ||
    {};

  const totalIterations =
    Number(settings.iterations) || 1;
  const completedIterations = Number(run.iterationState?.completed);
  // completed is a durable count, so completed + 1 is the first iteration that
  // may still need observation or publication after a backend restart. If its
  // result already exists, waitForIterationResult consumes it idempotently.
  const firstIncompleteIteration =
    Number.isInteger(completedIterations) && completedIterations >= 0
      ? Math.min(completedIterations + 1, totalIterations + 1)
      : 1;

  await appendRunLog(
    runId,
    `Supervisor starting ${totalIterations} iteration(s).`
  );

  //tracks whether this invocation persisted an aggregate terminal state before requesting cleanup
  let terminal = false;

  for (
    let iterationNumber = firstIncompleteIteration;
    iterationNumber <= totalIterations;
    iterationNumber += 1
  ) {
    // Cancellation can arrive after one iteration writes its result but before
    // the supervisor publishes the next pointer. Honor the durable request at
    // that boundary so no additional guest work becomes visible.
    const cancellationRequest = await readCancellationRequest(runId);
    if (cancellationRequest?.status === "requested") {
      await updateMetaFile(runId, {
        status: "cancelled",
        finishedUtc: new Date().toISOString(),
      });
      await appendRunLog(
        runId,
        `Cancellation applied before iteration ${iterationNumber} was published.`
      );
      terminal = true;
      break;
    }

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

    // Admission publishes iteration 1 atomically with the run. Rewriting that
    // task here could race with the guest after it observes the active pointer.
    // Later iterations are owned and published by the supervisor as usual.
    const alreadyPublished = run.activeIterationNumber === iterationNumber;

    if (!alreadyPublished) {
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
    }

    // Record the selected iteration before publishing a later pointer so API
    // readers use the same iteration-scoped task, result, logs, and artifacts.
    await updateMetaFile(runId, {
      status: "running",
      finishedUtc: null,
      iterationState: {
        total: totalIterations,
        current: iterationNumber,
        completed: iterationNumber - 1,
        failed: 0,
      },
    });

    if (!alreadyPublished) {
      const pointer =
        buildIterationRunPointer(
          runId,
          run.createdUtc,
          iterationNumber,
          iterationPaths
        );

      await writeCurrentRunPointer(pointer);
    }

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
      // Only successful iterations contribute to completed. Any other terminal
      // result stops the sequence and leaves remaining iterations unpublished.
      await updateMetaFile(runId, {
        status: iterationResult.status,
        finishedUtc: iterationResult.finishedUtc || new Date().toISOString(),
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

      terminal = true;
      break;
    }

    await updateMetaFile(runId, {
      // Intermediate success advances progress but is not an aggregate terminal
      // state. Only the final requested iteration supplies completed/finishedUtc.
      status: iterationNumber === totalIterations ? "completed" : "running",
      finishedUtc:
        iterationNumber === totalIterations
          ? iterationResult.finishedUtc || new Date().toISOString()
          : null,
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

    terminal = iterationNumber === totalIterations;
  }

  if (!terminal) {
    return;
  }

  try {
    //requests shared cleanup without an ownership scope so destructive work remains skipped in production
    const cleanup = await prune();
    if (cleanup?.skipped || cleanup?.failedRunIds?.length || cleanup?.deletionFailures?.length) {
      //reports skipped or failed cleanup without changing the already persisted terminal result
      onCleanup(cleanup?.skipped ? "SKIPPED" : "FAILED", cleanup);
    }
  } catch (error) {
    //keeps cleanup exceptions separate from successful terminal lifecycle handling
    onCleanup("FAILED", {
      code: error?.code || "CLEANUP_FAILED",
      message: error?.message || "Terminal cleanup failed.",
    });
  }
}

module.exports = {
  superviseRun,
};