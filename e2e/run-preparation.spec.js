const { test, expect } = require("@playwright/test");
const path = require("node:path");
const { stubAuthenticatedDashboard, stubExportStorage } = require("./support/apiStubs");

const fixture = (name) => path.resolve(__dirname, "fixtures", name);

// Wait for the 'runner file ready' message, which signals that the file was uploaded.
// To be used after a .setInputFiles() call to verify that the file finished uploading before continuing with the test
const waitForRunnerRead = (page, fileName) =>
  expect(page.locator(".Notify-msg").filter({
    hasText: `${fileName} was read and is ready for the next step.`,
  })).toBeVisible();

// Wait for the 'task plan file ready' message, which signals that the file was uploaded.
// To be used after a .setInputFiles() call to verify that the file finished uploading before continuing with the test
const waitForPlanRead = (page, fileName) =>
  expect(page.locator(".Notify-msg").filter({
    hasText: `${fileName} is ready for the next step.`,
  })).toBeVisible();

// Before each test, reference a new page with freshly stubbed Dashboard API requests.
// This provides a predictable and consist start to each test
test.beforeEach(async ({ page }) => {
  await stubAuthenticatedDashboard(page);
  await stubExportStorage(page);
});

test("valid custom setup reaches Confirmation with selected content and options", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page.getByText("Create New Test Run")).toBeVisible();

  // Fill in the required fields to run a test
  await page.getByPlaceholder("Name #1").fill("Browser preparation");
  await page.locator('input[type="file"]').nth(0).setInputFiles(fixture("runner.py"));
  await waitForRunnerRead(page, "runner.py");
  await page.locator('input[type="file"]').nth(1).setInputFiles(fixture("plan.json"));
  await waitForPlanRead(page, "plan.json");

  // Fill in Config Settings, and return to Dashboard
  await page.getByRole("button", { name: "Configure Settings" }).click();
  await page.locator("#text-box-count").fill("2");
  await page.locator("#capture-frequency").selectOption({ label: "Every 30 sec" });
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  // Check that we can go to the Confirmation page, and that all filled out information appears properly
  await page.getByRole("button", { name: /Start Test Run/ }).click();
  await expect(page).toHaveURL(/\/confirmation$/);
  await expect(page.locator("p").filter({ hasText: "Execution Mode:" })).toContainText("Custom Runner");
  await expect(page.getByText("Runner Script (runner.py)")).toBeVisible();
  await expect(page.locator("pre").filter({ hasText: "fixture-not-executed" })).toBeVisible();
  await expect(page.locator("p").filter({ hasText: "Iterations:" })).toContainText("2");
  await expect(page.locator("p").filter({ hasText: "Screenshot interval:" })).toContainText("30");
  await expect(page.locator("pre").filter({ hasText: '"tasks"' })).toBeVisible();

  // Check that the stored session contains the same info as filled in above
  const stored = await page.evaluate(() => JSON.parse(sessionStorage.getItem("dockvision-current-run")));
  expect(stored.executionMode).toBe("custom");
  expect(stored.runnerScriptName).toBe("runner.py");
  expect(stored.configFileName).toBe("plan.json");
  expect(stored.runOptions).toEqual({ iterations: 2, captureIntervalSeconds: 30, iterationTimeoutSeconds: 300 });
});

test("missing required custom runner is rejected on Dashboard", async ({ page }) => {
  // Fill out the name and task plan, but intentionally don't upload a runner script, then try to run the test
  await page.goto("/dashboard");
  await page.getByPlaceholder("Name #1").fill("Missing runner script");
  await page.locator('input[type="file"]').nth(1).setInputFiles(fixture("plan.json"));
  await waitForPlanRead(page, "plan.json");
  await page.getByRole("button", { name: /Start Test Run/ }).click();

  // Check that the test doesn't run, keeping us on the Dashboard, and gives the proper error message
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.locator(".Notify-msg").filter({ hasText: "Runner Script is required." })).toBeVisible();
});

