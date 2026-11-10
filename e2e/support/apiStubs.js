async function stubAuthenticatedDashboard(page, options = {}) {
  await page.route("**/api/profile", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ user: { user_id: 331, name: "E2E User", email: "e2e@example.test" } }),
    });
  });

  await page.route("**/api/auth/me", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ user: { user_id: 331, name: "E2E User", email: "e2e@example.test" } }),
    });
  });

  await page.route("**/api/runs", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ runs: [] }),
      });
      return;
    }
    await route.continue();
  });

  const readinessResponses = {
    "/api/health": { success: true },
    "/api/docker/ping": { success: true },
    "/api/storage/space": { success: true },
    "/api/windows-vm/status": { windowsVm: { status: "stopped", message: "Stubbed for browser test" } },
    ...options.readiness,
  };

  let readinessAttempt = 0;

  for (const [path, body] of Object.entries(readinessResponses)) {
    await page.route(`**${path}`, async (route) => {
      if (path === "/api/health") {
        readinessAttempt += 1;
      }

      const sequence = options.readinessSequence?.[path];
      const responseBody = sequence
        ? sequence[Math.min(Math.max(readinessAttempt, 1) - 1, sequence.length - 1)]
        : body;

      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(responseBody) });
    });
  }
}

async function stubExportStorage(page) {
  await page.addInitScript(() => {
    Object.defineProperty(window, "indexedDB", { value: undefined });
  });
}

module.exports = { stubAuthenticatedDashboard, stubExportStorage };