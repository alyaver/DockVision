const { test } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const bcrypt = require("bcrypt");
const { createProfileRouter } = require("../routes/ProfileRoutes");

const squarePng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
).toString("base64");
const rectangularPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAQAAAD0In+KAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
).toString("base64");

async function createApp(t, options = {}) {
  const calls = [];
  const user = {
    user_id: 7,
    name: "Test User",
    email: "test@example.com",
    created_at: "2026-10-21T00:00:00.000Z",
    has_avatar: false,
    avatar_updated_at: null,
  };
  let passwordHash = options.passwordHash || null;
  const avatar = { data: null, contentType: null };
  const db = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (options.queryError && (!options.queryErrorWhen || options.queryErrorWhen(sql))) {
        throw options.queryError;
      }
      if (sql.includes("SELECT user_id, name, email, created_at")) {
        return { rows: [{ ...user, has_avatar: Boolean(avatar.data), avatar_updated_at: avatar.data ? "2026-10-21T00:01:00.000Z" : null }] };
      }
      if (sql.includes("SELECT password_hash")) {
        return { rows: [{ password_hash: passwordHash }] };
      }
      if (sql.startsWith("UPDATE users SET name")) {
        return { rows: [{ ...user, name: params[0], email: params[1] }] };
      }
      if (sql.startsWith("UPDATE users SET avatar_data = NULL")) {
        avatar.data = null;
        avatar.contentType = null;
        return { rowCount: 1, rows: [] };
      }
      if (sql.startsWith("UPDATE users SET avatar_data")) {
        avatar.data = params[0];
        avatar.contentType = params[1];
        return { rowCount: 1, rows: [] };
      }
      if (sql.startsWith("SELECT avatar_data")) {
        return { rows: [{ avatar_data: avatar.data, avatar_content_type: avatar.contentType }] };
      }
      if (sql.startsWith("UPDATE users SET password_hash")) {
        return { rowCount: 1, rows: [] };
      }
      return { rows: [] };
    },
  };
  const app = express();
  app.use(express.json({ limit: "8mb" }));
  app.use("/api/profile", createProfileRouter({
    db,
    requireAuthenticatedUser: (req, res, next) => {
      req.auth = { userId: 7 };
      next();
    },
  }));
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
    avatar,
  };
}

test("profile authentication does not intercept public auth routes", async (t) => {
  const fixture = await createApp(t);

  const response = await fetch(`${fixture.base()}/api/auth/login`, { method: "POST" });
  assert.equal(response.status, 404);
});

test("profile read and update return safe durable account fields", async (t) => {
  const fixture = await createApp(t);
  const profile = await fetch(`${fixture.base()}/api/profile`);
  assert.equal(profile.status, 200);

  const profileBody = await profile.json();
  assert.equal(profileBody.user.email, "test@example.com");
  assert.equal(profileBody.user.has_avatar, false);
  assert.equal("password_hash" in profileBody.user, false);

  const update = await fetch(`${fixture.base()}/api/profile`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "  Updated   User ", email: "TEST@example.com" }),
  });
  assert.equal(update.status, 200);
  assert.equal((await update.json()).user.name, "Updated User");
  assert.deepEqual(fixture.calls.at(-1).params, ["Updated User", "test@example.com", 7]);
});

test("profile rejects invalid and conflicting email updates", async (t) => {
  const conflict = new Error("duplicate");
  conflict.code = "23505";
  const fixture = await createApp(t, { queryError: conflict });

  const response = await fetch(`${fixture.base()}/api/profile`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Test User", email: "other@example.com" }),
  });
  assert.equal(response.status, 409);
  assert.match((await response.json()).message, /already registered with another user/i);
});

test("profile storage failures return an error instead of a success response", async (t) => {
  const storageError = new Error("profile write failed");
  const fixture = await createApp(t, {
    queryError: storageError,
    queryErrorWhen: (sql) => sql.startsWith("UPDATE users SET name"),
  });

  const response = await fetch(`${fixture.base()}/api/profile`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Updated User", email: "test@example.com" }),
  });
  assert.equal(response.status, 500);
  assert.equal((await response.json()).message, "Internal test error");
});

