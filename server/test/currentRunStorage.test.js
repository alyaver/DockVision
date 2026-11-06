const { test } = require("node:test");
const assert = require("node:assert/strict");

const load = () => import("../../client/src/lib/currentRunStorage.mjs");

function createStorage(initialValue) {
  const values = new Map(initialValue === undefined ? [] : [["dockvision-current-run", initialValue]]);
  return {
    getItem(key) {
      return values.get(key) ?? null;
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

test("unavailable run clears only the matching browser handoff", async () => {
  const { CURRENT_RUN_STORAGE_KEY, clearStoredRunIfMatches } = await load();
  const storage = createStorage(JSON.stringify({ runId: "run-foreign", testName: "Foreign run" }));

  assert.equal(clearStoredRunIfMatches(storage, "run-foreign"), true);
  assert.equal(storage.getItem(CURRENT_RUN_STORAGE_KEY), null);
});

test("late unavailable response does not clear a newer run handoff", async () => {
  const { CURRENT_RUN_STORAGE_KEY, clearStoredRunIfMatches } = await load();
  const newerRun = JSON.stringify({ runId: "run-new", testName: "New run" });
  const storage = createStorage(newerRun);

  assert.equal(clearStoredRunIfMatches(storage, "run-old"), false);
  assert.equal(storage.getItem(CURRENT_RUN_STORAGE_KEY), newerRun);
});

test("malformed matching handoff is cleared instead of surviving indefinitely", async () => {
  const { CURRENT_RUN_STORAGE_KEY, clearStoredRunIfMatches } = await load();
  const storage = createStorage("{not-json");

  assert.equal(clearStoredRunIfMatches(storage, "run-unavailable"), true);
  assert.equal(storage.getItem(CURRENT_RUN_STORAGE_KEY), null);
});