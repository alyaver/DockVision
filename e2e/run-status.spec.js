const { test, expect } = require('@playwright/test');
const { stubAuthenticatedDashboard, stubExportStorage } = require('./support/apiStubs');

const {
  RUN_ID,
  makeRun,
} = require('./fixtures/runFixtures');

test('Running-Test renders queued -> running -> failed status', async ({ page }) => {
  await stubAuthenticatedDashboard(page);
  await stubExportStorage(page);
  let status = 'queued';
  await page.route(`**/api/runs/${RUN_ID}`, async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        run: makeRun({
          status,
          result: status === 'failed'
            ? { success: false, message: 'Fixture runner failed' }
            : null,
        }),
      }),
    });
  });

  await page.goto(`/running-test/${RUN_ID}`);
  const badge = page.locator('.TestPage__statusBadge');
  await expect(badge).toHaveText('Queued');
  status = 'running';
  await expect(badge).toHaveText('Running');
  await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible();
  status = 'failed';
  await expect(badge).toHaveText('Failed');
  await expect(badge).toHaveClass(/status-failed/);
  await expect(page.getByText('Fixture runner failed', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toHaveCount(0);
});

test('Running-Test displays cancelling -> cancelled status without duplicate requests', async ({ page }) => {
  await stubAuthenticatedDashboard(page);
  await stubExportStorage(page);
  let status = 'running';
  let cancelRequests = 0;
  await page.route(`**/api/runs/${RUN_ID}`, async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, run: makeRun({ status }) }),
    });
  });
  await page.route(`**/api/runs/${RUN_ID}/cancel`, async route => {
    cancelRequests += 1;
    status = 'cancelling';
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, run: makeRun({ status }) }),
    });
  });

  await page.goto(`/running-test/${RUN_ID}`);
  const badge = page.locator('.TestPage__statusBadge');
  await expect(badge).toHaveText('Running');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(badge).toHaveText('Cancelling');
  const cancelling = page.getByRole('button', { name: 'Cancelling...', exact: true });
  await expect(cancelling).toBeDisabled();
  // A physical second click on the disabled control must not submit again.
  const box = await cancelling.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  status = 'cancelled';
  await expect(badge).toHaveText('Cancelled');
  await expect(badge).toHaveClass(/status-cancelled/);
  await expect(page.locator('.TestPage__cancelButton')).toHaveCount(0);
  expect(cancelRequests).toBe(1);
});

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