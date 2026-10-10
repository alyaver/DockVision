const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

test("supervisor preserves a pre-published first iteration and publishes the next iteration", async (t) => {
  const sharedRoot = await fs.mkdtemp(path.join(os.tmpdir(), "dockvision-supervisor-"));
  const previousSharedRoot = process.env.DOCKVISION_SHARED_ROOT;
  process.env.DOCKVISION_SHARED_ROOT = sharedRoot;

  // runStore resolves its shared root at module load time. Reload both modules
  // so this test cannot read or modify the developer's real VM-shared directory.
  const runStorePath = require.resolve("../lib/runStore");
  const supervisorPath = require.resolve("../lib/runSupervisior");
  delete require.cache[runStorePath];
  delete require.cache[supervisorPath];
  const { superviseRun } = require("../lib/runSupervisior");

  t.after(async () => {
    delete require.cache[runStorePath];
    delete require.cache[supervisorPath];
    if (previousSharedRoot === undefined) {
      delete process.env.DOCKVISION_SHARED_ROOT;
    } else {
      process.env.DOCKVISION_SHARED_ROOT = previousSharedRoot;
    }
    await fs.rm(sharedRoot, { recursive: true, force: true });
  });

  const runId = "run-1234567890-abcdef";
  const runRoot = path.join(sharedRoot, "runs", runId);
  const firstIterationRoot = path.join(runRoot, "iterations", "1");
  const secondIterationRoot = path.join(runRoot, "iterations", "2");
  await fs.mkdir(path.join(firstIterationRoot, "logs"), { recursive: true });
  await fs.mkdir(path.join(firstIterationRoot, "screenshots"), { recursive: true });
  await fs.mkdir(path.join(firstIterationRoot, "artifacts"), { recursive: true });
  await fs.mkdir(path.join(runRoot, "logs"), { recursive: true });
  await fs.mkdir(path.join(sharedRoot, "active"), { recursive: true });

  const rootTask = {
    runId,
    taskId: `${runId}-task`,
    taskType: "script_runner",
    status: "queued",
    createdUtc: "2026-10-10T00:00:00.000Z",
    runOptions: { iterations: 2, captureIntervalSeconds: 5, iterationTimeoutSeconds: 300 },
    payload: { runnerPath: "uploaded-runner.py", configPath: "uploaded-task-plan.json" },
  };
  const firstTask = {
    ...rootTask,
    taskId: `${runId}-iteration-1`,
    parentTaskId: rootTask.taskId,
    iterationNumber: 1,
  };
  const meta = {
    runId,
    taskId: rootTask.taskId,
    status: "queued",
    createdUtc: rootTask.createdUtc,
    settings: rootTask.runOptions,
    iterationState: { total: 2, current: 1, completed: 0, failed: 0 },
  };
  const pointer = {
    runId,
    iterationNumber: 1,
    createdUtc: rootTask.createdUtc,
    updatedUtc: rootTask.createdUtc,
    channel: {
      taskPath: `runs/${runId}/iterations/1/task.json`,
      resultPath: `runs/${runId}/iterations/1/result.json`,
      logsDir: `runs/${runId}/iterations/1/logs`,
      screenshotsDir: `runs/${runId}/iterations/1/screenshots`,
      artifactsDir: `runs/${runId}/iterations/1/artifacts`,
    },
  };

  await Promise.all([
    fs.writeFile(path.join(runRoot, "meta.json"), JSON.stringify(meta)),
    fs.writeFile(path.join(runRoot, "task.json"), JSON.stringify(rootTask)),
    fs.writeFile(path.join(runRoot, "logs", "task.log"), ""),
    fs.writeFile(path.join(firstIterationRoot, "task.json"), JSON.stringify(firstTask)),
    fs.writeFile(path.join(firstIterationRoot, "result.json"), JSON.stringify({ status: "completed" })),
    fs.writeFile(path.join(sharedRoot, "active", "current-run.json"), JSON.stringify(pointer)),
  ]);

  const originalFirstTask = await fs.readFile(path.join(firstIterationRoot, "task.json"), "utf8");
  const supervision = superviseRun(runId);

  // Supervision waits on result files, so poll only until iteration 2 is
  // published and then provide its synthetic guest result to finish the test.
  let secondTask;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      secondTask = JSON.parse(await fs.readFile(path.join(secondIterationRoot, "task.json"), "utf8"));
      break;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  assert.ok(secondTask, "Supervisor did not publish iteration 2.");
  assert.equal(secondTask.iterationNumber, 2);
  assert.equal(secondTask.parentTaskId, rootTask.taskId);
  assert.equal(await fs.readFile(path.join(firstIterationRoot, "task.json"), "utf8"), originalFirstTask);

  await fs.writeFile(path.join(secondIterationRoot, "result.json"), JSON.stringify({ status: "completed" }));
  await supervision;

  const finalPointer = JSON.parse(await fs.readFile(path.join(sharedRoot, "active", "current-run.json"), "utf8"));
  const finalMeta = JSON.parse(await fs.readFile(path.join(runRoot, "meta.json"), "utf8"));
  assert.equal(finalPointer.iterationNumber, 2);
  assert.equal(finalPointer.channel.screenshotsDir, `runs/${runId}/iterations/2/screenshots`);
  assert.deepEqual(finalMeta.iterationState, { total: 2, current: 2, completed: 2, failed: 0 });
});