test("missing task plan is rejected on Dashboard", async ({ page }) => {
  // Fill out the name and runner script, but intentionally don't upload a task plan, then try to run the test
  await page.goto("/dashboard");
  await page.getByPlaceholder("Name #1").fill("Missing task plan");
  await page.locator('input[type="file"]').nth(0).setInputFiles(fixture("runner.py"));
  await waitForRunnerRead(page, "runner.py");
  await page.getByRole("button", { name: /Start Test Run/ }).click();

  // Check that the test doesn't run, keeping us on the Dashboard, and gives the proper error message
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.locator(".Notify-msg").filter({ hasText: "Task Plan JSON required." })).toBeVisible();
});

test("rejects invalid runner and task-plan extensions in the browser", async ({ page }) => {
  await page.goto("/dashboard");
  await page.getByPlaceholder("Name #1").fill("Unsupported file types");

  // Use an unsupported file type for the runner script, and verify that it gives the proper error message
  await page.locator('input[type="file"]').nth(0).setInputFiles({
    name: "runner.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("not a supported runner"),
  });
  await expect(page.locator(".Notify-msg").filter({ hasText: "Please upload a .py or .ps1 runner script" })).toBeVisible();
  await expect(page.getByText("Selected: runner.txt")).toHaveCount(0);
  
  // Use an unsupported file type for the task plan, and verify that it gives the proper error message
  await page.locator('input[type="file"]').nth(1).setInputFiles({
    name: "plan.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("not a supported task plan"),
  });
  await expect(page.locator(".Notify-msg").filter({ hasText: "Please upload a .json file" })).toBeVisible();
  await expect(page.getByText("Selected: plan.txt")).toHaveCount(0);
});

test("accepts a runner script at 256 KiB and rejects one byte over that limit", async ({ page }) => {
  await page.goto("/dashboard");
  await page.getByPlaceholder("Name #1").fill("Runner size boundary");
  await page.locator('input[type="file"]').nth(1).setInputFiles(fixture("plan.json"));
  await waitForPlanRead(page, "plan.json");

  // Use a runner that is exactly equal to the runner script size limit, and verify that it is accepted
  await page.locator('input[type="file"]').nth(0).setInputFiles({
    name: "boundary.py",
    mimeType: "text/x-python",
    buffer: Buffer.alloc(256 * 1024, "#"),
  });
  await waitForRunnerRead(page, "boundary.py");
  await expect(page.getByText("Selected: boundary.py")).toBeVisible();

  // Use a runner that is one byte over the runner script size limit, and verify that it gives the proper error message
  await page.locator('input[type="file"]').nth(0).setInputFiles({
    name: "too-large.py",
    mimeType: "text/x-python",
    buffer: Buffer.alloc(256 * 1024 + 1, "#"),
  });
  await expect(page.locator(".Notify-msg").filter({ hasText: "smaller than 256 KB" })).toBeVisible();
  await expect(page.getByText("Selected: boundary.py")).toHaveCount(0);

  // Check that the newly uploaded runner script isn't saved to session storage since its too large
  const stored = await page.evaluate(() => JSON.parse(sessionStorage.getItem("dockvision-current-run")));
  expect(stored.runnerScriptName).toBe("");
  expect(stored.runnerScriptContent).toBe("");
});

test("switching from custom to built-in ignores stale custom runner content", async ({ page }) => {
  // Upload a runner script and task plan using 'Custom Runner'
  await page.goto("/dashboard");
  await page.getByPlaceholder("Name #1").fill("Mode switching");
  await page.locator('input[type="file"]').nth(0).setInputFiles(fixture("runner.py"));
  await waitForRunnerRead(page, "runner.py");
  await page.locator('input[type="file"]').nth(1).setInputFiles(fixture("plan.json"));
  await waitForPlanRead(page, "plan.json");
  
  // Switch to 'Built-In Notepad' and verify that the runner script section is gone
  await page.getByRole("button", { name: "Built-In Notepad" }).click();
  await expect(page.getByRole("button", { name: /Upload Runner Script/ })).toHaveCount(0);
  
  // Check that the Confirmation page only displays the 'Built-In Notepad' content, and doesn't display a custom runner
  await page.getByRole("button", { name: /Start Test Run/ }).click();
  await expect(page).toHaveURL(/\/confirmation$/);
  await expect(page.locator("p").filter({ hasText: "Execution Mode:" })).toContainText("Built-in Notepad");
  await expect(page.locator(".Card-Content .Card-Title").filter({ hasText: /Runner Script/ })).toHaveCount(0);
});

