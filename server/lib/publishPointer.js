const fs = require("fs/promises");
const { execFile } = require("child_process");
const { promisify } = require("util");
const execute = promisify(execFile);

async function replaceWindowsFile(source, destination, backup) {
  // Pass paths as environment values, never interpolate them into PowerShell code.
  const script = "$ErrorActionPreference='Stop'; try { [IO.File]::Replace($env:DV_POINTER_SOURCE, $env:DV_POINTER_DEST, $env:DV_POINTER_BACKUP); exit 0 } catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }";
  await execute("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand",
    Buffer.from(script, "utf16le").toString("base64")], {
    windowsHide: true,
    env: { ...process.env, DV_POINTER_SOURCE: source, DV_POINTER_DEST: destination, DV_POINTER_BACKUP: backup },
  });
}

async function publishPointer(source, destination, {
  io = fs, platform = process.platform, replace = replaceWindowsFile,
} = {}) {
  try {
    await io.rename(source, destination);
    return;
  } catch (error) {
    if (platform !== "win32" || !["EPERM", "EACCES", "EEXIST"].includes(error.code)) throw error;
  }
  // ReplaceFile is needed on some Windows shared directories for an existing
  // destination. Never fall back to unlink + rename or in-place JSON writes.
  const expected = await io.readFile(source);
  const backup = `${source}.previous`;
  try {
    await replace(source, destination, backup);
  } catch (error) {
    // A helper-process reporting failure must not cause deletion of an already
    // published run. Check the unique pointer contents before propagating it.
    const actual = await io.readFile(destination).catch(() => null);
    if (!actual || !actual.equals(expected)) throw error;
  }
  // Publication has committed. Optional backup cleanup cannot turn it into failure.
  await io.rm(backup, { force: true }).catch(() => {});
}

module.exports = { publishPointer };