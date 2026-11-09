const { test } = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcrypt");
const express = require("express");
const cookieParser = require("cookie-parser");
const authRoutes = require("../routes/AuthRoutes");

const PASSWORD = "ValidPass1!";

async function startAuthApp(t, options = {}) {
  const passwordHash = options.passwordHash || await bcrypt.hash(PASSWORD, 4);
  const user = {
    user_id: options.userId || 7,
    name: options.name || "Test User",
    email: options.email || "test@example.com",
    password_hash: passwordHash,
    failed_login_count: options.failedLoginCount || 0,
    lock_until: options.lockUntil || null,
    deletion_status: "active",
  };
  const sessions = new Map();
  const calls = [];

  const db = {
    calls,
    user,
    sessions,
    async query(sql, values = []) {
      calls.push({ sql, values });

      if (options.queryError && options.queryErrorWhen?.(sql)) {
        throw options.queryError;
      }

      if (sql.includes("SELECT user_id FROM users WHERE email")) {
        return { rows: options.existingEmail ? [{ user_id: user.user_id }] : [] };
      }

      if (sql.includes("INSERT INTO users")) {
        user.name = values[0];
        user.email = values[1];
        user.password_hash = values[2];
        return {
          rows: [{
            user_id: user.user_id,
            name: user.name,
            email: user.email,
            created_at: "2026-11-05T00:00:00.000Z",
          }],
        };
      }

      if (sql.includes("INSERT INTO sessions")) {
        const token = values[1];
        sessions.set(token, {
          user_id: values[0],
          expires_at: options.sessionExpired ? new Date("2000-01-01T00:00:00.000Z") : new Date("2099-01-01T00:00:00.000Z"),
        });
        return { rows: [] };
      }

      if (sql.includes("FROM sessions s") && sql.includes("JOIN users u")) {
        const token = values[0];
        const session = sessions.get(token);
        if (!session || session.expires_at <= new Date()) return { rows: [] };
        return { rows: [{ ...user, user_id: session.user_id }] };
      }

      if (sql.includes("FROM users") && sql.includes("password_hash")) {
        return options.userMissing ? { rows: [] } : { rows: [user] };
      }

      if (sql.includes("failed_login_count = $1") && sql.includes("lock_until = CURRENT_TIMESTAMP")) {
        user.failed_login_count = values[0];
        user.lock_until = "2099-01-01T00:00:00.000Z";
        return { rows: [] };
      }

      if (sql.includes("failed_login_count = $1")) {
        user.failed_login_count = values[0];
        return { rows: [] };
      }

      if (sql.includes("failed_login_count = 0")) {
        user.failed_login_count = 0;
        user.lock_until = null;
        return { rows: [] };
      }

      if (sql.includes("DELETE FROM sessions")) {
        const session = sessions.get(values[0]);
        if (session && session.expires_at <= new Date()) sessions.delete(values[0]);
        return { rows: [] };
      }

      if (sql.includes("UPDATE sessions")) {
        const session = sessions.get(values[0]);
        const renewable = session && session.expires_at > new Date() && session.expires_at <= new Date(Date.now() + 60 * 60 * 1000);
        if (!renewable) return { rowCount: 0, rows: [] };
        session.expires_at = new Date(Date.now() + 2 * 60 * 60 * 1000);
        return { rowCount: 1, rows: [] };
      }

      return { rows: [] };
    },
    async connect() {
      let snapshot;
      return {
        async query(sql, values = []) {
          if (sql === "BEGIN") {
            snapshot = {
              user: { ...user },
              sessions: new Map(sessions),
            };
            calls.push({ sql, values });
            return { rows: [] };
          }
          if (sql === "ROLLBACK") {
            Object.assign(user, snapshot.user);
            sessions.clear();
            for (const [token, session] of snapshot.sessions) sessions.set(token, session);
            calls.push({ sql, values });
            return { rows: [] };
          }
          if (sql === "COMMIT") {
            calls.push({ sql, values });
            return { rows: [] };
          }
          return db.query(sql, values);
        },
        release() {},
      };
    },
  };

  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api/auth", authRoutes(db));
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
    db,
    base: () => `http://127.0.0.1:${server.address().port}`,
    addSession(token, expiresAt) {
      sessions.set(token, { user_id: user.user_id, expires_at: new Date(expiresAt) });
    },
  };
}

