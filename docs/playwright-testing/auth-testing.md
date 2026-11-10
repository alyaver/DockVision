## Authentication testing evaluation
The use of Playwright testing for our testing framework acros all pages should be used. While keeping the current node:test for validation checks.

## Current versions running
- Node 24.14.0 
- npm 10.5.0 
- React/React DOM 19.2.4 
- Vite 8.3.0 
- React plugin 6.0.1 
- React Router DOM 7.18.3 
- Playwright 1.64.1.

## Scenarios covered
- Valid Registration: current API creates a session
- Successful login and reload: Passed
- Logout and return to /login: Passed
- Duplicate account: current API returns 409
- Invalid credentials, no session: Passed
- Registration Sign In → /login: Source links to /sign-in
- Forgot Password Cancel → /login: Source navigates to /sign-in

Samples covered uses the real frontend with stubbed API responsed. It does not actually prove the backend password verifcation or database session behavior

## Validation
To reproduce the results
1. npm.cmd ci
2. npx.cmd playwright install chromium firefox
3. node --test server/test/runOwnership.test.js server/test/profileRoutes.test.js
4. npx.cmd playwright test e2e/auth.spec.js

Intended result should be the 6 playwright tests passing.
*Playwright starts Vite on port 4175

### Verify failures
To make sure that the tests don't pass no matter what, we can test whether a test fails

1. Temporarily change the first dashboard assertion in auth.spec.js to expect something like '/dashboard2134124' intsead of '/dashboard'
2. Run the command: npx.cmd playwright test e2e/auth.spec.js
3. Expect two failures and 4 passing tests
4. Restore the dashboard assertion to what it was originally

### Results
Existing basline: node --test server/test/runOwnership.test.js server/test/profileRoutes.test.js
- 18 test passed: ~574ms

Browser sample: npx.cmd playwright test e2e/auth.spec.js
- 6 test passed: ~6.6 seconds

Deliberatly incorrect URL assertion in Dashboard: npx.cmd playwright test e2e/auth.spec.js
- 2 failed, 4 Passed: ~18.3 seconds