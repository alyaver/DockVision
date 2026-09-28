const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

// Exercise production run creation, replacing all filesystem writes with memory.
// The allowlist prevents a new dependency from accidentally reaching a VM/service.
function loadStore() {
  const files = new Map();
  let calls = 0;
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
  const filename = path.resolve(__dirname, '../server/lib/runStore.js');
  const localRequire = createRequire(filename);
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    require(name) {
      if (name === 'fs/promises') return storage;
      assert.ok(['path', 'crypto', './test-script/readTestScript'].includes(name), `Unexpected dependency: ${name}`);
      return localRequire(name);
    },
    module, __dirname: path.dirname(filename), console, process,
  }, { filename });
  return { store: module.exports, files, calls: () => calls };
}

const options = configContent => ({
  executionMode: 'custom',
  runnerScriptName: 'runner.py',
  runnerScriptContent: "print('custom runner')\n",
  configFileName: 'config.json',
  configContent,
});

for (const method of ['createRunRecord', 'createRunRecord2']) {
  for (const content of [
    '\uFEFF{ "tasks": [{"id":"custom", "action":"WAIT", "seconds":2}], "extra":"世界\\t\\n" }\r\n',
    'null', '[]', '42', '"text"', '{"tasks":[]}',
  ]) {
    test(`${method}: custom JSON ${JSON.stringify(content)} is stored verbatim`, async () => {
      const { store, files } = loadStore();
      const input = options(content);
      const result = await store[method](input);
      assert.equal(result.task.taskType, 'script_runner');
      assert.equal(files.get(result.paths.uploadedPlanPath), content);
      assert.equal(files.get(path.join(result.paths.runRoot, result.task.payload.runnerPath)), input.runnerScriptContent);
      assert.equal(files.has(result.paths.taskPlanPath), false);
    });
  }
  for (const content of ['{', '', '   ', {}]) {
    test(`${method}: rejects invalid custom JSON ${JSON.stringify(content)} before storage`, async () => {
      const { store, calls } = loadStore();
      await assert.rejects(store[method](options(content)), error => {
        assert.equal(error.code, 'INVALID_TASK_PLAN');
        assert.equal(error.fieldErrors[0].path, 'configContent');
        assert.equal(error.fieldErrors[0].stepId, null);
        assert.ok(error.fieldErrors[0].message);
        return true;
      });
      assert.equal(calls(), 0);
    });
  }
}
