const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const express = require("express");
const { createLaunchStore } = require("../lib/launchStore");
const { createLaunchService } = require("../lib/launchService");
const { createRunLaunchRouter } = require("../routes/RunLaunchRoutes");
const { createGuestReadiness } = require("../lib/guestReadiness");
const { LaunchError } = require("../lib/launchRequest");

const plan = () => ({
  schemaVersion: "dockvision.user-task-plan.v1",
  app: { name: "notepad", executable: "notepad.exe" },
  tasks: [{ id: "click", action: "CLICK", target: "editor" },
    { id: "type", action: "TYPE", text: "  Unicode: λ\t{ENTER} + ^ %\n " }],
});
const builtin = () => ({ executionMode: "builtin", testName: "Fixture", configFileName: "plan.json", configContent: JSON.stringify(plan()) });
const custom = (language = "python") => ({
  ...builtin(), executionMode: "custom", runnerScriptLanguage: language,
  runnerScriptName: language === "python" ? "runner.py" : "runner.ps1",
  runnerScriptContent: "# stored, never executed\n",
  configContent: '{ "tasks": [{ "action": "WAIT" }], "arbitrary": true }',
});
const json = async (file) => JSON.parse(await fs.readFile(file, "utf8"));

async function fixture(t, options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "dockvision-launch-"));
  let readinessCalls = 0;
  const store = createLaunchStore({ sharedRoot: root, io: options.io || fs });
  const readiness = options.readiness || (async () => { readinessCalls++; return { containerId: "stub-windows" }; });
  const launch = createLaunchService({ store, readiness });
  const supervisedRuns = [];
  const supervise = options.supervise || (async (runId) => { supervisedRuns.push(runId); });
  const app = express();
  app.use(createRunLaunchRouter({ launch, supervise }));
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(root, { recursive: true, force: true });
  });
  const post = async (body, route = "/api/runs/start", raw = false) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${route}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: raw ? body : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };
  return { root, store, launch, post, readinessCalls: () => readinessCalls,
    supervisedRuns, pointer: () => json(path.join(root, "active/current-run.json")) };
}

test("built-in admission writes a complete normalized envelope before publication", async (t) => {
  let observed = false;
  const io = { ...fs, async rename(from, to) {
    const pointer = await json(from);
    const root = path.dirname(path.dirname(to));
    const run = path.join(root, "runs", pointer.runId);
    const task = await json(path.join(run, "task.json"));
    const meta = await json(path.join(run, "meta.json"));
    assert.deepEqual(task.payload, await json(path.join(run, "task-plan.json")));
    assert.equal(meta.containerId, "stub-windows");
    await fs.access(path.join(run, "uploaded-config.json"));
    await fs.access(path.join(run, "logs/task.log"));
    observed = true;
    return fs.rename(from, to);
  } };
  const f = await fixture(t, { io });
  const result = await f.post(builtin());
  assert.equal(result.status, 202);
  assert.equal(result.body.containerId, "stub-windows");
  assert.match(result.body.runId, /^run-\d+-[a-f0-9]{6}$/);
  assert.equal(observed, true);
  const task = await json(path.join(f.root, "runs", result.body.runId, "task.json"));
  const pointer = await f.pointer();
  const iterationTask = await json(path.join(f.root, pointer.channel.taskPath));
  assert.equal(task.taskType, "task_sequence");
  assert.equal(task.payload.tasks[1].text, plan().tasks[1].text);
  assert.equal(task.payload.tasks[0].button, "left");
  assert.deepEqual(task.runOptions, { iterations: 1, captureIntervalSeconds: 5, iterationTimeoutSeconds: 300 });
  assert.equal(pointer.runId, result.body.runId);
  assert.equal(pointer.iterationNumber, 1);
  assert.equal(pointer.channel.screenshotsDir, `runs/${result.body.runId}/iterations/1/screenshots`);
  assert.equal(iterationTask.parentTaskId, task.taskId);
  assert.deepEqual(f.supervisedRuns, [result.body.runId]);
});

