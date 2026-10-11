---
name: docker-windows-vm-diagnostics
description: Diagnose DockVision Docker and Windows guest readiness, shared mounts, heartbeat freshness, connectivity, and runner failures using non-destructive evidence. Use for VM startup or guest-handoff problems, not for automatic resets, deployments, or uploaded-script execution.
---

# Docker and Windows VM diagnostics

## Required context

Identify the development shell, Docker context/daemon, container, Windows guest, symptom, and time of failure. Inspect Compose, launcher scripts, readiness adapter, guest agent, and launch contract as relevant. Resolve all local references to absolute paths from the actual workspace root; initial root is `A:\Documents\Sku Shit\Senior Project\ProjectAtlas\DockVision`.

## Procedure

1. Distinguish the host, Docker's Linux environment, the container hosting virtualization, and the Windows guest. Do not assume a host command runs inside the guest or that host and guest paths are interchangeable.
2. Start with read-only evidence: Docker availability/context, Compose service status, bounded logs, and selected container state/mount fields. Avoid dumping environment variables or credentials.
3. Read Compose to determine actual mounts, device requirements, ports, and storage paths. Do not guess that the development host exposes the required virtualization devices.
4. Compare container identity/start time with heartbeat location, host-observed freshness, idle/busy state, and run identity according to the readiness implementation. A running container alone is insufficient.
5. Inspect active pointer and corresponding records read-only when relevant. Preserve inconsistent or unreadable state as evidence; do not clear it to force admission.
6. For GUI automation, verify guest session and interactive-desktop assumptions before blaming application code. Distinguish transport, readiness, task acceptance, and task execution failures.
7. State the narrowest likely cause, evidence, uncertainty, and next safe check. Propose disruptive recovery separately with data impact and explicit authorization requirements.

## Verification and output

Report each layer checked, redacted evidence, expected versus observed state, and unresolved checks. Use isolated readiness tests for code-level verification; do not launch a real task as a diagnostic shortcut.

## Boundaries

No automatic restart, rebuild, image pull, volume removal, storage deletion, pointer cleanup, or uploaded-code execution. Never recommend `down -v`, pruning, or deletion of VM storage as generic troubleshooting. Diagnosis does not authorize operational changes.
