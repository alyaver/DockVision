const { test, expect } = require("@playwright/test");

test("ForgotPassword submits the email and shows the success message", async ({ page }) => {
  const testEmail = "member@example.test";
  const successMessage = "If that email is registered, a reset link has been sent.";

  // The shared navigation checks authentication when the page loads.
  await page.route("**/api/profile", async (route) => {
    await route.fulfill({ status: 401, body: JSON.stringify({ message: "Not authenticated" }) });
  });

  // Return a success response without calling the backend or sending email.
  await page.route("**/api/forgot-password", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ message: successMessage }),
    });
  });

  await page.goto("/forgot-password");

  await page.getByLabel("Email").fill(testEmail);

  // Wait for the browser request so its JSON payload can be checked directly.
  const requestPromise = page.waitForRequest("**/api/forgot-password");
  await page.getByRole("button", { name: "Reset Password" }).click();
  const request = await requestPromise;

  expect(request.postDataJSON()).toEqual({ email: testEmail });
  await expect(page.getByText(successMessage)).toBeVisible();
});

test("ForgotPassword displays a service error and remains usable", async ({ page }) => {
  const firstEmail = "member@example.test";
  const replacementEmail = "another-member@example.test";
  const errorMessage = "Email service is not configured yet.";

  // The shared navigation checks authentication when the page loads.
  await page.route("**/api/profile", async (route) => {
    await route.fulfill({
      status: 401,
      body: JSON.stringify({ message: "Not authenticated" }),
    });
  });

  // Simulate the backend being unavailable for password-recovery email delivery.
  await page.route("**/api/forgot-password", async (route) => {
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ message: errorMessage }),
    });
  });

  await page.goto("/forgot-password");

  const emailInput = page.getByLabel("Email");
  const resetButton = page.getByRole("button", { name: "Reset Password" });

  await emailInput.fill(firstEmail);
  await resetButton.click();

  // The page should show the backend error after the request finishes.
  await expect(page.getByText(errorMessage)).toBeVisible();

  // The form should remain usable instead of staying stuck in its loading state.
  await expect(resetButton).toBeEnabled();
  await emailInput.fill(replacementEmail);
  await expect(emailInput).toHaveValue(replacementEmail);
});

test("SetNewPassword displays an invalid reset-link state", async ({ page }) => {
  const expiredToken = "expired-test-token";
  const errorMessage = "Invalid or expired token";

  // The shared navigation checks authentication when the page loads.
  await page.route("**/api/profile", async (route) => {
    await route.fulfill({
      status: 401,
      body: JSON.stringify({ message: "Not authenticated" }),
    });
  });

  // Simulate token validation rejecting an expired reset link.
  await page.route("**/api/auth/reset/validate?token=**", async (route) => {
    await route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({ message: errorMessage }),
    });
  });

  await page.goto(`/set-new-password?token=${expiredToken}`);

  await expect(page.getByRole("heading", { name: "Valid Reset Link", exact: true })).toBeVisible();
  await expect(page.getByText(errorMessage)).toBeVisible();
  await expect(page.getByPlaceholder("New Password")).not.toBeVisible();
  await expect(page.getByPlaceholder("Confirm New Password")).not.toBeVisible();
  await expect(page.getByRole("link", { name: "Back to Forgot Password" }))
    .toHaveAttribute("href", "/forgot-password");
});