test("switching from built-in to custom requires a runner again", async ({ page }) => {
  // Switch to 'Built-In Notepad', and fill in the required fields for a test run
  await page.goto("/dashboard");
  await page.getByPlaceholder("Name #1").fill("Reverse mode switching");
  await page.getByRole("button", { name: "Built-In Notepad" }).click();
  await page.locator('input[type="file"]').setInputFiles(fixture("plan.json"));
  await waitForPlanRead(page, "plan.json");
  
  // Switch back to 'Custom Runner' and verify that the test can't run without uploading a custom script
  await page.getByRole("button", { name: "Custom Runner" }).click();
  await expect(page.getByRole("button", { name: /Upload Runner Script/ })).toBeVisible();
  await page.getByRole("button", { name: /Start Test Run/ }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.locator(".Notify-msg").filter({ hasText: "Runner Script is required." })).toBeVisible();
});

test("clear current run removes the browser handoff and selected files", async ({ page }) => {
  // Fill in the required fields for a test run
  await page.goto("/dashboard");
  await page.getByPlaceholder("Name #1").fill("Reset preparation");
  await page.locator('input[type="file"]').nth(0).setInputFiles(fixture("runner.py"));
  await waitForRunnerRead(page, "runner.py");
  await page.locator('input[type="file"]').nth(1).setInputFiles(fixture("plan.json"));
  await waitForPlanRead(page, "plan.json");

  // Check that the 'Clear Current Run' button properly clears the run and delivers the appropriate message
  await page.getByRole("button", { name: "Clear Current Run" }).click();
  await expect(page.getByPlaceholder("Name #1")).toHaveValue("");
  await expect(page.getByText("Selected: runner.py")).toHaveCount(0);
  await expect(page.getByText("Selected: plan.json")).toHaveCount(0);
  await expect(page.locator(".Notify-msg").filter({ hasText: "current test run setup has been cleared" })).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem("dockvision-current-run"))).toBeNull();
});

test("dashboard recovers a valid preparation from session storage after refresh", async ({ page }) => {
  // Fill in the required fields for a test run
  await page.goto("/dashboard");
  await page.getByPlaceholder("Name #1").fill("Dashboard refresh");
  await page.locator('input[type="file"]').nth(0).setInputFiles(fixture("runner.py"));
  await waitForRunnerRead(page, "runner.py");
  await page.locator('input[type="file"]').nth(1).setInputFiles(fixture("plan.json"));
  await waitForPlanRead(page, "plan.json");

  // Refresh the page, and check that all the previously filled in info is still there
  await page.reload();
  await expect(page.getByPlaceholder("Name #1")).toHaveValue("Dashboard refresh");
  await expect(page.getByText("Selected: runner.py")).toBeVisible();
  await expect(page.getByText("Selected: plan.json")).toBeVisible();
});

test("refresh preserves the selected custom content and options on Confirmation", async ({ page }) => {
  // Fill in the required fields for a test run, then go to the Confirmation page
  await page.goto("/dashboard");
  await page.getByPlaceholder("Name #1").fill("Refresh recovery");
  await page.locator('input[type="file"]').nth(0).setInputFiles(fixture("runner.ps1"));
  await waitForRunnerRead(page, "runner.ps1");
  await page.locator('input[type="file"]').nth(1).setInputFiles(fixture("plan.json"));
  await waitForPlanRead(page, "plan.json");
  await page.getByRole("button", { name: /Start Test Run/ }).click();
  await expect(page).toHaveURL(/\/confirmation$/);

  // Refresh the page, and check that all the previously filled in info is still there
  await page.reload();
  await expect(page.locator("p").filter({ hasText: "Test Run Name:" })).toContainText("Refresh recovery");
  await expect(page.getByText("Runner Script (runner.ps1)")).toBeVisible();
  await expect(page.locator("pre").filter({ hasText: "fixture-not-executed" })).toBeVisible();
  await expect(page.locator("pre").filter({ hasText: '"tasks"' })).toBeVisible();
});

