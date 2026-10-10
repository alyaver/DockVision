const {
  readCurrentRunPointer,
  readRun,
  isTerminalStatus,
} = require("./runStore");
const { superviseRun } = require("./runSupervisior");

async function resumeActiveRun({
  readPointer = readCurrentRunPointer,
  read = readRun,
  supervise = superviseRun,
  onError = (error) => console.error("RUN RECOVERY ERROR:", error),
} = {}) {
  // Recovery is intentionally pointer-led: only the run currently published to
  // the guest can be resumed automatically. Historical runs are never replayed.
  const pointer = await readPointer();
  if (!pointer?.runId || !Number.isInteger(Number(pointer.iterationNumber))) {
    return null;
  }

  const run = await read(pointer.runId);
  if (!run || isTerminalStatus(run.status)) {
    return null;
  }

  const totalIterations = Number(run.iterationState?.total);
  const completedIterations = Number(run.iterationState?.completed);
  // Fail closed on missing or contradictory progress. Automatic recovery is
  // safe only when a persisted count identifies at least one remaining iteration.
  if (
    !Number.isInteger(totalIterations) ||
    totalIterations < 1 ||
    !Number.isInteger(completedIterations) ||
    completedIterations < 0 ||
    completedIterations >= totalIterations
  ) {
    return null;
  }

  // Do not await the long-running supervisor during server startup; route setup
  // and health checks must remain available while recovery continues in-process.
  supervise(run.runId).catch(onError);
  return run.runId;
}

module.exports = { resumeActiveRun };