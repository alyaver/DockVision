const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createRunCleanupScheduler, RUN_CLEANUP_INTERVAL_MS } = require("../lib/runCleanupScheduler");

async function writeJson(filePath, value) {
  //create the fixture parent so callers can write independent persisted run files
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(value), "utf8");
}

async function createFixture(t) {
  //isolate each scheduler test from the repository shared root and other test cleanup queues
  const sharedRoot = await fs.mkdtemp(path.join(os.tmpdir(), "dockvision-cleanup-scheduler-"));
  const previousRoot = process.env.DOCKVISION_SHARED_ROOT;
  process.env.DOCKVISION_SHARED_ROOT = sharedRoot;
  const storePath = require.resolve("../lib/runStore");
  delete require.cache[storePath];
  const store = require("../lib/runStore");

  t.after(async () => {
    //restore module configuration and remove only the temporary storage owned by this test
    delete require.cache[storePath];
    if (previousRoot === undefined) delete process.env.DOCKVISION_SHARED_ROOT;
    else process.env.DOCKVISION_SHARED_ROOT = previousRoot;
    await fs.rm(sharedRoot, { recursive: true, force: true });
  });

  return { sharedRoot, store };
}

async function writeTerminalRun(sharedRoot, runId, finishedUtc, extra = {}) {
  //persist enough input and terminal state to verify deletion and preservation outcomes
  const runRoot = path.join(sharedRoot, "runs", runId);
  await fs.mkdir(path.join(runRoot, "artifacts"), { recursive: true });
  await Promise.all([
    writeJson(path.join(runRoot, "meta.json"), {
      runId,
      status: "completed",
      finishedUtc,
      ...extra.meta,
    }),
    writeJson(path.join(runRoot, "result.json"), {
      runId,
      status: "completed",
      finishedUtc,
      ...extra.result,
    }),
    fs.writeFile(path.join(runRoot, "uploaded-config.json"), "preserved input", "utf8"),
  ]);
}

//runs startup cleanup through the shared mechanism without guest or VM work
test("startup cleanup removes an expired scoped terminal run and preserves its neighbors", async (t) => {
  //use the exact boundary to prove startup cleanup delegates retention selection to the shared mechanism
  const { sharedRoot, store } = await createFixture(t);
  const nowMs = Date.parse("2026-10-18T00:00:00.000Z");
  const expiredRunId = "expired-startup";
  const recentRunId = "recent-startup";
  const activeRunId = "active-startup";
  const indeterminateRunId = "indeterminate-startup";

  await Promise.all([
    writeTerminalRun(sharedRoot, expiredRunId, new Date(nowMs - 720 * 60 * 60 * 1000).toISOString()),
    writeTerminalRun(sharedRoot, recentRunId, new Date(nowMs - 720 * 60 * 60 * 1000 + 1).toISOString()),
    writeTerminalRun(sharedRoot, activeRunId, new Date(nowMs - 720 * 60 * 60 * 1000).toISOString()),
    writeJson(path.join(sharedRoot, "runs", indeterminateRunId, "meta.json"), {
      runId: indeterminateRunId,
      status: "running",
      finishedUtc: new Date(nowMs - 720 * 60 * 60 * 1000).toISOString(),
    }),
    writeJson(path.join(sharedRoot, "active", "current-run.json"), { runId: activeRunId }),
  ]);

  const scheduler = createRunCleanupScheduler({
    prune: (options) => store.pruneCompletedRuns({ ...options, now: () => nowMs }),
    getOptions: () => ({ sharedRoot, runIds: [expiredRunId, recentRunId, activeRunId, indeterminateRunId] }),
    setIntervalFn: () => null,
  });

  const cleanup = await scheduler.runCleanup();
  assert.deepEqual(cleanup.removedRunIds, [expiredRunId]);
  const repeatedCleanup = await scheduler.runCleanup();
  assert.deepEqual(repeatedCleanup.removedRunIds, []);
  await assert.rejects(fs.access(path.join(sharedRoot, "runs", expiredRunId)), { code: "ENOENT" });
  await fs.access(path.join(sharedRoot, "runs", recentRunId, "uploaded-config.json"));
  await fs.access(path.join(sharedRoot, "runs", activeRunId, "uploaded-config.json"));
  await fs.access(path.join(sharedRoot, "runs", indeterminateRunId, "meta.json"));
});