for (const language of ["python", "powershell"]) {
  test(`${language} custom input is stored unchanged with explicit options`, async (t) => {
    const f = await fixture(t);
    const request = custom(language);
    request.runOptions = { iterations: 3, captureIntervalSeconds: 60, iterationTimeoutSeconds: 12 };
    const result = await f.post(request);
    assert.equal(result.status, 202);
    const root = path.join(f.root, "runs", result.body.runId);
    const task = await json(path.join(root, "task.json"));
    assert.equal(task.taskType, "script_runner");
    assert.equal(task.payload.runnerScriptLanguage, language);
    assert.equal(await fs.readFile(path.join(root, task.payload.runnerPath), "utf8"), request.runnerScriptContent);
    assert.equal(await fs.readFile(path.join(root, task.payload.configPath), "utf8"), request.configContent);
    assert.deepEqual(task.runOptions, request.runOptions);
    assert.equal((await json(path.join(root, "meta.json"))).executionMode, "custom");
  });
}

for (const configContent of [
  '\uFEFF{ "tasks": [{"id":"custom", "action":"WAIT", "seconds":2}], "extra":"世界\\t\\n" }\r\n',
  "null",
  "[]",
  "42",
  '"text"',
  '{"tasks":[]}',
]) {
  test(`custom JSON ${JSON.stringify(configContent)} is preserved verbatim`, async (t) => {
    const f = await fixture(t);
    const request = { ...custom(), configContent };
    const result = await f.post(request);
    assert.equal(result.status, 202);
    const root = path.join(f.root, "runs", result.body.runId);
    const task = await json(path.join(root, "task.json"));
    assert.equal(await fs.readFile(path.join(root, "uploaded-config.json"), "utf8"), configContent);
    assert.equal(await fs.readFile(path.join(root, task.payload.configPath), "utf8"), configContent);
  });
}

test("invalid requests and malformed JSON fail before readiness or storage", async (t) => {
  const f = await fixture(t);
  const requests = [null, [], {}, { ...builtin(), executionMode: "other" },
    { ...builtin(), testName: " " }, { ...builtin(), configContent: "{" },
    { ...builtin(), configContent: "null" }, { ...builtin(), configFileName: "plan.txt" },
    { ...builtin(), runnerScriptName: "runner.py" }, { ...builtin(), payload: {} },
    { ...builtin(), taskType: "script_runner" }, { ...builtin(), runOptions: null },
    ...[0, 31, 1.5, "2"].map((iterations) => ({ ...builtin(), runOptions: { iterations } })),
    { ...builtin(), runOptions: { captureIntervalSeconds: 7 } },
    { ...builtin(), runOptions: { iterationTimeoutSeconds: -1 } },
    { ...builtin(), runOptions: { unexpected: true } },
    { ...custom(), runnerScriptContent: " " }, { ...custom(), runnerScriptLanguage: "javascript" },
    { ...custom(), runnerScriptName: "runner.ps1" }, { ...custom(), configContent: "bad" }];
  for (const request of requests) {
    const result = await f.post(request);
    assert.equal(result.status, 400, JSON.stringify(request));
    assert.equal(result.body.success, false);
    assert.equal(typeof result.body.code, "string");
    assert.ok(Array.isArray(result.body.fieldErrors));
  }
  assert.equal((await f.post('{"broken":', "/api/runs/start2", true)).status, 400);
  assert.equal(f.readinessCalls(), 0);
  assert.deepEqual(await fs.readdir(f.root), []);
});

