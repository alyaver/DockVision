const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const express = require("express");
const cookieParser = require("cookie-parser");
const { createRequireAuthenticatedUser } = require("../middleware/requireAuthenticatedUser");
const { createRunAccessRouter } = require("../routes/RunAccessRoutes");

async function startServer(t, app) {
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  return `http://127.0.0.1:${server.address().port}`;
}

test("authentication middleware derives the user from a non-expired session", async (t) => {
  const queries = [];
  const db = {
    async query(sql, values) {
      queries.push({ sql, values });
      return values[0] === "valid-token"
        ? { rows: [{ user_id: 17 }] }
        : { rows: [] };
    },
  };
  const app = express();
  app.use(cookieParser());
  app.get("/protected", createRequireAuthenticatedUser({ db }), (req, res) => {
    res.json({ userId: req.auth.userId });
  });
  const base = await startServer(t, app);

  const missing = await fetch(`${base}/protected`);
  assert.equal(missing.status, 401);

  const expired = await fetch(`${base}/protected`, {
    headers: { Cookie: "session_token=expired-token" },
  });
  assert.equal(expired.status, 401);

  const valid = await fetch(`${base}/protected`, {
    headers: { Cookie: "session_token=valid-token" },
  });
  assert.equal(valid.status, 200);
  assert.deepEqual(await valid.json(), { userId: 17 });
  assert.match(queries.at(-1).sql, /expires_at > CURRENT_TIMESTAMP/);
  assert.deepEqual(queries.at(-1).values, ["valid-token"]);
});

test("run access authentication does not intercept unrelated public routes", async (t) => {
  const app = express();
  app.use(createRunAccessRouter({
    requireAuthenticatedUser: (req, res) => {
      res.status(401).json({ message: "Authentication is required." });
    },
    list: async () => [],
    readOwned: async () => null,
    cancelOwned: async () => null,
    cancelOwned2: async () => null,
    resolveOwnedFile: async () => null,
  }));
  app.post("/api/auth/register", (req, res) => {
    res.status(201).json({ success: true });
  });
  const base = await startServer(t, app);

  const runResponse = await fetch(`${base}/api/runs`);
  assert.equal(runResponse.status, 401);

  const registrationResponse = await fetch(`${base}/api/auth/register`, {
    method: "POST",
  });
  assert.equal(registrationResponse.status, 201);
  assert.deepEqual(await registrationResponse.json(), { success: true });
});

test("run access routes pass only the authenticated owner and hide foreign runs", async (t) => {
  const calls = [];
  const ownRun = { runId: "run-own", status: "running" };
  const requireAuthenticatedUser = (req, res, next) => {
    req.auth = { userId: 17 };
    next();
  };
  const app = express();
  app.use(createRunAccessRouter({
    requireAuthenticatedUser,
    list: async (options) => {
      calls.push(["list", options]);
      return [ownRun];
    },
    readOwned: async (runId, ownerUserId) => {
      calls.push(["read", runId, ownerUserId]);
      return runId === ownRun.runId ? ownRun : null;
    },
    cancelOwned: async (runId, ownerUserId) => {
      calls.push(["cancel", runId, ownerUserId]);
      return runId === ownRun.runId ? { ...ownRun, status: "cancelling" } : null;
    },
    cancelOwned2: async () => null,
    resolveOwnedFile: async (runId, relativePath, ownerUserId) => {
      calls.push(["file", runId, relativePath, ownerUserId]);
      return null;
    },
  }));
  const base = await startServer(t, app);

  const history = await fetch(`${base}/api/runs`);
  assert.equal(history.status, 200);
  assert.deepEqual((await history.json()).runs, [ownRun]);

  const foreignDetail = await fetch(`${base}/api/runs/run-foreign`);
  assert.equal(foreignDetail.status, 404);

  const foreignCancel = await fetch(`${base}/api/runs/run-foreign/cancel`, { method: "POST" });
  assert.equal(foreignCancel.status, 404);

  const foreignFile = await fetch(`${base}/api/runs/run-foreign/files/logs/task.log`);
  assert.equal(foreignFile.status, 404);

  assert.deepEqual(calls, [
    ["list", { ownerUserId: 17 }],
    ["read", "run-foreign", 17],
    ["cancel", "run-foreign", 17],
    ["file", "run-foreign", "logs/task.log", 17],
  ]);
});

