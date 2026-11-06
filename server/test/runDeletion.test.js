const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const express = require("express");
const { createRunAccessRouter } = require("../routes/RunAccessRoutes");

async function createFixture(t) {
  //load the store against a temporary root so deletion tests never reach the vm share
  const sharedRoot = await fs.mkdtemp(path.join(os.tmpdir(), "dockvision-delete-run-"));
  const previousRoot = process.env.DOCKVISION_SHARED_ROOT;
  process.env.DOCKVISION_SHARED_ROOT = sharedRoot;
  const storePath = require.resolve("../lib/runStore");
  delete require.cache[storePath];
  const store = require("../lib/runStore");

  t.after(async () => {
    //restore process configuration and remove only storage owned by this fixture
    delete require.cache[storePath];
    if (previousRoot === undefined) delete process.env.DOCKVISION_SHARED_ROOT;
    else process.env.DOCKVISION_SHARED_ROOT = previousRoot;
    await fs.rm(sharedRoot, { recursive: true, force: true });
  });

  return { sharedRoot, store };
}

async function writeJson(filePath, value) {
  //create independent persisted fixture files without relying on run creation or guest work
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(value), "utf8");
}

async function writeRun(sharedRoot, runId, {
  metaStatus = "completed",
  resultStatus = metaStatus,
  finishedUtc = "2026-10-01T00:00:00.000Z",
} = {}) {
  //write server-managed inputs and artifacts so recursive deletion is tested at the run boundary
  const runRoot = path.join(sharedRoot, "runs", runId);
  await fs.mkdir(path.join(runRoot, "artifacts"), { recursive: true });
  await Promise.all([
    writeJson(path.join(runRoot, "meta.json"), { runId, status: metaStatus, finishedUtc }),
    writeJson(path.join(runRoot, "task.json"), { runId, status: metaStatus }),
    writeJson(path.join(runRoot, "result.json"), { runId, status: resultStatus, finishedUtc }),
    fs.writeFile(path.join(runRoot, "uploaded-config.json"), "submitted configuration", "utf8"),
    fs.writeFile(path.join(runRoot, "artifacts", "result.txt"), "artifact", "utf8"),
  ]);
}