//reuses the shared cleanup operation at the exact expiry boundary and across later retries
test("periodic cleanup uses a deterministic boundary and retries a failed deletion", async (t) => {
  //fail once at the filesystem boundary so the later scheduler pass proves retry behavior
  const { sharedRoot, store } = await createFixture(t);
  const nowMs = Date.parse("2026-10-18T00:00:00.000Z");
  const runId = "expired-retry";
  let attempts = 0;

  await writeTerminalRun(sharedRoot, runId, new Date(nowMs - 720 * 60 * 60 * 1000).toISOString());
  const scheduler = createRunCleanupScheduler({
    prune: (options) => store.pruneCompletedRuns({
      ...options,
      now: () => nowMs,
      removeRun: async (runRoot, removeOptions) => {
        attempts += 1;
        if (attempts === 1) throw new Error("temporary delete failure");
        return fs.rm(runRoot, removeOptions);
      },
    }),
    getOptions: () => ({ sharedRoot, runIds: [runId] }),
    onCleanup: () => {},
    setIntervalFn: () => null,
  });

  const failed = await scheduler.runCleanup();
  assert.deepEqual(failed.failedRunIds, [runId]);
  await fs.access(path.join(sharedRoot, "runs", runId));

  const retried = await scheduler.runCleanup();
  assert.deepEqual(retried.removedRunIds, [runId]);
  await assert.rejects(fs.access(path.join(sharedRoot, "runs", runId)), { code: "ENOENT" });
});

//expires persisted history from the registered periodic callback without any new terminal event
test("periodic cleanup expires a persisted run when the fake clock reaches 720 hours", async (t) => {
  //capture the scheduled callback so the test advances time without waiting for a real minute
  const { sharedRoot, store } = await createFixture(t);
  const boundaryMs = Date.parse("2026-10-18T00:00:00.000Z");
  const runId = "periodic-boundary";
  let nowMs = boundaryMs - 1;
  let intervalCallback;
  let startupComplete;
  let periodicComplete;
  const startupPass = new Promise((resolve) => { startupComplete = resolve; });
  const periodicPass = new Promise((resolve) => { periodicComplete = resolve; });
  let periodicRequested = false;

  await writeTerminalRun(sharedRoot, runId, new Date(boundaryMs - 720 * 60 * 60 * 1000).toISOString());
  const scheduler = createRunCleanupScheduler({
    prune: async (options) => {
      const cleanup = await store.pruneCompletedRuns({ ...options, now: () => nowMs });
      if (periodicRequested) periodicComplete(cleanup);
      else startupComplete(cleanup);
      return cleanup;
    },
    getOptions: () => ({ sharedRoot, runIds: [runId] }),
    setIntervalFn: (callback) => {
      intervalCallback = callback;
      return null;
    },
  });

  scheduler.start();
  const startupCleanup = await startupPass;
  assert.deepEqual(startupCleanup.removedRunIds, []);
  await fs.access(path.join(sharedRoot, "runs", runId, "uploaded-config.json"));

  nowMs = boundaryMs;
  periodicRequested = true;
  intervalCallback();
  const periodicCleanup = await periodicPass;
  assert.deepEqual(periodicCleanup.removedRunIds, [runId]);
  await assert.rejects(fs.access(path.join(sharedRoot, "runs", runId)), { code: "ENOENT" });
});

//starts one immediate pass and prevents a timer pass from overlapping it
test("periodic cleanup starts immediately, uses one-minute intervals, and skips overlap", async () => {
  //hold the first pass open so the captured interval callback attempts an overlapping pass
  let scheduledCallback;
  let scheduledInterval;
  let pruneCalls = 0;
  let releaseCleanup;
  const reports = [];
  const scheduler = createRunCleanupScheduler({
    prune: async () => {
      pruneCalls += 1;
      await new Promise((resolve) => {
        releaseCleanup = resolve;
      });
      return { skipped: false, removedRunIds: [], failedRunIds: [], deletionFailures: [] };
    },
    onCleanup: (event, details) => reports.push({ event, details }),
    setIntervalFn: (callback, interval) => {
      scheduledCallback = callback;
      scheduledInterval = interval;
      return null;
    },
  });

  scheduler.start();
  await new Promise((resolve) => setImmediate(resolve));
  scheduledCallback();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(scheduledInterval, RUN_CLEANUP_INTERVAL_MS);
  assert.equal(pruneCalls, 1);
  assert.deepEqual(reports.map((report) => report.details.reason), ["CLEANUP_ALREADY_RUNNING"]);

  releaseCleanup();
  await new Promise((resolve) => setImmediate(resolve));
});

//keeps production-style unscoped cleanup non-destructive while reporting the skip
test("unscoped startup and periodic cleanup report skips without deleting terminal history", async (t) => {
  //omit run ids to model production until task 317 provides a safe ownership scope
  const { sharedRoot, store } = await createFixture(t);
  const runId = "unscoped-terminal";
  const reports = [];
  await writeTerminalRun(sharedRoot, runId, "2000-01-01T00:00:00.000Z");

  const scheduler = createRunCleanupScheduler({
    prune: (options) => store.pruneCompletedRuns({ ...options, sharedRoot }),
    onCleanup: (event, details) => reports.push({ event, details }),
    setIntervalFn: () => null,
  });

  const first = await scheduler.runCleanup();
  const second = await scheduler.runCleanup();
  assert.equal(first.reason, "OWNERSHIP_SCOPE_REQUIRED");
  assert.equal(second.reason, "OWNERSHIP_SCOPE_REQUIRED");
  await fs.access(path.join(sharedRoot, "runs", runId, "uploaded-config.json"));
  assert.deepEqual(reports.map((report) => report.event), ["SKIPPED", "SKIPPED"]);
});