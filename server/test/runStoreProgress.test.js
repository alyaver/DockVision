const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

async function createFixture(t) {
  const sharedRoot = await fs.mkdtemp(path.join(os.tmpdir(), "dockvision-progress-"));
  const previousSharedRoot = process.env.DOCKVISION_SHARED_ROOT;
  process.env.DOCKVISION_SHARED_ROOT = sharedRoot;

  const runStorePath = require.resolve("../lib/runStore");
  delete require.cache[runStorePath];
  const store = require("../lib/runStore");

  t.after(async () => {
    delete require.cache[runStorePath];
    if (previousSharedRoot === undefined) {
      delete process.env.DOCKVISION_SHARED_ROOT;
    } else {
      process.env.DOCKVISION_SHARED_ROOT = previousSharedRoot;
    }
    await fs.rm(sharedRoot, { recursive: true, force: true });
  });

  return { sharedRoot, store };
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(value), "utf8");
}

function pointerFor(runId, iterationNumber) {
  return {
    runId,
    iterationNumber,
    channel: {
      taskPath: `runs/${runId}/iterations/${iterationNumber}/task.json`,
      resultPath: `runs/${runId}/iterations/${iterationNumber}/result.json`,
      logsDir: `runs/${runId}/iterations/${iterationNumber}/logs`,
      screenshotsDir: `runs/${runId}/iterations/${iterationNumber}/screenshots`,
      artifactsDir: `runs/${runId}/iterations/${iterationNumber}/artifacts`,
    },
  };
}

test("readRun maps iteration metadata and custom result steps into progress", async (t) => {
  const { sharedRoot, store } = await createFixture(t);
  const runId = "run-progress-custom";
  const runRoot = path.join(sharedRoot, "runs", runId);
  const iterationRoot = path.join(runRoot, "iterations", "2");

  await Promise.all([
    writeJson(path.join(runRoot, "meta.json"), {
      runId,
      executionMode: "custom",
      status: "completed",
      iterationState: { total: 2, current: 2, completed: 2, failed: 0 },
    }),
    writeJson(path.join(runRoot, "task.json"), { runId, status: "queued" }),
    writeJson(path.join(iterationRoot, "task.json"), { runId, status: "completed", iterationNumber: 2 }),
    // Custom runners publish their step collection at the result root.
    writeJson(path.join(iterationRoot, "result.json"), {
      status: "completed",
      steps: [
        { id: "open", status: "completed" },
        { id: "type", status: "completed" },
        { id: "verify", status: "failed" },
      ],
    }),
  ]);

  const run = await store.readRun(runId);

  assert.equal(run.executionMode, "custom");
  assert.deepEqual(run.progress, {
    currentIteration: 2,
    totalIterations: 2,
    completedIterations: 2,
    currentStepNumber: 3,
    totalSteps: 3,
    completedSteps: 2,
    currentStepId: "verify",
  });
  assert.equal(run.paths.resultPath, path.join(iterationRoot, "result.json"));
});

test("readRun supports built-in details.steps on the active iteration", async (t) => {
  const { sharedRoot, store } = await createFixture(t);
  const runId = "run-progress-builtin";
  const runRoot = path.join(sharedRoot, "runs", runId);
  const iterationRoot = path.join(runRoot, "iterations", "1");

  await Promise.all([
    writeJson(path.join(runRoot, "meta.json"), {
      runId,
      executionMode: "builtin",
      status: "running",
      iterationState: { total: 3, current: 1, completed: 0, failed: 0 },
    }),
    writeJson(path.join(runRoot, "task.json"), { runId, status: "queued" }),
    writeJson(path.join(iterationRoot, "task.json"), { runId, status: "running", iterationNumber: 1 }),
    // Built-in result producers may nest the same telemetry under details.
    writeJson(path.join(iterationRoot, "result.json"), {
      status: "running",
      details: { steps: [{ id: "click", status: "completed" }] },
    }),
    writeJson(path.join(sharedRoot, "active", "current-run.json"), pointerFor(runId, 1)),
  ]);

  const run = await store.readRun(runId);

  assert.equal(run.activeIterationNumber, 1);
  assert.deepEqual(run.progress, {
    currentIteration: 1,
    totalIterations: 3,
    completedIterations: 0,
    currentStepNumber: 1,
    totalSteps: 1,
    completedSteps: 1,
    currentStepId: "click",
  });
});

test("readRun keeps a completed intermediate iteration non-terminal", async (t) => {
  const { sharedRoot, store } = await createFixture(t);
  const runId = "run-progress-between-iterations";
  const runRoot = path.join(sharedRoot, "runs", runId);
  const iterationRoot = path.join(runRoot, "iterations", "2");

  await Promise.all([
    // Reproduce metadata corrupted by the former read path: iteration 2 has a
    // success result, but only one of three iterations was durably counted.
    writeJson(path.join(runRoot, "meta.json"), {
      runId,
      status: "completed",
      finishedUtc: "2026-10-10T17:07:31.000Z",
      settings: { iterations: 3 },
      iterationState: { total: 3, current: 2, completed: 1, failed: 0 },
    }),
    writeJson(path.join(runRoot, "task.json"), {
      runId,
      status: "queued",
      runOptions: { iterations: 3 },
    }),
    writeJson(path.join(iterationRoot, "task.json"), {
      runId,
      status: "completed",
      iterationNumber: 2,
    }),
    writeJson(path.join(iterationRoot, "result.json"), {
      status: "completed",
      finishedUtc: "2026-10-10T17:07:31.000Z",
    }),
    writeJson(path.join(sharedRoot, "active", "current-run.json"), pointerFor(runId, 2)),
  ]);

  const run = await store.readRun(runId);
  const persistedMeta = JSON.parse(await fs.readFile(path.join(runRoot, "meta.json"), "utf8"));

  assert.equal(run.status, "running");
  assert.equal(run.finishedUtc, null);
  assert.equal(run.progress.completedIterations, 1);
  assert.equal(persistedMeta.status, "running");
  assert.equal(persistedMeta.finishedUtc, null);
});

