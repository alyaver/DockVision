import test from "node:test";
import assert from "node:assert/strict";
import { BUILT_IN_TASK_PLAN_EXAMPLE, PYTHON_RUNNER_COMMAND, POWERSHELL_RUNNER_COMMAND, AI_RUNNER_PROMPT } from "../client/src/components/runInstructions.mjs";
import parser from "../server/lib/test-script/readTestScript.js";

test("instructional Built-In example matches the production Task Plan contract", () => {
  const plan = parser.readTestScript({
    fileName: "example.json",
    content: BUILT_IN_TASK_PLAN_EXAMPLE,
  });

  assert.equal(plan.schemaVersion, "dockvision.user-task-plan.v1");
  assert.deepEqual(plan.tasks.map(({ action }) => action), ["CLICK", "TYPE"]);
  assert.equal(plan.tasks[0].target, "editor");
});

test("instructional runner contracts cover both supported runner languages", () => {
  assert.equal(PYTHON_RUNNER_COMMAND, "python.exe <runner-script> --plan <task-plan>");
  assert.equal(POWERSHELL_RUNNER_COMMAND, "powershell.exe -NoProfile -ExecutionPolicy Bypass -File <runner-script> -ConfigPath <task-plan>");
  assert.match(AI_RUNNER_PROMPT, /--plan <path>/);
  assert.match(AI_RUNNER_PROMPT, /nonzero code/);
  assert.match(AI_RUNNER_PROMPT, /guest dependencies/);
});