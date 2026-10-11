---
name: react-ui-change
description: Implement or review DockVision React UI changes across routing, components, API interactions, loading and error states, accessibility, and effect cleanup. Use for frontend behavior work, not for backend-only changes or a framework migration.
---

# React UI change

## Required context

Inspect the client manifest, ESLint configuration, central router, affected components, styles, API helpers, and relevant tests. Resolve references to absolute paths from the actual workspace root; initial root is `A:\Documents\Sku Shit\Senior Project\ProjectAtlas\DockVision`.

## Procedure

1. Trace the entry route, inputs, state ownership, API request, response handling, and navigation outcome before editing.
2. Preserve JavaScript/JSX, functional components, existing routing conventions, and shared helpers. Avoid parallel implementations of the same API or validation logic.
3. Define observable idle, loading, success, empty, invalid, and failure states where applicable. Preserve user input on retryable failures and prevent accidental duplicate submission.
4. Use semantic controls, associated labels, keyboard access, and understandable error/status feedback. Verify disabled controls and focus behavior in the affected flow.
5. Clean up owned timers, subscriptions, and requests. Separate stopping UI polling from cancelling an already accepted backend run.
6. For launch changes, read the current launch contract and retry helper. Do not automatically resend an uncertain launch outcome or broaden readiness retries to all conflicts.
7. Add appropriate existing automated coverage. If component-test infrastructure is absent, record that gap and propose it separately rather than silently installing dependencies.

## Verification and output

After confirming the manifest, run `npm run build -w client` from the resolved workspace root. Run relevant existing tests and inspect whether lint is actually configured and executable before claiming lint coverage.

Provide a manual scenario list with expected results for the affected UI, including failure recovery and keyboard interaction. Report which scenarios were actually exercised; do not label a successful build as a browser test.

## Boundaries

Do not redesign unrelated pages, replace the router, migrate languages, or modify backend contracts without an explicit need and plan. UI validation does not replace server-side validation.
