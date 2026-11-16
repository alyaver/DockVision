// @ts-check
 
// DOCKV-337. Navigation and User Interface - screen-level acceptance tests.
// Each screen has at least one documented test covering the navigation/UI checklist from the deliverable.
// checklist: page opens, title/labels/buttons, routing, back/cancel, refresh,
// layout, disabled/enabled buttons, keyboard interaction, no broken links/inaccessible controls.
// The suite is run by the existing script: npm run test:e2e
 
const { test, expect } = require("@playwright/test");
const describe = test.describe;
const { stubAuthenticatedDashboard, stubExportStorage } = require("./support/apiStubs");
 
async function openAndAssertPage(page, url, expectedTitle) {
  await page.goto(url, { waitUntil: "networkidle" });
  await expect(page).toHaveURL(new RegExp(url.replace(/\//g, "\\/") + "(\\?.*)?$"), { timeout: 10000 });
  await expect(page.locator("body")).toBeVisible();
  await expect(page.locator("h1")).toBeVisible();
  await expect(page.locator("h1")).toHaveText(expectedTitle, { timeout: 10000 });
}
 
async function assertNoBrokenLinks(page) {
  const broken = await page.evaluate(async () => {
    const links = Array.from(document.querySelectorAll("a[href]"));
    const uris = new Set();
    for (const anchor of links) {
      const href = anchor.getAttribute("href");
      if (!href) continue;
      const u = new URL(href, window.location.href);
      if (uris.has(u.origin + u.pathname)) continue;
      uris.add(u.origin + u.pathname);
      try {
        if (u.origin === window.location.origin && u.pathname.includes("#")) continue;
        const response = await fetch(u.href, { method: "HEAD", signal: AbortSignal.timeout(2000) });
        if (response.status >= 400) return [u.href, response.status];
      } catch (error) {
        if (error.name === "TypeError") return [u.href, "cross-origin-or-opaque"];
        if (error.name === "AbortError") continue;
        return [u.href, error.message];
      }
    }
    return null;
  });
  expect(broken, "Broken link detected: " + JSON.stringify(broken)).toBeNull();
}
 
describe("Navigation and UI - general accessibility / broken controls", () => {
  test("exposes no inaccessible controls or missing focus targets on any screen", async ({ page }) => {
    await page.goto("/about");
    await expect(page).toHaveURL(/\/about$/);
    await expect(page.locator("h1")).toHaveText("About DockVision");
    const accessibilityIssues = await page.evaluate(() => {
      const selectors = [
        'input:not([type="hidden"]):not(:disabled)',
        "button:not(:disabled)",
        "a[href]",
        "select:not(:disabled)",
        "textarea:not(:disabled)",
      ];
      const results = [];
      for (const selector of selectors) {
        for (const node of Array.from(document.querySelectorAll(selector))) {
          const html = node.outerHTML.slice(0, 100);
          if (node.getAttribute("aria-hidden") === "true") {
            results.push({ type: "aria-hidden-control", html });
            continue;
          }
          const named =
            node.getAttribute("aria-label") ||
            node.getAttribute("aria-labelledby") ||
            node.getAttribute("title") ||
            (node.textContent || "").trim() ||
            node.getAttribute("placeholder") ||
            node.getAttribute("value") ||
            (node.id && document.querySelector('label[for="' + node.id + '"]')) ||
            node.closest("label");
          if (!named) results.push({ type: "control-without-accessible-name", html });
        }
      }
      return results;
    });
    expect(accessibilityIssues).toEqual([]);
  });
  test("navigation links route to the correct destination", async ({ page }) => {
    await stubAuthenticatedDashboard(page);
    await page.goto("/dashboard");
    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
    await page.goto("/");
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator("h1")).toHaveText("DockVision");
    await page.getByRole("link", { name: "About", exact: true }).click();
    await expect(page).toHaveURL(/\/about$/);
    await expect(page.locator("h1")).toHaveText("About DockVision");
    await page.getByRole("link", { name: "Home", exact: true }).click();
    await expect(page).toHaveURL(/\/$/);
    await page.getByRole("link", { name: "Contact", exact: true }).click();
    await expect(page).toHaveURL(/\/contact$/);
    await expect(page.locator("h1")).toHaveText("Contact");
    await page.getByRole("link", { name: "Dashboard", exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.locator("h1")).toHaveText("Create New Test Run");
  });
});
 
describe("Title page (/) - opens and routes to About", () => {
  test("opens successfully, shows the logo and title, then routes to /about after the splash", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator("h1")).toHaveText("DockVision");
    await expect(page.locator(".title-page-logo")).toBeVisible();
    await expect(page).toHaveURL(/\/about$/, { timeout: 10000 });
    await expect(page.locator("h1")).toHaveText("About DockVision");
  });
});
describe("About page - correct title, labels, and links", () => {
  test("opens and presents the about heading and navigation controls", async ({ page }) => {
    await page.goto("/contact");
    await openAndAssertPage(page, "/about", "About DockVision");
    await expect(page.getByRole("link", { name: "About", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Contact", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Home", exact: true })).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(/\/contact$/);
  });
  test("refresh preserves the about content", async ({ page }) => {
    await page.goto("/about");
    await expect(page.locator("h1")).toHaveText("About DockVision");
    await page.reload({ waitUntil: "networkidle" });
    await expect(page.locator("h1")).toHaveText("About DockVision");
  });
});
describe("Contact page - form, success and error states", () => {
  test("opens, submits empty input, and shows the required-field error", async ({ page }) => {
    await page.goto("/contact");
    await openAndAssertPage(page, "/contact", "Contact");
    const submit = page.getByRole("button", { name: "Submit" });
    await expect(submit).toBeEnabled();
    await submit.click();
    await expect(page.getByRole("alert")).toContainText("Complete all required fields.");
  });
  test("rejects a malformed email and does not submit the form", async ({ page }) => {
    await page.route("**/api/contact", async (route) => {
      await route.abort();
    });
    await page.goto("/contact");
    await page.getByPlaceholder("First Name").fill("Caleb");
    await page.getByPlaceholder("Last Name").fill("Lewis");
    await page.getByPlaceholder("Email").fill("not-an-email");
    await page.getByPlaceholder("Message").fill("I need help starting a test run.");
    await page.getByRole("button", { name: "Submit" }).click();
    await expect(page.getByRole("alert")).toContainText("Enter a valid email address.");
  });
  test("accepts a valid submission, clears the form, and shows the success message", async ({ page }) => {
    let submittedPayload;
    await page.route("**/api/contact", async (route) => {
      submittedPayload = route.request().postDataJSON();
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ message: "Your support request was submitted successfully." }) });
    });
    await page.goto("/contact");
    await page.getByPlaceholder("First Name").fill("Caleb");
    await page.getByPlaceholder("Last Name").fill("Lewis");
    await page.getByPlaceholder("Email").fill("VISITOR@EXAMPLE.COM");
    await page.getByPlaceholder("Message").fill("I need help starting a test run.");
    await page.getByRole("button", { name: "Submit" }).click();
    await expect(page.getByRole("status")).toContainText("Your support request was submitted successfully.");
    expect(submittedPayload).toEqual({ firstName: "Caleb", lastName: "Lewis", email: "visitor@example.com", message: "I need help starting a test run." });
    await expect(page.getByPlaceholder("First Name")).toHaveValue("");
    await expect(page.getByPlaceholder("Email")).toHaveValue("");
  });
  test("keeps the form usable after a network failure", async ({ page }) => {
    await page.route("**/api/contact", async (route) => {
      await route.abort("failed");
    });
    await page.goto("/contact");
    await page.getByPlaceholder("First Name").fill("Caleb");
    await page.getByPlaceholder("Message").fill("Needs help.");
    await page.getByRole("button", { name: "Submit" }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.getByPlaceholder("First Name")).toHaveValue("Caleb");
    await expect(page.getByPlaceholder("Message")).toHaveValue("Needs help.");
    await expect(page.getByRole("button", { name: "Submit" })).toBeEnabled();
  });
});
 