test("registration normalizes input, creates a user, and establishes a session", async (t) => {
  const fixture = await startAuthApp(t);
  const response = await fetch(`${fixture.base()}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "  Test   User  ",
      email: " TEST@EXAMPLE.COM ",
      password: PASSWORD,
      confirmPassword: PASSWORD,
    }),
  });

  assert.equal(response.status, 201);
  assert.deepEqual((await response.json()).user, {
    user_id: 7,
    name: "Test User",
    email: "test@example.com",
    created_at: "2026-11-05T00:00:00.000Z",
  });
  assert.equal(fixture.db.user.name, "Test User");
  assert.equal(fixture.db.user.email, "test@example.com");
  assert.match(response.headers.get("set-cookie"), /session_token=/);
  assert.equal(fixture.db.sessions.size, 1);
});

test("registration rejects missing, malformed, and mismatched input without writes", async (t) => {
  for (const body of [
    { email: "test@example.com", password: PASSWORD, confirmPassword: PASSWORD },
    { name: "Test User", email: "invalid", password: PASSWORD, confirmPassword: PASSWORD },
    { name: "Test User", email: "test@example.com", password: PASSWORD, confirmPassword: "OtherPass1!" },
  ]) {
    const fixture = await startAuthApp(t);
    const response = await fetch(`${fixture.base()}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    assert.equal(response.status, 400);
    assert.equal(fixture.db.calls.some(({ sql }) => sql.includes("INSERT INTO users")), false);
  }
});

test("registration rejects duplicate emails", async (t) => {
  const fixture = await startAuthApp(t, { existingEmail: true });
  const response = await fetch(`${fixture.base()}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Test User", email: "test@example.com", password: PASSWORD, confirmPassword: PASSWORD }),
  });

  assert.equal(response.status, 409);
  assert.match((await response.json()).message, /already exists/i);
  assert.equal(fixture.db.calls.some(({ sql }) => sql.includes("INSERT INTO users")), false);
});

test("registration rolls back the user when session creation fails", async (t) => {
  const fixture = await startAuthApp(t, {
    queryError: new Error("session write failed"),
    queryErrorWhen: (sql) => sql.includes("INSERT INTO sessions"),
  });
  const response = await fetch(`${fixture.base()}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Test User", email: "test@example.com", password: PASSWORD, confirmPassword: PASSWORD }),
  });

  assert.equal(response.status, 500);
  assert.equal(fixture.db.user.name, "Test User");
  assert.equal(fixture.db.sessions.size, 0);
  assert.equal(fixture.db.calls.some(({ sql }) => sql === "ROLLBACK"), true);
});