async function pathExists(filePath) {
  //make expected missing run directories distinct from unexpected filesystem errors
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

function createDeferred() {
  //control concurrent removal order without timing-dependent waits
  let resolve;
  const promise = new Promise((nextResolve) => { resolve = nextResolve; });
  return { promise, resolve };
}

//verifies deletion stays limited to one terminal run and its server-managed artifacts
test("internal deletion removes exactly one terminal run and preserves external exports", async (t) => {
  //keep another run and an export outside runs to prove the selected boundary is exact
  const { sharedRoot, store } = await createFixture(t);
  const selectedRunId = "run-delete-selected";
  const otherRunId = "run-delete-other";
  const exportPath = path.join(sharedRoot, "exports", `${selectedRunId}.zip`);
  await Promise.all([
    writeRun(sharedRoot, selectedRunId),
    writeRun(sharedRoot, otherRunId),
    fs.mkdir(path.dirname(exportPath), { recursive: true }).then(() => fs.writeFile(exportPath, "export", "utf8")),
  ]);

  const deletion = await store.deleteCompletedRun(selectedRunId, "CONFIRM");
  assert.deepEqual(deletion, { deleted: true, alreadyDeleted: false, runId: selectedRunId });
  assert.equal(await pathExists(path.join(sharedRoot, "runs", selectedRunId)), false);
  assert.equal(await pathExists(path.join(sharedRoot, "runs", otherRunId, "uploaded-config.json")), true);
  assert.equal(await fs.readFile(exportPath, "utf8"), "export");

  const repeated = await store.deleteCompletedRun(selectedRunId, "CONFIRM");
  assert.deepEqual(repeated, { deleted: true, alreadyDeleted: true, runId: selectedRunId });
});

//verifies a stale latest-run pointer cannot prevent deletion or block a later launch
test("internal deletion clears a lingering pointer for its terminal run only", async (t) => {
  //model the completed latest history entry before the guest or supervisor clears its pointer
  const { sharedRoot, store } = await createFixture(t);
  const runId = "run-delete-terminal-pointer";
  const otherRunId = "run-delete-other-pointer";
  await Promise.all([
    writeRun(sharedRoot, runId),
    writeJson(path.join(sharedRoot, "active", "current-run.json"), { runId }),
  ]);

  assert.equal((await store.readRun(runId)).active, false);
  assert.deepEqual(await store.deleteCompletedRun(runId, "CONFIRM"), {
    deleted: true,
    alreadyDeleted: false,
    runId,
  });
  assert.equal(await pathExists(path.join(sharedRoot, "runs", runId)), false);
  assert.equal(await pathExists(path.join(sharedRoot, "active", "current-run.json")), false);

  await Promise.all([
    writeRun(sharedRoot, runId),
    writeJson(path.join(sharedRoot, "active", "current-run.json"), { runId: otherRunId }),
  ]);
  assert.deepEqual(await store.deleteCompletedRun(runId, "CONFIRM"), {
    deleted: true,
    alreadyDeleted: false,
    runId,
  });
  assert.deepEqual(
    JSON.parse(await fs.readFile(path.join(sharedRoot, "active", "current-run.json"), "utf8")),
    { runId: otherRunId }
  );
});

//verifies only the raw exact confirmation text can reach deletion state checks
test("invalid confirmation values are no-ops", async (t) => {
  //exercise casing whitespace omitted values and malformed payload types without changing storage
  const { sharedRoot, store } = await createFixture(t);
  const runId = "run-confirmation";
  await writeRun(sharedRoot, runId);

  for (const confirmation of ["confirm", "Confirm", " CONFIRM", "CONFIRM ", "CONFIRM\n", undefined, null, 42, {}, false]) {
    const result = await store.deleteCompletedRun(runId, confirmation);
    assert.deepEqual(result, { deleted: false, reason: "CONFIRMATION_REQUIRED", runId });
    assert.equal(await pathExists(path.join(sharedRoot, "runs", runId, "uploaded-config.json")), true);
  }

  const malformed = await store.deleteCompletedRun("../run-confirmation", "CONFIRM");
  assert.deepEqual(malformed, { deleted: false, reason: "INVALID_RUN_ID", runId: null });
  assert.equal(await pathExists(path.join(sharedRoot, "runs", runId)), true);
});

//verifies uncertain active and incomplete lifecycle records remain protected from deletion
test("internal deletion preserves active indeterminate and non-terminal runs", async (t) => {
  //persist representative protected states so the store reads the same files used in production
  const { sharedRoot, store } = await createFixture(t);
  const activeRunId = "run-delete-active";
  const indeterminateRunId = "run-delete-indeterminate";
  const queuedRunId = "run-delete-queued";
  const runningRunId = "run-delete-running";
  const cancellingRunId = "run-delete-cancelling";
  await Promise.all([
    writeRun(sharedRoot, activeRunId, { metaStatus: "running", resultStatus: "running", finishedUtc: null }),
    writeJson(path.join(sharedRoot, "active", "current-run.json"), { runId: activeRunId }),
    writeRun(sharedRoot, indeterminateRunId, { metaStatus: "completed", resultStatus: "failed" }),
    writeRun(sharedRoot, queuedRunId, { metaStatus: "queued", resultStatus: "queued", finishedUtc: null }),
    writeRun(sharedRoot, runningRunId, { metaStatus: "running", resultStatus: "running", finishedUtc: null }),
    writeRun(sharedRoot, cancellingRunId, { metaStatus: "cancelling", resultStatus: "cancelling", finishedUtc: null }),
  ]);

  for (const [runId, reason] of [
    [activeRunId, "RUN_ACTIVE"],
    [indeterminateRunId, "RUN_INDETERMINATE"],
    [queuedRunId, "RUN_NOT_TERMINAL"],
    [runningRunId, "RUN_NOT_TERMINAL"],
    [cancellingRunId, "RUN_NOT_TERMINAL"],
  ]) {
    assert.deepEqual(await store.deleteCompletedRun(runId, "CONFIRM"), { deleted: false, reason, runId });
    assert.equal(await pathExists(path.join(sharedRoot, "runs", runId)), true);
  }
});

//verifies deletion shares cleanup serialization and leaves failed filesystem operations retryable
test("internal deletion surfaces filesystem failures and serializes with automatic cleanup", async (t) => {
  //hold deletion inside the injected remover while automatic cleanup waits on the shared queue
  const { sharedRoot, store } = await createFixture(t);
  const deleteRunId = "run-delete-queued";
  const cleanupRunId = "run-cleanup-queued";
  const nowMs = Date.parse("2026-10-18T00:00:00.000Z");
  const removalStarted = createDeferred();
  const releaseRemoval = createDeferred();
  let removeCalls = 0;
  await Promise.all([
    writeRun(sharedRoot, deleteRunId),
    writeRun(sharedRoot, cleanupRunId, { finishedUtc: new Date(nowMs - 720 * 60 * 60 * 1000).toISOString() }),
  ]);

  const deletion = store.deleteCompletedRun(deleteRunId, "CONFIRM", {
    removeRun: async (runRoot, options) => {
      removeCalls += 1;
      removalStarted.resolve();
      await releaseRemoval.promise;
      return fs.rm(runRoot, options);
    },
  });
  await removalStarted.promise;
  const cleanup = store.pruneCompletedRuns({
    sharedRoot,
    runIds: [cleanupRunId],
    now: () => nowMs,
  });
  assert.equal(removeCalls, 1);

  releaseRemoval.resolve();
  assert.deepEqual(await deletion, { deleted: true, alreadyDeleted: false, runId: deleteRunId });
  assert.deepEqual((await cleanup).removedRunIds, [cleanupRunId]);
  assert.equal(await pathExists(path.join(sharedRoot, "runs", deleteRunId)), false);
  assert.equal(await pathExists(path.join(sharedRoot, "runs", cleanupRunId)), false);

  //keep a failed removal directory on disk so a later caller can retry it
  await writeRun(sharedRoot, "run-delete-failure");
  await assert.rejects(
    store.deleteCompletedRun("run-delete-failure", "CONFIRM", {
      removeRun: async () => {
        const error = new Error("fixture deletion failure");
        error.code = "EACCES";
        throw error;
      },
    }),
    { code: "EACCES", message: "fixture deletion failure" }
  );
  assert.equal(await pathExists(path.join(sharedRoot, "runs", "run-delete-failure")), true);
});

//verifies the deletion route requires authentication and hides a run outside the authorized scope
test("run access deletion requires authentication and hides foreign runs", async (t) => {
  //mount the real router with no owned fixture run so authenticated foreign access remains not found
  const app = express();
  app.use(createRunAccessRouter({
    requireAuthenticatedUser: (req, res, next) => {
      if (req.headers.cookie === "session_token=valid") {
        req.auth = { userId: 1 };
        next();
        return;
      }
      res.status(401).json({ success: false });
    },
    list: async () => [],
    readOwned: async () => null,
    cancelOwned: async () => null,
    cancelOwned2: async () => null,
    resolveOwnedFile: async () => null,
  }));
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  assert.equal((await fetch(`${base}/api/runs/run-no-route`, { method: "DELETE" })).status, 401);
  assert.equal((await fetch(`${base}/api/runs/run-no-route`, {
    method: "DELETE",
    headers: { Cookie: "session_token=valid" },
  })).status, 404);
});