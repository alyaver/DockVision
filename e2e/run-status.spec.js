const { test, expect } = require('@playwright/test');

const {
  RUN_ID,
  makeRun,
} = require('./fixtures/runFixtures');

test(
  'Running-Test renders queued -> running -> completed progress',
  async ({ page }) => {

    const states = [
      makeRun({
        status: 'queued',
      }),

      makeRun({
        status: 'queued',
      }),

      makeRun({
        status: 'running',

        progress: {
          currentIteration: 1,
          totalIterations: 1,
          completedSteps: 2,
          totalSteps: 3,
          percent: 66,
        },
      }),

      makeRun({
        status: 'completed',

        progress: {
          currentIteration: 1,
          totalIterations: 1,
          completedSteps: 3,
          totalSteps: 3,
          percent: 100,
        },

        result: {
          success: true,
          message: 'Fixture run completed',
        },
      }),
    ];

    let pollCount = 0;

    // Mock authenticated user.
    await page.route('**/api/auth/me', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',

        body: JSON.stringify({
          success: true,
          user: {
            id: 'user-poc-001',
          },
        }),
      })
    );

    await page.route('**/api/profile', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          user: {
            user_id: 'user-poc-001',
            name: 'E2E User',
            email: 'e2e@example.test',
          },
        }),
      })
    );

    // Control run polling responses.
    await page.route(
      new RegExp(`/api/runs/${RUN_ID}$`),
      async route => {
        const state = states[
          Math.min(pollCount, states.length - 1)
        ];

        pollCount++;

        await route.fulfill({
          status: 200,
          contentType: 'application/json',

          body: JSON.stringify({
            success: true,
            run: state,
          }),
        });
      }
    );
    // Open the Running Test page.
    await page.goto(`/running-test/${RUN_ID}`);

    const statusBadge = page.locator('.TestPage__statusBadge');
    await expect(statusBadge).toHaveText('Queued');
    await expect(statusBadge).toHaveText('Running', { timeout: 5000 });
    await expect(statusBadge).toHaveText('Completed', { timeout: 5000 });

    expect(pollCount).toBeGreaterThanOrEqual(3);
  }
);


test(
  'Running-Test presents a recoverable polling error',
  async ({ page }) => {

    await page.route('**/api/auth/me', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',

        body: JSON.stringify({
          success: true,
          user: {
            id: 'user-poc-001',
          },
        }),
      })
    );

    await page.route('**/api/profile', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          user: {
            user_id: 'user-poc-001',
            name: 'E2E User',
            email: 'e2e@example.test',
          },
        }),
      })
    );

    await page.route(
      new RegExp(`/api/runs/${RUN_ID}$`),
      async route => {
        return route.fulfill({
          status: 503,
          contentType: 'application/json',

          body: JSON.stringify({
            success: false,
            message: 'Fixture API unavailable',
          }),
        });
      }
    );

    await page.goto(
      `/running-test/${RUN_ID}`
    );

    await expect(
      page.getByText('Temporary network issue. Retrying for the latest run status.')
    ).toBeVisible();
  }
);