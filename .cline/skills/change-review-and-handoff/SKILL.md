---
name: change-review-and-handoff
description: Review a DockVision diff against acceptance criteria and prepare a prioritized defect report or implementation handoff with real verification evidence. Use before a PR or after implementation; do not commit, push, or modify Jira automatically.
---

# Change review and handoff

## Required context

Identify the requested review scope, base/head or working-tree changes, acceptance criteria, and applicable contracts. Resolve paths to absolute paths from the actual workspace root; initial root is `A:\Documents\Sku Shit\Senior Project\ProjectAtlas\DockVision`.

## Procedure

1. Check status, remotes, and the comparison base before interpreting the diff. Do not assume `origin` is authoritative or cached remote refs are current; disclose whether live heads were checked.
2. Inspect intended tracked and untracked files explicitly. Preserve unrelated work and avoid branch switches, resets, staging, or publishing.
3. Trace changed behavior through callers and consumers. Prioritize correctness, security, regressions, contract compatibility, lifecycle/concurrency, and data preservation over stylistic preferences.
4. Map acceptance criteria to code and tests. Check negative scenarios, resource cleanup, secret exposure, and uncertain launch/retry handling where applicable.
5. Execute relevant safe tests when feasible. Record exact commands, results, skips, and environmental blockers. Do not infer functional success from a clean diff or passing build alone.
6. Check whitespace and accidental debug/comment churn in changed content, including untracked files that ordinary Git diff omits.

## Output and verification

For each finding provide severity, absolute file path and line, triggering scenario, impact, and a focused correction or test. Clearly distinguish confirmed defects from questions. If there are no findings, say so and still identify verification limitations.

For handoff, include outcome, affected scope, acceptance-criteria evidence, commands/results, manual checks actually performed, remaining risks, and coordination dependencies. Do not invent a Jira key or mandatory commit-message format.

## Boundaries

A review request does not authorize fixes unless requested. Neither a review nor a handoff authorizes commits, pushes, PR comments, Jira transitions, or sprint changes. Do not mark work accepted on the team's behalf.
