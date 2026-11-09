const { test } = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcrypt");
const express = require("express");
const cookieParser = require("cookie-parser");
const authRoutes = require("../routes/AuthRoutes");

async function createDeletionApp(t, options = {}) {
  const passwordHash = await bcrypt.hash("CurrentPassword1!", 4);
  const calls = [];
  const user = {
    user_id: 7,
    password_hash: passwordHash,
    deletion_status: options.deletionStatus || "active",
  };
  let resumeCalls = 0;
  const deletionService = {
    async getJob() {
      return options.job || null;
    },
    async accept() {
      return options.job || { status: "pending", step: "cancelling" };
    },
    async resume() {
      resumeCalls += 1;
      return options.resumeResult || { status: "pending", step: "cancelling" };
    },
  };
  const db = {
    async query(sql, values = []) {
      calls.push({ sql, values });
      if (sql.includes("FROM sessions") && sql.includes("JOIN users")) {
        return options.missingSession ? { rows: [] } : { rows: [user] };
      }
      if (sql.includes("SELECT password_hash FROM users")) {
        return options.missingUser ? { rows: [] } : { rows: [user] };
      }
      return { rows: [] };
    },
  };

  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api/auth", authRoutes(db, { deletionService }));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    return res.status(500).json({ message: "Internal test error" });
  });
  const server = await new Promise((resolve, reject) => {
    const listeningServer = app.listen(0, "127.0.0.1", () => resolve(listeningServer));
    listeningServer.once("error", reject);
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return {
    base: () => `http://127.0.0.1:${server.address().port}`,
    calls,
    get resumeCalls() {
      return resumeCalls;
    },
  };
}

function deletionRequest(fixture, path, body) {
  return fetch(`${fixture.base()}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: "session_token=valid-session",
    },
    body: JSON.stringify(body),
  });
}

test("account deletion rejects incorrect confirmation before checking the password", async (t) => {
  const fixture = await createDeletionApp(t);
  const response = await deletionRequest(fixture, "/api/auth/delete-account", {
    password: "CurrentPassword1!",
    confirmation: "confirm",
  });
  assert.equal(response.status, 400);
  assert.match((await response.json()).message, /CONFIRM exactly/i);
  assert.equal(fixture.calls.some(({ sql }) => sql.includes("SELECT password_hash")), false);
});

test("account deletion rejects an incorrect password", async (t) => {
  const fixture = await createDeletionApp(t);
  const response = await deletionRequest(fixture, "/api/auth/delete-account", {
    password: "WrongPassword1!",
    confirmation: "CONFIRM",
  });
  assert.equal(response.status, 401);
  assert.match((await response.json()).message, /current password/i);
});

test("deletion-restricted accounts can inspect status and retry deletion", async (t) => {
  const fixture = await createDeletionApp(t, {
    deletionStatus: "pending",
    job: { status: "pending", step: "cancelling" },
    resumeResult: { status: "completed", step: "complete" },
  });

  const status = await fetch(`${fixture.base()}/api/auth/deletion-status`, {
    headers: { Cookie: "session_token=valid-session" },
  });
  assert.equal(status.status, 200);
  assert.deepEqual((await status.json()).job, { status: "pending", step: "cancelling" });

  const resume = await deletionRequest(fixture, "/api/auth/delete-account/resume", {});
  assert.equal(resume.status, 200);
  assert.equal(fixture.resumeCalls, 1);

  const secondRequest = await deletionRequest(fixture, "/api/auth/delete-account", {
    password: "CurrentPassword1!",
    confirmation: "CONFIRM",
  });
  assert.equal(secondRequest.status, 200);
  assert.equal(fixture.resumeCalls, 2);
});

test("account deletion reports a pending cleanup job and allows a later retry", async (t) => {
  const fixture = await createDeletionApp(t, {
    resumeResult: { status: "pending", step: "cancelling" },
  });
  const accepted = await deletionRequest(fixture, "/api/auth/delete-account", {
    password: "CurrentPassword1!",
    confirmation: "CONFIRM",
  });
  assert.equal(accepted.status, 202);
  assert.equal(fixture.resumeCalls, 1);

  const resumed = await deletionRequest(fixture, "/api/auth/delete-account/resume", {});
  assert.equal(resumed.status, 202);
  assert.equal(fixture.resumeCalls, 2);
});