test("built-in validation reports task fields; legacy targetApp and steps normalize", async (t) => {
  const f = await fixture(t);
  const invalid = plan();
  invalid.tasks[1].text = "";
  const rejected = await f.post({ ...builtin(), configContent: JSON.stringify(invalid) });
  assert.equal(rejected.body.code, "INVALID_TASK_PLAN");
  assert.equal(rejected.body.fieldErrors[0].path, "tasks[1].text");
  const legacy = { schemaVersion: "dockvision.plan.v1", targetApp: { name: "notepad", executable: "notepad.exe" }, steps: plan().tasks };
  const accepted = await f.post({ ...builtin(), configContent: JSON.stringify(legacy) });
  assert.equal(accepted.status, 202);
  const task = await json(path.join(f.root, "runs", accepted.body.runId, "task.json"));
  assert.equal(task.payload.schemaVersion, "dockvision.user-task-plan.v1");
  assert.ok(task.payload.app);
  assert.equal(task.payload.steps, undefined);
  assert.equal(task.payload.targetApp, undefined);
});

test("concurrent requests across every alias admit exactly one run", async (t) => {
  const f = await fixture(t);
  const routes = ["/api/runs/start", "/api/runs/start2", "/api/docker/start-smoke"];
  const results = await Promise.all(Array.from({ length: 12 }, (_, i) => f.post(i % 2 ? custom() : builtin(), routes[i % 3])));
  const winner = results.filter((result) => result.status === 202);
  assert.equal(winner.length, 1);
  for (const rejected of results.filter((result) => result.status !== 202)) {
    assert.equal(rejected.status, 409);
    assert.equal(rejected.body.activeRunId, winner[0].body.runId);
    assert.deepEqual(rejected.body.fieldErrors, []);
  }
  assert.equal(f.readinessCalls(), 1);
  assert.equal((await fs.readdir(path.join(f.root, "runs"))).length, 1);
});

for (const status of ["queued", "running", "cancelling"]) {
  test(`${status} blocks without replacing or recovering existing work`, async (t) => {
    const f = await fixture(t);
    const accepted = await f.post(builtin());
    const root = path.join(f.root, "runs", accepted.body.runId);
    const taskFile = path.join(root, "task.json");
    const task = await json(taskFile);
    task.status = status;
    await fs.writeFile(taskFile, JSON.stringify(task));
    const before = await fs.readFile(taskFile, "utf8");
    const result = await f.post(custom());
    assert.equal(result.status, 409);
    assert.equal(result.body.activeRunId, accepted.body.runId);
    assert.equal(await fs.readFile(taskFile, "utf8"), before);
    assert.equal((await f.pointer()).runId, accepted.body.runId);
  });
}

test("a terminal iteration pointer releases admission when the full run is terminal", async (t) => {
  const f = await fixture(t);
  const runId = "run-legacy-completed";
  const runRoot = path.join(f.root, "runs", runId);
  const iterationRoot = path.join(runRoot, "iterations", "1");
  await fs.mkdir(iterationRoot, { recursive: true });
  await fs.mkdir(path.join(f.root, "active"), { recursive: true });
  await fs.writeFile(path.join(runRoot, "meta.json"), JSON.stringify({
    status: "completed",
    iterationState: { total: 1, current: 1, completed: 1, failed: 0 },
  }));
  await fs.writeFile(path.join(runRoot, "task.json"), JSON.stringify({ status: "queued" }));
  await fs.writeFile(path.join(iterationRoot, "task.json"), JSON.stringify({ status: "completed" }));
  await fs.writeFile(path.join(iterationRoot, "result.json"), JSON.stringify({ status: "completed" }));
  await fs.writeFile(path.join(f.root, "active", "current-run.json"), JSON.stringify({
    runId,
    iterationNumber: 1,
    channel: {
      taskPath: `runs/${runId}/iterations/1/task.json`,
      resultPath: `runs/${runId}/iterations/1/result.json`,
      logsDir: `runs/${runId}/iterations/1/logs`,
      screenshotsDir: `runs/${runId}/iterations/1/screenshots`,
      artifactsDir: `runs/${runId}/iterations/1/artifacts`,
    },
  }));

  const accepted = await f.post(builtin());
  assert.equal(accepted.status, 202);
  assert.notEqual(accepted.body.runId, runId);
});

