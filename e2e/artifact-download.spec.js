const { test, expect } = require('@playwright/test');

const crypto = require('node:crypto');
const fs = require('node:fs/promises');

const {
  RUN_ID,
  makeRun,
  artifactBytes,
  artifactSha256,
} = require('./fixtures/runFixtures');


test(
  'downloads a fixture artifact and verifies its bytes',
  async ({ page }) => {

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

    // Mock completed run with an artifact.
    await page.route(
      new RegExp(`/api/runs/${RUN_ID}$`),
      async route => {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',

          body: JSON.stringify({
            success: true,

            run: makeRun({
              status: 'completed',

              artifacts: {
                artifact: {
                  fileName: 'text-fixture.bin',
                  url: `/api/runs/${RUN_ID}/files/text-fixture.bin`,
                },
              },
            }),
          }),
        });
      }
    );

    // Return actual fixture bytes through the browser download.
    await page.route(
      `**/api/runs/${RUN_ID}/files/**`,
      route =>
        route.fulfill({
          status: 200,

          contentType: 'application/octet-stream',

          headers: {
            'content-disposition':
              'attachment; filename="text-fixture.bin"',
          },

          body: artifactBytes,
        })
    );

    await page.goto(
      `/running-test/${RUN_ID}`
    );

    const downloadPromise =
      page.waitForEvent('download');

    const downloadControl = page
      .locator('li')
      .filter({ hasText: 'text-fixture.bin' })
      .getByRole('button', { name: 'Download' });

    await expect(downloadControl).toBeVisible();

    await downloadControl.click();

    const download = await downloadPromise;

    expect(
      download.suggestedFilename()
    ).toBe('text-fixture.bin');

    const downloadedPath = await download.path();

    expect(downloadedPath).toBeTruthy();

    const downloadedBytes =
      await fs.readFile(downloadedPath);

    const downloadedHash = crypto
      .createHash('sha256')
      .update(downloadedBytes)
      .digest('hex');

    expect(downloadedHash).toBe(artifactSha256);

    expect(
      downloadedBytes.equals(artifactBytes)
    ).toBe(true);
  }
);


test(
  'shows an unavailable-artifact state when the file is missing',
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
      route =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',

          body: JSON.stringify({
            success: true,

            run: makeRun({
              status: 'completed',

              artifacts: {
                artifact: {
                  fileName: 'missing.png',
                  url: `/api/runs/${RUN_ID}/files/missing.png`,
                },
              },
            }),
          }),
        })
    );

    // Simulate an artifact that no longer exists.
    await page.route(
      `**/api/runs/${RUN_ID}/files/**`,
      route =>
        route.fulfill({
          status: 404,
          contentType: 'application/json',

          body: JSON.stringify({
            success: false,
            message: 'Artifact not found',
          }),
        })
    );

    await page.goto(
      `/running-test/${RUN_ID}`
    );

    const downloadControl = page
      .locator('li')
      .filter({ hasText: 'missing.png' })
      .getByRole('button', { name: 'Download' });

    await expect(downloadControl).toBeVisible();

    await downloadControl.click();

    await expect(
      page.getByRole('alert').filter({
        hasText: 'Could not download this artifact.',
      })
    ).toBeVisible();
  }
);