describe("Login page - form, success/failure, locked state, refresh", () => {
  test("opens and shows the sign-in heading, email/password fields, and submit button", async ({ page }) => {
    await openAndAssertPage(page, "/login", "Sign In");
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByLabel("Password")).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign In" })).toBeEnabled();
    await expect(page.getByRole("link", { name: "Forgot password?" })).toBeVisible();
  });
  test("rejects wrong credentials and does not create a session", async ({ page, context }) => {
    await page.route("**/api/auth/login", (route) =>
      route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ message: "Invalid email or password" }) }));
    await page.goto("/login");
    await page.getByPlaceholder("Email").fill("user@example.com");
    await page.getByPlaceholder("Password", { exact: true }).fill("WrongPassword!");
    await page.getByRole("button", { name: "Sign In" }).click();
    await expect(page.getByText("Invalid email or password", { exact: true })).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
    const cookies = await context.cookies();
    expect(cookies.filter((c) => c.name === "session_token")).toEqual([]);
  });
  test("accepts valid credentials and survives a reload", async ({ page, context }) => {
    await stubAuthenticatedDashboard(page);
    await page.route("**/api/auth/login", (route) =>
      route.fulfill({ status: 200, headers: { "Set-Cookie": "session_token=poc-session; Path=/; HttpOnly" }, contentType: "application/json", body: JSON.stringify({ user: { user_id: 12345, name: "John Doe", email: "user@example.com" } }) }));
    await page.goto("/login");
    await page.getByPlaceholder("Email").fill("user@example.com");
    await page.getByPlaceholder("Password", { exact: true }).fill("password123");
    await page.getByRole("button", { name: "Sign In" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
    await page.reload({ waitUntil: "networkidle" });
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
  });
  test("password reveal toggles visibility and keeps the field value", async ({ page }) => {
    await page.goto("/login");
    await page.getByPlaceholder("Password", { exact: true }).fill("Password123!");
    await page.getByRole("button", { name: "Show password" }).click();
    await expect(page.getByPlaceholder("Password", { exact: true })).toHaveAttribute("type", "text");
    await expect(page.getByPlaceholder("Password", { exact: true })).toHaveValue("Password123!");
  });
  test("lockout state shows the toast and disables the submit button", async ({ page }) => {
    await page.route("**/api/auth/login", (route) =>
      route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ message: "Invalid email or password" }) }));
    await page.goto("/login");
    await page.getByPlaceholder("Email").fill("user@example.com");
    await page.getByPlaceholder("Password", { exact: true }).fill("WrongPassword!");
    const submit = page.getByRole("button", { name: "Sign In" });
    // ADJUST: repeat failed attempts until the app locks the form
    for (let attempt = 0; attempt < 10; attempt++) {
      if (await submit.isDisabled()) break;
      await submit.click();
      await page.waitForTimeout(200);
    }
    await expect(page.getByRole("alert")).toContainText("Too many attempts, try again later");
    await expect(submit).toBeDisabled();
  });
});
describe("Registration page - form, validation, and success state", () => {
  test("opens and shows the registration heading and password strength rules", async ({ page }) => {
    await openAndAssertPage(page, "/register", "Create your DockVision account");
    await expect(page.getByPlaceholder("Name")).toBeVisible();
    await expect(page.getByPlaceholder("Email")).toBeVisible();
    await expect(page.getByPlaceholder("Password", { exact: true })).toBeVisible();
    await expect(page.getByPlaceholder("Confirm Password")).toBeVisible();
    await expect(page.getByRole("button", { name: "Create Account" })).toBeEnabled();
  });
  test("rejects a short or weak password and disables the submit button", async ({ page }) => {
    await page.goto("/register");
    await page.getByPlaceholder("Name").fill("E2E User");
    await page.getByPlaceholder("Email").fill("e2e@example.test");
    await page.getByPlaceholder("Password", { exact: true }).fill("short");
    await page.getByPlaceholder("Confirm Password").fill("short");
    await expect(page.getByText("Password must be at least 8 characters and include uppercase, lowercase, number, and symbol")).toBeVisible();
    await expect(page.getByRole("button", { name: "Create Account" })).toBeDisabled();
  });
  test("rejects mismatched passwords and prevents submission", async ({ page }) => {
    await page.goto("/register");
    await page.getByPlaceholder("Name").fill("E2E User");
    await page.getByPlaceholder("Email").fill("e2e@example.test");
    await page.getByPlaceholder("Password", { exact: true }).fill("Password123!");
    await page.getByPlaceholder("Confirm Password").fill("Password12!");
    await page.getByRole("button", { name: "Create Account" }).click();
    await expect(page.getByText("Confirm Password must match Password")).toBeVisible();
  });
  test("accepts a valid submission and redirects to the dashboard", async ({ page }) => {
    await page.route("**/api/auth/register", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true }) });
    });
    await page.goto("/register");
    await page.getByPlaceholder("Name").fill("E2E User");
    await page.getByPlaceholder("Email").fill("e2e@example.test");
    await page.getByPlaceholder("Password", { exact: true }).fill("Password123!");
    await page.getByPlaceholder("Confirm Password").fill("Password123!");
    await page.getByRole("button", { name: "Create Account" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
  });
});
 
