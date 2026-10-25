const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

async function createFixture(t) {
  //create and register an isolated shared root so each history test owns its storage
  const sharedRoot = await fs.mkdtemp(path.join(os.tmpdir(), "dockvision-history-"));
  const store = require("../lib/runStore");

  t.after(async () => {
    await fs.rm(sharedRoot, { recursive: true, force: true });
  });

  return { sharedRoot, store };
}

async function writeJson(filePath, value) {
  //create parent directories because fixtures model each run as an independent directory tree
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(value), "utf8");
}

async function writeTextFile(filePath, value) {
  //create parent directories for fixture files that do not contain JSON
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, value, "utf8");
}

//create a test-controlled promise for deterministic overlap checks
function createDeferred() {
  //control asynchronous deletion order without relying on timing delays
  let resolve;
  const promise = new Promise((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

async function pathExists(filePath) {
  //distinguish an expected missing path from an unexpected filesystem failure
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function writeTerminalRun(runsRoot, runId, finishedMs, options = {}) {
  //write matching metadata and result files to model a normally finalized aggregate run
  const finishedUtc = options.finishedUtc === undefined
    ? new Date(finishedMs).toISOString()
    : options.finishedUtc;
  const status = options.status || "completed";
  await Promise.all([
    writeJson(path.join(runsRoot, runId, "meta.json"), {
      runId,
      status,
      createdUtc: options.createdUtc || "2000-01-01T00:00:00.000Z",
      ...(finishedUtc === undefined ? {} : { finishedUtc }),
    }),
    writeJson(path.join(runsRoot, runId, "result.json"), {
      runId,
      status,
      ...(finishedUtc === undefined ? {} : { finishedUtc }),
    }),
  ]);
}

function terminalRecord(runId, finishedUtc, options = {}) {
  //build in-memory scoped records for pure retention selection tests without filesystem setup
  return {
    runId,
    status: options.status || "completed",
    active: options.active || false,
    indeterminate: options.indeterminate || false,
    finishedUtc,
  };
}

test("listRuns returns configured iteration counts with a legacy single-iteration fallback", async (t) => {
  const { sharedRoot, store } = await createFixture(t);
  const runsRoot = path.join(sharedRoot, "runs");

  await Promise.all([
    writeJson(path.join(runsRoot, "run-list-multi", "meta.json"), {
      runId: "run-list-multi",
      testName: "Multi Iteration Run",
      status: "running",
      iterationState: { total: 3, current: 2, completed: 1, failed: 0 },
    }),
    writeJson(path.join(runsRoot, "run-list-legacy", "task.json"), {
      runId: "run-list-legacy",
      status: "queued",
      runOptions: { iterations: 2 },
    }),
    writeJson(path.join(runsRoot, "run-list-default", "meta.json"), {
      runId: "run-list-default",
      status: "queued",
    }),
  ]);

  const runs = await store.listRuns({ sharedRoot });
  const iterationsByRunId = new Map(runs.map((run) => [run.runId, run.totalIterations]));

  assert.equal(iterationsByRunId.get("run-list-multi"), 3);
  assert.equal(iterationsByRunId.get("run-list-legacy"), 2);
  assert.equal(iterationsByRunId.get("run-list-default"), 1);
});

test("listRuns reads only from the supplied shared root", async (t) => {
  const { store } = await createFixture(t);
  const rootA = await fs.mkdtemp(path.join(os.tmpdir(), "dockvision-history-a-"));
  const rootB = await fs.mkdtemp(path.join(os.tmpdir(), "dockvision-history-b-"));

  t.after(async () => {
    await Promise.all([
      fs.rm(rootA, { recursive: true, force: true }),
      fs.rm(rootB, { recursive: true, force: true }),
    ]);
  });

  await Promise.all([
    writeJson(path.join(rootA, "runs", "run-a", "meta.json"), { status: "queued" }),
    writeJson(path.join(rootB, "runs", "run-b", "meta.json"), { status: "queued" }),
  ]);

  const runs = await store.listRuns({ sharedRoot: rootA });

  assert.deepEqual(runs.map((run) => run.runId), ["run-a"]);
  assert.equal(await pathExists(path.join(rootB, "runs", "run-b", "meta.json")), true);
});

test("listRuns resolves the active pointer from the supplied shared root", async (t) => {
  const { store } = await createFixture(t);
  const sharedRoot = await fs.mkdtemp(path.join(os.tmpdir(), "dockvision-history-active-"));

  t.after(() => fs.rm(sharedRoot, { recursive: true, force: true }));

  await Promise.all([
    writeJson(path.join(sharedRoot, "runs", "run-active", "meta.json"), { status: "running" }),
    writeJson(path.join(sharedRoot, "runs", "run-inactive", "meta.json"), { status: "queued" }),
    writeJson(path.join(sharedRoot, "active", "current-run.json"), { runId: "run-active" }),
  ]);

  const runs = await store.listRuns({ sharedRoot });
  const activeRun = runs.find((run) => run.runId === "run-active");
  const inactiveRun = runs.find((run) => run.runId === "run-inactive");

  assert.equal(activeRun?.active, true);
  assert.equal(inactiveRun?.active, false);
});

test("listRuns does not mark terminal runs active when a pointer lingers", async (t) => {
  const { sharedRoot, store } = await createFixture(t);
  const terminalStatuses = ["completed", "failed", "cancelled"];

  //create one run for each terminal aggregate status.
  await Promise.all(
    terminalStatuses.map((status) =>
      writeJson(path.join(sharedRoot, "runs", `run-${status}`, "meta.json"), {
        runId: `run-${status}`,
        status,
        finishedUtc: "2026-10-10T00:00:00.000Z",
      })
    )
  );

  for (const status of terminalStatuses) {
    //point at each terminal run to verify pointer presence does not set active.
    await writeJson(path.join(sharedRoot, "active", "current-run.json"), {
      runId: `run-${status}`,
    });

    const runs = await store.listRuns({ sharedRoot });
    assert.equal(runs.find((run) => run.runId === `run-${status}`)?.active, false);
  }
});

test("listRuns keeps a multi-iteration run active after an intermediate completion", async (t) => {
  const { sharedRoot, store } = await createFixture(t);
  const runId = "run-intermediate-completion";

  //the aggregate metadata remains running while later iterations are pending.
  await Promise.all([
    writeJson(path.join(sharedRoot, "runs", runId, "meta.json"), {
      runId,
      status: "running",
      iterationState: { total: 3, current: 2, completed: 1, failed: 0 },
    }),
    writeJson(path.join(sharedRoot, "runs", runId, "iterations", "1", "result.json"), {
      status: "completed",
    }),
    writeJson(path.join(sharedRoot, "active", "current-run.json"), {
      runId,
      iterationNumber: 2,
    }),
  ]);

  //the pointer still represents an active aggregate run after iteration one finishes.
  const runs = await store.listRuns({ sharedRoot });
  assert.equal(runs.find((run) => run.runId === runId)?.active, true);
});

test("listRuns recalculates active state after a terminal history refresh", async (t) => {
  const { sharedRoot, store } = await createFixture(t);
  const runId = "run-refresh-terminal";
  const metaPath = path.join(sharedRoot, "runs", runId, "meta.json");

  //start with a pointed aggregate run that is still in progress.
  await Promise.all([
    writeJson(metaPath, { runId, status: "running" }),
    writeJson(path.join(sharedRoot, "active", "current-run.json"), { runId }),
  ]);

  const runningRun = (await store.listRuns({ sharedRoot })).find((run) => run.runId === runId);
  assert.equal(runningRun?.active, true);

  //preserve the pointer while the aggregate metadata records terminal completion.
  await writeJson(metaPath, {
    runId,
    status: "completed",
    finishedUtc: "2026-10-10T00:00:00.000Z",
  });

  const completedRun = (await store.listRuns({ sharedRoot })).find((run) => run.runId === runId);
  assert.equal(completedRun?.active, false);
});

test("unscoped history cleanup skips deletion and preserves terminal runs", async (t) => {
  const { store } = await createFixture(t);
  const rootA = await fs.mkdtemp(path.join(os.tmpdir(), "dockvision-history-prune-a-"));
  const rootB = await fs.mkdtemp(path.join(os.tmpdir(), "dockvision-history-prune-b-"));

  t.after(async () => {
    await Promise.all([
      fs.rm(rootA, { recursive: true, force: true }),
      fs.rm(rootB, { recursive: true, force: true }),
    ]);
  });

  const finishedUtc = "2026-10-10T00:00:00.000Z";
  const completedRuns = Array.from({ length: 21 }, (_, index) => {
    const runId = `completed-${String(index).padStart(2, "0")}`;
    return writeJson(path.join(rootA, "runs", runId, "meta.json"), {
      runId,
      status: "completed",
      finishedUtc,
      createdUtc: finishedUtc,
    });
  });

  await Promise.all([
    ...completedRuns,
    writeJson(path.join(rootA, "runs", "active-run", "meta.json"), {
      runId: "active-run",
      status: "completed",
      finishedUtc,
      createdUtc: finishedUtc,
    }),
    writeJson(path.join(rootA, "active", "current-run.json"), { runId: "active-run" }),
    writeJson(path.join(rootB, "runs", "sentinel", "meta.json"), {
      runId: "sentinel",
      status: "completed",
      finishedUtc,
      createdUtc: finishedUtc,
    }),
  ]);

  const runs = await store.listRuns({ sharedRoot: rootA });
  const cleanup = await store.pruneCompletedRuns({ sharedRoot: rootA });

  const remainingRuns = await fs.readdir(path.join(rootA, "runs"));
  assert.equal(runs.length, 22);
  assert.deepEqual(cleanup, {
    skipped: true,
    reason: "OWNERSHIP_SCOPE_REQUIRED",
    removedRunIds: [],
    failedRunIds: [],
    deletionFailures: [],
  });
  assert.equal(remainingRuns.length, 22);
  assert.equal(await pathExists(path.join(rootA, "runs", "active-run")), true);
  assert.equal(await pathExists(path.join(rootB, "runs", "sentinel", "meta.json")), true);
});

test("scoped cleanup retains 29 terminal runs", async (t) => {
  const { sharedRoot, store } = await createFixture(t);
  const runsRoot = path.join(sharedRoot, "runs");
  const nowMs = Date.parse("2026-10-18T00:00:00.000Z");
  const runIds = Array.from({ length: 29 }, (_, index) => `run-29-${index}`);

  await Promise.all(runIds.map((runId, index) => (
    writeTerminalRun(runsRoot, runId, nowMs - index * 1000)
  )));

  //fail only the first candidate and allow the second deletion to reach the filesystem
  const cleanup = await store.pruneCompletedRuns({
    sharedRoot,
    runIds,
    now: () => nowMs,
  });

  assert.deepEqual(cleanup.removedRunIds, []);
  assert.equal((await fs.readdir(runsRoot)).length, 29);
});

test("scoped cleanup retains 30 terminal runs", async (t) => {
  const { sharedRoot, store } = await createFixture(t);
  const runsRoot = path.join(sharedRoot, "runs");
  const nowMs = Date.parse("2026-10-18T00:00:00.000Z");
  const runIds = Array.from({ length: 30 }, (_, index) => `run-30-${index}`);

  await Promise.all(runIds.map((runId, index) => (
    writeTerminalRun(runsRoot, runId, nowMs - index * 1000)
  )));

  const cleanup = await store.pruneCompletedRuns({
    sharedRoot,
    runIds,
    now: () => nowMs,
  });

  assert.deepEqual(cleanup.removedRunIds, []);
  assert.equal((await fs.readdir(runsRoot)).length, 30);
});

test("scoped cleanup removes the oldest valid completion when 31 terminal runs exist", async (t) => {
  const { sharedRoot, store } = await createFixture(t);
  const runsRoot = path.join(sharedRoot, "runs");
  const nowMs = Date.parse("2026-10-18T00:00:00.000Z");
  const runIds = Array.from({ length: 31 }, (_, index) => `run-${index}`);

  await Promise.all(runIds.map((runId, index) => (
    writeTerminalRun(runsRoot, runId, nowMs - index * 1000)
  )));

  const cleanup = await store.pruneCompletedRuns({
    sharedRoot,
    runIds,
    now: () => nowMs,
  });

  assert.deepEqual(cleanup.removedRunIds, ["run-30"]);
  assert.equal(await pathExists(path.join(runsRoot, "run-30")), false);
  assert.equal(await pathExists(path.join(runsRoot, "run-29")), true);
});

test("scoped cleanup expires terminal runs at the 720-hour completion boundary", async (t) => {
  const { sharedRoot, store } = await createFixture(t);
  const runsRoot = path.join(sharedRoot, "runs");
  const nowMs = Date.parse("2026-10-18T00:00:00.000Z");
  const hourMs = 60 * 60 * 1000;
  const runIds = ["run-boundary", "run-recent", "run-expired"];

  await Promise.all([
    writeTerminalRun(runsRoot, "run-boundary", nowMs - 720 * hourMs),
    writeTerminalRun(runsRoot, "run-recent", nowMs - 720 * hourMs + 1),
    writeTerminalRun(runsRoot, "run-expired", nowMs - 720 * hourMs - 1),
  ]);

  const cleanup = await store.pruneCompletedRuns({
    sharedRoot,
    runIds,
    now: () => nowMs,
  });

  assert.deepEqual(cleanup.removedRunIds.sort(), ["run-boundary", "run-expired"]);
  assert.equal(await pathExists(path.join(runsRoot, "run-recent")), true);
});

test("scoped cleanup preserves terminal runs without valid completion timestamps", async (t) => {
  const { sharedRoot, store } = await createFixture(t);
  const runsRoot = path.join(sharedRoot, "runs");
  const nowMs = Date.parse("2026-10-18T00:00:00.000Z");
  const validRunIds = Array.from({ length: 31 }, (_, index) => `run-valid-${index}`);
  const runIds = [...validRunIds, "run-invalid"];

  await Promise.all([
    ...validRunIds.map((runId, index) => (
      writeTerminalRun(runsRoot, runId, nowMs - index * 1000)
    )),
    writeTerminalRun(runsRoot, "run-invalid", nowMs, {
      finishedUtc: "not-a-timestamp",
      createdUtc: "2000-01-01T00:00:00.000Z",
    }),
  ]);

  const cleanup = await store.pruneCompletedRuns({
    sharedRoot,
    runIds,
    now: () => nowMs,
  });

  assert.deepEqual(cleanup.removedRunIds, ["run-valid-30"]);
  assert.equal(await pathExists(path.join(runsRoot, "run-invalid")), true);
});

//verify recursive cleanup stays inside the selected run directory
test("scoped cleanup removes every server-managed file from a selected run only", async (t) => {
  const { sharedRoot, store } = await createFixture(t);
  const runsRoot = path.join(sharedRoot, "runs");
  const nowMs = Date.parse("2026-10-18T00:00:00.000Z");
  const hourMs = 60 * 60 * 1000;
  const selectedRunId = "user-a-expired";
  const inScopeRecentRunId = "user-a-recent";
  const outOfScopeRunId = "user-b-expired";
  const externalExportPath = path.join(sharedRoot, "exports", `${selectedRunId}.zip`);

  await Promise.all([
    //write an age-eligible user-a run with every server-managed content category
    writeTerminalRun(runsRoot, selectedRunId, nowMs - 720 * hourMs),
    writeTerminalRun(runsRoot, inScopeRecentRunId, nowMs),
    writeTerminalRun(runsRoot, outOfScopeRunId, nowMs - 720 * hourMs),
    writeJson(path.join(runsRoot, selectedRunId, "task.json"), { runId: selectedRunId }),
    writeJson(path.join(runsRoot, selectedRunId, "task-plan.json"), { tasks: [] }),
    writeTextFile(path.join(runsRoot, selectedRunId, "inputs", "config.json"), "{}"),
    writeTextFile(path.join(runsRoot, selectedRunId, "scripts", "runner.py"), "print('run')"),
    writeTextFile(path.join(runsRoot, selectedRunId, "logs", "run.log"), "completed"),
    writeTextFile(path.join(runsRoot, selectedRunId, "screenshots", "screen.png"), "png"),
    writeTextFile(path.join(runsRoot, selectedRunId, "artifacts", "report.txt"), "report"),
    writeTextFile(path.join(runsRoot, selectedRunId, "iterations", "1", "result.json"), "{}"),
    writeTextFile(path.join(runsRoot, selectedRunId, "cancel-request.json"), "{}"),
    writeTextFile(externalExportPath, "exported copy"),
  ]);

  //scope cleanup to user-a fixture IDs and leave user-b outside that scope
  const cleanup = await store.pruneCompletedRuns({
    sharedRoot,
    runIds: [selectedRunId, inScopeRecentRunId],
    now: () => nowMs,
  });

  assert.deepEqual(cleanup.removedRunIds, [selectedRunId]);
  assert.equal(await pathExists(path.join(runsRoot, selectedRunId)), false);
  assert.equal(await pathExists(path.join(runsRoot, inScopeRecentRunId)), true);
  assert.equal(await pathExists(path.join(runsRoot, outOfScopeRunId)), true);
  assert.equal(await pathExists(externalExportPath), true);
});

//verify protected lifecycle records are never selected for deletion
test("scoped cleanup preserves active and contradictory terminal records", async (t) => {
  const { sharedRoot, store } = await createFixture(t);
  const runsRoot = path.join(sharedRoot, "runs");
  const nowMs = Date.parse("2026-10-18T00:00:00.000Z");
  const expiredUtc = new Date(nowMs - 720 * 60 * 60 * 1000).toISOString();
  const activeRunId = "active-terminal";
  const contradictoryRunId = "contradictory-terminal";

  await Promise.all([
    writeTerminalRun(runsRoot, activeRunId, nowMs - 720 * 60 * 60 * 1000),
    writeJson(path.join(sharedRoot, "active", "current-run.json"), { runId: activeRunId }),
    writeJson(path.join(runsRoot, contradictoryRunId, "meta.json"), {
      runId: contradictoryRunId,
      status: "completed",
      finishedUtc: expiredUtc,
    }),
    writeJson(path.join(runsRoot, contradictoryRunId, "result.json"), {
      runId: contradictoryRunId,
      status: "failed",
      finishedUtc: expiredUtc,
    }),
  ]);

  //submit both protected records so retention must exclude them by lifecycle state
  const cleanup = await store.pruneCompletedRuns({
    sharedRoot,
    runIds: [activeRunId, contradictoryRunId],
    now: () => nowMs,
  });

  assert.deepEqual(cleanup.removedRunIds, []);
  assert.equal(await pathExists(path.join(runsRoot, activeRunId)), true);
  assert.equal(await pathExists(path.join(runsRoot, contradictoryRunId)), true);
});

//verify one deletion failure does not prevent unrelated cleanup or a later retry
test("scoped cleanup reports deletion failures and retries the failed candidate later", async (t) => {
  const { sharedRoot, store } = await createFixture(t);
  const runsRoot = path.join(sharedRoot, "runs");
  const nowMs = Date.parse("2026-10-18T00:00:00.000Z");
  const runIds = ["expired-failure", "expired-success"];

  await Promise.all(runIds.map((runId) => (
    writeTerminalRun(runsRoot, runId, nowMs - 720 * 60 * 60 * 1000)
  )));

  //fail only the first candidate and allow the second deletion to reach the filesystem
  const cleanup = await store.pruneCompletedRuns({
    sharedRoot,
    runIds,
    now: () => nowMs,
    removeRun: async (runRoot, options) => {
      if (runRoot.endsWith("expired-failure")) {
        const error = new Error("fixture deletion failure");
        error.code = "EACCES";
        throw error;
      }
      return fs.rm(runRoot, options);
    },
  });

  assert.deepEqual(cleanup.removedRunIds, ["expired-success"]);
  assert.deepEqual(cleanup.failedRunIds, ["expired-failure"]);
  assert.deepEqual(cleanup.deletionFailures, [{
    runId: "expired-failure",
    code: "EACCES",
    message: "fixture deletion failure",
  }]);
  assert.equal(await pathExists(path.join(runsRoot, "expired-failure")), true);
  assert.equal(await pathExists(path.join(runsRoot, "expired-success")), false);

  //use the normal remover on the next scoped cleanup opportunity
  const retry = await store.pruneCompletedRuns({
    sharedRoot,
    runIds,
    now: () => nowMs,
  });

  assert.deepEqual(retry.removedRunIds, ["expired-failure"]);
  assert.deepEqual(retry.failedRunIds, []);
  assert.equal(await pathExists(path.join(runsRoot, "expired-failure")), false);
});

//verify overlapping scoped cleanups serialize filesystem deletion and converge safely
test("overlapping scoped cleanups serialize deletion and tolerate an already removed candidate", async (t) => {
  const { sharedRoot, store } = await createFixture(t);
  const runsRoot = path.join(sharedRoot, "runs");
  const nowMs = Date.parse("2026-10-18T00:00:00.000Z");
  const runIds = ["expired-first", "expired-second"];
  const firstDeletionStarted = createDeferred();
  const releaseFirstDeletion = createDeferred();
  let removeCalls = 0;

  await Promise.all(runIds.map((runId) => (
    writeTerminalRun(runsRoot, runId, nowMs - 720 * 60 * 60 * 1000)
  )));

  //hold the first deletion open while a second scoped cleanup joins the same queue
  const firstCleanup = store.pruneCompletedRuns({
    sharedRoot,
    runIds,
    now: () => nowMs,
    removeRun: async (runRoot, options) => {
      removeCalls += 1;
      if (removeCalls === 1) {
        firstDeletionStarted.resolve();
        await releaseFirstDeletion.promise;
      }
      return fs.rm(runRoot, options);
    },
  });

  await firstDeletionStarted.promise;
  const secondCleanup = store.pruneCompletedRuns({ sharedRoot, runIds, now: () => nowMs });
  const unscopedCleanup = await store.pruneCompletedRuns({ sharedRoot });

  assert.equal(removeCalls, 1);
  assert.equal(unscopedCleanup.skipped, true);
  assert.deepEqual(unscopedCleanup.removedRunIds, []);

  //release the first cleanup then confirm the queued call observes the final filesystem state
  releaseFirstDeletion.resolve();
  const [firstResult, secondResult] = await Promise.all([firstCleanup, secondCleanup]);

  assert.deepEqual(firstResult.removedRunIds, runIds);
  assert.deepEqual(secondResult.removedRunIds, []);
  assert.deepEqual(secondResult.failedRunIds, []);
  assert.equal(await pathExists(path.join(runsRoot, "expired-first")), false);
  assert.equal(await pathExists(path.join(runsRoot, "expired-second")), false);
});

//verify an externally removed selected directory is an idempotent cleanup outcome
test("scoped cleanup continues after a selected directory is already removed", async (t) => {
  const { sharedRoot, store } = await createFixture(t);
  const runsRoot = path.join(sharedRoot, "runs");
  const nowMs = Date.parse("2026-10-18T00:00:00.000Z");
  const runIds = ["expired-missing", "expired-remaining"];

  await Promise.all(runIds.map((runId) => (
    writeTerminalRun(runsRoot, runId, nowMs - 720 * 60 * 60 * 1000)
  )));

  //simulate a directory removed after selection while allowing the other candidate to delete
  const cleanup = await store.pruneCompletedRuns({
    sharedRoot,
    runIds,
    now: () => nowMs,
    removeRun: async (runRoot, options) => {
      if (runRoot.endsWith("expired-missing")) {
        const error = new Error("fixture directory was removed");
        error.code = "ENOENT";
        throw error;
      }
      return fs.rm(runRoot, options);
    },
  });

  assert.deepEqual(cleanup.removedRunIds, runIds);
  assert.deepEqual(cleanup.failedRunIds, []);
  assert.equal(await pathExists(path.join(runsRoot, "expired-remaining")), false);
});

test("retention selection uses run IDs to order equal completion timestamps deterministically", async (t) => {
  const { store } = await createFixture(t);
  const nowMs = Date.parse("2026-10-18T00:00:00.000Z");
  const finishedUtc = new Date(nowMs).toISOString();
  const records = Array.from({ length: 31 }, (_, index) => (
    terminalRecord(`run-${String(index).padStart(2, "0")}`, finishedUtc)
  ));

  const selectedRunIds = store.selectRunsForRetention(records, { now: () => nowMs });

  assert.deepEqual(selectedRunIds, ["run-30"]);
});

test("retention selection applies count eligibility without age eligibility", async (t) => {
  const { store } = await createFixture(t);
  const nowMs = Date.parse("2026-10-18T00:00:00.000Z");
  const records = Array.from({ length: 31 }, (_, index) => (
    terminalRecord(`count-only-${String(index).padStart(2, "0")}`, new Date(nowMs - index).toISOString())
  ));

  const selectedRunIds = store.selectRunsForRetention(records, { now: () => nowMs });

  assert.deepEqual(selectedRunIds, ["count-only-30"]);
});

test("retention selection applies age eligibility without count eligibility", async (t) => {
  const { store } = await createFixture(t);
  const nowMs = Date.parse("2026-10-18T00:00:00.000Z");
  const hourMs = 60 * 60 * 1000;
  const records = [
    terminalRecord("age-only", new Date(nowMs - 720 * hourMs).toISOString()),
    terminalRecord("recent", new Date(nowMs - 720 * hourMs + 1).toISOString()),
  ];

  const selectedRunIds = store.selectRunsForRetention(records, { now: () => nowMs });

  assert.deepEqual(selectedRunIds, ["age-only"]);
});

test("retention selection combines independent age and count eligibility", async (t) => {
  const { store } = await createFixture(t);
  const nowMs = Date.parse("2026-10-18T00:00:00.000Z");
  const hourMs = 60 * 60 * 1000;
  const recentRecords = Array.from({ length: 31 }, (_, index) => (
    terminalRecord(`recent-${String(index).padStart(2, "0")}`, new Date(nowMs - index).toISOString())
  ));
  const records = [
    ...recentRecords,
    terminalRecord("expired", new Date(nowMs - 720 * hourMs).toISOString()),
  ];

  const selectedRunIds = store.selectRunsForRetention(records, { now: () => nowMs });

  assert.deepEqual(selectedRunIds, ["recent-30", "expired"]);
});

test("retention selection excludes active and indeterminate records", async (t) => {
  const { store } = await createFixture(t);
  const nowMs = Date.parse("2026-10-18T00:00:00.000Z");
  const expiredUtc = new Date(nowMs - 720 * 60 * 60 * 1000).toISOString();
  const records = [
    terminalRecord("expired-terminal", expiredUtc),
    terminalRecord("active-terminal", expiredUtc, { active: true }),
    terminalRecord("indeterminate-terminal", expiredUtc, { indeterminate: true }),
    terminalRecord("running", expiredUtc, { status: "running" }),
    terminalRecord("missing-finished", null),
  ];

  const selectedRunIds = store.selectRunsForRetention(records, { now: () => nowMs });

  assert.deepEqual(selectedRunIds, ["expired-terminal"]);
});

test("retention selection keeps fixture-user scopes independent", async (t) => {
  const { store } = await createFixture(t);
  const nowMs = Date.parse("2026-10-18T00:00:00.000Z");
  const recordsForUserA = Array.from({ length: 31 }, (_, index) => (
    terminalRecord(`user-a-${String(index).padStart(2, "0")}`, new Date(nowMs - index).toISOString())
  ));
  const recordsForUserB = Array.from({ length: 30 }, (_, index) => (
    terminalRecord(`user-b-${String(index).padStart(2, "0")}`, new Date(nowMs - index).toISOString())
  ));

  const selectedForUserA = store.selectRunsForRetention(recordsForUserA, { now: () => nowMs });
  const selectedForUserB = store.selectRunsForRetention(recordsForUserB, { now: () => nowMs });

  assert.deepEqual(selectedForUserA, ["user-a-30"]);
  assert.deepEqual(selectedForUserB, []);
});