test("password changes preserve the current authenticated session", async (t) => {
  const fixture = await createApp(t, { passwordHash: await bcrypt.hash("OldPassword1!", 4) });

  const response = await fetch(`${fixture.base()}/api/profile/password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: "session_token=session-7" },
    body: JSON.stringify({ currentPassword: "OldPassword1!", newPassword: "NewPassword2!" }),
  });
  assert.equal(response.status, 200);
  assert.match((await response.json()).message, /success/i);
  assert.equal(fixture.calls.some(({ sql }) => sql.includes("DELETE FROM sessions")), false);
});

test("password changes reject an incorrect current password and invalid new passwords", async (t) => {
  const fixture = await createApp(t, { passwordHash: await bcrypt.hash("OldPassword1!", 4) });

  const incorrectCurrentPassword = await fetch(`${fixture.base()}/api/profile/password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ currentPassword: "WrongPassword1!", newPassword: "NewPassword2!" }),
  });
  assert.equal(incorrectCurrentPassword.status, 401);
  assert.match((await incorrectCurrentPassword.json()).message, /current password/i);

  for (const newPassword of ["short", "NoNumber!", "NoSymbol1", "a".repeat(65)]) {
    const invalid = await fetch(`${fixture.base()}/api/profile/password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword: "OldPassword1!", newPassword }),
    });
    assert.equal(invalid.status, 400, `expected ${newPassword} to be rejected`);
  }
});

test("password storage failures return an error instead of a success response", async (t) => {
  const storageError = new Error("password write failed");
  const fixture = await createApp(t, {
    passwordHash: await bcrypt.hash("OldPassword1!", 4),
    queryError: storageError,
    queryErrorWhen: (sql) => sql.startsWith("UPDATE users SET password_hash"),
  });

  const response = await fetch(`${fixture.base()}/api/profile/password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ currentPassword: "OldPassword1!", newPassword: "NewPassword2!" }),
  });
  assert.equal(response.status, 500);
  assert.equal((await response.json()).message, "Internal test error");
});

test("profile accepts square avatars and rejects non-square or invalid data", async (t) => {
  const fixture = await createApp(t);

  const accepted = await fetch(`${fixture.base()}/api/profile/avatar`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contentType: "image/png", data: squarePng }),
  });
  assert.equal(accepted.status, 200);
  assert.equal(fixture.avatar.contentType, "image/png");

  const rejected = await fetch(`${fixture.base()}/api/profile/avatar`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contentType: "image/png", data: rectangularPng }),
  });
  assert.equal(rejected.status, 400);
  assert.match((await rejected.json()).message, /square/i);

  const invalid = await fetch(`${fixture.base()}/api/profile/avatar`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contentType: "image/png", data: "not-base64!" }),
  });
  assert.equal(invalid.status, 400);
});

test("avatar storage failures return an error instead of a success response", async (t) => {
  const storageError = new Error("avatar write failed");
  const fixture = await createApp(t, {
    queryError: storageError,
    queryErrorWhen: (sql) => sql.startsWith("UPDATE users SET avatar_data"),
  });

  const response = await fetch(`${fixture.base()}/api/profile/avatar`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contentType: "image/png", data: squarePng }),
  });
  assert.equal(response.status, 500);
  assert.equal((await response.json()).message, "Internal test error");
  assert.equal(fixture.avatar.data, null);
});

test("stored avatars can be retrieved with their persisted content type", async (t) => {
  const fixture = await createApp(t);
  await fetch(`${fixture.base()}/api/profile/avatar`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contentType: "image/png", data: squarePng }),
  });

  const response = await fetch(`${fixture.base()}/api/profile/avatar`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/png");
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), Buffer.from(squarePng, "base64"));
});

test("avatar removal clears the stored image", async (t) => {
  const fixture = await createApp(t);
  await fetch(`${fixture.base()}/api/profile/avatar`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contentType: "image/png", data: squarePng }),
  });

  const removed = await fetch(`${fixture.base()}/api/profile/avatar`, { method: "DELETE" });
  assert.equal(removed.status, 200);
  assert.equal(fixture.avatar.data, null);
});