describe("Configuration Settings - form, validation, persistence, and refresh", () => {
  test.beforeEach(async ({ page }) => {
    await stubAuthenticatedDashboard(page);
  });
  test("accepts boundary iteration values and stores numbers", async ({ page }) => {
    await page.goto("/configuration-settings");
    await page.evaluate(() => sessionStorage.removeItem("dockvision-current-run"));
    await page.reload();
    for (const iterations of ["1", "30"]) {
      await page.locator("#text-box-count").fill(iterations);
      await page.getByRole("button", { name: "Continue" }).click();
      await expect(page).toHaveURL(/\/dashboard$/);
      const stored = await page.evaluate(() => JSON.parse(sessionStorage.getItem("dockvision-current-run")));
      expect(stored.runOptions.iterations).toBe(Number(iterations));
    }
  });
  test("rejects values outside the 1-30 integer range and keeps saved options", async ({ page }) => {
    await page.goto("/configuration-settings");
    await page.evaluate(() => sessionStorage.setItem("dockvision-current-run", JSON.stringify({ testName: "iteration range check", executionMode: "custom", runnerScriptName: "runner.py", runnerScriptContent: "fixture", configFileName: "plan.json", configContent: "{}", runOptions: { iterations: 7, captureIntervalSeconds: 30, iterationTimeoutSeconds: 300 } })));
    for (const iterations of ["-1", "0", "31", "1.5", "", "999999"]) {
      await page.reload();
      await page.locator("#text-box-count").fill(iterations);
      await page.getByRole("button", { name: "Continue" }).click();
      await expect(page).toHaveURL(/\/configuration-settings$/);
      await expect(page.locator(".error")).toHaveText("Please enter an integer between 1 and 30.");
    }
    const stored = await page.evaluate(() => JSON.parse(sessionStorage.getItem("dockvision-current-run")));
    expect(stored.runOptions.iterations).toBe(7);
  });
  test("restores valid settings after navigation and refresh", async ({ page }) => {
    await page.goto("/configuration-settings");
    await page.locator("#capture-frequency").selectOption({ label: "Every 1 min" });
    await page.locator("#text-box-count").fill("7");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await page.goto("/configuration-settings");
    await expect(page.locator("#text-box-count")).toHaveValue("7");
    await expect(page.locator("#capture-frequency")).toHaveValue("Every 1 min");
    await page.reload();
    await expect(page.locator("#text-box-count")).toHaveValue("7");
    await expect(page.locator("#capture-frequency")).toHaveValue("Every 1 min");
  });
  test("recovers from corrupt session storage without crashing", async ({ page }) => {
    await page.goto("/configuration-settings");
    await page.evaluate(() => sessionStorage.setItem("dockvision-current-run", "{not-json"));
    await page.reload();
    await expect(page.locator("#capture-frequency")).toHaveValue("Every 5 sec");
    await expect(page.locator("#text-box-count")).toHaveValue("");
    await page.locator("#text-box-count").fill("3");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    const stored = await page.evaluate(() => JSON.parse(sessionStorage.getItem("dockvision-current-run")));
    expect(stored.runOptions).toEqual({ iterations: 3, captureIntervalSeconds: 5, iterationTimeoutSeconds: 300 });
  });
});
 
