const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const { listRuns, isTerminalStatus } = require("./runStore");

const TERMINAL_JOB_STATUSES = new Set(["completed"]);

function createAccountDeletionService({ db, sharedRoot, runs = {} } = {}) {
  if (!db || typeof db.query !== "function") throw new Error("Deletion service requires a database.");
  const root = path.resolve(sharedRoot || path.resolve(__dirname, "..", "..", "WindowsVm", "shared"));
  const runApi = {
    listRuns: (options) => listRuns(options),
    readRunForOwner: async (runId, userId) => {
      const metaPath = path.join(root, "runs", runId, "meta.json");
      const resultPath = path.join(root, "runs", runId, "result.json");
      try {
        const meta = JSON.parse(await fs.readFile(metaPath, "utf8"));
        if (String(meta.ownerUserId) !== String(userId)) return null;
        let result = null;
        try { result = JSON.parse(await fs.readFile(resultPath, "utf8")); } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
        return { ...meta, status: meta.status || result?.status || "queued" };
      } catch (error) {
        if (error.code === "ENOENT") return null;
        throw error;
      }
    },
    requestRunCancellationForOwner: async (runId, userId) => {
      const run = await runApi.readRunForOwner(runId, userId);
      if (!run) return null;
      const requestedUtc = new Date().toISOString();
      const runRoot = path.join(root, "runs", runId);
      await fs.writeFile(path.join(runRoot, "cancel-request.json"), `${JSON.stringify({ runId, requestedUtc, status: "requested" })}\n`);
      const metaPath = path.join(runRoot, "meta.json");
      await fs.writeFile(metaPath, `${JSON.stringify({ ...run, status: "cancelling", cancelRequestedUtc: requestedUtc }, null, 2)}\n`);
      return { ...run, status: "cancelling" };
    },
    isTerminalStatus,
    ...runs,
  };

  async function getJob(userId) {
    const result = await db.query(
      `SELECT deletion_job_id, user_id, status, step, last_error, accepted_at, updated_at, completed_at
       FROM account_deletion_jobs WHERE user_id = $1`,
      [userId]
    );
    return result.rows[0] || null;
  }

  async function accept(userId) {
    const existing = await getJob(userId);
    if (existing) return existing;
    const jobId = crypto.randomUUID();
    await db.query(
      `INSERT INTO account_deletion_jobs (deletion_job_id, user_id, status, step)
       VALUES ($1, $2, 'pending', 'cancelling')`,
      [jobId, userId]
    );
    await db.query(
      `UPDATE users SET deletion_status = 'pending', updated_at = CURRENT_TIMESTAMP WHERE user_id = $1`,
      [userId]
    );
    return getJob(userId);
  }

  async function updateJob(userId, status, step, lastError = null) {
    const result = await db.query(
      `UPDATE account_deletion_jobs
       SET status = $2::varchar, step = $3, last_error = $4, updated_at = CURRENT_TIMESTAMP,
           completed_at = CASE WHEN $2::varchar = 'completed' THEN CURRENT_TIMESTAMP ELSE completed_at END
       WHERE user_id = $1
       RETURNING deletion_job_id, user_id, status, step, last_error, accepted_at, updated_at, completed_at`,
      [userId, status, step, lastError]
    );
    return result.rows[0] || null;
  }

  async function removeOwnedRun(runId, userId) {
    const run = await runApi.readRunForOwner(runId, userId);
    if (!run) return false;
    if (!runApi.isTerminalStatus(run.status)) {
      await runApi.requestRunCancellationForOwner(runId, userId);
      return false;
    }
    const pointerPath = path.join(root, "active", "current-run.json");
    try {
      const pointer = JSON.parse(await fs.readFile(pointerPath, "utf8"));
      if (pointer.runId === runId) await fs.rm(pointerPath, { force: true });
    } catch (error) {
      if (error.code !== "ENOENT" && error.name !== "SyntaxError") throw error;
    }
    await fs.rm(path.join(root, "runs", runId), { recursive: true, force: true });
    return true;
  }

  async function resume(userId) {
    const job = await getJob(userId);
    if (!job) return null;
    if (TERMINAL_JOB_STATUSES.has(job.status)) return job;
    try {
      await updateJob(userId, "pending", "cancelling", null);
      const ownedRuns = await runApi.listRuns({ sharedRoot: root, ownerUserId: userId, prune: false });
      const remaining = [];
      for (const run of ownedRuns) {
        if (!(await removeOwnedRun(run.runId, userId))) remaining.push(run.runId);
      }
      if (remaining.length > 0) {
        return updateJob(userId, "pending", "cancelling", `Waiting for ${remaining.length} owned run(s) to reach a terminal state.`);
      }

      await updateJob(userId, "pending", "removing-account", null);
      const client = await db.connect();
      try {
        await client.query("BEGIN");
        await client.query("DELETE FROM sessions WHERE user_id = $1", [userId]);
        await client.query("DELETE FROM password_reset_tokens WHERE user_id = $1", [userId]);
        await client.query("DELETE FROM users WHERE user_id = $1", [userId]);
        const completedJob = await client.query(
          `UPDATE account_deletion_jobs
           SET status = 'completed', step = 'complete', last_error = NULL,
               updated_at = CURRENT_TIMESTAMP, completed_at = CURRENT_TIMESTAMP
           WHERE deletion_job_id = $1
           RETURNING deletion_job_id, user_id, status, step, last_error, accepted_at, updated_at, completed_at`,
          [job.deletion_job_id]
        );
        await client.query("COMMIT");
        return completedJob.rows[0] || {
          ...job,
          status: "completed",
          step: "complete",
          last_error: null,
        };
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      return updateJob(userId, "failed", job.step || "cancelling", error.message || "Deletion step failed.");
    }
  }

  return { getJob, accept, resume };
}

module.exports = { createAccountDeletionService };