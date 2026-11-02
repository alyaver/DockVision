const { test } = require("node:test");
const assert = require("node:assert/strict");

const load = () => import("../../client/src/lib/passwordStrength.mjs");

test("shared password requirements match the registration policy", async () => {
  const { getPasswordRules } = await load();

  assert.equal(getPasswordRules("ValidPassword1!").every((rule) => rule.valid), true);
  assert.equal(getPasswordRules("short1!").every((rule) => rule.valid), false);
  assert.equal(getPasswordRules("A".repeat(65) + "a1!").every((rule) => rule.valid), false);
  assert.equal(getPasswordRules("NoNumber!").every((rule) => rule.valid), false);
});

test("shared password strength returns the existing registration score and level", async () => {
  const { getPasswordStrength, getStrengthBarPresentation } = await load();
  const strength = getPasswordStrength("ValidPassword1!");

  assert.equal(strength.score, 6);
  assert.equal(strength.level.label, "Very strong");
  assert.deepEqual(getStrengthBarPresentation(strength.score), {
    filledSegmentCount: 4,
    color: "#1D9E75",
  });
});