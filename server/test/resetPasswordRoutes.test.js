const { test } = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcrypt");
const crypto = require("crypto");
const express = require("express");
const createAuthRouter = require("../routes/AuthRoutes");

const RESET_TOKEN = "reset-token-for-isolated-tests";
const RESET_TOKEN_HASH = crypto.createHash("sha256").update(RESET_TOKEN).digest("hex");
const NEW_PASSWORD = "NewPassword2!";
const FIXTURE_NOW = new Date("2026-10-31T12:00:00.000Z");

//creates an isolated transactional auth fixture so reset completion never uses a shared database or live sessions.
async function createFixture(t, {
  expiresAt = new Date(FIXTURE_NOW.getTime() + 1_000),
  queryError,
  queryErrorWhen,
} = {}) {
  //seeds a second account so successful and rolled-back resets can prove they do not change unrelated authentication state.
  const state = {
    users: [
      { userId: 7, passwordHash: await bcrypt.hash("OldPassword1!", 4) },
      { userId: 8, passwordHash: await bcrypt.hash("OtherPassword1!", 4) },
    ],
    tokens: [
      { id: 41, userId: 7, tokenHash: RESET_TOKEN_HASH, expiresAt },
      { id: 42, userId: 8, tokenHash: "unrelated-token-hash", expiresAt },
    ],
    sessions: [
      { userId: 7, token: "session-7-a" },
      { userId: 7, token: "session-7-b" },
      { userId: 8, token: "session-8" },
    ],
  };
  const calls = [];
  let transactionState;

  //copies plain fixture records so rollback can discard every mutation made after BEGIN.
  function copyState(value) {
    return {
      users: value.users.map((user) => ({ ...user })),
      tokens: value.tokens.map((token) => ({ ...token })),
      sessions: value.sessions.map((session) => ({ ...session })),
    };
  }

  //runs transaction queries against an isolated working copy and publishes it only when COMMIT succeeds.
  async function query(sql, params = []) {
    calls.push({ sql, params });
    //raises only at the selected operation so the test can verify rollback after earlier mutations have run.
    if (queryError && (!queryErrorWhen || queryErrorWhen(sql, params))) {
      throw queryError;
    }
    if (sql === "BEGIN") {
      transactionState = copyState(state);
      return { rows: [] };
    }
    if (sql === "ROLLBACK") {
      transactionState = undefined;
      return { rows: [] };
    }
    if (sql === "COMMIT") {
      Object.assign(state, transactionState);
      transactionState = undefined;
      return { rows: [] };
    }

    const workingState = transactionState;
    if (sql.includes("FROM password_reset_tokens") && sql.includes("FOR UPDATE")) {
      //models the database predicate so equality with the database clock is rejected at the expiry boundary.
      const token = workingState.tokens.find((candidate) => (
        candidate.tokenHash === params[0] && candidate.expiresAt > FIXTURE_NOW
      ));
      return {
        rows: token ? [{
          password_reset_token_id: token.id,
          user_id: token.userId,
          expires_at: token.expiresAt,
        }] : [],
      };
    }
    if (sql.includes("UPDATE users") && sql.includes("password_hash")) {
      workingState.users.find((user) => user.userId === params[1]).passwordHash = params[0];
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes("DELETE FROM sessions")) {
      workingState.sessions = workingState.sessions.filter((session) => session.userId !== params[0]);
      return { rows: [], rowCount: 2 };
    }
    if (sql.includes("DELETE FROM password_reset_tokens")) {
      workingState.tokens = workingState.tokens.filter((token) => token.id !== params[0]);
      return { rows: [], rowCount: 1 };
    }
    throw new Error(`Unexpected query: ${sql}`);
  }

  const db = {
    async query() {
      return { rows: [] };
    },
    async connect() {
      //returns a per-request client that exposes only the transaction behavior exercised by reset completion.
      return { query, release() {} };
    },
  };
  const app = express();
  app.use(express.json());
  app.use("/api/auth", createAuthRouter(db));
  const server = await new Promise((resolve, reject) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
    listening.once("error", reject);
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return {
    calls,
    state,
    url: `http://127.0.0.1:${server.address().port}`,
  };
}

//submits reset completion through HTTP so assertions cover route validation as well as transactional persistence.
async function resetPassword(fixture, body) {
  return fetch(`${fixture.url}/api/auth/reset-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

//verifies malformed reset input cannot open a transaction or mutate account state.
test("reset completion validates token and password before database mutation", async (t) => {
  const fixture = await createFixture(t);

  for (const body of [
    { newPassword: NEW_PASSWORD },
    { token: RESET_TOKEN, newPassword: "weak" },
  ]) {
    const response = await resetPassword(fixture, body);
    assert.equal(response.status, 400);
  }

  //confirms validation failures return before the transaction fixture receives a query.
  assert.equal(fixture.calls.length, 0);
});

//verifies only tokens strictly after the database clock are eligible for password reset completion.
test("reset completion rejects expired tokens at and after the expiry boundary", async (t) => {
  for (const expiresAt of [
    new Date(FIXTURE_NOW.getTime() - 1),
    new Date(FIXTURE_NOW.getTime()),
  ]) {
    const fixture = await createFixture(t, { expiresAt });
    const response = await resetPassword(fixture, { token: RESET_TOKEN, newPassword: NEW_PASSWORD });

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { message: "Invalid or expired token" });
    assert.equal(fixture.state.users[0].passwordHash.startsWith("$2"), true);
    assert.equal(fixture.state.tokens.some((token) => token.id === 41), true);
    assert.equal(fixture.state.sessions.filter((session) => session.userId === 7).length, 2);
    //confirms completion uses the same strict expiry predicate as reset validation.
    assert.match(fixture.calls.find((call) => call.sql.includes("FOR UPDATE")).sql, /expires_at > CURRENT_TIMESTAMP/);
  }
});

//verifies a token immediately before expiry updates one password, invalidates its sessions, and consumes only that token.
test("reset completion commits password replacement, session invalidation, and single token consumption", async (t) => {
  const fixture = await createFixture(t, { expiresAt: new Date(FIXTURE_NOW.getTime() + 1) });

  const response = await resetPassword(fixture, { token: RESET_TOKEN, newPassword: NEW_PASSWORD });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { message: "Password reset successful" });
  assert.equal(await bcrypt.compare(NEW_PASSWORD, fixture.state.users[0].passwordHash), true);
  assert.equal(await bcrypt.compare("OtherPassword1!", fixture.state.users[1].passwordHash), true);
  assert.equal(fixture.state.tokens.some((token) => token.id === 41), false);
  assert.equal(fixture.state.tokens.some((token) => token.id === 42), true);
  assert.deepEqual(fixture.state.sessions, [{ userId: 8, token: "session-8" }]);
  //checks the commit order that prevents existing authenticated sessions from surviving a successful reset.
  const mutationQueries = fixture.calls.filter((call) => (
    call.sql.includes("UPDATE users") ||
    call.sql.includes("DELETE FROM sessions") ||
    call.sql.includes("DELETE FROM password_reset_tokens")
  ));
  assert.match(mutationQueries[0].sql, /UPDATE users/);
  assert.match(mutationQueries[1].sql, /DELETE FROM sessions/);
  assert.match(mutationQueries[2].sql, /DELETE FROM password_reset_tokens/);
});

//verifies a consumed token cannot update the password or invalidate sessions a second time.
test("reset completion rejects a consumed token without changing committed state", async (t) => {
  const fixture = await createFixture(t);

  assert.equal((await resetPassword(fixture, { token: RESET_TOKEN, newPassword: NEW_PASSWORD })).status, 200);
  const committedState = JSON.stringify(fixture.state);
  const secondResponse = await resetPassword(fixture, { token: RESET_TOKEN, newPassword: "AnotherPassword3!" });

  assert.equal(secondResponse.status, 400);
  assert.deepEqual(await secondResponse.json(), { message: "Invalid or expired token" });
  assert.equal(JSON.stringify(fixture.state), committedState);
});

//verifies a mutation-stage database failure rolls back all prior password, session, and token work.
test("reset completion rolls back partial authentication changes when a mutation fails", async (t) => {
  for (const stage of ["UPDATE users", "DELETE FROM sessions", "DELETE FROM password_reset_tokens"]) {
    const fixture = await createFixture(t, {
      queryError: new Error("fixture persistence failure"),
      queryErrorWhen: (sql) => sql.includes(stage),
    });
    const initialState = JSON.stringify(fixture.state);

    const response = await resetPassword(fixture, { token: RESET_TOKEN, newPassword: NEW_PASSWORD });

    assert.equal(response.status, 500, stage);
    assert.deepEqual(await response.json(), { message: "Server error" }, stage);
    //requires rollback to discard mutations completed before the selected stage raised its error.
    assert.equal(JSON.stringify(fixture.state), initialState, stage);
    assert.equal(fixture.calls.at(-1).sql, "ROLLBACK", stage);
  }
});