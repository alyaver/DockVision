// @ts-check
import { test as base, expect } from '@playwright/test';

const email = 'user@example.com';
const password = 'password123';
const user = { user_id: 12345, name: 'John Doe', email };

/**
 * Routes that must render for a user without a session.
 */
const PUBLIC_ROUTES = [
  '/',
  '/about',
  '/contact',
  '/login',
  '/register',
  '/forgot-password',
  '/set-new-password',
  '/reset-password',
];

/**
 * Routes that require a session. An unauthenticated user is sent to the
 * landing page:
 * - Navigation intercepts /dashboard, /configuration-settings, /create-a-task,
 *   /running-test and /profile (Navigation.jsx authenticatedPaths),
 * - Confirmation intercepts itself (Confirmation.jsx verifyAuthentication).
 *
 * Profile is asserted separately because its 401 handler races Navigation's
 * redirect and can land on /login as well as /.
 */
const PROTECTED_ROUTES = [
  '/dashboard',
  '/confirmation',
  '/configuration-settings',
  '/create-a-task',
  '/running-test',
];

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
async function signIn(page) {
  await page.goto('/login');
  await page.getByPlaceholder('Email').fill(email);
  await page.getByPlaceholder('Password').fill(password);
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

/**
 * Asserts the nav bar shows signed-out controls.
 * @param {import('@playwright/test').Page} page
 */
async function assertSignedOutNav(page) {
  await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Register' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign out' })).not.toBeVisible();
  await expect(page.getByRole('link', { name: 'Dashboard' })).not.toBeVisible();
  await expect(page.getByRole('link', { name: 'Profile' })).not.toBeVisible();
}

/**
 * Asserts the nav bar shows signed-in controls.
 * @param {import('@playwright/test').Page} page
 * @param {boolean} onDashboard
 */
async function assertSignedInNav(page, onDashboard = false) {
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Profile' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Sign in' })).not.toBeVisible();
  await expect(page.getByRole('link', { name: 'Register' })).not.toBeVisible();
  // The Dashboard link is hidden while already on the Dashboard page.
  if (onDashboard) {
    await expect(page.getByRole('link', { name: 'Dashboard' })).not.toBeVisible();
  } else {
    await expect(page.getByRole('link', { name: 'Dashboard' })).toBeVisible();
  }
}

test.describe('route access for unauthenticated users', () => {
  test('public routes render without a session', async ({ page }) => {
    for (const route of PUBLIC_ROUTES) {
      await page.goto(route);
      // The title page (/) auto-advances to /about after 3 seconds.
      const expectedUrl =
        route === '/'
          ? /^(\/|\/about)$/
          : new RegExp(`^${route.replace(/\//g, '\\/')}$`);
      await expect(page).toHaveURL(expectedUrl);
      await assertSignedOutNav(page);
    }
  });

  test('protected routes redirect to the landing page without a session', async ({
    page,
  }) => {
    for (const route of PROTECTED_ROUTES) {
      await page.goto(route);
      await expect(page).toHaveURL('/');
      await assertSignedOutNav(page);
      await expectLoggedOut(page, page.context());
    }
  });

  test('profile redirects without a session', async ({ page, context }) => {
    // Navigation and Profile both handle a 401 on /profile; the exact landing
    // URL depends on which redirect commits first.
    await page.goto('/profile');
    await expect(page).toHaveURL(/\/(\/|\/login)$/i);
    await assertSignedOutNav(page);
    await expectLoggedOut(page, context);
  });

  test('sign in link routes to /login', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/login$/i);
  });

  test('register link routes to /register', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'Register' }).click();
    await expect(page).toHaveURL(/\/register$/i);
  });
});

test.describe('route access for authenticated users', () => {
  test('sign in reaches the dashboard and shows signed-in nav', async ({
    page,
  }) => {
    await signIn(page);
    await expect(page).toHaveURL(/\/dashboard$/i);
    await assertSignedInNav(page, true);
  });

  test('protected routes are reachable with a session', async ({ page }) => {
    await signIn(page);
    for (const route of PROTECTED_ROUTES) {
      await page.goto(route);
      await expect(page).toHaveURL(
        new RegExp(`^${route.replace(/\//g, '\\/')}$`)
      );
      await assertSignedInNav(page, route === '/dashboard');
    }
  });

  test('nav links route between pages', async ({ page }) => {
    await signIn(page);
    await expect(page).toHaveURL(/\/dashboard$/i);
    await assertSignedInNav(page, true);

    // Dashboard -> Profile -> Dashboard
    await page.getByRole('link', { name: 'Profile' }).click();
    await expect(page).toHaveURL(/\/profile$/i);
    await assertSignedInNav(page, false);
    await page.getByRole('link', { name: 'Dashboard' }).click();
    await expect(page).toHaveURL(/\/dashboard$/i);

    // Dashboard -> About -> Contact
    await page.getByRole('link', { name: 'About' }).click();
    await expect(page).toHaveURL(/\/about$/i);
    await assertSignedInNav(page, false);
    await page.getByRole('link', { name: 'Contact' }).click();
    await expect(page).toHaveURL(/\/contact$/i);
    await assertSignedInNav(page, false);
  });

  test('sign out clears the session and returns to /login', async ({
    page,
    context,
  }) => {
    await signIn(page);
    await expect(page).toHaveURL(/\/dashboard$/i);

    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login$/i);
    await expect(page.getByRole('heading', { name: 'Sign In' })).toBeVisible();
    await expectLoggedOut(page, context);

    // After logout the nav must revert to signed-out controls.
    await assertSignedOutNav(page);
  });
});


