const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

// Load runStore with an in-memory filesystem instead of the real shared folder.
function loadStore() {
  // Keep each test's files separate from every other test.
  const files = new Map();
  // Count filesystem calls so validation tests can prove no files were written.
  let calls = 0;
  // Provide only the filesystem methods runStore needs during these tests.
  const storage = {
    async mkdir() { calls++; },
    async readdir() { calls++; return []; },
    async rm(file) { calls++; files.delete(file); },
    async writeFile(file, content) { calls++; files.set(file, content); },
    async appendFile(file, content) { calls++; files.set(file, (files.get(file) || '') + content); },
    async readFile(file) {
      calls++;
      if (files.has(file)) return files.get(file);
      throw Object.assign(new Error('Not found'), { code: 'ENOENT' });
    },
  };
  // Load the real module source, but resolve its normal local dependencies.
  const filename = path.resolve(__dirname, '../server/lib/runStore.js');
  const localRequire = createRequire(filename);
  const module = { exports: {} };
  // Run the real store code with the in-memory filesystem above.
  // Pass both CommonJS export objects so module.exports works like it does in Node.
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    require(name) {
      if (name === 'fs/promises') return storage;
      assert.ok(['path', 'crypto', './test-script/readTestScript'].includes(name), `Unexpected dependency: ${name}`);
      return localRequire(name);
    },
    module, exports: module.exports, __dirname: path.dirname(filename), console, process,
  }, { filename });
  // Return the loaded store and the files it wrote for each test to inspect.
  return { store: module.exports, files, calls: () => calls };
}

// Build a normal custom-runner request with caller-provided JSON content.
const options = configContent => ({
  executionMode: 'custom',
  runnerScriptName: 'runner.py',
  runnerScriptContent: "print('custom runner')\n",
  configFileName: 'config.json',
  configContent,
});

test('supervised run preserves canonical runOptions and legacy agent settings', async () => {
  // Create an isolated copy of the store and use explicit modern run options.
  const { store, files } = loadStore();
  const runOptions = { iterations: 3, captureIntervalSeconds: 10, iterationTimeoutSeconds: 45 };
  // Top-level iterations should not override the nested runOptions value.
  const result = await store.createRunRecord2({
    ...options('{}'), runOptions, iterations: 9,
  });
  // Read the task and metadata that would have been written to the shared folder.
  const task = JSON.parse(files.get(result.paths.taskPath));
  const meta = JSON.parse(files.get(result.paths.metaPath));
  // Both current and older agent fields should contain the same settings.
  assert.deepEqual(task.runOptions, runOptions);
  assert.deepEqual(task.settings, runOptions);
  assert.deepEqual(meta.runOptions, runOptions);
  assert.equal(meta.iterationState.total, 3);
});

test('supervised run defaults to the handbook timeout', async () => {
  // Create a run without any optional run settings.
  const { store } = loadStore();
  const result = await store.createRunRecord2(options('{}'));
  // Verify the agent receives the documented default values.
  assert.equal(result.task.settings.iterations, 1);
  assert.equal(result.task.settings.captureIntervalSeconds, 5);
  assert.equal(result.task.settings.iterationTimeoutSeconds, 300);
});

test('supervised built-in run keeps normalized tasks and execution options', async () => {
  // Submit a legacy built-in plan so the store must normalize it.
  const { store } = loadStore();
  const result = await store.createRunRecord2({
    executionMode: 'builtin',
    configFileName: 'plan.json',
    configContent: JSON.stringify({
      schemaVersion: 'dockvision.plan.v1',
      targetApp: { name: 'notepad', executable: 'notepad.exe' },
      steps: [{ id: 'type-1', action: 'TYPE', text: '  Hello\n' }],
    }),
    runOptions: { iterations: 2, captureIntervalSeconds: 10, iterationTimeoutSeconds: 120 },
  });
  // The agent should receive the normalized built-in task and its run options.
  assert.equal(result.task.taskType, 'task_sequence');
  assert.equal(result.task.payload.tasks[0].text, '  Hello\n');
  assert.equal(result.task.payload.steps, undefined);
  assert.equal(result.task.runOptions.iterations, 2);
  assert.equal(result.task.settings.iterationTimeoutSeconds, 120);
});

test('supervised run retains older top-level settings', async () => {
  // Older clients send settings at the top level instead of inside runOptions.
  const { store } = loadStore();
  const result = await store.createRunRecord2({
    ...options('{}'), iterations: 2, captureIntervalSeconds: 30, iterationTimeoutSeconds: 90,
  });
  // The store keeps supporting those older fields for the agent.
  assert.equal(result.task.settings.iterations, 2);
  assert.equal(result.task.settings.captureIntervalSeconds, 30);
  assert.equal(result.task.settings.iterationTimeoutSeconds, 90);
});

for (const method of ['createRunRecord', 'createRunRecord2']) {
  // Both route-specific creators must preserve custom runner input in the same way.
  for (const content of [
    '\uFEFF{ "tasks": [{"id":"custom", "action":"WAIT", "seconds":2}], "extra":"世界\\t\\n" }\r\n',
    'null', '[]', '42', '"text"', '{"tasks":[]}',
  ]) {
    test(`${method}: custom JSON ${JSON.stringify(content)} is stored verbatim`, async () => {
      // Save valid JSON without changing its formatting or its JSON value type.
      const { store, files } = loadStore();
      const input = options(content);
      const result = await store[method](input);
      // Check the task type and the exact files made available to the runner.
      assert.equal(result.task.taskType, 'script_runner');
      assert.equal(files.get(result.paths.uploadedPlanPath), content);
      assert.equal(files.get(path.join(result.paths.runRoot, result.task.payload.runnerPath)), input.runnerScriptContent);
      assert.equal(files.has(result.paths.taskPlanPath), false);
    });
  }
  for (const content of ['{', '', '   ', {}]) {
    test(`${method}: rejects invalid custom JSON ${JSON.stringify(content)} before storage`, async () => {
      // Invalid runner config must fail before the store creates run files.
      const { store, calls } = loadStore();
      await assert.rejects(store[method](options(content)), error => {
        assert.equal(error.code, 'INVALID_TASK_PLAN');
        assert.equal(error.fieldErrors[0].path, 'configContent');
        assert.equal(error.fieldErrors[0].stepId, null);
        assert.ok(error.fieldErrors[0].message);
        return true;
      });
      // A rejected request must not touch the filesystem.
      assert.equal(calls(), 0);
    });
  }
}
