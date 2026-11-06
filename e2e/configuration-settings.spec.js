const { test, expect } = require("@playwright/test");
const { stubAuthenticatedDashboard, stubExportStorage } = require("./support/apiStubs");

// Before each test, reference a new page with freshly stubbed API requests.
// This provides a predictable and consist start to each test
test.beforeEach(async ({ page }) => {
  await stubAuthenticatedDashboard(page);
  await stubExportStorage(page);
});

test("accepts the supported iteration boundaries and stores numbers", async ({ page }) => {
  // Check that the minimum and maximum number of iterations are accepted and stored as numbers
  for (const iterations of ["1", "30"]) {
    await page.goto("/configuration-settings");
    await page.evaluate(() => sessionStorage.removeItem("dockvision-current-run"));
    await page.reload();

    // Fill in the number of iterations, then continue to Dashboard
    await page.locator("#text-box-count").fill(iterations);
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);

    // Check that the selected number of iterations is properly stored
    const stored = await page.evaluate(() => JSON.parse(sessionStorage.getItem("dockvision-current-run")));
    expect(stored.runOptions.iterations).toBe(Number(iterations));
  }
});

test("rejects iteration values outside the 1 through 30 integer range without changing saved options", async ({ page }) => {
  // Store a complete preparation to sessionStorage
  await page.goto("/configuration-settings");
  await page.evaluate(() => sessionStorage.setItem(
    "dockvision-current-run",
    JSON.stringify({
      testName: "iteration range check",
      executionMode: "custom",
      runnerScriptName: "runner.py",
      runnerScriptContent: "fixture",
      configFileName: "plan.json",
      configContent: "{}",
      runOptions: { iterations: 7, captureIntervalSeconds: 30, iterationTimeoutSeconds: 300 },
    }),
  ));

  // Check that an invalid iteration value isn't accepted or stored 
  for (const iterations of ["-1", "0", "31", "1.5", "", "999999"]) {
    await page.reload();

    // Fill in an invalid iteration value and try to continue to Dashboard
    await page.locator("#text-box-count").fill(iterations);
    await page.getByRole("button", { name: "Continue" }).click();

    // Check that the page stays on Config Settings and displays the proper error message
    await expect(page).toHaveURL(/\/configuration-settings$/);
    await expect(page.locator(".error")).toHaveText("Please enter an integer between 1 and 30.");

    // Check that the previously stored settings weren't changed
    const stored = await page.evaluate(() => JSON.parse(sessionStorage.getItem("dockvision-current-run")));
    expect(stored.testName).toBe("iteration range check");
    expect(stored.runnerScriptName).toBe("runner.py");
    expect(stored.configFileName).toBe("plan.json");
    expect(stored.runOptions).toEqual({ iterations: 7, captureIntervalSeconds: 30, iterationTimeoutSeconds: 300 });
  }
});

test("maps every capture-frequency option to its stored seconds value", async ({ page }) => {
  const options = [
    ["Every 5 sec", 5],
    ["Every 10 sec", 10],
    ["Every 30 sec", 30],
    ["Every 1 min", 60],
  ];

  for (const [label, seconds] of options) {
    await page.goto("/configuration-settings");
    await page.evaluate(() => sessionStorage.removeItem("dockvision-current-run"));
    await page.reload();

    // Fill in a capture frequency and number of iterations, then continue to Dashboard
    await page.locator("#capture-frequency").selectOption({ label });
    await page.locator("#text-box-count").fill("2");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);

    // Check that the selected capture frequency is stored as the proper integer
    const stored = await page.evaluate(() => JSON.parse(sessionStorage.getItem("dockvision-current-run")));
    expect(stored.runOptions.captureIntervalSeconds).toBe(seconds);
  }
});

test("restores valid settings after navigation and refresh", async ({ page }) => {
  // Fill in valid settings, then continue to Dashboard
  await page.goto("/configuration-settings");
  await page.locator("#capture-frequency").selectOption({ label: "Every 1 min" });
  await page.locator("#text-box-count").fill("7");
  await page.getByRole("button", { name: "Continue" }).click();

  // Check that the settings are still displayed properly after navigating back to Config Settings
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.goto("/configuration-settings");
  await expect(page.locator("#text-box-count")).toHaveValue("7");
  await expect(page.locator("#capture-frequency")).toHaveValue("Every 1 min");

  // Refresh the page and check that the settings are still displayed properly
  await page.reload();
  await expect(page.locator("#text-box-count")).toHaveValue("7");
  await expect(page.locator("#capture-frequency")).toHaveValue("Every 1 min");
});

test("recovers from missing or corrupt session storage", async ({ page }) => {
  // Put a corrupt JSON file into sessionStorage, then refresh Configuration Settings
  await page.goto("/configuration-settings");
  await page.evaluate(() => sessionStorage.setItem("dockvision-current-run", "{not-json"));
  await page.reload();

  // Check that the page falls back to its default values instead of crashing
  await expect(page.locator("#capture-frequency")).toHaveValue("Every 5 sec");
  await expect(page.locator("#text-box-count")).toHaveValue("");

  // Enter valid settings and continue to Dashboard
  await page.locator("#text-box-count").fill("3");
  await page.getByRole("button", { name: "Continue" }).click();

  // Check that the corrupt storage was replaced with valid settings
  await expect(page).toHaveURL(/\/dashboard$/);
  const stored = await page.evaluate(() => JSON.parse(sessionStorage.getItem("dockvision-current-run")));
  expect(stored.runOptions).toEqual({ iterations: 3, captureIntervalSeconds: 5, iterationTimeoutSeconds: 300 });
});

test("creates a new handoff with defaults when session storage is missing", async ({ page }) => {
  // Remove the current run from sessionStorage, then refresh Configuration Settings
  await page.goto("/configuration-settings");
  await page.evaluate(() => sessionStorage.removeItem("dockvision-current-run"));
  await page.reload();

  // Check that the page displays its default values when no settings are stored
  await expect(page.locator("#capture-frequency")).toHaveValue("Every 5 sec");
  await expect(page.locator("#text-box-count")).toHaveValue("");

  // Enter valid settings and continue to Dashboard
  await page.locator("#text-box-count").fill("4");
  await page.getByRole("button", { name: "Continue" }).click();

  // Check that the new settings were stored properly
  await expect(page).toHaveURL(/\/dashboard$/);
  const stored = await page.evaluate(() => JSON.parse(sessionStorage.getItem("dockvision-current-run")));
  expect(stored.runOptions).toEqual({ iterations: 4, captureIntervalSeconds: 5, iterationTimeoutSeconds: 300 });
});