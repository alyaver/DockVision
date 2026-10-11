# Verify behavior changes

- Add or update appropriate automated tests for new or changed behavior. For a bug fix, add a regression test that exposes the original failure when feasible.
- Retain the established Node built-in runner for backend and pure-JavaScript tests. Do not add a new test framework without approval.
- Test observable outcomes, including relevant invalid input, boundaries, failures, concurrency, lifecycle transitions, and data preservation. Avoid assertions tied only to incidental implementation details.
- Keep routine tests deterministic and isolated: use temporary storage, controlled clocks, ephemeral ports, and stubs for external dependencies. Clean up resources owned by the test.
- Never use production databases, live VM run storage, or execution of uploaded scripts for routine tests.
- Run focused tests first, then relevant existing suites. Inspect the current scripts before selecting commands. Do not weaken assertions or hide failures to obtain a passing result.
- Report exact commands, outcomes, skips, and blockers. Distinguish pre-existing failures from regressions using evidence, not assumptions.
- For documentation-only work, validate content, references, and structure; explain why runtime tests are unnecessary. When automated coverage is unavailable, state the gap and give concrete manual checks without calling them automated coverage.
