const { test } = require("node:test");
const assert = require("node:assert/strict");

const load = () => import("../../client/src/lib/launchWhenReady.mjs");
const notReady = (code) => Object.assign(new Error(code), { status: 409, code });

test("confirmation waits through cold startup and delayed agent, then accepts once", async () => {
  const { launchWhenReady } = await load();
  let calls = 0;
  let clock = 0;
  const messages = [];
  const payload = { executionMode: "custom" };
  const accepted = await launchWhenReady(payload, {
    launch: async (body) => {
      assert.equal(body, payload);
      calls++;
      if (calls === 1) throw notReady("GUEST_STARTING");
      if (calls === 2) throw notReady("AGENT_NOT_READY");
      return { runId: "run-fixture" };
    },
    now: () => clock, sleep: async (ms) => { clock += ms; },
    onProgress: (message) => messages.push(message),
  });
  assert.equal(accepted.runId, "run-fixture");
  assert.equal(calls, 3);
  assert.ok(messages.some((message) => message.includes("Starting Windows")));
  assert.ok(messages.some((message) => message.includes("test agent")));
});

test("readiness timeout is bounded and provides recovery instructions", async () => {
  const { launchWhenReady } = await load();
  let clock = 0;
  let calls = 0;
  await assert.rejects(launchWhenReady({}, {
    launch: async () => { calls++; throw notReady("AGENT_NOT_READY"); },
    now: () => clock, sleep: async (ms) => { clock += ms; },
    timeoutMs: 9000,
  }), /check that the DockVision agent is running/);
  assert.equal(calls, 3);
});

test("conflict, validation, startup failure and uncertain network failures are never retried", async () => {
  const { launchWhenReady } = await load();
  for (const error of [notReady("RUN_ACTIVE"), notReady("GUEST_START_FAILED"),
    Object.assign(new Error("Invalid"), { status: 400 }), new TypeError("Failed to fetch")]) {
    let calls = 0;
    await assert.rejects(launchWhenReady({}, {
      launch: async () => { calls++; throw error; },
    }), (actual) => actual === error);
    assert.equal(calls, 1);
  }
});

test("leaving confirmation stops further admission attempts", async () => {
  const { launchWhenReady } = await load();
  const controller = new AbortController();
  let calls = 0;
  await assert.rejects(launchWhenReady({}, {
    signal: controller.signal,
    launch: async () => { calls++; throw notReady("AGENT_NOT_READY"); },
    sleep: async () => controller.abort(),
  }), { name: "AbortError" });
  assert.equal(calls, 1);
});