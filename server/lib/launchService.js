const { validateLaunchRequest, LaunchError } = require("./launchRequest");
const { createLaunchStore } = require("./launchStore");
const { createGuestReadiness } = require("./guestReadiness");

// Shared across service instances and aliases targeting the same directory.
// Deployment contract: one backend process per shared root, not a distributed lock.
const admissions = new Map();

function createLaunchService({ store = createLaunchStore(), readiness = createGuestReadiness({ sharedRoot: store.sharedRoot }), validate = validateLaunchRequest, beforePublish = async () => {} } = {}) {
  return async function launch(input) {
    const request = validate(input);
    const key = process.platform === "win32" ? store.sharedRoot.toLowerCase() : store.sharedRoot;
    const previous = admissions.get(key) || Promise.resolve();
    const pending = previous.catch(() => {}).then(async () => {
      await store.assertAvailable();
      const guest = await readiness();
      if (!guest || typeof guest.containerId !== "string" || !guest.containerId.trim()) {
        throw new LaunchError(409, "GUEST_NOT_READY", "Guest readiness did not resolve a container ID.");
      }
      await beforePublish();
      return store.publish(request, guest.containerId);
    });
    admissions.set(key, pending);
    try {
      return await pending;
    } finally {
      if (admissions.get(key) === pending) admissions.delete(key);
    }
  };
}

module.exports = { createLaunchService };