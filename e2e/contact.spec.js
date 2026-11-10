import { test, expect } from '@playwright/test';

const validContact = {
  firstName: 'Caleb',
  lastName: 'Lewis',
  email: 'VISITOR@EXAMPLE.COM',
  message: 'I need help starting a test run.',
};

async function fillContactForm(page, contact = validContact) {
  await page.getByPlaceholder('First Name').fill(contact.firstName);
  await page.getByPlaceholder('Last Name').fill(contact.lastName);
  await page.getByPlaceholder('Email').fill(contact.email);
  await page.getByPlaceholder('Message').fill(contact.message);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/contact');
});

test('invalid input does not submit a Contact request', async ({ page }) => {
  let contactRequestCount = 0;

  await page.route('**/api/contact', async (route) => {
    contactRequestCount += 1;

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        message: 'Your support request was submitted successfully.',
      }),
    });
  });

  await page.getByRole('button', { name: 'Submit' }).click();

  await expect(page.getByRole('alert')).toContainText(
    'Complete all required fields.'
  );

  expect(contactRequestCount).toBe(0);
});

test('malformed email does not submit a Contact request', async ({ page }) => {
  let contactRequestCount = 0;

  await page.route('**/api/contact', async (route) => {
    contactRequestCount += 1;
    await route.abort();
  });

  await fillContactForm(page, {
    ...validContact,
    email: 'not-an-email',
  });

  await page.getByRole('button', { name: 'Submit' }).click();

  await expect(page.getByRole('alert')).toContainText(
    'Enter a valid email address.'
  );

  expect(contactRequestCount).toBe(0);
});

test('successful submission sends normalized data and clears the form', async ({
  page,
}) => {
  let submittedPayload;

  await page.route('**/api/contact', async (route) => {
    submittedPayload = route.request().postDataJSON();

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        message: 'Your support request was submitted successfully.',
      }),
    });
  });

  await fillContactForm(page, validContact);

  await page.getByRole('button', { name: 'Submit' }).click();

  await expect(page.getByRole('status')).toContainText(
    'Your support request was submitted successfully.'
  );

  await expect(submittedPayload).toEqual({
    firstName: 'Caleb',
    lastName: 'Lewis',
    email: 'visitor@example.com',
    message: 'I need help starting a test run.',
  });

  await expect(page.getByPlaceholder('First Name')).toHaveValue('');
  await expect(page.getByPlaceholder('Last Name')).toHaveValue('');
  await expect(page.getByPlaceholder('Email')).toHaveValue('');
  await expect(page.getByPlaceholder('Message')).toHaveValue('');
});

test('pending submission prevents duplicate requests', async ({ page }) => {
  let contactRequestCount = 0;
  let releaseResponse;

  const responseGate = new Promise((resolve) => {
    releaseResponse = resolve;
  });

  await page.route('**/api/contact', async (route) => {
    contactRequestCount += 1;

    await responseGate;

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        message: 'Your support request was submitted successfully.',
      }),
    });
  });

  await fillContactForm(page);

  await page.getByRole('button', { name: 'Submit' }).click();

  const pendingButton = page.getByRole('button', {
    name: 'Submitting...',
  });

  await expect(pendingButton).toBeDisabled();

  // Try another keyboard-based form submission while the first is pending.
  await page.getByPlaceholder('Email').press('Enter');

  expect(contactRequestCount).toBe(1);

  releaseResponse();

  await expect(page.getByRole('status')).toContainText(
    'Your support request was submitted successfully.'
  );

  expect(contactRequestCount).toBe(1);
});

test('network failure preserves content and shows an error', async ({
  page,
}) => {
  await page.route('**/api/contact', async (route) => {
    await route.abort('failed');
  });

  await fillContactForm(page);

  await page.getByRole('button', { name: 'Submit' }).click();

  await expect(page.getByRole('alert')).toBeVisible();

  await expect(page.getByPlaceholder('First Name')).toHaveValue(
    validContact.firstName
  );

  await expect(page.getByPlaceholder('Message')).toHaveValue(
    validContact.message
  );

  await expect(
    page.getByRole('button', { name: 'Submit' })
  ).toBeEnabled();
});




