# Repository-aligned code style

- Inspect nearby code and applicable configuration before choosing conventions.
- Preserve JavaScript/JSX and frontend ES modules; preserve CommonJS in the backend. Do not introduce a language or module-system migration implicitly.
- Use functional React components and hooks for new components. Keep hooks unconditional and clean up effects that own subscriptions, timers, or requests.
- Use descriptive names, focused responsibilities, and existing shared utilities. Avoid speculative abstractions and duplicate validators or API clients.
- Match local formatting in changed code; do not reformat unrelated lines. Do not impose a new formatter, line-ending policy, or naming convention without approval.
- Comments should explain intent, constraints, or non-obvious behavior. Preserve useful rationale and update comments made inaccurate by the change.
- Check manifests before claiming tooling is available. The existing client ESLint configuration is not proof that lint dependencies or a lint script are installed.