describe("Dashboard - run creation, empty state, readiness, and refresh", () => {
  test("opens, shows empty-state, and renders welcome + run controls", async ({ page }) => {
    await stubAuthenticatedDashboard(page);
    await page.goto("/dashboard");
    await expect(page.getByText("No recent Test Runs")).toBeVisible();
    await expect(page.locator(".empty-icon")).toBeVisible();
    await expect(page.locator(".empty-title")).toHaveText("No recent Test Runs");
    await expect(page.locator(".empty-sub")).toContainText("Start a new test run to see it appear.");
    await expect(page.getByText("Welcome")).toBeVisible();
    await expect(page.getByRole("button", { name: "Create New Test Run" })).toBeVisible();
  });
  test("shows readiness errors and disables the start action when the backend is offline", async ({ page }) => {
    await stubAuthenticatedDashboard(page, { readiness: { "/api/health": { success: false } } });
    await page.goto("/dashboard");
    await expect(page.getByText("Backend availability").locator("..")).toContainText("Unavailable");
    await expect(page.getByText("Required launch readiness").locator("..")).toContainText("Not ready");
    await expect(page.getByText("Backend is offline.")).toBeVisible();
    await expect(page.getByRole("button", { name: /Start Test Run/ })).toBeDisabled();
  });
  test("refresh keeps the loaded run configuration stored in sessionStorage", async ({ page }) => {
    await stubAuthenticatedDashboard(page);
    await page.goto("/dashboard");
    await page.getByPlaceholder("Name #1").fill("Refresh test");
    await page.getByRole("button", { name: /Start Test Run/ }).click();
    await expect(page).toHaveURL(/\/confirmation$/);
    const stored = await page.evaluate(() => JSON.parse(sessionStorage.getItem("dockvision-current-run")));
    expect(stored.testName).toBe("Refresh test");
    await page.reload({ waitUntil: "networkidle" });
    await expect(page.locator("h1")).toHaveText("Review or confirm test run");
  });
  test("clicking delete with confirmation cancels correctly", async ({ page }) => {
    await stubAuthenticatedDashboard(page);
    await page.goto("/dashboard");
    const deleteButton = page.locator("button.run-delete");
    if (await deleteButton.count()) {
      await deleteButton.first().click();
      await expect(page.getByRole("dialog", { name: "Delete run history" })).toBeVisible();
      await page.getByRole("button", { name: "Cancel" }).click();
      await expect(page.getByRole("dialog", { name: "Delete run history" })).toBeHidden();
    }
  });
});
// Confirmation block test append
 