//verifies the single delete route reuses authenticated owner lookup before core deletion
test("run access deletion authorizes the selected run and forwards only exact confirmation", async (t) => {
  //capture deletion inputs so the route cannot silently accept client ownership fields
  const calls = [];
  const ownRun = { runId: "run-own", status: "completed" };
  const requireAuthenticatedUser = (req, res, next) => {
    req.auth = { userId: 17 };
    next();
  };
  const app = express();
  app.use(createRunAccessRouter({
    requireAuthenticatedUser,
    list: async () => [],
    readOwned: async (runId, ownerUserId) => {
      calls.push(["read", runId, ownerUserId]);
      return runId === ownRun.runId ? ownRun : null;
    },
    cancelOwned: async () => null,
    cancelOwned2: async () => null,
    resolveOwnedFile: async () => null,
    deleteRun: async (runId, confirmation) => {
      calls.push(["delete", runId, confirmation]);
      return confirmation === "CONFIRM"
        ? { deleted: true, alreadyDeleted: false, runId }
        : { deleted: false, reason: "CONFIRMATION_REQUIRED", runId };
    },
  }));
  const base = await startServer(t, app);
  const request = (runId, confirmation) => fetch(`${base}/api/runs/${runId}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ confirmation, ownerUserId: 999 }),
  });

  const missing = await request("run-foreign", "CONFIRM");
  assert.equal(missing.status, 404);

  const invalidConfirmation = await request("run-own", "Confirm");
  assert.equal(invalidConfirmation.status, 400);
  assert.equal((await invalidConfirmation.json()).code, "CONFIRMATION_REQUIRED");

  const deleted = await request("run-own", "CONFIRM");
  assert.equal(deleted.status, 200);
  assert.deepEqual(await deleted.json(), {
    success: true,
    deleted: true,
    alreadyDeleted: false,
    runId: "run-own",
  });
  assert.deepEqual(calls, [
    ["read", "run-foreign", 17],
    ["read", "run-own", 17],
    ["delete", "run-own", "Confirm"],
    ["read", "run-own", 17],
    ["delete", "run-own", "CONFIRM"],
  ]);
});

test("task-plan downloads use the plan name while preserving owner enforcement", async (t) => {
  const sharedRoot = await fs.mkdtemp(path.join(os.tmpdir(), "dockvision-download-"));
  const taskPlanPath = path.join(sharedRoot, "uploaded-task-plan.json");
  await fs.writeFile(taskPlanPath, JSON.stringify({ name: "Quarterly / Smoke: Plan?" }), "utf8");

  t.after(async () => {
    await fs.rm(sharedRoot, { recursive: true, force: true });
  });

  let authenticatedUserId = 17;
  const app = express();
  app.use(createRunAccessRouter({
    requireAuthenticatedUser: (req, res, next) => {
      req.auth = { userId: authenticatedUserId };
      next();
    },
    list: async () => [],
    readOwned: async () => null,
    cancelOwned: async () => null,
    cancelOwned2: async () => null,
    resolveOwnedFile: async (runId, relativePath, ownerUserId) =>
      runId === "run-download" && ownerUserId === 17 && relativePath === "uploaded-task-plan.json"
        ? taskPlanPath
        : null,
  }));
  const base = await startServer(t, app);

  const download = await fetch(
    `${base}/api/runs/run-download/files/uploaded-task-plan.json?download=1`
  );
  assert.equal(download.status, 200);
  assert.match(
    download.headers.get("content-disposition"),
    /attachment; filename="Quarterly - Smoke- Plan-\.json"/
  );
  assert.deepEqual(await download.json(), { name: "Quarterly / Smoke: Plan?" });

  authenticatedUserId = 18;
  const foreignDownload = await fetch(
    `${base}/api/runs/run-download/files/uploaded-task-plan.json?download=1`
  );
  assert.equal(foreignDownload.status, 404);
});

test("two authenticated sessions receive separate history and cannot read each other's run", async (t) => {
  const sessions = new Map([
    ["token-a", 1],
    ["token-b", 2],
  ]);
  const runs = [
    { runId: "run-a", ownerUserId: 1 },
    { runId: "run-b", ownerUserId: 2 },
  ];
  const db = {
    async query(sql, values) {
      const userId = sessions.get(values[0]);
      return { rows: userId ? [{ user_id: userId }] : [] };
    },
  };
  const app = express();
  app.use(cookieParser());
  app.use(createRunAccessRouter({
    requireAuthenticatedUser: createRequireAuthenticatedUser({ db }),
    list: async ({ ownerUserId }) => runs.filter((run) => run.ownerUserId === ownerUserId),
    readOwned: async (runId, ownerUserId) =>
      runs.find((run) => run.runId === runId && run.ownerUserId === ownerUserId) || null,
    cancelOwned: async () => null,
    cancelOwned2: async () => null,
    resolveOwnedFile: async () => null,
  }));
  const base = await startServer(t, app);
  const request = (url, token) => fetch(`${base}${url}`, {
    headers: { Cookie: `session_token=${token}` },
  });

  const historyA = await request("/api/runs", "token-a");
  assert.deepEqual((await historyA.json()).runs.map((run) => run.runId), ["run-a"]);

  const historyB = await request("/api/runs", "token-b");
  assert.deepEqual((await historyB.json()).runs.map((run) => run.runId), ["run-b"]);

  assert.equal((await request("/api/runs/run-b", "token-a")).status, 404);
  assert.equal((await request("/api/runs/run-b", "expired-token")).status, 401);
});

test("owner-aware store access excludes other users and preserves ownerless legacy data", async (t) => {
  const sharedRoot = await fs.mkdtemp(path.join(os.tmpdir(), "dockvision-ownership-"));
  const previousRoot = process.env.DOCKVISION_SHARED_ROOT;
  process.env.DOCKVISION_SHARED_ROOT = sharedRoot;
  const modulePath = require.resolve("../lib/runStore");
  delete require.cache[modulePath];
  const store = require("../lib/runStore");

  t.after(async () => {
    delete require.cache[modulePath];
    if (previousRoot === undefined) delete process.env.DOCKVISION_SHARED_ROOT;
    else process.env.DOCKVISION_SHARED_ROOT = previousRoot;
    await fs.rm(sharedRoot, { recursive: true, force: true });
  });

  const writeRun = async (runId, meta) => {
    const root = path.join(sharedRoot, "runs", runId);
    await fs.mkdir(path.join(root, "logs"), { recursive: true });
    await fs.writeFile(path.join(root, "meta.json"), JSON.stringify({ runId, status: "queued", ...meta }));
    await fs.writeFile(path.join(root, "task.json"), JSON.stringify({ runId, status: "queued" }));
    await fs.writeFile(path.join(root, "logs", "task.log"), `${runId}\n`);
  };

  await writeRun("run-a", { ownerUserId: 1 });
  await writeRun("run-b", { ownerUserId: 2 });
  await writeRun("run-legacy", {});

  const userOneRuns = await store.listRuns({ sharedRoot, ownerUserId: 1 });
  assert.deepEqual(userOneRuns.map((run) => run.runId), ["run-a"]);
  assert.equal((await store.readRunForOwner("run-a", 1)).ownerUserId, 1);
  assert.equal(await store.readRunForOwner("run-b", 1), null);
  assert.equal(await store.readRunForOwner("run-legacy", 1), null);
  assert.equal(await store.readRunForOwner("../run-b", 1), null);
  assert.equal(await store.resolveRunFilePathForOwner("run-b", "logs/task.log", 1), null);
  await store.updateMetaFile("run-a", { status: "running" });
  const updatedMeta = JSON.parse(
    await fs.readFile(path.join(sharedRoot, "runs", "run-a", "meta.json"), "utf8")
  );
  assert.equal(updatedMeta.ownerUserId, 1);
  assert.equal(await fs.readFile(path.join(sharedRoot, "runs", "run-legacy", "logs", "task.log"), "utf8"), "run-legacy\n");
});