test("partial runner storage renders safely and is replaced by a complete upload", async ({ page }) => {
  // Make a sessionStorage entry that is missing the 'runnerScriptContent' section, meaning the script is blank
  await page.addInitScript(() => {
    sessionStorage.setItem("dockvision-current-run", JSON.stringify({
      testName: "Partial runner",
      executionMode: "custom",
      runnerScriptName: "runner.py",
      runnerScriptLanguage: "python",
      configFileName: "plan.json",
      configContent: "{}",
    }));
  });
  await page.goto("/dashboard");

  // Check that you can't start a test run with an empty runner script, and make sure that it gives the proper error message
  await expect(page.getByText("Selected: runner.py")).toBeVisible();
  await page.getByRole("button", { name: /Start Test Run/ }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.locator(".Notify-msg").filter({ hasText: "Runner Script content could not be read." })).toBeVisible();

  // Upload 'runner.py', and make sure that its content was properly added to the sessionStorage entry
  await page.locator('input[type="file"]').nth(0).setInputFiles(fixture("runner.py"));
  await waitForRunnerRead(page, "runner.py");
  const stored = await page.evaluate(() => JSON.parse(sessionStorage.getItem("dockvision-current-run")));
  expect(stored.runnerScriptContent).toContain("fixture-not-executed");
});

test("replacing runner and task-plan uploads updates names, language, and content", async ({ page }) => {
  // Fill in the required fields for a test run, then replace the runner and task-plan with new ones
  await page.goto("/dashboard");
  await page.getByPlaceholder("Name #1").fill("Replacement uploads");
  await page.locator('input[type="file"]').nth(0).setInputFiles(fixture("runner.py"));
  await waitForRunnerRead(page, "runner.py");
  await page.locator('input[type="file"]').nth(1).setInputFiles(fixture("plan.json"));
  await waitForPlanRead(page, "plan.json");
  await page.locator('input[type="file"]').nth(0).setInputFiles(fixture("runner.ps1"));
  await waitForRunnerRead(page, "runner.ps1");
  await page.locator('input[type="file"]').nth(1).setInputFiles({
    name: "replacement.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ schemaVersion: "replacement", tasks: [{ id: "replacement", action: "WAIT", seconds: 2 }] })),
  });
  await waitForPlanRead(page, "replacement.json");

  // Check that the newly uploaded runner and task-plan are properly displayed on the page
  await expect(page.getByText("Selected: runner.ps1")).toBeVisible();
  await expect(page.getByText("Selected: replacement.json")).toBeVisible();
  await expect(page.getByText("Selected: runner.py")).toHaveCount(0);
  await expect(page.getByText("Selected: plan.json")).toHaveCount(0);

  // Check that the newly uploaded runner and task-plan are properly stored in sessionStorage
  const stored = await page.evaluate(() => JSON.parse(sessionStorage.getItem("dockvision-current-run")));
  expect(stored.runnerScriptName).toBe("runner.ps1");
  expect(stored.runnerScriptLanguage).toBe("powershell");
  expect(stored.runnerScriptContent).toContain("fixture-not-executed");
  expect(stored.configFileName).toBe("replacement.json");
  expect(stored.configContent).toContain("replacement");
});

test("backend-unavailable readiness is visible and blocks starting a run", async ({ page }) => {
  // Set backend health to false
  await stubAuthenticatedDashboard(page, { readiness: { "/api/health": { success: false } } });
  await page.goto("/dashboard");

  // Check that the 'Start Test Run' button is disabled, and the proper labels are used in the 'Laucher Readiness' section
  await expect(page.getByText("Backend availability").locator("..")).toContainText("Unavailable");
  await expect(page.getByText("Required launch readiness").locator("..")).toContainText("Not ready");
  await expect(page.getByText("Backend is offline.")).toBeVisible({ timeout: 1_000 });
  await expect(page.getByRole("button", { name: /Start Test Run/ })).toBeDisabled();
});

test("Docker-unavailable readiness is visible and blocks starting a run", async ({ page }) => {
  // Set docker readiness to false
  await stubAuthenticatedDashboard(page, { readiness: { "/api/docker/ping": { success: false } } });
  await page.goto("/dashboard");

  // Check that the 'Start Test Run' button is disabled, and the proper labels/error messages are used
  await expect(page.getByText("Docker availability").locator("..")).toContainText("Unavailable");
  await expect(page.getByText("Docker Desktop is not running.")).toBeVisible();
  await expect(page.getByRole("button", { name: /Start Test Run/ })).toBeDisabled();
});