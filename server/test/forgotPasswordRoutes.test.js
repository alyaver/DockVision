const { test } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const crypto = require("crypto");
const { createForgotPasswordRouter } = require("../routes/ForgotPasswordRoutes");

const genericMessage = "If that email is registered, a reset link has been sent.";

//creates isolated HTTP, storage, and mail fixtures so password-reset tests never use SMTP or a shared database.
async function createFixture(t, {
  users = [],
  mailConfiguration = { clientUrl: "https://dockvision.example.test", user: "sender@example.test" },
  queryError,
  queryErrorWhen,
  sendMailError,
} = {}) {
  const attempts = [];
  const tokens = [];
  const calls = [];
  const messages = [];
  const db = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      //injects one chosen persistence failure so each response path can be verified without a real database.
      if (queryError && (!queryErrorWhen || queryErrorWhen(sql, params))) {
        throw queryError;
      }
      if (sql.includes("COUNT(DISTINCT email)")) {
        const uniqueEmails = new Set(
          attempts
            .filter((attempt) => attempt.ipAddress === params[0])
            .map((attempt) => attempt.email)
        );
        return { rows: [{ unique_email_count: uniqueEmails.size }] };
      }
      if (sql.includes("COUNT(*)::int AS request_count")) {
        const requestCount = attempts.filter(
          (attempt) => attempt.ipAddress === params[0] && attempt.email === params[1]
        ).length;
        return { rows: [{ request_count: requestCount }] };
      }
      if (sql.includes("INSERT INTO password_reset_request_attempts")) {
        attempts.push({ email: params[0], ipAddress: params[1] });
        return { rows: [] };
      }
      if (sql.includes("SELECT user_id FROM users")) {
        const user = users.find(
          (candidate) => candidate.email === params[0] && candidate.deletion_status === "active"
        );
        return { rows: user ? [{ user_id: user.user_id }] : [] };
      }
      if (sql.includes("DELETE FROM password_reset_tokens")) {
        for (let index = tokens.length - 1; index >= 0; index -= 1) {
          if (
            tokens[index].userId === params[0] &&
            (params.length === 1 || tokens[index].tokenHash === params[1])
          ) {
            tokens.splice(index, 1);
          }
        }
        return { rows: [] };
      }
      if (sql.includes("INSERT INTO password_reset_tokens")) {
        tokens.push({ userId: params[0], tokenHash: params[1] });
        return { rows: [] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  const transporter = {
    async sendMail(message) {
      //fails before retaining fixture mail so the test can prove no delivery was accepted.
      if (sendMailError) throw sendMailError;
      messages.push(message);
    },
  };
  const app = express();
  app.use(express.json());
  app.use("/api/forgot-password", createForgotPasswordRouter({
    db,
    transporter,
    mailConfiguration,
  }));
  const server = await new Promise((resolve, reject) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
    listening.once("error", reject);
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return {
    attempts,
    calls,
    messages,
    tokens,
    url: `http://127.0.0.1:${server.address().port}/api/forgot-password`,
  };
}

//submits through HTTP so the assertions include JSON parsing, route mounting, and the public response contract.
async function requestReset(fixture, email) {
  return fetch(fixture.url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": "203.0.113.7" },
    body: JSON.stringify({ email }),
  });
}

test("registered active accounts receive a normalized-recipient reset email with a hashed stored token", async (t) => {
  //verifies the observable delivery contract while keeping SMTP and token storage fully local to the fixture.
  const fixture = await createFixture(t, {
    users: [{ user_id: 11, email: "member@example.com", deletion_status: "active" }],
  });

  const response = await requestReset(fixture, "  MEMBER@example.com ");

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { message: genericMessage });
  assert.equal(fixture.messages.length, 1);
  assert.equal(fixture.messages[0].from, "sender@example.test");
  assert.equal(fixture.messages[0].to, "member@example.com");
  //derives the raw secret from the captured link to prove it differs from the persisted digest.
  const rawToken = new URL(fixture.messages[0].html.match(/https:\/\/[^"\s<]+/)[0]).searchParams.get("token");
  assert.match(fixture.messages[0].html, /https:\/\/dockvision\.example\.test\/set-new-password\?token=/);
  assert.equal(fixture.tokens.length, 1);
  assert.equal(fixture.tokens[0].tokenHash, crypto.createHash("sha256").update(rawToken).digest("hex"));
  assert.notEqual(fixture.tokens[0].tokenHash, rawToken);
});

test("unknown and deletion-pending addresses receive the normal acknowledgement without tokens or email", async (t) => {
  //compares both non-eligible cases so the route cannot reveal whether an address belongs to a pending account.
  const fixture = await createFixture(t, {
    users: [{ user_id: 12, email: "pending@example.com", deletion_status: "pending" }],
  });

  const unknownResponse = await requestReset(fixture, "unknown@example.com");
  const pendingResponse = await requestReset(fixture, "pending@example.com");

  assert.equal(unknownResponse.status, 200);
  assert.equal(pendingResponse.status, 200);
  assert.deepEqual(await unknownResponse.json(), { message: genericMessage });
  assert.deepEqual(await pendingResponse.json(), { message: genericMessage });
  assert.equal(fixture.messages.length, 0);
  assert.equal(fixture.tokens.length, 0);
  assert.equal(fixture.attempts.length, 2);
});

test("malformed reset addresses fail before rate-limit storage, lookup, token creation, or delivery", async (t) => {
  //starts with an active fixture account to prove validation short-circuits before account eligibility could matter.
  const fixture = await createFixture(t, {
    users: [{ user_id: 13, email: "member@example.com", deletion_status: "active" }],
  });

  const response = await requestReset(fixture, "not-an-email");

  assert.equal(response.status, 400);
  assert.match((await response.json()).message, /email must be valid/i);
  assert.equal(fixture.attempts.length, 0);
  assert.equal(fixture.tokens.length, 0);
  assert.equal(fixture.messages.length, 0);
  assert.equal(fixture.calls.length, 0);
});

//verifies unavailable mail configuration fails before the request can create durable reset state.
test("missing mail configuration returns a non-confirming service failure before storage or delivery", async (t) => {
  //omits the server-owned origin and sender to prove configuration failure cannot create an attempt or token.
  const fixture = await createFixture(t, {
    users: [{ user_id: 14, email: "member@example.com", deletion_status: "active" }],
    mailConfiguration: null,
  });

  const response = await requestReset(fixture, "member@example.com");

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { message: "Email service is not configured yet." });
  //confirms the early configuration guard prevents both rate-limit writes and reset-token preparation.
  assert.equal(fixture.calls.length, 0);
  assert.equal(fixture.attempts.length, 0);
  assert.equal(fixture.tokens.length, 0);
  assert.equal(fixture.messages.length, 0);
});

//verifies each critical persistence dependency fails closed instead of reporting a potentially undelivered reset link.
test("database failures return a non-confirming error without delivering a reset email", async (t) => {
  //covers each write/read stage that must fail closed rather than acknowledge delivery after partial request handling.
  const failureStages = [
    "COUNT(DISTINCT email)",
    "COUNT(*)::int AS request_count",
    "INSERT INTO password_reset_request_attempts",
    "SELECT user_id FROM users",
    "DELETE FROM password_reset_tokens WHERE user_id = $1",
    "INSERT INTO password_reset_tokens",
  ];

  for (const stage of failureStages) {
    const fixture = await createFixture(t, {
      users: [{ user_id: 15, email: "member@example.com", deletion_status: "active" }],
      queryError: new Error("fixture database failure"),
      queryErrorWhen: (sql) => sql.includes(stage),
    });

    const response = await requestReset(fixture, "member@example.com");

    assert.equal(response.status, 500, stage);
    assert.deepEqual(await response.json(), { message: "Server error. Please try again." }, stage);
    //requires every failed stage to prevent transport acceptance regardless of work completed earlier in the request.
    assert.equal(fixture.messages.length, 0, stage);
  }
});

//verifies a rejected mail handoff removes the exact prepared token before returning a non-confirming delivery error.
test("transport failures remove only the prepared token and do not acknowledge delivery", async (t) => {
  //uses an opaque provider error message so the response assertion proves it is not forwarded to clients.
  const fixture = await createFixture(t, {
    users: [{ user_id: 16, email: "member@example.com", deletion_status: "active" }],
    sendMailError: new Error("provider rejected private reset payload"),
  });

  const response = await requestReset(fixture, "member@example.com");

  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { message: "Unable to send reset email. Please try again." });
  assert.equal(fixture.messages.length, 0);
  assert.equal(fixture.tokens.length, 0);
  //inspects the conditional delete to ensure a concurrent replacement token cannot be deleted by this cleanup.
  const cleanupCall = fixture.calls.find((call) => (
    call.sql.includes("DELETE FROM password_reset_tokens WHERE user_id = $1 AND token_hash = $2")
  ));
  assert.ok(cleanupCall);
  assert.equal(cleanupCall.params.length, 2);
});

//verifies an unproven token cleanup remains a server failure rather than claiming email delivery succeeded.
test("transport cleanup failures return a server error instead of confirming delivery", async (t) => {
  //fails the conditional cleanup after token preparation so the route does not claim the email was sent or token was removed.
  const fixture = await createFixture(t, {
    users: [{ user_id: 17, email: "member@example.com", deletion_status: "active" }],
    sendMailError: new Error("provider rejected message"),
    queryError: new Error("cleanup unavailable"),
    queryErrorWhen: (sql) => sql.includes("DELETE FROM password_reset_tokens WHERE user_id = $1 AND token_hash = $2"),
  });

  const response = await requestReset(fixture, "member@example.com");

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { message: "Server error. Please try again." });
  assert.equal(fixture.messages.length, 0);
  //preserves the prepared-token observation because the simulated conditional delete did not complete.
  assert.equal(fixture.tokens.length, 1);
});