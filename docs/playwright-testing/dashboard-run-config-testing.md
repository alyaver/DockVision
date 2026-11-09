## DOCKV 331 testing evaluation

Playwright should be used for browser-level testing of the Dashboard, Configuration Settings, and Dashboard-to-Confirmation preparation flow. The already existing node:test tests should also remain in use for backend testing, and shouldn't be migrated or duplicated over to Playwright.

The DOCKV 331 browser checks use the real React/Vite frontend with stubbed authentication, readiness, run-history, and export-storage APIs. They do not execute uploaded Python or PowerShell content and do not connect to Docker, the Windows VM, PostgreSQL, or production data.

The browser tests are configured in `playwright.config.js` and are stored in the `e2e` directory. Playwright starts only the Vite client; API calls are intercepted in the browser test setup by `e2e/support/apiStubs.js`.

## Tests covered

The Dashboard/run prep section of DOCKV 331 is stored in `e2e/run-preparation.spec.js`, which covers:
- Valid custom setup reaches `/confirmation` with the selected `.py` runner and `.json` task plan visible.
- Missing required custom runner input is rejected while remaining on `/dashboard`.
- Missing task-plan input is rejected in the Dashboard UI.
- Invalid runner and task-plan extensions are rejected in the Dashboard UI.
- The client-side 256 KiB runner boundary accepts exactly 256 KiB and rejects one byte over the limit.
- Switching from Custom Runner to Built-In Notepad does not render or submit the stale custom runner.
- Switching from Built-In Notepad back to Custom Runner restores the runner requirement.
- Clearing the current run removes selected content and the browser handoff.
- Dashboard refresh restores a valid preparation.
- Refreshing Confirmation preserves the selected test name, runner content, task-plan content, and selected options through `sessionStorage`.
- Partial runner storage renders safely and is replaced by a complete upload.
- Replacing runner and task-plan files updates the displayed names and stored content/language.
- Unavailability in Backend and Docker readiness states are visible and block the Start Test Run button.

The Config Settings section of DOCKV 331 is stored in `e2e/configuration-settings.spec.js`, which covers:
- Configuration Settings accepts iterations 1 and 30 and stores them as numbers.
- Configuration Settings rejects values outside the integer range without changing the saved settings.
- Configuration Settings maps all four capture-frequency choices to seconds.
- Configuration Settings restores its values after navigation and refresh.
- Configuration Settings recovers from corrupt storage by falling back to defaults and replacing the corrupt handoff.
- Missing Configuration Settings storage starts with defaults and creates a new handoff on save.

Three inert fixtures are provided to run some of these tests:
- `e2e/fixtures/plan.json`
- `e2e/fixtures/runner.py`
- `e2e/fixtures/runner.ps1`

## Validation

To reproduce the DOCKV 331 browser and supporting checks, run:
```powershell
npm.cmd install
npx.cmd playwright install chromium
npx.cmd playwright test e2e/run-preparation.spec.js e2e/configuration-settings.spec.js
npm.cmd run test:task-plan
npm.cmd run build -w client
```

The full browser command is also available for you to run all tests in the e2e directory:
```powershell
npm.cmd run test:e2e
```

This should report all 20 Playwright tests passing

## Results

Command:
```powershell
npx.cmd playwright test e2e/run-preparation.spec.js e2e/configuration-settings.spec.js
```
- 20/20 passed

```powershell
npm.cmd run test:task-plan
```
- 102/102 passed

```powershell
npm.cmd run build -w client
```
- Client built successfully