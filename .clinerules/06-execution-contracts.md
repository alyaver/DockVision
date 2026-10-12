# Execution safety and contract preservation

- Before changing launch admission or guest handoff, read the launch contract and relevant producer, consumer, and tests. Resolve their paths from the workspace root.
- Do not invent request fields, statuses, defaults, retry guarantees, or lifecycle ownership. Flag contradictions between the contract and implementation.
- Preserve submitted runner/configuration content and active-run data according to the contract. Include failure and concurrency verification when modifying storage or publication.
- Never execute arbitrary uploaded scripts on the development host. Keep guest execution behind the existing backend/guest boundary.
- Do not start, stop, reset, rebuild, or delete VM/container resources merely to inspect a problem. Obtain explicit authorization for disruptive operations and explain data impact.
- Never delete VM storage, active pointers, or live run data as routine cleanup or testing.
- Do not blindly retry uncertain launch requests or treat a running container as proof of guest readiness.
- Keep secrets outside committed files; redact tokens, credentials, and sensitive payloads from diagnostic output.
