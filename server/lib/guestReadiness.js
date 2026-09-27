const fs = require("fs/promises");
const path = require("path");
const { LaunchError } = require("./launchRequest");
const { DEFAULT_SHARED_ROOT } = require("./launchStore");
const { getWindowsVmStatus, ensureWindowsVmRunning } = require("./windowsVm");

function createGuestReadiness({ sharedRoot = DEFAULT_SHARED_ROOT, getStatus = getWindowsVmStatus, ensureRunning = ensureWindowsVmRunning, io = fs, now = Date.now } = {}) {
  return async function checkGuestReadiness() {
    let status;
    try {
      status = await getStatus();
    } catch {
      throw new LaunchError(409, "GUEST_UNAVAILABLE", "Cannot check the Windows guest. Check Docker and start the VM before retrying.");
    }
    if (!status.running || !status.containerId) {
      try {
        await ensureRunning();
      } catch (error) {
        throw new LaunchError(409, "GUEST_START_FAILED", `Could not start the Windows VM: ${error.message}`);
      }
      // Starting the container is not proof that Windows and the agent have booted.
      // Require a subsequent request and a new heartbeat; never trust a pre-start heartbeat.
      throw new LaunchError(409, "GUEST_STARTING", "The Windows VM is starting. Wait for Windows and the guest agent to finish booting, then click Confirm again. No test has been queued.");
    }
    let heartbeat;
    let modified;
    try {
      const file = path.join(sharedRoot, "agent-heartbeat.json");
      heartbeat = JSON.parse((await io.readFile(file, "utf8")).replace(/^\uFEFF/, ""));
      modified = (await io.stat(file)).mtimeMs;
    } catch {
      throw new LaunchError(409, "AGENT_NOT_READY", "Guest heartbeat is missing or unreadable. Start the guest agent and retry.");
    }
    // Host file modification time avoids guest/host clock skew. Match the existing 60-second floor.
    const interval = heartbeat?.agent?.intervalSeconds;
    const grace = Math.max(60000, Number.isFinite(interval) && interval > 0 ? interval * 3000 : 60000);
    const containerStarted = Date.parse(status.startedAt);
    if ((Number.isFinite(containerStarted) && modified < containerStarted) || now() - modified > grace || modified > now() + 5000) {
      throw new LaunchError(409, "AGENT_NOT_READY", "Guest heartbeat is stale. Wait for a fresh agent heartbeat before retrying.");
    }
    if (heartbeat?.agent?.status !== "idle" || heartbeat.agent.runId) {
      throw new LaunchError(409, "AGENT_NOT_READY", "Guest agent is not idle. Wait for execution or recovery to finish.");
    }
    return { containerId: status.containerId };
  };
}

module.exports = { createGuestReadiness };