test("registration rejects password length and character-boundary violations", async (t) => {
  for (const password of ["Short1!", "NoSymbol1", "NoNumber!", "a".repeat(65)]) {
    const fixture = await startAuthApp(t);
    const response = await fetch(`${fixture.base()}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Test User", email: "test@example.com", password, confirmPassword: password }),
    });
    assert.equal(response.status, 400, `expected password to be rejected: ${password}`);
    assert.equal(fixture.db.calls.some(({ sql }) => sql.includes("INSERT INTO users")), false);
  }
});

test("registration enforces the agreed name, email, symbol, and confirmation boundaries", async (t) => {
  const validCases = [
    { name: "Al", email: "al@example.mil", password: "ValidPass1!" },
    { name: "Anne-Marie", email: "anne.marie@example.org", password: "ValidPass1@" },
    { name: "O'Neil", email: "oneil@example.gov", password: "ValidPass1#" },
  ];
  for (const valid of validCases) {
    const fixture = await startAuthApp(t);
    const response = await fetch(`${fixture.base()}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...valid, confirmPassword: valid.password }),
    });
    assert.equal(response.status, 201, JSON.stringify(valid));
  }

  const invalidCases = [
    { name: "A", email: "a@example.com", password: "ValidPass1!", reason: "short name" },
    { name: "A1", email: "a@example.com", password: "ValidPass1!", reason: "digit in name" },
    { name: "1Alice", email: "a@example.com", password: "ValidPass1!", reason: "non-letter first name character" },
    { name: "Alice", email: ".alice@example.com", password: "ValidPass1!", reason: "leading local-part period" },
    { name: "Alice", email: "alice@example.xyz", password: "ValidPass1!", reason: "unsupported extension" },
    { name: "Alice", email: `alice${"x".repeat(45)}@example.com`, password: "ValidPass1!", reason: "email too long" },
    { name: "Alice", email: "alice@example.com", password: "ValidPass1?", reason: "unsupported password symbol" },
    { name: "Alice", email: "alice@example.com", password: "ValidPass1!", confirmPassword: "ValidPass1?", reason: "confirmation mismatch" },
  ];
  for (const invalid of invalidCases) {
    const fixture = await startAuthApp(t);
    const response = await fetch(`${fixture.base()}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...invalid, confirmPassword: invalid.confirmPassword || invalid.password }),
    });
    assert.equal(response.status, 400, invalid.reason);
    assert.equal(fixture.db.calls.some(({ sql }) => sql.includes("INSERT INTO users")), false, invalid.reason);
  }
});

test("login creates a session for valid credentials and rejects invalid credentials", async (t) => {
  const fixture = await startAuthApp(t);
  const valid = await fetch(`${fixture.base()}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: " TEST@EXAMPLE.COM ", password: PASSWORD }),
  });
  assert.equal(valid.status, 200);
  assert.deepEqual((await valid.json()).user.email, "test@example.com");
  assert.match(valid.headers.get("set-cookie"), /session_token=/);

  const invalid = await fetch(`${fixture.base()}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "test@example.com", password: "WrongPass1!" }),
  });
  assert.equal(invalid.status, 401);
  assert.match((await invalid.json()).message, /invalid email or password/i);
  assert.equal(fixture.db.user.failed_login_count, 1);
});

test("login locks an account on the fifth failed attempt and blocks later attempts", async (t) => {
  const fixture = await startAuthApp(t, { failedLoginCount: 4 });
  const response = await fetch(`${fixture.base()}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "test@example.com", password: "WrongPass1!" }),
  });
  assert.equal(response.status, 423);
  assert.match((await response.json()).message, /locked/i);
  assert.equal(fixture.db.user.failed_login_count, 5);

  const blocked = await fetch(`${fixture.base()}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "test@example.com", password: PASSWORD }),
  });
  assert.equal(blocked.status, 423);
  assert.equal(fixture.db.sessions.size, 0);
});

test("expired session cookies are rejected by /me and removed from storage", async (t) => {
  const fixture = await startAuthApp(t);
  fixture.addSession("expired-token", "2000-01-01T00:00:00.000Z");
  const response = await fetch(`${fixture.base()}/api/auth/me`, {
    headers: { Cookie: "session_token=expired-token" },
  });

  assert.equal(response.status, 401);
  assert.match((await response.json()).message, /not authenticated/i);
  assert.equal(fixture.db.sessions.has("expired-token"), false);
});

test("/me preserves a valid session and renews the same token when one hour remains", async (t) => {
  const fixture = await startAuthApp(t);
  fixture.addSession("renewable-token", new Date(Date.now() + 30 * 60 * 1000).toISOString());

  const response = await fetch(`${fixture.base()}/api/auth/me`, {
    headers: { Cookie: "session_token=renewable-token" },
  });

  assert.equal(response.status, 200);
  assert.equal((await response.json()).user.user_id, 7);
  assert.match(response.headers.get("set-cookie"), /session_token=renewable-token/);
  assert.ok(fixture.db.sessions.get("renewable-token").expires_at > new Date(Date.now() + 60 * 60 * 1000));
  assert.equal(fixture.db.sessions.has("renewable-token"), true);
});

test("/me rejects requests without a session token", async (t) => {
  const fixture = await startAuthApp(t);
  const response = await fetch(`${fixture.base()}/api/auth/me`);
  assert.equal(response.status, 401);
  assert.match((await response.json()).message, /not authenticated/i);
});