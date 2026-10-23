const { pruneOwnedCompletedRuns } = require("./runStore");

const RUN_CLEANUP_INTERVAL_MS = 60 * 1000;

//reports skipped and failed cleanup separately from lifecycle and startup work
function reportCleanupOutcome(event, details) {
  //keep cleanup diagnostics visible without changing lifecycle or startup results
  console.error(`RUN CLEANUP ${event}:`, details);
}

//runs shared cleanup at startup and on an interval without allowing overlapping passes
function createRunCleanupScheduler({
  prune = pruneOwnedCompletedRuns,
  getOptions = () => ({}),
  onCleanup = reportCleanupOutcome,
  setIntervalFn = setInterval,
  intervalMs = RUN_CLEANUP_INTERVAL_MS,
} = {}) {
  //hold the active promise so timer ticks cannot start a second cleanup pass
  let activeCleanup = null;

  //requests cleanup with the caller-provided safe scope and reports non-success outcomes
  async function runCleanup() {
    //skip later requests while the current pass still owns cleanup execution
    if (activeCleanup) {
      const skipped = {
        skipped: true,
        reason: "CLEANUP_ALREADY_RUNNING",
        removedRunIds: [],
        failedRunIds: [],
        deletionFailures: [],
      };
      onCleanup("SKIPPED", skipped);
      return skipped;
    }

    //defer execution so the guard is assigned before cleanup work can begin
    activeCleanup = Promise.resolve().then(async () => {
      try {
        //resolve scope for each pass so future ownership integration can supply current run ids
        const cleanup = await prune(getOptions());
        if (cleanup?.skipped || cleanup?.failedRunIds?.length || cleanup?.deletionFailures?.length) {
          //report fail-closed skips and deletion failures without turning them into scheduler failures
          onCleanup(cleanup?.skipped ? "SKIPPED" : "FAILED", cleanup);
        }
        return cleanup;
      } catch (error) {
        //convert unexpected errors into a reportable result so future interval passes can continue
        const failure = {
          skipped: false,
          reason: null,
          removedRunIds: [],
          failedRunIds: [],
          deletionFailures: [{
            code: error?.code || "CLEANUP_FAILED",
            message: error?.message || "Run cleanup failed.",
          }],
        };
        onCleanup("FAILED", failure);
        return failure;
      }
    });

    try {
      return await activeCleanup;
    } finally {
      //release the guard after every outcome so later passes can retry failed candidates
      activeCleanup = null;
    }
  }

  //starts an immediate non-blocking pass and schedules later passes with the same mechanism
  function start() {
    //do not await startup cleanup because backend availability must not depend on retention work
    void runCleanup();
    return setIntervalFn(() => {
      //reuse the guarded path so periodic cleanup cannot overlap the startup or prior pass
      void runCleanup();
    }, intervalMs);
  }

  return { runCleanup, start };
}

module.exports = {
  RUN_CLEANUP_INTERVAL_MS,
  createRunCleanupScheduler,
};