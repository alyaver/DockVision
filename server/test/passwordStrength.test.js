const { test } = require("node:test");
const assert = require("node:assert/strict");

//loads the browser-shared module directly so its validation behavior is tested without a UI framework.
const load = () => import("../../client/src/lib/passwordStrength.mjs");

//verifies the shared form rules accept a complete password and reject each representative invalid boundary.
test("shared password requirements match the registration policy", async () => {
  //uses the helper output instead of duplicated regex assertions so the test protects submit eligibility.
  const { getPasswordRules } = await load();

  assert.equal(getPasswordRules("ValidPassword1!").every((rule) => rule.valid), true);
  assert.equal(getPasswordRules("short1!").every((rule) => rule.valid), false);
  assert.equal(getPasswordRules("A".repeat(65) + "a1!").every((rule) => rule.valid), false);
  assert.equal(getPasswordRules("NoNumber!").every((rule) => rule.valid), false);
});

//verifies the shared strength score produces the expected label and four-segment visual state.
test("shared password strength returns the existing registration score and level", async () => {
  //uses a password that satisfies all six score checks to cover the strongest display state.
  const { getPasswordStrength, getStrengthBarPresentation } = await load();
  const strength = getPasswordStrength("ValidPassword1!");

  assert.equal(strength.score, 6);
  assert.equal(strength.level.label, "Very strong");
  assert.deepEqual(getStrengthBarPresentation(strength.score), {
    filledSegmentCount: 4,
    color: "#1D9E75",
  });
});