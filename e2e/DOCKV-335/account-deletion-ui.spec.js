const { test, expect } = require("@playwright/test");

const fakeUser = {
  user_id: 335001,
  name: "DockVision Test User",
  email: "dockv335@example.test",
  deletion_status: "active",
};

async function mockProfileApis(page, { deletionJob = null, onDelete, onResume } = {}) {
  await page.route("**/api/**", async (route) => {
    throw new Error(`Unexpected API request: ${route.request().method()} ${route.request().url()}`);
  });
  await page.route("**/api/runs", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ runs: [] }),
    });
  });
  await page.route("**/api/profile", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ user: fakeUser }),
    });
  });
  await page.route("**/api/auth/deletion-status", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true, job: deletionJob }),
    });
  });
  await page.route("**/api/auth/delete-account", async (route) => {
    if (!onDelete) throw new Error("Unexpected account-deletion request");
    await onDelete(route);
  });
  await page.route("**/api/auth/delete-account/resume", async (route) => {
    if (!onResume) throw new Error("Unexpected account-deletion resume request");
    await onResume(route);
  });
}

test("account deletion requires an exact CONFIRM value before submission", async ({ page }) => {
  let deleteRequests = 0;
  await mockProfileApis(page, {
    onDelete: async (route) => {
      deleteRequests += 1;
      await route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          job: { status: "pending", step: "cancelling", last_error: null },
        }),
      });
    },
  });

  await page.goto("/profile");
  await expect(page.getByRole("heading", { name: "Delete account" })).toBeVisible();
  await page.getByRole("button", { name: "Delete my account" }).click();

  const dialog = page.getByRole("dialog", { name: "Confirm permanent deletion" });
  const submit = dialog.getByRole("button", { name: "Permanently delete account" });
  await dialog.getByLabel("Current password").fill("DisposablePassword!7");
  await dialog.getByLabel("Type CONFIRM").fill("confirm");
  await expect(submit).toBeDisabled();
  expect(deleteRequests).toBe(0);

  await dialog.getByLabel("Type CONFIRM").fill("CONFIRM");
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(dialog).toBeHidden();
  expect(deleteRequests).toBe(1);
});

test("pending deletion status is displayed without making deletion requests", async ({ page }) => {
  await mockProfileApis(page, {
    deletionJob: {
      status: "pending",
      step: "cancelling",
      last_error: null,
    },
  });

  await page.goto("/profile");
  await expect(page.getByText("Deletion status:").locator(".."))
    .toContainText("cancelling");
  await expect(page.getByRole("button", { name: "Check status / retry" })).toBeVisible();
});

test("cleanup failure exposes retry and updates after a successful mocked retry", async ({ page }) => {
  let resumeRequests = 0;
  await mockProfileApis(page, {
    deletionJob: {
      status: "failed",
      step: "cancelling",
      last_error: "Cleanup failed for a disposable owned run.",
    },
    onResume: async (route) => {
      resumeRequests += 1;
      await route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          job: { status: "pending", step: "removing-account", last_error: null },
        }),
      });
    },
  });

  await page.goto("/profile");
  await expect(page.getByRole("alert")).toContainText("Cleanup failed");
  const retry = page.getByRole("button", { name: "Check status / retry" });
  await expect(retry).toBeVisible();
  await retry.click();

  await expect(page.getByText("Deletion status:").locator("..")).toContainText("removing-account");
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(resumeRequests).toBe(1);
});