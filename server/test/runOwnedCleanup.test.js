const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

//creates an isolated configured run store so scoped cleanup cannot reach the live shared directory
async function createFixture(t) {
  //reload the module after setting the root because the store resolves its root during import
  const sharedRoot = await fs.mkdtemp(path.join(os.tmpdir(), "dockvision-owned-cleanup-"));
  const previousRoot = process.env.DOCKVISION_SHARED_ROOT;
  process.env.DOCKVISION_SHARED_ROOT = sharedRoot;
  const storePath = require.resolve("../lib/runStore");
  delete require.cache[storePath];
  const store = require("../lib/runStore");

  t.after(async () => {
    //restore the process configuration and delete only this test fixture root
    delete require.cache[storePath];
    if (previousRoot === undefined) delete process.env.DOCKVISION_SHARED_ROOT;
    else process.env.DOCKVISION_SHARED_ROOT = previousRoot;
    await fs.rm(sharedRoot, { recursive: true, force: true });
  });

  return { sharedRoot, store };
}

//writes json fixture state while creating the parent directory owned by that fixture file
async function writeJson(filePath, value) {
  //avoid launch and guest execution because retention only needs durable lifecycle files
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(value), "utf8");
}

//persists a terminal run with optional task 317 ownership for scope integration checks
async function writeTerminalRun(sharedRoot, runId, ownerUserId, finishedMs, options = {}) {
  //leave ownerUserId absent for legacy fixtures because task 317 does not fabricate legacy owners
  const runRoot = path.join(sharedRoot, "runs", runId);
  const finishedUtc = new Date(finishedMs).toISOString();
  const meta = {
    runId,
    status: options.metaStatus || "completed",
    finishedUtc,
  };
  if (ownerUserId !== undefined) meta.ownerUserId = ownerUserId;
  await Promise.all([
    writeJson(path.join(runRoot, "meta.json"), meta),
    writeJson(path.join(runRoot, "result.json"), {
      runId,
      status: options.resultStatus || "completed",
      finishedUtc,
    }),
    fs.mkdir(path.join(runRoot, "artifacts"), { recursive: true }),
  ]);
}

//checks fixture paths without converting unexpected filesystem errors into preservation assertions
async function pathExists(filePath) {
  //use access only to distinguish expected retention deletion from fixture failures
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

//verifies the 31st terminal run is selected only inside its persisted task 317 owner scope
test("owned cleanup applies terminal count retention independently per user", async (t) => {
  //give both users terminal history so a global selection would expose cross-user deletion errors
  const { sharedRoot, store } = await createFixture(t);
  const nowMs = Date.parse("2026-10-18T00:00:00.000Z");
  const userARunIds = Array.from({ length: 31 }, (_, index) => `run-user-a-${index}`);
  const userBRunIds = Array.from({ length: 30 }, (_, index) => `run-user-b-${index}`);
  await Promise.all([
    ...userARunIds.map((runId, index) => writeTerminalRun(sharedRoot, runId, 101, nowMs - index * 1000)),
    ...userBRunIds.map((runId, index) => writeTerminalRun(sharedRoot, runId, 202, nowMs - index * 1000)),
  ]);

  const cleanup = await store.pruneOwnedCompletedRuns({ sharedRoot, now: () => nowMs });
  assert.deepEqual(cleanup.removedRunIds, ["run-user-a-30"]);
  assert.equal(await pathExists(path.join(sharedRoot, "runs", "run-user-a-30")), false);
  assert.equal(await pathExists(path.join(sharedRoot, "runs", "run-user-b-29")), true);
});

//verifies age expiration and protected lifecycle records remain isolated from other user histories
test("owned cleanup isolates age expiration and preserves ownerless active and indeterminate records", async (t) => {
  //combine scope isolation with records that must remain outside destructive retention selection
  const { sharedRoot, store } = await createFixture(t);
  const nowMs = Date.parse("2026-10-18T00:00:00.000Z");
  const expiredMs = nowMs - 720 * 60 * 60 * 1000;
  await Promise.all([
    writeTerminalRun(sharedRoot, "run-user-a-expired", 101, expiredMs),
    writeTerminalRun(sharedRoot, "run-user-b-recent", 202, nowMs),
    writeTerminalRun(sharedRoot, "run-legacy-expired", undefined, expiredMs),
    writeTerminalRun(sharedRoot, "run-user-a-active", 101, expiredMs),
    writeTerminalRun(sharedRoot, "run-user-a-indeterminate", 101, expiredMs, { resultStatus: "failed" }),
    writeJson(path.join(sharedRoot, "active", "current-run.json"), { runId: "run-user-a-active" }),
  ]);

  const cleanup = await store.pruneOwnedCompletedRuns({ sharedRoot, now: () => nowMs });
  assert.deepEqual(cleanup.removedRunIds, ["run-user-a-expired"]);
  assert.equal(await pathExists(path.join(sharedRoot, "runs", "run-user-b-recent")), true);
  assert.equal(await pathExists(path.join(sharedRoot, "runs", "run-legacy-expired")), true);
  assert.equal(await pathExists(path.join(sharedRoot, "runs", "run-user-a-active")), true);
  assert.equal(await pathExists(path.join(sharedRoot, "runs", "run-user-a-indeterminate")), true);
});

//verifies one owner cleanup failure does not prevent another owner scope from completing retention
test("owned cleanup continues with another user after one user deletion failure", async (t) => {
  //inject a single owner a removal failure while retaining an independently expired owner b candidate
  const { sharedRoot, store } = await createFixture(t);
  const nowMs = Date.parse("2026-10-18T00:00:00.000Z");
  await Promise.all([
    writeTerminalRun(sharedRoot, "run-user-a-failure", 101, nowMs - 720 * 60 * 60 * 1000),
    writeTerminalRun(sharedRoot, "run-user-b-expired", 202, nowMs - 720 * 60 * 60 * 1000),
  ]);

  const cleanup = await store.pruneOwnedCompletedRuns({
    sharedRoot,
    now: () => nowMs,
    removeRun: async (runRoot, options) => {
      if (runRoot.endsWith("run-user-a-failure")) {
        const error = new Error("fixture owner a deletion failure");
        error.code = "EACCES";
        throw error;
      }
      return fs.rm(runRoot, options);
    },
  });
  assert.deepEqual(cleanup.failedRunIds, ["run-user-a-failure"]);
  assert.deepEqual(cleanup.removedRunIds, ["run-user-b-expired"]);
  assert.equal(await pathExists(path.join(sharedRoot, "runs", "run-user-a-failure")), true);
  assert.equal(await pathExists(path.join(sharedRoot, "runs", "run-user-b-expired")), false);
});