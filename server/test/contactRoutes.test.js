const { test } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { createContactRouter } = require("../routes/ContactRoutes");

const supportRecipient = "support@example.com";
const fromAddress = "sender@example.com";
const validPayload = {
  firstName: "Caleb",
  lastName: "Lewis",
  email: "visitor@example.com",
  message: "I need help starting a test run.",
};

async function createApp(t, options = {}) {
  const sentMessages = [];
  const transporter = {
    async sendMail(mailOptions) {
      sentMessages.push(mailOptions);
      if (options.sendMail) return options.sendMail(mailOptions);
      return { accepted: [mailOptions.to], rejected: [] };
    },
  };
  const app = express();
  app.use(express.json());
  app.use("/api/contact", createContactRouter(
    options.missingTransporter ? null : transporter,
    options.missingRecipient ? "" : supportRecipient,
    options.missingSender ? "" : fromAddress
  ));
  const server = await new Promise((resolve, reject) => {
    const listeningServer = app.listen(0, "127.0.0.1", () => resolve(listeningServer));
    listeningServer.once("error", reject);
  });
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));

  return {
    sentMessages,
    async submit(payload) {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/contact`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      return { status: response.status, body: await response.json() };
    },
  };
}

test("valid Contact submission sends one message with the configured addresses", async (t) => {
  const fixture = await createApp(t);
  const response = await fixture.submit(validPayload);

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, {
    message: "Your support request was submitted successfully.",
  });
  assert.equal(fixture.sentMessages.length, 1);
  const mail = fixture.sentMessages[0];
  assert.equal(mail.from, fromAddress);
  assert.equal(mail.to, supportRecipient);
  assert.equal(mail.replyTo, validPayload.email);
  assert.match(mail.subject, /Caleb Lewis/);
  assert.ok(mail.text.includes("Name: Caleb Lewis"));
  assert.ok(mail.text.includes(`Email: ${validPayload.email}`));
  assert.ok(mail.text.includes(validPayload.message));
});

test("Contact normalizes fields and preserves multiline message content", async (t) => {
  const fixture = await createApp(t);
  const message = "Error: ENOENT\nC:\\tests\\plan.json\nDetails: <tag> & café.";
  const response = await fixture.submit({
    firstName: "  Mary   Jane  ",
    lastName: "  O'Neil-Smith  ",
    email: "  VISITOR@EXAMPLE.COM  ",
    message: `  ${message}  `,
  });

  assert.equal(response.status, 200);
  assert.equal(fixture.sentMessages.length, 1);
  const mail = fixture.sentMessages[0];
  assert.match(mail.subject, /Mary Jane O'Neil-Smith/);
  assert.equal(mail.replyTo, "visitor@example.com");
  assert.ok(mail.text.includes("Name: Mary Jane O'Neil-Smith"));
  assert.ok(mail.text.endsWith(`Message: ${message}`));
});

test("Contact ignores user-supplied recipient and sender overrides", async (t) => {
  const fixture = await createApp(t);
  const response = await fixture.submit({
    ...validPayload,
    to: "other@example.com",
    supportRecipient: "other@example.com",
    from: "spoofed@example.com",
    fromAddress: "spoofed@example.com",
    replyTo: "other@example.com",
  });

  assert.equal(response.status, 200);
  assert.equal(fixture.sentMessages.length, 1);
  assert.equal(fixture.sentMessages[0].to, supportRecipient);
  assert.equal(fixture.sentMessages[0].from, fromAddress);
  assert.equal(fixture.sentMessages[0].replyTo, validPayload.email);
});

test("missing, blank, and non-string Contact fields are rejected without sending", async (t) => {
  const fixture = await createApp(t);
  for (const field of Object.keys(validPayload)) {
    for (const value of [undefined, null, "", " \n\t ", 123, true, [], {}]) {
      const response = await fixture.submit({ ...validPayload, [field]: value });
      assert.equal(response.status, 400, `${field} must reject ${JSON.stringify(value)}`);
      assert.equal(typeof response.body.message, "string");
    }
  }
  assert.equal(fixture.sentMessages.length, 0);
});

test("Contact enforces current name rules and email format", async (t) => {
  const fixture = await createApp(t);
  // The current backend regex requires names of at least three characters.
  for (const field of ["firstName", "lastName"]) {
    for (const value of ["A", "Al", "123", "Name!", "A".repeat(51)]) {
      const response = await fixture.submit({ ...validPayload, [field]: value });
      assert.equal(response.status, 400, `${field} must reject ${value}`);
    }
  }
  for (const email of ["not-an-email", "user@", "@example.com", "user name@example.com", "user@@example.com", "user@example.invalid"]) {
    const response = await fixture.submit({ ...validPayload, email });
    assert.equal(response.status, 400, `email must reject ${email}`);
  }
  assert.equal(fixture.sentMessages.length, 0);
});

test("Contact accepts length boundaries and rejects values above maximums", async (t) => {
  const fixture = await createApp(t);
  const emailAtLimit = `${"a".repeat(242)}@example.com`;
  assert.equal(emailAtLimit.length, 254);
  const accepted = await fixture.submit({
    firstName: "A".repeat(50),
    lastName: "B".repeat(50),
    email: emailAtLimit,
    message: "m".repeat(2000),
  });
  assert.equal(accepted.status, 200);
  assert.equal((await fixture.submit({ ...validPayload, firstName: "Ann", lastName: "Lee", message: "x" })).status, 200);
  assert.equal(fixture.sentMessages.length, 2);

  for (const [field, value] of [
    ["firstName", "A".repeat(51)],
    ["lastName", "B".repeat(51)],
    ["email", `a${emailAtLimit}`],
    ["message", "m".repeat(2001)],
  ]) {
    const response = await fixture.submit({ ...validPayload, [field]: value });
    assert.equal(response.status, 400, `${field} must enforce its maximum`);
  }
  assert.equal(fixture.sentMessages.length, 2);
});

for (const option of ["missingTransporter", "missingRecipient", "missingSender"]) {
  test(`Contact returns a safe 503 when ${option}`, async (t) => {
    const fixture = await createApp(t, { [option]: true });
    const response = await fixture.submit(validPayload);

    assert.equal(response.status, 503);
    assert.deepEqual(response.body, {
      message: "Your support request could not be submitted. Please try again.",
    });
    assert.equal(fixture.sentMessages.length, 0);
  });
}

test("mail rejection returns a safe error rather than success", async (t) => {
  const fixture = await createApp(t, {
    async sendMail() {
      throw new Error("Fake SMTP failure with private diagnostic details");
    },
  });
  const response = await fixture.submit(validPayload);

  assert.equal(response.status, 500);
  assert.deepEqual(response.body, {
    message: "Your support request could not be submitted. Please try again.",
  });
  assert.equal(fixture.sentMessages.length, 1);
});

test("Contact waits for mail-service acceptance before responding successfully", async (t) => {
  let acceptMail;
  let notifyMailStarted;
  const mailStarted = new Promise((resolve) => { notifyMailStarted = resolve; });
  const mailAccepted = new Promise((resolve) => { acceptMail = resolve; });
  t.after(() => acceptMail({ accepted: [supportRecipient] }));
  const fixture = await createApp(t, {
    async sendMail() {
      notifyMailStarted();
      return mailAccepted;
    },
  });
  let responseReceived = false;
  const pendingResponse = fixture.submit(validPayload).then((response) => {
    responseReceived = true;
    return response;
  });

  await mailStarted;
  assert.equal(responseReceived, false);
  acceptMail({ accepted: [supportRecipient] });
  const response = await pendingResponse;
  assert.equal(response.status, 200);
  assert.equal(fixture.sentMessages.length, 1);
});