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
          },
        }),
      })
    );

    // Mock history response.
    await page.route(
      '**/api/runs/history**',
      route =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',

          body: JSON.stringify({
            success: true,

            runs: [
              {
                id: 'run-new',
                status: 'completed',
                createdAt: '2026-11-04T12:00:00Z',
              },

              {
                id: 'run-old',
                status: 'failed',
                createdAt: '2026-11-03T12:00:00Z',
              },
            ],
          }),
        })
    );

    await page.goto('/profile');

    await expect(
      page.getByText('run-new')
    ).toBeVisible();

    await expect(
      page.getByText('run-old')
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