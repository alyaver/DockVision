const { test } = require("node:test");
const assert = require("node:assert/strict");

const { resumeActiveRun } = require("../lib/runRecovery");

test("resumeActiveRun starts supervision for an incomplete active iteration run", async () => {
  const supervised = [];
  const runId = "run-recovery-incomplete";

  const resumedRunId = await resumeActiveRun({
    readPointer: async () => ({ runId, iterationNumber: 2 }),
    read: async () => ({
      runId,
      status: "running",
      iterationState: { total: 3, current: 2, completed: 1, failed: 0 },
    }),
    supervise: async (candidateRunId) => {
      supervised.push(candidateRunId);
    },
  });

  assert.equal(resumedRunId, runId);
  assert.deepEqual(supervised, [runId]);
});

test("resumeActiveRun ignores terminal and fully completed runs", async () => {
  let supervisionCalls = 0;
  const supervise = async () => {
    supervisionCalls += 1;
  };

  const terminal = await resumeActiveRun({
    readPointer: async () => ({ runId: "run-terminal", iterationNumber: 3 }),
    read: async () => ({
      runId: "run-terminal",
      status: "completed",
      iterationState: { total: 3, current: 3, completed: 3, failed: 0 },
    }),
    supervise,
  });
  const inconsistentNonTerminal = await resumeActiveRun({
    readPointer: async () => ({ runId: "run-done", iterationNumber: 3 }),
    read: async () => ({
      runId: "run-done",
      status: "running",
      iterationState: { total: 3, current: 3, completed: 3, failed: 0 },
    }),
    supervise,
  });

  assert.equal(terminal, null);
  assert.equal(inconsistentNonTerminal, null);
  assert.equal(supervisionCalls, 0);
});