test("a completed iteration does not release a run with remaining iterations", async (t) => {
  const f = await fixture(t);
  const runId = "run-multiple-iterations";
  const runRoot = path.join(f.root, "runs", runId);
  const iterationRoot = path.join(runRoot, "iterations", "1");
  await fs.mkdir(iterationRoot, { recursive: true });
  await fs.mkdir(path.join(f.root, "active"), { recursive: true });
  // Iteration 1 is terminal, but metadata says iteration 2 is still outstanding.
  // A new launch must not replace the pointer during this supervisor handoff.
  await fs.writeFile(path.join(runRoot, "meta.json"), JSON.stringify({
    status: "running",
    iterationState: { total: 2, current: 1, completed: 1, failed: 0 },
  }));
  await fs.writeFile(path.join(runRoot, "task.json"), JSON.stringify({ status: "queued" }));
  await fs.writeFile(path.join(iterationRoot, "result.json"), JSON.stringify({ status: "completed" }));
  await fs.writeFile(path.join(f.root, "active", "current-run.json"), JSON.stringify({
    runId,
    iterationNumber: 1,
    channel: {
      taskPath: `runs/${runId}/iterations/1/task.json`,
      resultPath: `runs/${runId}/iterations/1/result.json`,
      logsDir: `runs/${runId}/iterations/1/logs`,
      screenshotsDir: `runs/${runId}/iterations/1/screenshots`,
      artifactsDir: `runs/${runId}/iterations/1/artifacts`,
    },
  }));

  const rejected = await f.post(builtin());
  assert.equal(rejected.status, 409);
  assert.equal(rejected.body.code, "RUN_ACTIVE");
  assert.equal(rejected.body.activeRunId, runId);
  assert.equal(f.readinessCalls(), 0);
});

test("aggregate cancellation releases admission after a completed fifth iteration", async (t) => {
  const f = await fixture(t);
  const runId = "run-cancelled-five-of-seven";
  const runRoot = path.join(f.root, "runs", runId);
  const iterationRoot = path.join(runRoot, "iterations", "5");
  await fs.mkdir(iterationRoot, { recursive: true });
  await fs.mkdir(path.join(f.root, "active"), { recursive: true });
  // The pointer remains useful for displaying iteration 5 artifacts, but the
  // aggregate cancellation must release the single-active-run admission gate.
  await fs.writeFile(path.join(runRoot, "meta.json"), JSON.stringify({
    status: "cancelled",
    iterationState: { total: 7, current: 5, completed: 5, failed: 0 },
  }));
  await fs.writeFile(path.join(runRoot, "task.json"), JSON.stringify({ status: "queued" }));
  await fs.writeFile(path.join(iterationRoot, "task.json"), JSON.stringify({ status: "completed" }));
  await fs.writeFile(path.join(iterationRoot, "result.json"), JSON.stringify({ status: "completed" }));
  await fs.writeFile(path.join(f.root, "active", "current-run.json"), JSON.stringify({
    runId,
    iterationNumber: 5,
    channel: {
      taskPath: `runs/${runId}/iterations/5/task.json`,
      resultPath: `runs/${runId}/iterations/5/result.json`,
      logsDir: `runs/${runId}/iterations/5/logs`,
      screenshotsDir: `runs/${runId}/iterations/5/screenshots`,
      artifactsDir: `runs/${runId}/iterations/5/artifacts`,
    },
  }));

  const accepted = await f.post(builtin());
  assert.equal(accepted.status, 202);
  assert.notEqual(accepted.body.runId, runId);
  assert.equal(f.readinessCalls(), 1);
});

