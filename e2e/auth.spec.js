// @ts-check
import { test as base, expect } from '@playwright/test';

const email = 'user@example.com';
const password = 'password123';
const user = { user_id: 12345, name: 'John Doe', email};

const test = base.extend({
  page: async ({ page, context }, use) => {
    /** @type {string[]} */
    const unexpected = [];

    await context.route('**/api/**', async (route) => { // Intercept all API requests
      const request = route.request();
      const endpoint = `${request.method()} ${new URL(request.url()).pathname}`;
      const hasSession = (request.headers().cookie || '').split(';').some((cookie) => cookie.trim() === 'session_token=poc-session');
      const gets = ['GET /api/health', 'GET /api/docker/ping', 'GET /api/storage/space', 'GET /api/windows-vm/status'];

      if (endpoint === 'POST /api/auth/login') { // Handle login requests
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
      
      if (['GET /api/profile', 'GET /api/auth/me'].includes(endpoint)){ // Handle profile requests
        return route.fulfill({
          status: hasSession ? 200 : 401,
          json: hasSession ? { user } : { error: 'Unauthorized' },
        });
      }

      if (endpoint === 'POST /api/auth/logout') { // Handle logout requests
        return route.fulfill({
          status: 204,
          headers: { 'Set-Cookie': 'session_token=; Path=/; HttpOnly; Max-Age=0' },
        });
      }

      if (endpoint === 'GET /api/runs') { // Handle runs requests
        return route.fulfill({
          json: { runs: [] } 
        });
      }

      if (gets.includes(endpoint)) { // Handle other GET requests
        return route.fulfill({
          status: 503,
          json: { error: 'Service Unavailable' },
        });
      }

      unexpected.push(endpoint);
      return route.abort();
    });

    await use(page);
    expect(unexpected, '').toEqual([]);
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
 * @param {import('@playwright/test').Page} page
 * @param {import('@playwright/test').BrowserContext} context
 */
async function expectNoSession(page, context) {
  const cookies = await context.cookies();
  expect(cookies.filter((cookie) => cookie.name === 'session_token')).toEqual([]);
  const status = await page.evaluate(async () => {
    return (await fetch('/api/auth/me')).status;
  });
  expect(status).toEqual(401);
}

// Test cases
test('succesful sign in survies page reload', async ({ page }) => { // Test that a successful sign-in persists across page reloads
  await signIn(page);
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
  await expect(page).toHaveURL(/\/dashboard$/);
});

test('rejected credentials create no session', async ({ page, context }) => { // Test that rejected credentials do not create a session
  await signIn(page, 'WrongPassword!');
  await expect(page.getByText('Invalid email or password', { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
  await expectNoSession(page, context);
});

test('logout clears session and redirects to login', async ({ page, context }) => { // Test that logging out clears the session and redirects to the login page
  await signIn(page);
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { name: 'Sign In' })).toBeVisible();
  await expectNoSession(page, context);
});
