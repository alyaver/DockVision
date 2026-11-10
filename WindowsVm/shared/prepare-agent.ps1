param(
    [string]$SharedRoot = ""
)

$ErrorActionPreference = "Stop"
$TaskName = "DockVisionAgent"
$AgentVersion = "0.5.2"
$AgentRoot = "C:\DockVision\agent"
$AgentPath = Join-Path $AgentRoot "vm-notepad-runner.py"
$RuntimeScriptPath = Join-Path $AgentRoot "ensure-python-runtime.ps1"

function Get-UtcTimestamp {
    return [DateTime]::UtcNow.ToString("o")
}

function Resolve-SharedRoot {
    param([string]$RequestedRoot)

    foreach ($candidate in @(
        $RequestedRoot,
        "\\host.lan\Data",
        "C:\Users\Docker\Desktop\Shared",
        "C:\Users\Public\Desktop\Shared"
    )) {
        if (-not [string]::IsNullOrWhiteSpace($candidate) -and (Test-Path -LiteralPath $candidate)) {
            return (Resolve-Path -LiteralPath $candidate).Path
        }
    }

    throw "The DockVision shared folder is unavailable. Verify the /shared mount and guest networking."
}

function Write-PreparationStatus {
    param(
        [ValidateSet("preparing", "ready", "failed")]
        [string]$State,
        [string]$Message,
        [string]$ErrorCode = ""
    )

    $statusPath = Join-Path $script:ResolvedSharedRoot "guest-preparation.json"
    $temporaryPath = "$statusPath.tmp"
    $status = [ordered]@{
        schemaVersion = 1
        state = $State
        updatedUtc = Get-UtcTimestamp
        agentVersion = $AgentVersion
        message = $Message
        errorCode = if ($ErrorCode) { $ErrorCode } else { $null }
    }

    $status | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $temporaryPath -Encoding UTF8
    Move-Item -LiteralPath $temporaryPath -Destination $statusPath -Force
}

function Resolve-Asset {
    param([string]$Name)

    foreach ($candidate in @(
        (Join-Path $script:ResolvedSharedRoot $Name),
        (Join-Path $PSScriptRoot $Name),
        (Join-Path "C:\OEM" $Name)
    )) {
        if (Test-Path -LiteralPath $candidate) {
            return (Resolve-Path -LiteralPath $candidate).Path
        }
    }

    throw "Required preparation asset '$Name' was not found. Rebuild the DockVision Windows image."
}

function Resolve-PythonExecutable {
    $managedPython = "C:\DockVision\Python311\python.exe"
    if (Test-Path -LiteralPath $managedPython) {
        return $managedPython
    }

    $pythonCommand = Get-Command python.exe -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($pythonCommand) {
        return $pythonCommand.Source
    }

    throw "Python setup completed, but python.exe could not be resolved."
}

try {
    $script:ResolvedSharedRoot = Resolve-SharedRoot -RequestedRoot $SharedRoot
    Write-PreparationStatus -State "preparing" -Message "Preparing the DockVision guest runtime and test agent."

    New-Item -ItemType Directory -Path $AgentRoot -Force | Out-Null
    Copy-Item -LiteralPath (Resolve-Asset -Name "vm-notepad-runner.py") -Destination $AgentPath -Force
    Copy-Item -LiteralPath (Resolve-Asset -Name "ensure-python-runtime.ps1") -Destination $RuntimeScriptPath -Force

    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $RuntimeScriptPath -SharedRoot $script:ResolvedSharedRoot
    if ($LASTEXITCODE -ne 0) {
        throw "The Python automation runtime could not be prepared. Review agent-install-log.txt for details."
    }

    $pythonExecutable = Resolve-PythonExecutable
    & $pythonExecutable -c "import pywinauto; from PIL import Image"
    if ($LASTEXITCODE -ne 0) {
        throw "The Python automation dependencies failed their import check."
    }

    $arguments = ([char]34) + $AgentPath + ([char]34) + " --agent"
    $action = New-ScheduledTaskAction -Execute $pythonExecutable -Argument $arguments
    $trigger = New-ScheduledTaskTrigger -AtLogOn
    $settings = New-ScheduledTaskSettingsSet `
        -RestartCount 999 `
        -RestartInterval (New-TimeSpan -Minutes 1) `
        -ExecutionTimeLimit ([TimeSpan]::Zero) `
        -MultipleInstances IgnoreNew

    Register-ScheduledTask `
        -TaskName $TaskName `
        -Action $action `
        -Trigger $trigger `
        -Settings $settings `
        -RunLevel Highest `
        -Force | Out-Null

    $task = Get-ScheduledTask -TaskName $TaskName
    if ($task.State -ne "Running") {
        Start-ScheduledTask -TaskName $TaskName
    }

    Write-PreparationStatus -State "ready" -Message "DockVision guest preparation completed; waiting for the agent heartbeat."
    exit 0
}
catch {
    if ($script:ResolvedSharedRoot) {
        try {
            Write-PreparationStatus `
                -State "failed" `
                -ErrorCode "GUEST_PREPARATION_FAILED" `
                -Message $_.Exception.Message
        }
        catch {
            Write-Error "Guest preparation failed and its status could not be published: $($_.Exception.Message)"
        }
    }

    Write-Error "DockVision guest preparation failed: $($_.Exception.Message)"
    exit 1
}