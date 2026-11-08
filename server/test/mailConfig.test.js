const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readMailConfiguration } = require("../lib/mailConfig");

//builds an isolated complete configuration so each test changes only the setting it is verifying.
function validEnvironment(overrides = {}) {
  return {
    EMAIL_HOST: "smtp.example.test",
    EMAIL_PORT: "587",
    EMAIL_USER: "sender@example.test",
    EMAIL_PASS: "test-only-secret",
    CLIENT_URL: "https://dockvision.example.test",
    ...overrides,
  };
}

test("mail configuration accepts a complete SMTP configuration and normalized application origin", () => {
  //proves a trailing slash cannot create a double slash before the server appends the reset route.
  const configuration = readMailConfiguration(validEnvironment({ CLIENT_URL: "https://dockvision.example.test/" }));

  assert.deepEqual(configuration, {
    host: "smtp.example.test",
    port: 587,
    user: "sender@example.test",
    pass: "test-only-secret",
    clientUrl: "https://dockvision.example.test",
  });
});

test("mail configuration rejects missing required values and invalid SMTP ports", () => {
  //covers values that would otherwise initialize a partially usable SMTP transport.
  for (const overrides of [
    { EMAIL_HOST: "" },
    { EMAIL_PORT: "" },
    { EMAIL_PORT: "587.5" },
    { EMAIL_PORT: "0" },
    { EMAIL_PORT: "65536" },
    { EMAIL_USER: "" },
    { EMAIL_PASS: "" },
    { CLIENT_URL: "" },
  ]) {
    assert.equal(readMailConfiguration(validEnvironment(overrides)), null);
  }
});

test("mail configuration rejects reset origins that are not bare absolute HTTP(S) origins", () => {
  //prevents configured path/query/fragment data from changing the server-owned reset-link route.
  for (const clientUrl of [
    "dockvision.example.test",
    "ftp://dockvision.example.test",
    "https://dockvision.example.test/reset",
    "https://dockvision.example.test?preview=true",
    "https://dockvision.example.test#fragment",
  ]) {
    assert.equal(readMailConfiguration(validEnvironment({ CLIENT_URL: clientUrl })), null);
  }
});