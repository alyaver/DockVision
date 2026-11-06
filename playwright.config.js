const { defineConfig, devices } = require("@playwright/test");

module.exports = defineConfig({
  // Playwright will discover the password-recovery browser tests here.
  testDir: "./e2e",

  // Use the Vite client as the browser test target.
  use: {
    baseURL: "http://127.0.0.1:5173",
    screenshot: "off",
    video: "off",
    trace: "off",
  },

  // Keep the initial browser coverage small and deterministic.
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  // Start only the frontend; future tests mock all password-recovery API calls.
  webServer: {
    command:
      "npm run dev -w client -- --host 127.0.0.1 --port 5173 --strictPort",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: !process.env.CI,
  },
});