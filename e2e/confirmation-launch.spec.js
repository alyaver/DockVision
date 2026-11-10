const { test, expect } = require("@playwright/test");
const path = require("node:path");
const { stubAuthenticatedDashboard, stubExportStorage } = require("./support/apiStubs");

const fixture = (name) => path.resolve(__dirname, "fixtures", name);

// Prepare a valid custom test run for each test to use
async function prepareConfirmation(page) {
  // Fill in the required fields to run a test
  await page.goto("/dashboard");
  await page.getByPlaceholder("Name #1").fill("Confirmation launch");
  await page.locator('input[type="file"]').nth(0).setInputFiles(fixture("runner.py"));
  await page.locator('input[type="file"]').nth(1).setInputFiles(fixture("plan.json"));

  // Start the test run and navigate to the Confirmation page
  await page.getByRole("button", { name: /Start Test Run/ }).click();
  await expect(page).toHaveURL(/\/confirmation$/);
}

// Before each test, reference a new page with freshly stubbed API requests.
// This provides a predictable and consist start to each test
test.beforeEach(async ({ page }) => {
  await stubAuthenticatedDashboard(page);
  await stubExportStorage(page);
});

test("accepted Confirm response hands off the run ID", async ({ page }) => {
  // Prepare a valid test run
  await prepareConfirmation(page);

  // Stub an accepted admission response and store the submitted request body
  let requestBody;
  await page.route("**/api/runs/start", async (route) => {
    requestBody = JSON.parse(route.request().postData());
    await route.fulfill({
      status: 202,
      contentType: "application/json",
      body: JSON.stringify({ success: true, runId: "run-e2e-accepted", containerId: "stub-container" }),
    });
  });
  await page.route("**/api/runs/run-e2e-accepted", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ run: { runId: "run-e2e-accepted", status: "queued" } }),
    });
  });

  // Confirm the test run and check that the accepted run ID is handed off
  await page.getByRole("button", { name: "Confirm" }).click();
  await expect(page).toHaveURL(/\/running-test\/run-e2e-accepted$/);
  expect(requestBody.executionMode).toBe("custom");
  expect(requestBody.runnerScriptContent).toContain("fixture-not-executed");
  expect(requestBody.configContent).toContain('"tasks"');
});

test("repeated Confirm clicks create one admission request", async ({ page }) => {
  // Prepare a valid test run
  await prepareConfirmation(page);

  // Delay the accepted response so a repeated click can be attempted while the request is pending
  let requestCount = 0;
  await page.route("**/api/runs/start", async (route) => {
    requestCount += 1;
    await new Promise((resolve) => setTimeout(resolve, 250));
    await route.fulfill({
      status: 202,
      contentType: "application/json",
      body: JSON.stringify({ success: true, runId: "run-e2e-single", containerId: "stub-container" }),
    });
  });
  await page.route("**/api/runs/run-e2e-single", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ run: { runId: "run-e2e-single", status: "queued" } }),
    });
  });

  // Click Confirm twice while the first admission request is pending
  const confirm = page.locator("button.Confirm");
  const confirmBox = await confirm.boundingBox();
  const admissionRequest = page.waitForRequest("**/api/runs/start");
  await confirm.click();
  await admissionRequest;
  // The button's label changes after the first click, so we use the button's physical location for the second click
  await page.mouse.click(confirmBox.x + confirmBox.width / 2, confirmBox.y + confirmBox.height / 2);

  // Check that only one admission request is created after both clicks
  await expect(page).toHaveURL(/\/running-test\/run-e2e-single$/);
  expect(requestCount).toBe(1);
});

test("uncertain network failure is not automatically resubmitted", async ({ page }) => {
  // Prepare a valid test run
  await prepareConfirmation(page);

  // Abort the admission request to simulate a failure where acceptance is uncertain
  let requestCount = 0;
  await page.route("**/api/runs/start", async (route) => {
    requestCount += 1;
    await route.abort("connectionfailed");
  });

  // Confirm the test run and check that the failure is shown without automatic resubmission
  await page.getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByRole("alert")).toContainText("Acceptance could not be confirmed");
  expect(requestCount).toBe(1);
  await expect(page).toHaveURL(/\/confirmation$/);
});

test("explicit readiness responses are retried before accepted admission", async ({ page }) => {
  // Prepare a valid test run
  await prepareConfirmation(page);

  // Return a retryable readiness response first, then accept the admission request
  let requestCount = 0;
  await page.route("**/api/runs/start", async (route) => {
    requestCount += 1;
    if (requestCount === 1) {
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({ success: false, code: "GUEST_STARTING", message: "Not ready" }),
      });
      return;
    }
    await route.fulfill({
      status: 202,
      contentType: "application/json",
      body: JSON.stringify({ success: true, runId: "run-e2e-ready" })
    });
  });
  await page.route("**/api/runs/run-e2e-ready", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ run: { runId: "run-e2e-ready", status: "queued" } }),
    });
  });

  // Confirm the test run and check that the retry reaches accepted admission
  await page.getByRole("button", { name: "Confirm" }).click();
  await expect(page).toHaveURL(/\/running-test\/run-e2e-ready$/);
  expect(requestCount).toBe(2);
});