const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createAccountDeletionService } = require("../lib/accountDeletion");

function fakeDb(userId = 7) {
  let job = null;
  const queries = [];
  return {
    queries,
    async query(sql, values) {
      queries.push([sql, values]);
      if (sql.includes("FROM account_deletion_jobs")) return { rows: job ? [job] : [] };
      if (sql.includes("INSERT INTO account_deletion_jobs")) {
        job = { deletion_job_id: values[0], user_id: userId, status: "pending", step: "cancelling", last_error: null };
        return { rows: [] };
      }
      if (sql.includes("UPDATE account_deletion_jobs")) {
        if (sql.includes("SET status = 'completed'")) {
          job = { ...job, status: "completed", step: "complete", last_error: null };
          return { rows: [job] };
        }
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
}

test("account deletion waits for owned active runs and preserves other runs", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "dockvision-delete-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, "runs", "owned"), { recursive: true });
  await fs.mkdir(path.join(root, "runs", "other"), { recursive: true });
  const db = fakeDb();
  let status = "running";
  const service = createAccountDeletionService({
    db,
    sharedRoot: root,
    runs: {
      listRuns: async () => [{ runId: "owned" }],
      readRunForOwner: async () => ({ status }),
      isTerminalStatus: (value) => value === "completed",
      requestRunCancellationForOwner: async () => { status = "cancelled"; },
    },
  });
  await service.accept(7);
  const pending = await service.resume(7);
  assert.equal(pending.status, "pending");
  status = "completed";
  const complete = await service.resume(7);
  assert.equal(complete.status, "completed");
  await assert.rejects(fs.access(path.join(root, "runs", "owned")));
  await fs.access(path.join(root, "runs", "other"));

  const userDeleteIndex = db.queries.findIndex(([sql]) => sql.includes("DELETE FROM users"));
  const completionIndex = db.queries.findIndex(([sql]) => sql.includes("SET status = 'completed'"));
  assert.ok(userDeleteIndex >= 0);
  assert.ok(completionIndex > userDeleteIndex);
});

test("account deletion cleanup uses its configured shared root", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "dockvision-delete-root-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, "runs", "owned"), { recursive: true });
  const db = fakeDb();
  const service = createAccountDeletionService({
    db,
    sharedRoot: root,
    runs: {
      listRuns: async () => [{ runId: "owned" }],
      readRunForOwner: async () => ({ status: "completed" }),
      isTerminalStatus: (value) => value === "completed",
    },
  });
  await service.accept(7);
  const result = await service.resume(7);
  assert.equal(result.status, "completed");
  await assert.rejects(fs.access(path.join(root, "runs", "owned")));
});