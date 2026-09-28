const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readTestScript } = require("../lib/test-script/readTestScript");

function plan(tasks) {
  return { schemaVersion: "dockvision.user-task-plan.v1", app: { name: "notepad", executable: "notepad.exe" }, tasks };
}
const parse = (value) => readTestScript({ fileName: "plan.json", content: JSON.stringify(value) });

test("TYPE preserves literal and whitespace-only text", () => {
  for (const text of [" ", "\t\n", "Unicode λ 😀 {ENTER} + ^ % { }\n\t"]) {
    assert.equal(parse(plan([{ id: "type", action: "TYPE", text }])).tasks[0].text, text);
  }
});

test("named and coordinate CLICK targets normalize without translating actions", () => {
  for (const target of ["editor", { type: "namedControl", name: "fileMenu", xPercent: 20 },
    { type: "screenPoint", x: 350, y: 240 }, { type: "windowPoint", x: 100, y: 100 }]) {
    const task = parse(plan([{ id: "click", action: "CLICK", target }])).tasks[0];
    assert.equal(task.action, "CLICK");
    assert.equal(task.button, "left");
    assert.equal(task.clickCount, 1);
    assert.deepEqual(task.target, target);
  }
  const task = parse(plan([{ id: "demo", action: "CLICK", target: "notepad.editor", xPercent: 25 }])).tasks[0];
  assert.deepEqual(task.target, { type: "namedControl", name: "editor", xPercent: 25 });
  assert.equal(task.xPercent, undefined);
});

test("invalid and ambiguous plans produce structured field errors", () => {
  const click = { id: "click", action: "CLICK", target: "editor" };
  const cases = [null, [], plan([]), plan([click, click]),
    plan([{ ...click, id: " " }]), plan([{ ...click, action: "WAIT" }]),
    plan([{ ...click, text: "wrong" }]), plan([{ ...click, target: "unknown" }]),
    plan([{ ...click, button: "middle" }]), plan([{ ...click, clickCount: 3 }]),
    plan([{ ...click, target: { type: "screenPoint", x: "1", y: 2 } }]),
    plan([{ ...click, target: { type: "namedControl", name: "editor", xPercent: 101 } }]),
    plan([{ id: "type", action: "TYPE", text: "", target: "editor" }]),
    { ...plan([click]), steps: [click] }, { ...plan([click]), targetApp: "notepad" },
    { ...plan([click]), schemaVersion: "unsupported" }];
  for (const value of cases) {
    assert.throws(() => parse(value), (error) => {
      assert.equal(error.code, "INVALID_TASK_PLAN");
      assert.equal(typeof error.fieldErrors[0].path, "string");
      return true;
    });
  }
});