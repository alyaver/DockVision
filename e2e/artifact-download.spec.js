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

    // Mock completed run with an artifact.
    await page.route(
      `**/api/runs/${RUN_ID}**`,
      async route => {

        if (route.request().method() !== 'GET') {
          return route.continue();
        }

        return route.fulfill({
          status: 200,
          contentType: 'application/json',

          body: JSON.stringify({
            success: true,

            run: makeRun({
              status: 'completed',

              artifacts: [
                {
                  name: 'text-fixture.bin',
                  filename: 'text-fixture.bin',
                  url: `/api/runs/${RUN_ID}/files/text-fixture.bin`,
                },
              ],
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
      `/running-test?runId=${RUN_ID}`
    );

    const downloadPromise =
      page.waitForEvent('download');

    const downloadControl = page.getByRole(
      'button',
      {
        name: /download.*text-fixture\.bin|text-fixture\.bin.*download/i,
      }
    );

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

    await page.route(
      `**/api/runs/${RUN_ID}**`,
      route =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',

          body: JSON.stringify({
            success: true,

            run: makeRun({
              status: 'completed',

              artifacts: [
                {
                  name: 'missing.png',
                  filename: 'missing.png',
                  url: `/api/runs/${RUN_ID}/files/missing.png`,
                },
              ],
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
      `/running-test?runId=${RUN_ID}`
    );

    const downloadControl = page.getByRole(
      'button',
      {
        name: /download.*missing\.png|missing\.png.*download/i,
      }
    );

    await expect(downloadControl).toBeVisible();

    await downloadControl.click();

    await expect(
      page.getByText(
        /not found|unavailable|failed to download/i
      ).first()
    ).toBeVisible();
  }
);