test("non-iteration and cross-run pointers fail closed", async (t) => {
  const f = await fixture(t);
  const runId = "run-invalid-result-path";
  await fs.mkdir(path.join(f.root, "runs", runId), { recursive: true });
  await fs.mkdir(path.join(f.root, "active"), { recursive: true });
  const pointerPath = path.join(f.root, "active", "current-run.json");
  const invalidPointers = [
    {
      runId,
      channel: {
        taskPath: `runs/${runId}/task.json`,
        resultPath: `runs/${runId}/result.json`,
        logsDir: `runs/${runId}/logs`,
        screenshotsDir: `runs/${runId}/screenshots`,
        artifactsDir: `runs/${runId}/artifacts`,
      },
    },
    {
      runId,
      iterationNumber: 1,
      channel: {
        taskPath: "runs/another-run/iterations/1/task.json",
        resultPath: "runs/another-run/iterations/1/result.json",
        logsDir: "runs/another-run/iterations/1/logs",
        screenshotsDir: "runs/another-run/iterations/1/screenshots",
        artifactsDir: "runs/another-run/iterations/1/artifacts",
      },
    },
  ];

  for (const pointer of invalidPointers) {
    await fs.writeFile(pointerPath, JSON.stringify(pointer));
    const rejected = await f.post(builtin());
    assert.equal(rejected.status, 409);
    assert.equal(rejected.body.code, "ACTIVE_RUN_STATE_INVALID");
    assert.equal(rejected.body.activeRunId, runId);
  }
  assert.equal(f.readinessCalls(), 0);
});

test("readiness errors return useful 409 and publish nothing", async (t) => {
  const f = await fixture(t, { readiness: async () => { throw new LaunchError(409, "AGENT_NOT_READY", "Start the agent."); } });
  const result = await f.post(builtin());
  assert.equal(result.status, 409);
  assert.equal(result.body.code, "AGENT_NOT_READY");
  assert.equal(result.body.message, "Start the agent.");
  assert.deepEqual(await fs.readdir(f.root), []);
});

for (const failure of ["input", "metadata", "rename"]) {
  test(`${failure} failure leaves the previous terminal pointer intact and releases admission`, async (t) => {
    let fail = false;
    const io = { ...fs,
      async writeFile(file, ...args) {
        if (fail && ((failure === "input" && file.endsWith("uploaded-config.json")) || (failure === "metadata" && file.endsWith("meta.json")))) throw new Error("Injected write failure");
        return fs.writeFile(file, ...args);
      },
      async rename(...args) {
        if (fail && failure === "rename") throw new Error("Injected publication failure");
        return fs.rename(...args);
      },
    };
    const f = await fixture(t, { io });
    const first = await f.launch(builtin());
    await fs.writeFile(path.join(f.root, "runs", first.runId, "result.json"), JSON.stringify({ status: "completed" }));
    fail = true;
    await assert.rejects(f.launch(custom()), /Injected/);
    assert.equal((await f.pointer()).runId, first.runId);
    assert.deepEqual(await fs.readdir(path.join(f.root, "runs")), [first.runId]);
    assert.deepEqual(await fs.readdir(path.join(f.root, "active")), ["current-run.json"]);
    fail = false;
    const next = await f.launch(custom());
    assert.notEqual(next.runId, first.runId);
    assert.equal((await f.pointer()).runId, next.runId);
  });
}

test("corrupt and missing active state fail closed", async (t) => {
  const f = await fixture(t);
  await fs.mkdir(path.join(f.root, "active"));
  const pointer = path.join(f.root, "active/current-run.json");
  await fs.writeFile(pointer, "{");
  assert.equal((await f.post(builtin())).body.code, "ACTIVE_RUN_STATE_INVALID");
  await fs.writeFile(pointer, "null");
  assert.equal((await f.post(builtin())).body.code, "ACTIVE_RUN_STATE_INVALID");
  await fs.writeFile(pointer, JSON.stringify({ runId: "run-missing" }));
  const result = await f.post(builtin());
  assert.equal(result.status, 409);
  assert.equal(result.body.activeRunId, "run-missing");
  assert.equal(f.readinessCalls(), 0);
});

