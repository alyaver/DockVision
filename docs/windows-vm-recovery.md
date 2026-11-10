# Windows VM boot recovery

## Runtime configuration

DockVision builds a pinned `dockurr/windows` image through
`WindowsVm/Dockerfile`. The derived image applies two host-specific boot
recovery settings:

- The image boot watchdog is extended from 30 seconds to 300 seconds.
- QEMU uses `snapshot=on` only for the writable OVMF variables pflash drive.

The Compose service also uses the conservative nested-KVM CPU settings:

```text
CPU_MODEL=Skylake-Client-v4
HV=N
VMX=N
```

Do not replace these settings with host CPU passthrough without repeating the
bounded boot qualification described below.

## Persistence behavior

The Windows guest disk and UEFI variables intentionally have different
persistence behavior:

```text
WindowsVm/OS/data.img       Persistent Windows OS and application state
WindowsVm/OS/windows.vars   Base OVMF variables file
QEMU pflash snapshot        Ephemeral UEFI-variable writes for one VM process
```

The generated QEMU command must include:

```text
-drive file=/storage/windows.vars,if=pflash,unit=1,format=raw,snapshot=on
```

It must not use global QEMU `-snapshot` for normal operation. Global snapshot
mode would also discard writes to the Windows guest disk.

Because UEFI-variable writes are ephemeral, firmware boot-order changes,
firmware configuration changes, and some recovery-time firmware registrations
may not persist across VM restarts. Ordinary Windows filesystem changes remain
persistent in `data.img`.

## Readiness and timing

A running container alone does not prove that the Windows guest is ready.
Readiness requires `WindowsVm/shared/agent-heartbeat.json` to be:

- valid JSON;
- fresh;
- newer than the current VM container start;
- `idle`; and
- not associated with another run.

An early QEMU register value of `RIP=000000007fae977b` is not by itself a boot
failure. During the recovery qualification, the guest remained at that address
at an early checkpoint, loaded Windows Boot Manager after approximately 93
seconds, and published an idle heartbeat within the 300-second watchdog.

Wait for the bounded watchdog or positive readiness evidence before declaring
the boot stalled.

## Safe qualification

For a non-destructive boot qualification, mount the live `data.img` read-only
as the backing file for a temporary qcow2 overlay. Use separate temporary
storage for the overlay, UEFI files, logs, and shared directory. Before starting
QEMU, verify:

- the live `data.img` mount is read-only;
- only temporary paths are writable;
- restart is disabled;
- no global `-snapshot` argument is present;
- the data drive uses the temporary qcow2 overlay; and
- only the UEFI variables pflash drive has `snapshot=on`.

Do not copy over, replace, truncate, or delete the live `data.img` or preserved
UEFI-variable backups as routine troubleshooting.

## KVM availability after Docker Desktop or WSL changes

If Docker cannot pass `/dev/kvm` after Docker Desktop or WSL changes, verify the
device in the `docker-desktop` WSL distribution. The previously successful
recovery was:

```sh
modprobe kvm
modprobe kvm_intel
```

Then confirm a Docker container can receive `--device /dev/kvm` before starting
the Windows VM. Do not treat a running container as proof that KVM or the guest
agent is ready.

## Operational boundary

The safe overlay qualification does not prove direct writable operation of the
live raw `data.img`. A final production-path test is a separate, deliberate
operation because normal Windows boot activity will modify that live disk. It
must be authorized separately and should verify the actual QEMU command,
Windows networking, and a fresh idle guest-agent heartbeat.