describe("Confirmation page - rehydration, back, cancel, and submit states", () => {
  test("rehydrates stored run details after reload and displays script/config previews", async ({ page }) => {
    await stubAuthenticatedDashboard(page);
    await page.addInitScript(() => sessionStorage.setItem("dockvision-current-run", JSON.stringify({ testName: "Rehydrated run", executionMode: "custom", runnerScriptName: "runner.py", runnerScriptContent: "fixture-content", configFileName: "plan.json", configContent: "{tasks:[]}", runOptions: { iterations: 2, captureIntervalSeconds: 5, iterationTimeoutSeconds: 300 } })));
    await page.goto("/confirmation");
    await expect(page.locator("h1")).toHaveText("Review or confirm test run");
    await expect(page.locator("p").filter({ hasText: "Execution Mode:" })).toContainText("Custom Runner");
    await expect(page.getByText("Runner Script (runner.py)")).toBeVisible();
    await expect(page.locator("pre").filter({ hasText: "fixture-content" })).toBeVisible();
    await page.reload({ waitUntil: "networkidle" });
    await expect(page).toHaveURL(/\/confirmation$/);
    await expect(page.locator("pre").filter({ hasText: "fixture-content" })).toBeVisible();
  });
  test("going back keeps confirmation open when a stored run exists", async ({ page }) => {
    await stubAuthenticatedDashboard(page);
    await page.addInitScript(() => sessionStorage.setItem("dockvision-current-run", JSON.stringify({ testName: "Back conf", executionMode: "custom", runnerScriptName: "runner.py", runnerScriptContent: "fixture-content", configFileName: "plan.json", configContent: "{tasks:[]}" })));
    await page.goto("/confirmation");
    await expect(page).toHaveURL(/\/confirmation$/);
    await page.getByRole("link", { name: "Return" }).click();
    await expect(page).toHaveURL(/\/confirmation$/);
    await expect(page.locator("h1")).toHaveText("Review or confirm test run");
  });
  test("submit failure shows an error without blocking the page", async ({ page }) => {
    await stubAuthenticatedDashboard(page);
    await page.addInitScript(() => sessionStorage.setItem("dockvision-current-run", JSON.stringify({ testName: "Error conf", executionMode: "custom", runnerScriptName: "runner.py", runnerScriptContent: "fixture-content", configFileName: "plan.json", configContent: "{tasks:[]}" })));
    await page.goto("/confirmation");
    await page.getByRole("button", { name: "Confirm" }).click();
    await expect(page.getByRole("alert")).toContainText("Acceptance could not be confirmed");
    await expect(page).toHaveURL(/\/confirmation$/);
  });
});
 