test("separate service instances sharing storage use the same admission lock", async (t) => {
  const f = await fixture(t);
  const other = createLaunchService({ store: createLaunchStore({ sharedRoot: f.root }),
    readiness: async () => ({ containerId: "stub-other" }) });
  const results = await Promise.allSettled([f.launch(builtin()), other(custom())]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.find((result) => result.status === "rejected").reason.code, "RUN_ACTIVE");
});

test("a readiness failure releases admission for a later retry", async (t) => {
  let ready = false;
  const f = await fixture(t, { readiness: async () => {
    if (!ready) throw new LaunchError(409, "GUEST_NOT_READY", "VM is starting.");
    return { containerId: "stub" };
  } });
  assert.equal((await f.post(builtin())).status, 409);
  ready = true;
  assert.equal((await f.post(builtin())).status, 202);
});

test("real readiness adapter checks running guest and fresh idle heartbeat without Docker", async (t) => {
  const f = await fixture(t);
  let status = { running: false, message: "VM stopped" };
  let now = Date.now();
  let starts = 0;
  const ready = createGuestReadiness({ sharedRoot: f.root, getStatus: async () => status,
    ensureRunning: async () => { starts++; }, now: () => now });
  await assert.rejects(ready(), { code: "GUEST_STARTING" });
  assert.equal(starts, 1);
  status = { running: true, containerId: "stub" };
  await assert.rejects(ready(), { code: "AGENT_NOT_READY" });
  const file = path.join(f.root, "agent-heartbeat.json");
  await fs.writeFile(file, JSON.stringify({ agent: { status: "idle", intervalSeconds: 15, runId: "" } }));
  assert.deepEqual(await ready(), { containerId: "stub" });
  assert.equal(starts, 1);
  status.startedAt = new Date(now + 1000).toISOString();
  await assert.rejects(ready(), { code: "AGENT_NOT_READY" });
  delete status.startedAt;
  now += 120000;
  await assert.rejects(ready(), { code: "AGENT_NOT_READY" });
  now = Date.now();
  await fs.writeFile(file, JSON.stringify({ agent: { status: "running", runId: "run-other" } }));
  await assert.rejects(ready(), { code: "AGENT_NOT_READY" });
});

test("cold launch starts the VM without publishing; ready retry admits the run", async (t) => {
  const f = await fixture(t);
  let status = { running: false, containerId: null };
  let starts = 0;
  const readiness = createGuestReadiness({ sharedRoot: f.root,
    getStatus: async () => status,
    ensureRunning: async () => { starts++; status = { running: true, containerId: "cold-start-stub" }; },
  });
  const launch = createLaunchService({ store: f.store, readiness });
  await assert.rejects(launch(custom()), { code: "GUEST_STARTING" });
  assert.deepEqual(await fs.readdir(f.root), []);
  await assert.rejects(launch(custom()), { code: "AGENT_NOT_READY" });
  await fs.writeFile(path.join(f.root, "agent-heartbeat.json"), JSON.stringify({ agent: { status: "idle", runId: "", intervalSeconds: 15 } }));
  const accepted = await launch(custom());
  assert.equal(accepted.containerId, "cold-start-stub");
  assert.equal(starts, 1);
  assert.equal((await f.pointer()).runId, accepted.runId);
});

test("VM startup failures produce actionable conflicts without publication", async (t) => {
  const f = await fixture(t);
  const readiness = createGuestReadiness({ sharedRoot: f.root,
    getStatus: async () => ({ running: false }),
    ensureRunning: async () => { throw new Error("Docker is unavailable"); },
  });
  const launch = createLaunchService({ store: f.store, readiness });
  await assert.rejects(launch(builtin()), (error) => {
    assert.equal(error.status, 409);
    assert.equal(error.code, "GUEST_START_FAILED");
    assert.match(error.message, /Docker is unavailable/);
    return true;
  });
  assert.deepEqual(await fs.readdir(f.root), []);
});