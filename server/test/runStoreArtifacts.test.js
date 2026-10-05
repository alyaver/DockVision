const { test } = require("node:test");
const assert = require("node:assert/strict");
const { buildArtifactMap } = require("../lib/runStore");

test("artifact mapper normalizes each custom screenshot and builds a scoped URL", () => {
  const runId = "run-artifact-fixture";
  const artifacts = buildArtifactMap(runId, {
    screenshots: [
      "screenshots/task-periodic-01.png",
      `runs/${runId}/screenshots/task complete.png`,
    ],
  });

  assert.equal(Array.isArray(artifacts.screenshots), true);
  assert.deepEqual(artifacts.screenshots, [
    {
      rawPath: "screenshots/task-periodic-01.png",
      relativePath: "screenshots/task-periodic-01.png",
      url: `/api/runs/${runId}/files/screenshots/task-periodic-01.png`,
      fileName: "task-periodic-01.png",
    },
    {
      rawPath: `runs/${runId}/screenshots/task complete.png`,
      relativePath: "screenshots/task complete.png",
      url: `/api/runs/${runId}/files/screenshots/task%20complete.png`,
      fileName: "task complete.png",
    },
  ]);
});

test("artifact mapper retains iteration-relative screenshot arrays", () => {
  const runId = "run-iteration-fixture";
  const artifacts = buildArtifactMap(runId, {
    screenshot: `runs/${runId}/iterations/2/screenshots/task-complete.png`,
    screenshots: [
      "iterations/2/screenshots/task-periodic-01.png",
      `runs/${runId}/iterations/2/screenshots/task-complete.png`,
    ],
  });

  assert.deepEqual(artifacts.screenshot, {
    rawPath: `runs/${runId}/iterations/2/screenshots/task-complete.png`,
    relativePath: "iterations/2/screenshots/task-complete.png",
    url: `/api/runs/${runId}/files/iterations/2/screenshots/task-complete.png`,
    fileName: "task-complete.png",
  });
  assert.deepEqual(artifacts.screenshots.map((artifact) => artifact.url), [
    `/api/runs/${runId}/files/iterations/2/screenshots/task-periodic-01.png`,
    `/api/runs/${runId}/files/iterations/2/screenshots/task-complete.png`,
  ]);
});