## DOCKV 332 testing evaluation

Playwright should be used for browser-level testing of Run Confirmation and Launch Admission. The already existing node:test tests should also remain in use for backend testing, and shouldn't be migrated or duplicated over to Playwright.

The DOCKV 332 browser checks use the real React/Vite frontend with stubbed launch responses. They do not submit to the live backend, publish to the guest share, start Docker or the Windows VM, or execute uploaded content.

The browser tests are configured in `playwright.config.js` and live in the root `e2e` directory. Playwright starts only the Vite client; API calls are intercepted in the browser test setup by `e2e/support/apiStubs.js`; launch-admission responses are stubbed directly in the tests.

## Tests covered

The current DOCKV 332 sample is in `e2e/confirmation-launch.spec.js`, which covers:
- Accepted `202` launch response hands the returned `runId` to the running-test route.
- Submitted execution mode, runner content, and task-plan content are preserved in the launch request.
- Repeated Confirm clicks create exactly one admission request, rather than creating duplicate submissions.
- An uncertain network failure is not automatically resubmitted.
- Explicit retryable readiness response `GUEST_STARTING` is retried before the accepted response.

## Validation

To reproduce the DOCKV 332 browser and supporting checks, run:
```powershell
npm.cmd install
npx.cmd playwright install chromium
npx.cmd playwright test e2e/confirmation-launch.spec.js
npm.cmd run test:task-plan
npm.cmd run build -w client
npm.cmd test -w server
```

The full browser command is also available for you to run all tests in the e2e directory:
```powershell
npm.cmd run test:e2e
```

This should report all 4 Playwright tests passing

## Results

Command:
```powershell
npx.cmd playwright test e2e/confirmation-launch.spec.js
```
- 4/4 passed

```powershell
npm.cmd run test:task-plan
```
- 102/102 passed

```powershell
npm.cmd run build -w client
```
- Client built successfully

```powershell
npm.cmd test -w server
```
- 121/122 passed
- 1 unrelated existing failure in `server/test/windowsVmRuntime.test.js` while comparing the VM deployment bundle for the selected single-file Python agent. That failure was outside the scope of DOCKV 332, and was left unmodified.