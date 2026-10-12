# Commit and PR hygiene

- Inspect working-tree status and the final diff. Stage only intended files, and only when staging is requested; avoid blanket staging in a dirty workspace.
- Check whitespace errors in the changed files. Fix accidental whitespace locally, not with a repository-wide formatting pass. Remember that a normal Git diff omits untracked files.
- Remove accidental debug output, stale commented-out code, and misleading comments in the changed area; preserve useful diagnostics and rationale.
- Exclude secrets, credentials, local logs, generated run artifacts, and VM storage from commits.
- Describe the outcome and scope; include a Jira reference when supplied and list actual verification evidence and remaining gaps. Follow existing team message conventions rather than inventing a required format.
- Do not commit, push, amend, rewrite history, or change branches unless requested. Approval to edit files is not approval to publish them.
