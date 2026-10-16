const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

async function createFixture(t) {
  const sharedRoot = await fs.mkdtemp(path.join(os.tmpdir(), "dockvision-history-"));
  const store = require("../lib/runStore");

  t.after(async () => {
    await fs.rm(sharedRoot, { recursive: true, force: true });
  });

  return { sharedRoot, store };
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(value), "utf8");
}

async function pathExists(filePath) {
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

test("listRuns prunes only the supplied shared root and preserves its active run", async (t) => {
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

  await store.listRuns({ sharedRoot: rootA });

  const remainingRuns = await fs.readdir(path.join(rootA, "runs"));
  assert.equal(remainingRuns.length, 21);
  assert.equal(await pathExists(path.join(rootA, "runs", "active-run")), true);
  assert.equal(await pathExists(path.join(rootB, "runs", "sentinel", "meta.json")), true);
});