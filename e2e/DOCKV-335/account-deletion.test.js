const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const express = require("express");
const cookieParser = require("cookie-parser");
const accountDeletionRoutes = require("../../server/routes/AuthRoutes");
const { createAccountDeletionService } = require("../../server/lib/accountDeletion");

async function startHttpServer(t, app) {
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });

  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });

  return `http://127.0.0.1:${server.address().port}`;
}

function createJobDb(userId = 77) {
  let job = null;
  const queries = [];
  const db = {
    queries,
    async query(sql, values = []) {
      queries.push({ sql, values });

      if (sql.includes("FROM sessions") && sql.includes("JOIN users")) {
        return { rows: [{ user_id: userId, deletion_status: "active" }] };
      }
      if (sql.includes("FROM account_deletion_jobs")) {
        return { rows: job ? [job] : [] };
      }
      if (sql.includes("INSERT INTO account_deletion_jobs")) {
        job = {
          deletion_job_id: values[0],
          user_id: userId,
          status: "pending",
          step: "cancelling",
          last_error: null,
        };
        return { rows: [] };
      }
      if (sql.includes("SET status = 'completed'")) {
        job = { ...job, status: "completed", step: "complete", last_error: null };
        return { rows: [job] };
      }
      if (sql.includes("UPDATE account_deletion_jobs")) {
        job = { ...job, status: values[1], step: values[2], last_error: values[3] };
        return { rows: [job] };
      }
      return { rows: [] };
    },
    async connect() {
      return {
        query: this.query.bind(this),
        release() {},
      };
    },
  };
  return db;
}

async function writeRun(root, runId, metadata) {
  const runRoot = path.join(root, "runs", runId);
  await fs.mkdir(path.join(runRoot, "artifacts"), { recursive: true });
  await fs.writeFile(
    path.join(runRoot, "meta.json"),
    `${JSON.stringify({ runId, ...metadata }, null, 2)}\n`,
    "utf8"
  );
  await fs.writeFile(path.join(runRoot, "artifacts", "fixture.txt"), `${runId}\n`, "utf8");
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

// DOCKV-335 POC 1: route validation is production code; the database and deletion service are test doubles.
test("invalid account-deletion confirmation is rejected without invoking deletion", async (t) => {
  const db = createJobDb();
  let deletionCalls = 0;
  const deletionService = {
    async accept() {
      deletionCalls += 1;
      throw new Error("deletion service must not be invoked");
    },
    async resume() {
      deletionCalls += 1;
      throw new Error("deletion service must not be invoked");
    },
  };
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api/auth", accountDeletionRoutes(db, { deletionService }));
  const base = await startHttpServer(t, app);

  const response = await fetch(`${base}/api/auth/delete-account`, {
    method: "POST",
    headers: {
      Cookie: "session_token=disposable-session",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ password: "KnownPassword!7", confirmation: "confirm" }),
  });
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.code, "CONFIRMATION_REQUIRED");
  assert.equal(deletionCalls, 0);
  assert.equal(
    db.queries.some(({ sql }) => sql.includes("INSERT INTO account_deletion_jobs")),
    false
  );
  assert.equal(
    db.queries.some(({ sql }) => sql.includes("SELECT password_hash FROM users")),
    false
  );
});

// DOCKV-335 POC 2: the service uses a real temporary run folder, while cancellation remains controlled by the stub.
test("owned active run remains on disk while cancellation is pending", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "dockvision-account-deletion-pending-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await writeRun(root, "owned-active", { ownerUserId: 77, status: "running" });

  const db = createJobDb();
  const cancellationRequests = [];
  const service = createAccountDeletionService({
    db,
    sharedRoot: root,
    runs: {
      listRuns: async () => [{ runId: "owned-active" }],
      readRunForOwner: async () => ({ runId: "owned-active", ownerUserId: 77, status: "running" }),
      isTerminalStatus: (status) => status === "completed",
      requestRunCancellationForOwner: async (runId, userId) => {
        cancellationRequests.push({ runId, userId });
      },
    },
  });

  await service.accept(77);
  const result = await service.resume(77);

  assert.equal(result.status, "pending");
  assert.equal(result.step, "cancelling");
  assert.deepEqual(cancellationRequests, [{ runId: "owned-active", userId: 77 }]);
  assert.equal(await exists(path.join(root, "runs", "owned-active")), true);
  assert.equal(await exists(path.join(root, "runs", "owned-active", "meta.json")), true);
  assert.equal(
    db.queries.some(({ sql }) => sql.includes("DELETE FROM users")),
    false
  );
});

// DOCKV-335 POC 3: the real service sees a one-time filesystem failure, then resumes against persisted fixtures.
test("cleanup failure can resume while preserving foreign-owner and ownerless fixtures", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "dockvision-account-deletion-resume-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await writeRun(root, "owned-terminal", { ownerUserId: 77, status: "completed" });
  await writeRun(root, "foreign-terminal", { ownerUserId: 88, status: "completed" });
  await writeRun(root, "ownerless-legacy", { status: "completed" });

  const db = createJobDb();
  const service = createAccountDeletionService({
    db,
    sharedRoot: root,
    runs: {
      listRuns: async ({ ownerUserId }) =>
        ownerUserId === 77 ? [{ runId: "owned-terminal" }] : [],
      isTerminalStatus: (status) => status === "completed",
    },
  });

  const originalRm = fs.rm;
  let injectedFailure = true;
  fs.rm = async (target, options) => {
    if (injectedFailure && target === path.join(root, "runs", "owned-terminal")) {
      injectedFailure = false;
      const error = new Error("one-time fixture removal failure");
      error.code = "EACCES";
      throw error;
    }
    return originalRm(target, options);
  };
  t.after(() => {
    fs.rm = originalRm;
  });

  await service.accept(77);
  const failed = await service.resume(77);

  assert.equal(failed.status, "failed");
  assert.match(failed.last_error, /one-time fixture removal failure/);
  assert.equal(await exists(path.join(root, "runs", "owned-terminal")), true);
  assert.equal(await exists(path.join(root, "runs", "foreign-terminal")), true);
  assert.equal(await exists(path.join(root, "runs", "ownerless-legacy")), true);

  const completed = await service.resume(77);

  assert.equal(completed.status, "completed");
  assert.equal(await exists(path.join(root, "runs", "owned-terminal")), false);
  assert.equal(await exists(path.join(root, "runs", "foreign-terminal")), true);
  assert.equal(await exists(path.join(root, "runs", "ownerless-legacy")), true);
  assert.ok(db.queries.some(({ sql }) => sql.includes("DELETE FROM users")));
});