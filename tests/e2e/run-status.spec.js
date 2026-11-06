const { test, expect } = require('@playwright/test');

const {
  RUN_ID,
  makeRun,
} = require('../fixtures/runFixtures');

test(
  'Running-Test renders queued -> running -> completed progress',
  async ({ page }) => {

    const states = [
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

    // Control run polling responses.
    await page.route(
      `**/api/runs/${RUN_ID}**`,
      async route => {

        if (route.request().method() !== 'GET') {
          return route.continue();
        }

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
    /*
    await page.goto(
      `/running-test?runId=${RUN_ID}`
    );
    */
    // Log browser network requests.
    page.on('request', request => {
      console.log(
        'REQUEST:',
        request.method(),
        request.url()
      );
    });

    // Log browser network responses.
    page.on('response', response => {
      console.log(
        'RESPONSE:',
        response.status(),
        response.url()
      );
    });

    // Open the Running Test page.
    await page.goto(
      `/running-test?runId=${RUN_ID}`
    );


    await expect(
      page.getByText(/queued/i).first()
    ).toBeVisible();

    await expect(
      page.getByText(/running/i).first()
    ).toBeVisible();

    await expect(
      page.getByText(/completed/i).first()
    ).toBeVisible();

    expect(pollCount).toBeGreaterThanOrEqual(3);
  }
);


test(
  'Running-Test presents a recoverable polling error',
  async ({ page }) => {

    let shouldFail = true;

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
      async route => {

        if (route.request().method() !== 'GET') {
          return route.continue();
        }

        if (shouldFail) {
          shouldFail = false;

          return route.fulfill({
            status: 503,
            contentType: 'application/json',

            body: JSON.stringify({
              success: false,
              message: 'Fixture API unavailable',
            }),
          });
        }

        return route.fulfill({
          status: 200,
          contentType: 'application/json',

          body: JSON.stringify({
            success: true,
            run: makeRun({
              status: 'running',
            }),
          }),
        });
      }
    );

    await page.goto(
      `/running-test?runId=${RUN_ID}`
    );

    await expect(
      page.getByText(
        /error|unavailable|try again|retry/i
      ).first()
    ).toBeVisible();
  }
);