describe("Manage Test Runner (/running-test) - progress, empty, polling error, delete", () => {
  test("renders queued -> running -> completed progress", async ({ page }) => {
    const states = [
      { status: "queued" },
      { status: "queued" },
      { status: "running", progress: { currentIteration: 1, totalIterations: 1, completedSteps: 2, totalSteps: 3, percent: 66 } },
      { status: "completed", progress: { currentIteration: 1, totalIterations: 1, completedSteps: 3, totalSteps: 3, percent: 100 }, result: { success: true, message: "Fixture run completed" } },
    ];
    let pollCount = 0;
    await page.route("**/api/auth/me", route =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, user: { id: "user-poc-001" } }) }));
    await page.route("**/api/profile", route =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ user: { user_id: "user-poc-001", name: "E2E User", email: "e2e@example.test" } }) }));
    await page.route(new RegExp(`/api/runs/rundemo$`), async (route) => {
      const state = states[Math.min(pollCount, states.length - 1)];
      pollCount += 1;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, run: state }) });
    });
    await page.goto("/running-test/rundemo");
    const statusBadge = page.locator(".TestPage__statusBadge");
    await expect(statusBadge).toHaveText("Queued");
    await expect(statusBadge).toHaveText("Running", { timeout: 5000 });
    await expect(statusBadge).toHaveText("Completed", { timeout: 5000 });
    expect(pollCount).toBeGreaterThanOrEqual(3);
  });
  test("presents a recoverable polling error", async ({ page }) => {
    await page.route("**/api/auth/me", route =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, user: { id: "user-poc-001" } }) }));
    await page.route("**/api/profile", route =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ user: { user_id: "user-poc-001", name: "E2E User", email: "e2e@example.test" } }) }));
    await page.route(new RegExp(`/api/runs/rundemo$`), (route) =>
      route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ success: false, message: "Fixture API unavailable" }) }));
    await page.goto("/running-test/rundemo");
    await expect(page.getByText("Temporary network issue. Retrying for the latest run status.")).toBeVisible();
  });
  test("shows no run specified when there is no run id and handles logout via navigation link", async ({ page }) => {
    await stubAuthenticatedDashboard(page);
    await page.goto("/running-test");
    await expect(page.locator("h1")).toHaveText("Manage Test Runner (Running Test)");
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login$/);
  });
});
 
describe("Profile page - save, password change, and sign out", () => {
  test("opens, shows the profile heading, and has editable fields", async ({ page }) => {
    await stubAuthenticatedDashboard(page);
    await page.goto("/profile");
    await expect(page.locator("h1")).toHaveText("Profile");
    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Save changes" })).toBeVisible();
  });
  test("shows an error when saving profile fails and keeps the entered values", async ({ page }) => {
    await stubAuthenticatedDashboard(page);
    await page.route("**/api/profile", async (route) => {
      await route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ message: "Profile update failed" }) });
    });
    await page.goto("/profile");
    await page.getByPlaceholder("Full name").fill("Updated Name");
    await page.getByPlaceholder("Email").fill("updated@example.test");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Profile update failed")).toBeVisible();
    await expect(page.getByPlaceholder("Full name")).toHaveValue("Updated Name");
    await expect(page.getByPlaceholder("Email")).toHaveValue("updated@example.test");
  });
  test("changing password shows success and clears the form", async ({ page }) => {
    await stubAuthenticatedDashboard(page);
    await page.route("**/api/profile/password", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true }) });
    });
    await page.goto("/profile");
    await page.getByRole("button", { name: "Change password" }).click();
    await page.getByLabel("Current password").fill("OldPassword!1");
    await page.getByLabel("New password").fill("NewPassword!2");
    await page.getByLabel("Confirm new password").fill("NewPassword!2");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Password changed successfully")).toBeVisible();
    await expect(page.getByLabel("Current password")).toHaveValue("");
    await expect(page.getByLabel("New password")).toHaveValue("");
    await expect(page.getByLabel("Confirm new password")).toHaveValue("");
  });
});
describe("Create a Task page - title and controls", () => {
  test("opens with the correct title and contains the task form controls", async ({ page }) => {
    await openAndAssertPage(page, "/create-a-task", "Create a Task");
    await expect(page.getByRole("button", { name: "Return" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Create task" })).toBeVisible();
  });
});
describe("Set New Password page - token validation and form states", () => {
  test("displays the invalid reset-link state for an expired token", async ({ page }) => {
    await page.route("**/api/auth/reset/validate?token=**", async (route) => {
      await route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ message: "Invalid or expired token" }) });
    });
    await page.goto("/set-new-password?token=expired-test-token");
    await expect(page.getByRole("heading", { name: "Valid Reset Link", exact: true })).toBeVisible();
    await expect(page.getByText("Invalid or expired token")).toBeVisible();
    await expect(page.getByPlaceholder("New Password")).not.toBeVisible();
    await expect(page.getByPlaceholder("Confirm New Password")).not.toBeVisible();
    await expect(page.getByRole("link", { name: "Back to Forgot Password" })).toHaveAttribute("href", "/forgot-password");
  });
  test("keeps the form enabled after a server error", async ({ page }) => {
    await page.route("**/api/auth/reset/validate?token=**", async (route) => {
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ message: "Service unavailable" }) });
    });
    await page.goto("/set-new-password?token=valid-test-token");
    await expect(page.getByRole("heading", { name: "Valid Reset Link", exact: true })).toBeVisible();
    await expect(page.getByPlaceholder("New Password")).toBeVisible();
    await expect(page.getByRole("button", { name: "Set Password" })).toBeEnabled();
  });
});
 
