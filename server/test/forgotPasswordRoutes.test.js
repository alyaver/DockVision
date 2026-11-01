const { test } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const crypto = require("crypto");
const { createForgotPasswordRouter } = require("../routes/ForgotPasswordRoutes");

const genericMessage = "If that email is registered, a reset link has been sent.";

//creates isolated HTTP, storage, and mail fixtures so password-reset tests never use SMTP or a shared database.
async function createFixture(t, { users = [] } = {}) {
  const attempts = [];
  const tokens = [];
  const calls = [];
  const messages = [];
  const db = {
    async query(sql, params = []) {
      calls.push({ sql, params });
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
          if (tokens[index].userId === params[0]) tokens.splice(index, 1);
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
      messages.push(message);
    },
  };
  const app = express();
  app.use(express.json());
  app.use("/api/forgot-password", createForgotPasswordRouter({
    db,
    transporter,
    mailConfiguration: {
      clientUrl: "https://dockvision.example.test",
      user: "sender@example.test",
    },
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