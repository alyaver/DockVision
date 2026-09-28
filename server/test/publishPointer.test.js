const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { publishPointer } = require("../lib/publishPointer");

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pointer-replace-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, "new.tmp");
  const destination = path.join(root, "current-run.json");
  await fs.writeFile(source, '{"runId":"run-new"}');
  await fs.writeFile(destination, '{"runId":"run-old"}');
  return { source, destination };
}
const denied = { ...fs, rename: async () => { throw Object.assign(new Error("Shared directory rename denied"), { code: "EPERM" }); } };

test("Windows fallback replaces an existing pointer with real File.Replace", { skip: process.platform !== "win32" }, async (t) => {
  const { source, destination } = await fixture(t);
  await publishPointer(source, destination, { io: denied });
  assert.equal(await fs.readFile(destination, "utf8"), '{"runId":"run-new"}');
  await assert.rejects(fs.access(source), { code: "ENOENT" });
  await assert.rejects(fs.access(`${source}.previous`), { code: "ENOENT" });
});

test("failed replacement preserves the existing pointer", async (t) => {
  const { source, destination } = await fixture(t);
  await assert.rejects(publishPointer(source, destination, {
    io: denied, platform: "win32", replace: async () => { throw new Error("locked"); },
  }), /locked/);
  assert.equal(await fs.readFile(destination, "utf8"), '{"runId":"run-old"}');
  assert.equal(await fs.readFile(source, "utf8"), '{"runId":"run-new"}');
});

test("helper failure after committed replacement is not reported as failed admission", async (t) => {
  const { source, destination } = await fixture(t);
  await publishPointer(source, destination, {
    io: denied, platform: "win32", replace: async () => {
      await fs.rename(source, destination);
      throw new Error("helper exited after commit");
    },
  });
  assert.equal(await fs.readFile(destination, "utf8"), '{"runId":"run-new"}');
});