describe("Forgot Password page - email submission, success and service error", () => {
  test("opens with the reset heading, email field, submit and cancel buttons", async ({ page }) => {
    await openAndAssertPage(page, "/forgot-password", "Reset Password");
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByRole("button", { name: "Reset Password" })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Cancel" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Sign In" })).toBeVisible();
  });
  test("submits the email and shows the success message", async ({ page }) => {
    const successMessage = "If that email is registered, a reset link has been sent.";
    await page.route("**/api/forgot-password", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ message: successMessage }) });
    });
    await page.goto("/forgot-password");
    const requestPromise = page.waitForRequest("**/api/forgot-password");
    await page.getByLabel("Email").fill("member@example.test");
    await page.getByRole("button", { name: "Reset Password" }).click();
    const request = await requestPromise;
    expect(request.postDataJSON()).toEqual({ email: "member@example.test" });
    await expect(page.getByText(successMessage)).toBeVisible();
  });
  test("shows a service error and remains usable", async ({ page }) => {
    const errorMessage = "Email service is not configured yet.";
    await page.route("**/api/forgot-password", async (route) => {
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ message: errorMessage }) });
    });
    await page.goto("/forgot-password");
    const emailInput = page.getByLabel("Email");
    const resetButton = page.getByRole("button", { name: "Reset Password" });
    await emailInput.fill("member@example.test");
    await resetButton.click();
    await expect(page.getByText(errorMessage)).toBeVisible();
    await expect(resetButton).toBeEnabled();
    await emailInput.fill("another-member@example.test");
    await expect(emailInput).toHaveValue("another-member@example.test");
  });
});
 
describe("Browser / layout matrix", () => {
  test("layout is usable and blocks do not overlap", async ({ page }) => {
    await page.goto("/about");
    await expect(page.locator("h1")).toHaveText("About DockVision");
    const noOverlap = await page.evaluate(() => {
      const blocks = Array.from(document.querySelectorAll("main, .card, section, .page, .login-page"))
        .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
      const rects = blocks.map((el) => el.getBoundingClientRect());
      for (let i = 0; i < rects.length; i += 1) {
        for (let j = i + 1; j < rects.length; j += 1) {
          if (blocks[i].contains(blocks[j]) || blocks[j].contains(blocks[i])) continue; // nested is not overlap
          const a = rects[i]; const b = rects[j];
          if (a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y) {
            return true;
          }
        }
      }
      return false;
    });
    expect(noOverlap).toBe(false);
  });
});
 
describe("Sweep - broken links and inaccessible controls", () => {
  test("finds no non-2xx navigation targets on any screen", async ({ page }) => {
    const urls = [
      "/", "/about", "/contact", "/dashboard", "/confirmation", "/configuration-settings",
      "/running-test", "/running-test/nonexistent-run", "/login", "/register", "/forgot-password",
      "/set-new-password", "/create-a-task", "/profile",
    ];
    for (const url of urls) {
      await page.goto(url, { waitUntil: "networkidle" });
      await assertNoBrokenLinks(page);
    }
  });
});