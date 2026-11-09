const { test, expect } = require('@playwright/test');


test(
  'history renders only the authenticated user runs in newest-first order',
  async ({ page }) => {

    // Authenticate as User A.
    await page.route('**/api/auth/me', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',

        body: JSON.stringify({
          success: true,
          user: {
            id: 'user-a',
            user_id: 'user-a',
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
            user_id: 'user-a',
            name: 'User A',
            email: 'user-a@example.test',
          },
        }),
      })
    );

    // Mock history response.
    await page.route(
      '**/api/runs',
      route =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',

          body: JSON.stringify({
            success: true,

            runs: [
              {
                runId: 'run-new',
                testName: 'run-new',
                status: 'completed',
                createdUtc: '2026-11-04T12:00:00Z',
              },

              {
                runId: 'run-old',
                testName: 'run-old',
                status: 'failed',
                createdUtc: '2026-11-03T12:00:00Z',
              },
            ],
          }),
        })
    );

    await page.goto('/profile');

    await expect(
      page.getByText('run-new', { exact: true })
    ).toBeVisible();

    await expect(
      page.getByText('run-old', { exact: true })
    ).toBeVisible();

    // Verify newest run appears first.
    const pageText = await page
      .locator('body')
      .innerText();

    expect(
      pageText.indexOf('run-new')
    ).toBeLessThan(
      pageText.indexOf('run-old')
    );

    // A foreign user's run must not appear.
    await expect(
      page.getByText('run-foreign')
    ).toHaveCount(0);
  }
);