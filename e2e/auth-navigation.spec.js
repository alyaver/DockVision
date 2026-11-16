// @ts-check
import { test as base, expect } from '@playwright/test';

const email = 'user@example.com';
const password = 'password123';
const user = { user_id: 12345, name: 'John Doe', email };

/**
 * Page fixture that stubs every `/api/**` call so the real React frontend runs
 * against a fake auth backend. No database or live server is involved.
 *
 * Session state is represented by the `session_token=poc-session` cookie:
 *   - present  -> the user is treated as logged in
 *   - absent   -> the user is treated as logged out
 */
const test = base.extend({
  page: async ({ page, context }, use) => {
    /** @type {string[]} */
    const unexpected = [];

    await context.route('**/api/**', async (route) => {
      const request = route.request();
      const endpoint = `${request.method()} ${new URL(request.url()).pathname}`;
      const hasSession = (request.headers().cookie || '').split(';').some(
        (cookie) => cookie.trim() === 'session_token=poc-session'
      );

      if (endpoint === 'POST /api/auth/login') {
        const body = request.postDataJSON();
        if (body.email !== email || body.password !== password) {
          return route.fulfill({
            status: 401,
            json: { message: 'Invalid email or password' },
          });
        }
        return route.fulfill({
          headers: { 'Set-Cookie': 'session_token=poc-session; Path=/; HttpOnly' },
          json: { user },
        });
      }

      if (['GET /api/profile', 'GET /api/auth/me'].includes(endpoint)) {
        return route.fulfill({
          status: hasSession ? 200 : 401,
          json: hasSession ? { user } : { error: 'Unauthorized' },
        });
      }

      if (endpoint === 'GET /api/auth/deletion-status') {
        return route.fulfill({ status: 200, json: { job: { status: 'none' } } });
      }

      if (endpoint === 'POST /api/auth/logout') {
        return route.fulfill({
          status: 204,
          headers: { 'Set-Cookie': 'session_token=; Path=/; HttpOnly; Max-Age=0' },
        });
      }

      if (endpoint === 'GET /api/runs') {
        return route.fulfill({ json: { runs: [] } });
      }

      const readiness = [
        'GET /api/health',
        'GET /api/docker/ping',
        'GET /api/storage/space',
        'GET /api/windows-vm/status',
      ];
      if (readiness.includes(endpoint)) {
        return route.fulfill({ status: 200, json: { success: true } });
      }

      unexpected.push(endpoint);
      return route.abort();
    });

    await use(page);
    expect(unexpected, 'No unexpected API calls').toEqual([]);
  },
});

/** @param {import('@playwright/test').Page} page */
async function signIn(page, submittedPassword = password) {
  await page.goto('/login');
  await page.getByPlaceholder('Email').fill(email);
  await page.getByPlaceholder('Password').fill(submittedPassword);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

/**
 * Asserts the session cookie is gone and the profile endpoint reports 401.
 * @param {import('@playwright/test').Page} page
 * @param {import('@playwright/test').BrowserContext} context
 */
async function expectLoggedOut(page, context) {
  const cookies = await context.cookies();
  expect(cookies.filter((cookie) => cookie.name === 'session_token')).toEqual([]);
  const status = await page.evaluate(async () => {
    return (await fetch('/api/auth/me')).status;
  });
  expect(status).toEqual(401);
}

test.describe('Navigation by authentication state', () => {
  test.describe('when the user is NOT logged in', () => {
    test('nav shows Sign in / Register and no signed-in controls', async ({ page, context }) => {
      await page.goto('/');
      await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Register' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Sign out' })).not.toBeVisible();
      await expect(page.getByRole('link', { name: 'Dashboard' })).not.toBeVisible();
      await expect(page.getByRole('link', { name: 'Profile' })).not.toBeVisible();
      await expectLoggedOut(page, context);
    });

    test('Sign in link routes to /login', async ({ page }) => {
      await page.goto('/');
      await page.getByRole('link', { name: 'Sign in' }).click();
      await expect(page).toHaveURL(/\/login$/);
    });

    test('Register link routes to /register', async ({ page }) => {
      await page.goto('/');
      await page.getByRole('link', { name: 'Register' }).click();
      await expect(page).toHaveURL(/\/register$/);
    });

    test('reaching a protected page while logged out does not grant signed-in nav', async ({
      page,
      context,
    }) => {
      // /dashboard is a protected route; the Dashboard page redirects logged-out
      // users to the landing page and the NavBar shows signed-out controls.
      await page.goto('/dashboard');
      await expect(page).toHaveURL('/');
      await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Register' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Sign out' })).not.toBeVisible();
      await expectLoggedOut(page, context);
    });
  });

  test.describe('when the user IS logged in', () => {
    test('nav shows Dashboard / Profile / Sign out and links route between pages', async ({
      page,
      context,
    }) => {
      await signIn(page);
      await expect(page).toHaveURL(/\/dashboard$/);
      await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Profile' })).toBeVisible();
      // The Dashboard link is hidden while already on the Dashboard page.
      await expect(page.getByRole('link', { name: 'Dashboard' })).not.toBeVisible();
      await expect(page.getByRole('link', { name: 'Sign in' })).not.toBeVisible();
      await expect(page.getByRole('link', { name: 'Register' })).not.toBeVisible();

      // Navigate from Dashboard to Profile via the nav link.
      await page.getByRole('link', { name: 'Profile' }).click();
      await expect(page).toHaveURL(/\/profile$/);
      await expect(page.getByRole('link', { name: 'Dashboard' })).toBeVisible();

      // Navigate from Profile back to Dashboard via the nav link.
      await page.getByRole('link', { name: 'Dashboard' }).click();
      await expect(page).toHaveURL(/\/dashboard$/);
    });

    test('Sign out clears the session and returns to /login', async ({ page, context }) => {
      await signIn(page);
      await expect(page).toHaveURL(/\/dashboard$/);

      await page.getByRole('button', { name: 'Sign out' }).click();
      await expect(page).toHaveURL(/\/login$/);
      await expect(page.getByRole('heading', { name: 'Sign In' })).toBeVisible();
      await expectLoggedOut(page, context);

      // After logout the nav must revert to signed-out controls.
      await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Register' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Sign out' })).not.toBeVisible();
    });
  });
});