test("supervisor resumes a completed second iteration and publishes iteration 3", async (t) => {
  const sharedRoot = await fs.mkdtemp(path.join(os.tmpdir(), "dockvision-supervisor-resume-"));
  const previousSharedRoot = process.env.DOCKVISION_SHARED_ROOT;
  process.env.DOCKVISION_SHARED_ROOT = sharedRoot;

  const runStorePath = require.resolve("../lib/runStore");
  const supervisorPath = require.resolve("../lib/runSupervisior");
  delete require.cache[runStorePath];
  delete require.cache[supervisorPath];
  const { superviseRun } = require("../lib/runSupervisior");

  t.after(async () => {
    delete require.cache[runStorePath];
    delete require.cache[supervisorPath];
    if (previousSharedRoot === undefined) delete process.env.DOCKVISION_SHARED_ROOT;
    else process.env.DOCKVISION_SHARED_ROOT = previousSharedRoot;
    await fs.rm(sharedRoot, { recursive: true, force: true });
  });

  const runId = "run-1234567890-resume";
  const runRoot = path.join(sharedRoot, "runs", runId);
  const secondIterationRoot = path.join(runRoot, "iterations", "2");
  const thirdIterationRoot = path.join(runRoot, "iterations", "3");
  await Promise.all([
    fs.mkdir(path.join(runRoot, "logs"), { recursive: true }),
    fs.mkdir(path.join(secondIterationRoot, "logs"), { recursive: true }),
    fs.mkdir(path.join(secondIterationRoot, "screenshots"), { recursive: true }),
    fs.mkdir(path.join(secondIterationRoot, "artifacts"), { recursive: true }),
    fs.mkdir(path.join(sharedRoot, "active"), { recursive: true }),
  ]);

  const settings = { iterations: 3, captureIntervalSeconds: 5, iterationTimeoutSeconds: 300 };
  const rootTask = {
    runId,
    taskId: `${runId}-task`,
    taskType: "script_runner",
    status: "queued",
    createdUtc: "2026-10-10T00:00:00.000Z",
    runOptions: settings,
    payload: { runnerPath: "uploaded-runner.py", configPath: "uploaded-task-plan.json" },
  };
  const secondTask = {
    ...rootTask,
    taskId: `${runId}-iteration-2`,
    parentTaskId: rootTask.taskId,
    iterationNumber: 2,
  };
  const pointer = {
    runId,
    iterationNumber: 2,
    createdUtc: rootTask.createdUtc,
    updatedUtc: rootTask.createdUtc,
    channel: {
      taskPath: `runs/${runId}/iterations/2/task.json`,
      resultPath: `runs/${runId}/iterations/2/result.json`,
      logsDir: `runs/${runId}/iterations/2/logs`,
      screenshotsDir: `runs/${runId}/iterations/2/screenshots`,
      artifactsDir: `runs/${runId}/iterations/2/artifacts`,
    },
  };

  await Promise.all([
    // This is the crash window observed in production: iteration 2 wrote a
    // result, but the supervisor had not advanced metadata or published 3.
    fs.writeFile(path.join(runRoot, "meta.json"), JSON.stringify({
      runId,
      taskId: rootTask.taskId,
      status: "completed",
      finishedUtc: "2026-10-10T00:05:00.000Z",
      createdUtc: rootTask.createdUtc,
      settings,
      iterationState: { total: 3, current: 2, completed: 1, failed: 0 },
    })),
    fs.writeFile(path.join(runRoot, "task.json"), JSON.stringify(rootTask)),
    fs.writeFile(path.join(runRoot, "logs", "task.log"), ""),
    fs.writeFile(path.join(secondIterationRoot, "task.json"), JSON.stringify(secondTask)),
    fs.writeFile(path.join(secondIterationRoot, "result.json"), JSON.stringify({
      status: "completed",
      finishedUtc: "2026-10-10T00:05:00.000Z",
    })),
    fs.writeFile(path.join(sharedRoot, "active", "current-run.json"), JSON.stringify(pointer)),
  ]);

  const supervision = superviseRun(runId);
  let thirdTask;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      thirdTask = JSON.parse(await fs.readFile(path.join(thirdIterationRoot, "task.json"), "utf8"));
      break;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  assert.ok(thirdTask, "Supervisor did not resume with iteration 3.");
  assert.equal(thirdTask.iterationNumber, 3);
  assert.equal(thirdTask.parentTaskId, rootTask.taskId);

  await fs.writeFile(path.join(thirdIterationRoot, "result.json"), JSON.stringify({
    status: "completed",
    finishedUtc: "2026-10-10T00:06:00.000Z",
  }));
  await supervision;

  const finalMeta = JSON.parse(await fs.readFile(path.join(runRoot, "meta.json"), "utf8"));
  const finalPointer = JSON.parse(await fs.readFile(path.join(sharedRoot, "active", "current-run.json"), "utf8"));
  assert.equal(finalPointer.iterationNumber, 3);
  assert.equal(finalMeta.status, "completed");
  assert.equal(finalMeta.finishedUtc, "2026-10-10T00:06:00.000Z");
  assert.deepEqual(finalMeta.iterationState, { total: 3, current: 3, completed: 3, failed: 0 });
});