test("requestRunCancellation accepts an incomplete sequence whose current iteration completed", async (t) => {
  const { sharedRoot, store } = await createFixture(t);
  const runId = "run-progress-cancel-between-iterations";
  const runRoot = path.join(sharedRoot, "runs", runId);
  const iterationRoot = path.join(runRoot, "iterations", "2");

  await Promise.all([
    writeJson(path.join(runRoot, "meta.json"), {
      runId,
      status: "completed",
      settings: { iterations: 3 },
      iterationState: { total: 3, current: 2, completed: 1, failed: 0 },
    }),
    writeJson(path.join(runRoot, "task.json"), { runId, status: "queued" }),
    writeJson(path.join(iterationRoot, "task.json"), {
      runId,
      status: "completed",
      iterationNumber: 2,
    }),
    writeJson(path.join(iterationRoot, "result.json"), { status: "completed" }),
    writeJson(path.join(sharedRoot, "active", "current-run.json"), pointerFor(runId, 2)),
  ]);

  const run = await store.requestRunCancellation(runId);
  const cancellation = JSON.parse(await fs.readFile(path.join(runRoot, "cancel-request.json"), "utf8"));

  assert.equal(run.status, "cancelling");
  assert.equal(cancellation.runId, runId);
  assert.equal(cancellation.status, "requested");
});

test("readRun preserves aggregate cancellation after the current iteration completed", async (t) => {
  const { sharedRoot, store } = await createFixture(t);
  const runId = "run-progress-cancelled-five-of-seven";
  const runRoot = path.join(sharedRoot, "runs", runId);
  const iterationRoot = path.join(runRoot, "iterations", "5");
  const finishedUtc = "2026-10-10T11:21:22.712Z";

  await Promise.all([
    // A cancellation boundary may be reached after iteration 5 succeeds. The
    // completed iteration result must not reopen the intentionally shortened run.
    writeJson(path.join(runRoot, "meta.json"), {
      runId,
      status: "cancelled",
      finishedUtc,
      settings: { iterations: 7 },
      iterationState: { total: 7, current: 5, completed: 5, failed: 0 },
    }),
    writeJson(path.join(runRoot, "task.json"), { runId, status: "queued" }),
    writeJson(path.join(iterationRoot, "task.json"), {
      runId,
      status: "completed",
      iterationNumber: 5,
    }),
    writeJson(path.join(iterationRoot, "result.json"), { status: "completed" }),
    writeJson(path.join(sharedRoot, "active", "current-run.json"), pointerFor(runId, 5)),
  ]);

  const run = await store.readRun(runId);
  const persistedMeta = JSON.parse(await fs.readFile(path.join(runRoot, "meta.json"), "utf8"));

  assert.equal(run.status, "cancelled");
  assert.equal(run.finishedUtc, finishedUtc);
  assert.equal(persistedMeta.status, "cancelled");
  assert.equal(persistedMeta.finishedUtc, finishedUtc);
});

test("readRun leaves step fields unknown when no step telemetry exists", async (t) => {
  const { sharedRoot, store } = await createFixture(t);
  const runId = "run-progress-no-steps";
  const runRoot = path.join(sharedRoot, "runs", runId);
  const iterationRoot = path.join(runRoot, "iterations", "1");

  await Promise.all([
    writeJson(path.join(runRoot, "meta.json"), {
      runId,
      status: "running",
      settings: { iterations: 4 },
      iterationState: { total: 4, current: 1, completed: 0, failed: 0 },
    }),
    writeJson(path.join(runRoot, "task.json"), { runId, status: "queued" }),
    writeJson(path.join(iterationRoot, "task.json"), { runId, status: "running", iterationNumber: 1 }),
    writeJson(path.join(sharedRoot, "active", "current-run.json"), pointerFor(runId, 1)),
  ]);

  const run = await store.readRun(runId);

  // Missing telemetry must remain unknown rather than implying zero work.
  assert.deepEqual(run.progress, {
    currentIteration: 1,
    totalIterations: 4,
    completedIterations: 0,
    currentStepNumber: null,
    totalSteps: null,
    completedSteps: null,
    currentStepId: null,
  });
});

test("readRun ignores a stale root result when iteration metadata exists", async (t) => {
  const { sharedRoot, store } = await createFixture(t);
  const runId = "run-progress-stale-root";
  const runRoot = path.join(sharedRoot, "runs", runId);
  const iterationRoot = path.join(runRoot, "iterations", "2");

  await Promise.all([
    writeJson(path.join(runRoot, "meta.json"), {
      runId,
      status: "completed",
      iterationState: { total: 2, current: 2, completed: 2, failed: 0 },
    }),
    writeJson(path.join(runRoot, "task.json"), { runId, status: "queued" }),
    // This legacy result intentionally conflicts with iteration 2. Metadata
    // must keep historical reads on the canonical iteration-scoped result.
    writeJson(path.join(runRoot, "result.json"), {
      status: "failed",
      steps: [{ id: "stale", status: "failed" }],
    }),
    writeJson(path.join(iterationRoot, "task.json"), { runId, status: "completed", iterationNumber: 2 }),
    writeJson(path.join(iterationRoot, "result.json"), {
      status: "completed",
      steps: [{ id: "latest", status: "completed" }],
    }),
  ]);

  const run = await store.readRun(runId);

  assert.equal(run.status, "completed");
  assert.equal(run.progress.currentStepId, "latest");
  assert.equal(run.result.steps[0].id, "latest");
});