# DockVision Guest Agent
# This script runs inside the Windows guest VM and acts as a simple task agent
# that uses a shared folder as the communication channel with the host.
# The agent discovers a shared folder, creates it if needed, writes a startup log,
# emits a recurring heartbeat, reads a task file, executes supported tasks,
# writes result and task status files, and keeps looping forever.

$ErrorActionPreference = "Stop"

# Ensure only one instance of the agent runs at a time.
$createdNew = $false
$script:AgentMutex = New-Object System.Threading.Mutex($true, "Global\DockVisionGuestAgent", [ref]$createdNew)
if (-not $createdNew) {
    exit 0
}

# Agent identity and heartbeat settings
$AgentName = "DockVision Guest Agent"
$AgentVersion = "0.5.2"
$HeartbeatIntervalSeconds = 15

function Get-UtcTimestamp {
    # Return a timestamp in ISO 8601 format for logs and status files.
    return [DateTime]::UtcNow.ToString("o")
}

function Resolve-SharedRoot {
    # Find the shared folder where the host and guest can exchange files.
    # Try known mount points first, then fall back to a local directory if none exist.
    $candidates = @(
        "\\host.lan\Data",
        "C:\Users\Docker\Desktop\Shared",
        "C:\Users\Public\Desktop\Shared"
    )

    foreach ($candidate in $candidates) {
        if (Test-Path $candidate) {
            return $candidate
        }
    }

    # If no shared folder is available, create a fallback directory.
    $fallback = "C:\DockVision\shared-fallback"
    if (-not (Test-Path $fallback)) {
        New-Item -ItemType Directory -Force -Path $fallback | Out-Null
    }

    return $fallback
}

function Ensure-Directory {
    param([string]$Path)

    # Make sure the given path exists so the agent can write files there.
    if (-not (Test-Path $Path)) {
        New-Item -ItemType Directory -Force -Path $Path | Out-Null
    }
}

function Get-RunContext {
    param(
        [string]$SharedRoot,
        [string]$RunId
    )

    $runRoot = Join-Path (Join-Path $SharedRoot "runs") $RunId
    $logsRoot = Join-Path $runRoot "logs"

    return @{
        runId = $RunId
        runRoot = $runRoot
        metaPath = Join-Path $runRoot "meta.json"
        taskPath = Join-Path $runRoot "task.json"
        resultPath = Join-Path $runRoot "result.json"
        logsRoot = $logsRoot
        taskLogPath = Join-Path $logsRoot "task.log"
        screenshotsRoot = Join-Path $runRoot "screenshots"
        artifactsRoot = Join-Path $runRoot "artifacts"
    }
}

function Ensure-RunLayout {
    param([hashtable]$RunContext)

    foreach ($path in @(
        $RunContext.runRoot,
        $RunContext.logsRoot,
        $RunContext.screenshotsRoot,
        $RunContext.artifactsRoot
    )) {
        Ensure-Directory -Path $path
    }
}

function Read-CurrentRunPointer {
    param([string]$SharedRoot)

    $pointerPath = Join-Path (Join-Path $SharedRoot "active") "current-run.json"
    if (-not (Test-Path $pointerPath)) {
        return $null
    }

    try {
        $raw = Get-Content -Raw -Path $pointerPath -Encoding UTF8
        if ([string]::IsNullOrWhiteSpace($raw)) {
            return $null
        }

        return $raw | ConvertFrom-Json
    }
    catch {
        Write-InstallLog -SharedRoot $SharedRoot -Message ("Failed to parse current run pointer: " + $_.Exception.Message)
        return $null
    }
}

function Resolve-ActiveRunContext {
    param([string]$SharedRoot)

    $currentRun = Read-CurrentRunPointer -SharedRoot $SharedRoot
    if (-not $currentRun -or [string]::IsNullOrWhiteSpace([string]$currentRun.runId)) {
        return $null
    }

    $runContext = Get-RunContext -SharedRoot $SharedRoot -RunId ([string]$currentRun.runId)
    Ensure-RunLayout -RunContext $runContext
    return $runContext
}

function Write-RunLog {
    param(
        [hashtable]$RunContext,
        [string]$Message
    )

    Ensure-RunLayout -RunContext $RunContext
    $timestamp = Get-UtcTimestamp
    Add-Content -Encoding UTF8 -Path $RunContext.taskLogPath -Value "[$timestamp] $Message"
}

function ConvertTo-RelativeRunPath {
    param(
        [hashtable]$RunContext,
        [string]$AbsolutePath
    )

    $runRoot = [System.IO.Path]::GetFullPath($RunContext.runRoot)
    $targetPath = [System.IO.Path]::GetFullPath($AbsolutePath)

    if (-not $targetPath.StartsWith($runRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
        return $AbsolutePath
    }

    return $targetPath.Substring($runRoot.Length).TrimStart('\') -replace '\\', '/'
}

function Resolve-RunRelativePath {
    param(
        [hashtable]$RunContext,
        [string]$PathValue
    )

    if ([string]::IsNullOrWhiteSpace($PathValue)) {
        return $null
    }

    $candidate = if ([System.IO.Path]::IsPathRooted($PathValue)) {
        $PathValue
    }
    else {
        Join-Path $RunContext.runRoot $PathValue
    }

    $runRoot = [System.IO.Path]::GetFullPath($RunContext.runRoot)
    $resolvedPath = [System.IO.Path]::GetFullPath($candidate)

    if (-not $resolvedPath.StartsWith($runRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Resolved path is outside the active run folder: $PathValue"
    }

    return $resolvedPath
}

function Write-InstallLog {
    param(
        [string]$SharedRoot,
        [string]$Message
    )

    # Append a timestamped message to the agent install log in the shared root.
    $installLogPath = Join-Path $SharedRoot "agent-install-log.txt"
    $timestamp = Get-UtcTimestamp
    Add-Content -Encoding UTF8 -Path $installLogPath -Value "[$timestamp] $Message"
}

function Write-Heartbeat {
    param(
        [string]$SharedRoot,
        [string]$Status = "idle",
        [string]$TaskName = "waiting_for_task",
        [string]$RunId = ""
    )

    # Emit a heartbeat JSON file that documents the agent status and machine info.
    $heartbeatPath = Join-Path $SharedRoot "agent-heartbeat.json"

    $payload = @{
        agent = @{
            name = $AgentName
            version = $AgentVersion
            status = $Status
            taskName = $TaskName
            runId = $RunId
            intervalSeconds = $HeartbeatIntervalSeconds
        }
        machine = @{
            computerName = $env:COMPUTERNAME
            username = $env:USERNAME
            timestampUtc = Get-UtcTimestamp
            sharedRoot = $SharedRoot
        }
        prototype = @{
            notes = @(
                "Guest agent is running inside the Windows VM.",
                "Shared folder was detected successfully.",
                "Heartbeat is being written on a recurring loop."
            )
        }
    }

    $payload | ConvertTo-Json -Depth 10 | Set-Content -Encoding UTF8 -Path $heartbeatPath
}

function Read-TaskFile {
    param([string]$SharedRoot)

    # Read the host-provided task file for the active run channel.
    $runContext = Resolve-ActiveRunContext -SharedRoot $SharedRoot
    if (-not $runContext -or -not (Test-Path $runContext.taskPath)) {
        return $null
    }

    try {
        $raw = Get-Content -Raw -Path $runContext.taskPath -Encoding UTF8
        if ([string]::IsNullOrWhiteSpace($raw)) {
            return $null
        }

        $task = $raw | ConvertFrom-Json
        if ($task.PSObject.Properties.Name -notcontains "runId") {
            $task | Add-Member -NotePropertyName "runId" -NotePropertyValue $runContext.runId -Force
        }

        return $task
    }
    catch {
        # If parsing fails, write an install log entry and ignore the malformed task.
        Write-InstallLog -SharedRoot $SharedRoot -Message ("Failed to parse task file: " + $_.Exception.Message)
        return $null
    }
}

function Write-TaskFile {
    param(
        [hashtable]$RunContext,
        [object]$TaskObject
    )

    # Write the current task object back to disk, preserving status updates.
    Ensure-RunLayout -RunContext $RunContext
    $TaskObject | ConvertTo-Json -Depth 10 | Set-Content -Encoding UTF8 -Path $RunContext.taskPath
}

function Write-ResultFile {
    param(
        [hashtable]$RunContext,
        [string]$TaskId,
        [string]$Status,
        [string]$Message,
        [hashtable]$Artifacts = @{},
        [hashtable]$Details = @{}
    )

    # Write a result file for the completed task so the host can observe the outcome.
    Ensure-RunLayout -RunContext $RunContext

    $result = @{
        runId = $RunContext.runId
        taskId = $TaskId
        status = $Status
        finishedUtc = Get-UtcTimestamp
        message = $Message
        artifacts = $Artifacts
        details = $Details
    }

    $result | ConvertTo-Json -Depth 10 | Set-Content -Encoding UTF8 -Path $RunContext.resultPath
}

function Write-ResultObject {
    param(
        [hashtable]$RunContext,
        [object]$ResultObject
    )

    Ensure-RunLayout -RunContext $RunContext

    if ($ResultObject.PSObject.Properties.Name -notcontains "runId") {
        $ResultObject | Add-Member -NotePropertyName "runId" -NotePropertyValue $RunContext.runId -Force
    }

    $ResultObject | ConvertTo-Json -Depth 10 | Set-Content -Encoding UTF8 -Path $RunContext.resultPath
}

function ConvertFrom-RunnerOutputJson {
    param([string]$OutputText)

    if ([string]::IsNullOrWhiteSpace($OutputText)) {
        throw "Runner produced no output."
    }

    $startIndex = $OutputText.IndexOf("{")
    $endIndex = $OutputText.LastIndexOf("}")

    if ($startIndex -lt 0 -or $endIndex -lt $startIndex) {
        throw "Runner output did not contain a JSON object. Output: $OutputText"
    }

    $jsonText = $OutputText.Substring($startIndex, $endIndex - $startIndex + 1)
    return $jsonText | ConvertFrom-Json
}

function Get-TaskPayloadValue {
    param(
        [object]$Task,
        [string]$Name,
        [object]$DefaultValue
    )

    if ($Task.PSObject.Properties.Name -contains "payload" -and $null -ne $Task.payload) {
        $property = $Task.payload.PSObject.Properties[$Name]
        if ($null -ne $property -and $null -ne $property.Value) {
            return $property.Value
        }
    }

    return $DefaultValue
}

function ConvertTo-Boolean {
    param([object]$Value)

    if ($Value -is [bool]) {
        return $Value
    }

    if ($Value -is [string]) {
        return $Value.Trim().ToLowerInvariant() -in @("1", "true", "yes", "y", "on")
    }

    return [bool]$Value
}

function Get-DefaultNotepadText {
    param([string]$TaskId)

    return "DockVision Notepad proof of concept`r`nTask: $TaskId`r`nUTC: $(Get-UtcTimestamp)`r`nTyped through the Windows guest agent."
}

function Ensure-User32Type {
    if (-not ([System.Management.Automation.PSTypeName]"DockVision.User32").Type) {
        Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

namespace DockVision {
    public static class User32 {
        [DllImport("user32.dll")]
        public static extern bool SetForegroundWindow(IntPtr hWnd);

        [DllImport("user32.dll")]
        public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    }
}
"@
    }
}

function Wait-ForMainWindow {
    param(
        [System.Diagnostics.Process]$Process,
        [int]$TimeoutSeconds = 20
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        $Process.Refresh()
        if ($Process.MainWindowHandle -ne [IntPtr]::Zero) {
            return $Process.MainWindowHandle
        }

        Start-Sleep -Milliseconds 250
    }

    throw "Timed out waiting for Notepad main window."
}

function Focus-Window {
    param([IntPtr]$WindowHandle)

    Ensure-User32Type
    [DockVision.User32]::ShowWindow($WindowHandle, 9) | Out-Null
    [DockVision.User32]::SetForegroundWindow($WindowHandle) | Out-Null
    Start-Sleep -Milliseconds 350
}

function ConvertTo-SendKeysLiteral {
    param([string]$Character)

    switch ($Character) {
        "`r" { return $null }
        "`n" { return "{ENTER}" }
        "`t" { return "{TAB}" }
        "{" { return "{{}" }
        "}" { return "{}}" }
        default {
            if ("+^%~()[]".Contains($Character)) {
                return "{$Character}"
            }

            return $Character
        }
    }
}

function Send-HumanLikeText {
    param(
        [string]$Text,
        [int]$DelayMs = 35
    )

    Add-Type -AssemblyName System.Windows.Forms

    foreach ($character in $Text.ToCharArray()) {
        $keys = ConvertTo-SendKeysLiteral -Character ([string]$character)
        if ($null -ne $keys) {
            [System.Windows.Forms.SendKeys]::SendWait($keys)
        }

        if ($DelayMs -gt 0) {
            Start-Sleep -Milliseconds $DelayMs
        }
    }
}

function Capture-ScreenArtifact {
    param(
        [hashtable]$RunContext,
        [string]$TaskId
    )

    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing

    Ensure-RunLayout -RunContext $RunContext

    $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
    $bitmap = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $path = Join-Path $RunContext.screenshotsRoot "notepad-$TaskId.png"

    try {
        $graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
        $bitmap.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
        return ConvertTo-RelativeRunPath -RunContext $RunContext -AbsolutePath $path
    }
    finally {
        $graphics.Dispose()
        $bitmap.Dispose()
    }
}

function Wait-ForFileArtifact {
    param(
        [string]$Path,
        [int]$TimeoutSeconds = 10,
        [long]$MinimumLength = 1
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        if (Test-Path -LiteralPath $Path) {
            try {
                $file = Get-Item -LiteralPath $Path -ErrorAction Stop
                if ($file.Length -ge $MinimumLength) {
                    return $true
                }
            }
            catch {
                # Keep polling until the file becomes readable.
            }
        }

        Start-Sleep -Milliseconds 250
    }

    return $false
}

function Wait-ForProcessExit {
    param(
        [System.Diagnostics.Process]$Process,
        [int]$TimeoutSeconds = 5
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        $Process.Refresh()
        if ($Process.HasExited) {
            return $true
        }

        Start-Sleep -Milliseconds 250
    }

    $Process.Refresh()
    return $Process.HasExited
}

function Stop-ProcessIfRunning {
    param(
        [System.Diagnostics.Process]$Process,
        [int]$TimeoutSeconds = 5
    )

    if (-not $Process) {
        return $true
    }

    try {
        $Process.Refresh()
        if ($Process.HasExited) {
            return $true
        }
    }
    catch {
        return $true
    }

    Stop-Process -Id $Process.Id -Force -ErrorAction Stop
    return Wait-ForProcessExit -Process $Process -TimeoutSeconds $TimeoutSeconds
}

function Resolve-PythonExecutable {
    param(
        [string]$Command,
        [string[]]$Arguments = @()
    )

    try {
        $output = & $Command @Arguments -c "import sys; print(sys.executable)" 2>$null
        if ($LASTEXITCODE -ne 0 -or -not $output) {
            return $null
        }

        $pythonPath = [string](@($output)[0])
        $pythonPath = $pythonPath.Trim()
        if (-not [string]::IsNullOrWhiteSpace($pythonPath) -and (Test-Path -LiteralPath $pythonPath)) {
            return (Resolve-Path -LiteralPath $pythonPath).Path
        }
    }
    catch {
        return $null
    }

    return $null
}

function Find-PythonCommand {
    # Confirm that the candidate can execute Python code instead of only checking
    # whether a command shim or Windows app alias exists.
    foreach ($candidate in @(
        @{ Command = "python.exe"; Arguments = @() },
        @{ Command = "python"; Arguments = @() },
        @{ Command = "py.exe"; Arguments = @("-3") },
        @{ Command = "py"; Arguments = @("-3") }
    )) {
        $pythonPath = Resolve-PythonExecutable -Command $candidate.Command -Arguments $candidate.Arguments
        if ($pythonPath) {
            return $pythonPath
        }
    }

    foreach ($root in @(
        "C:\DockVision\Python*",
        "$env:ProgramFiles\Python*",
        "$env:LocalAppData\Programs\Python\Python*",
        "C:\Python*"
    )) {
        $directories = Get-ChildItem -Path $root -Directory -ErrorAction SilentlyContinue |
            Sort-Object -Property FullName -Descending

        foreach ($directory in $directories) {
            $pythonPath = Resolve-PythonExecutable -Command (Join-Path $directory.FullName "python.exe")
            if ($pythonPath) {
                return $pythonPath
            }
        }
    }

    return $null
}

function Add-PythonRuntimePaths {
    param([string]$PythonPath)

    if ([string]::IsNullOrWhiteSpace($PythonPath) -or -not (Test-Path -LiteralPath $PythonPath)) {
        return
    }

    $pythonRoot = Split-Path -Parent $PythonPath
    $candidates = New-Object System.Collections.Generic.List[string]
    $candidates.Add($pythonRoot)
    $candidates.Add((Join-Path $pythonRoot "Scripts"))

    try {
        $sitePackagesOutput = & $PythonPath -c "import site; print(site.getsitepackages()[0])" 2>$null
        if ($LASTEXITCODE -eq 0 -and $sitePackagesOutput) {
            $sitePackages = ([string](@($sitePackagesOutput)[0])).Trim()
            $candidates.Add($sitePackages)
            $candidates.Add((Join-Path $sitePackages "pywin32_system32"))
        }
    }
    catch {
        # The run can still continue; failed imports will surface in the runner output.
    }

    foreach ($part in ($env:Path -split ";")) {
        if (-not [string]::IsNullOrWhiteSpace($part)) {
            $candidates.Add($part)
        }
    }

    $env:Path = ($candidates |
        Where-Object { -not [string]::IsNullOrWhiteSpace($_) -and (Test-Path -LiteralPath $_) } |
        Select-Object -Unique) -join ";"
}

function Invoke-PythonNotepadTask {
    param(
        [hashtable]$RunContext,
        [object]$Task,
        [string]$TaskId
    )

    $scriptPath = Join-Path $PSScriptRoot "dockvision_notepad_task.py"
    if (-not (Test-Path $scriptPath)) {
        throw "Python Notepad task script was not found at $scriptPath"
    }

    $pythonPath = Find-PythonCommand
    if (-not $pythonPath) {
        throw "Python is not available inside the Windows guest."
    }

    Add-PythonRuntimePaths -PythonPath $pythonPath

    $payloadFile = Join-Path $env:TEMP "dockvision-$TaskId-payload.json"
    if ($Task.PSObject.Properties.Name -contains "payload" -and $null -ne $Task.payload) {
        $Task.payload | ConvertTo-Json -Depth 10 | Set-Content -Encoding UTF8 -Path $payloadFile
    }
    else {
        "{}" | Set-Content -Encoding UTF8 -Path $payloadFile
    }

    $output = & $pythonPath $scriptPath --run-root $RunContext.runRoot --task-id $TaskId --payload-file $payloadFile 2>&1
    $exitCode = $LASTEXITCODE
    $outputText = ($output | Out-String).Trim()

    if ($exitCode -ne 0) {
        throw "Python Notepad task failed: $outputText"
    }

    return $outputText | ConvertFrom-Json
}

function Invoke-UploadedScriptRunnerTask {
    param(
        [hashtable]$RunContext,
        [object]$Task,
        [string]$TaskId
    )

    $language = [string](Get-TaskPayloadValue -Task $Task -Name "runnerScriptLanguage" -DefaultValue "")
    $runnerPathValue = [string](Get-TaskPayloadValue -Task $Task -Name "runnerPath" -DefaultValue "")
    $configPathValue = [string](Get-TaskPayloadValue -Task $Task -Name "configPath" -DefaultValue "")

    if ([string]::IsNullOrWhiteSpace($runnerPathValue)) {
        throw "script_runner task requires payload.runnerPath."
    }

    if ([string]::IsNullOrWhiteSpace($configPathValue)) {
        throw "script_runner task requires payload.configPath."
    }

    $runnerPath = Resolve-RunRelativePath -RunContext $RunContext -PathValue $runnerPathValue
    $configPath = Resolve-RunRelativePath -RunContext $RunContext -PathValue $configPathValue

    if (-not (Test-Path -LiteralPath $runnerPath)) {
        throw "Uploaded runner was not found at $runnerPath"
    }

    if (-not (Test-Path -LiteralPath $configPath)) {
        throw "Uploaded task plan was not found at $configPath"
    }

    if ([string]::IsNullOrWhiteSpace($language)) {
        if ($runnerPath.ToLowerInvariant().EndsWith(".py")) {
            $language = "python"
        }
        elseif ($runnerPath.ToLowerInvariant().EndsWith(".ps1")) {
            $language = "powershell"
        }
    }

    Write-RunLog -RunContext $RunContext -Message "Executing uploaded $language runner: $runnerPath"

    if ($language -eq "python") {
        $pythonPath = Find-PythonCommand
        if (-not $pythonPath) {
            throw "Python is not available inside the Windows guest."
        }

        Add-PythonRuntimePaths -PythonPath $pythonPath
        $output = & $pythonPath $runnerPath --plan $configPath 2>&1
    }
    elseif ($language -eq "powershell") {
        $output = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $runnerPath -ConfigPath $configPath 2>&1
    }
    else {
        throw "Unsupported uploaded runner language '$language'."
    }

    $exitCode = $LASTEXITCODE
    $outputText = ($output | Out-String).Trim()

    if ($exitCode -ne 0) {
        throw "Uploaded runner failed with exit code $exitCode. $outputText"
    }

    try {
        $result = ConvertFrom-RunnerOutputJson -OutputText $outputText
    }
    catch {
        throw "Uploaded runner completed but did not return valid JSON. Output: $outputText"
    }

    if ($result.PSObject.Properties.Name -notcontains "taskId") {
        $result | Add-Member -NotePropertyName "taskId" -NotePropertyValue $TaskId -Force
    }

    return $result
}

function Invoke-PowerShellNotepadTask {
    param(
        [hashtable]$RunContext,
        [object]$Task,
        [string]$TaskId,
        [string]$PythonWarning = ""
    )

    $text = [string](Get-TaskPayloadValue -Task $Task -Name "text" -DefaultValue (Get-DefaultNotepadText -TaskId $TaskId))
    $typingDelayMs = [int](Get-TaskPayloadValue -Task $Task -Name "typingDelayMs" -DefaultValue 35)
    $captureScreenshot = ConvertTo-Boolean (Get-TaskPayloadValue -Task $Task -Name "captureScreenshot" -DefaultValue $true)
    $saveFile = ConvertTo-Boolean (Get-TaskPayloadValue -Task $Task -Name "saveFile" -DefaultValue $false)
    $closeAfter = ConvertTo-Boolean (Get-TaskPayloadValue -Task $Task -Name "closeAfter" -DefaultValue $false)
    $taskType = if ($Task.taskType) { [string]$Task.taskType } else { "unknown" }
    $savePath = $null

    if ($saveFile) {
        Ensure-RunLayout -RunContext $RunContext
        $fileName = [string](Get-TaskPayloadValue -Task $Task -Name "fileName" -DefaultValue "dockvision-notepad-$TaskId.txt")
        $savePath = Join-Path $RunContext.artifactsRoot $fileName
    }

    $artifacts = @{}
    $details = @{
        automationBackend = "powershell-sendkeys"
        taskType = $taskType
        typingDelayMs = $typingDelayMs
        typedCharacterCount = $text.Length
        saveRequested = $saveFile
        closeRequested = $closeAfter
    }

    if ($PythonWarning) {
        $details.pythonWarning = $PythonWarning
    }

    $process = if ($savePath) {
        Start-Process "notepad.exe" -ArgumentList $savePath -PassThru
    }
    else {
        Start-Process "notepad.exe" -PassThru
    }

    $details.processId = $process.Id

    try {
        $handle = Wait-ForMainWindow -Process $process
        Focus-Window -WindowHandle $handle
        Send-HumanLikeText -Text $text -DelayMs $typingDelayMs
        Start-Sleep -Milliseconds 500

        if ($captureScreenshot) {
            try {
                $artifacts.screenshot = Capture-ScreenArtifact -RunContext $RunContext -TaskId $TaskId
            }
            catch {
                $details.screenshotWarning = $_.Exception.Message
            }
        }

        if ($saveFile) {
            Add-Type -AssemblyName System.Windows.Forms
            Focus-Window -WindowHandle $handle
            [System.Windows.Forms.SendKeys]::SendWait("^s")
            if (-not (Wait-ForFileArtifact -Path $savePath -TimeoutSeconds 10)) {
                throw "Notepad did not save the requested file within 10 seconds: $savePath"
            }

            $artifacts.savedFile = ConvertTo-RelativeRunPath -RunContext $RunContext -AbsolutePath $savePath
            $details.savedFile = $artifacts.savedFile
            $details.saveVerified = $true
        }

        if ($closeAfter) {
            Add-Type -AssemblyName System.Windows.Forms
            Focus-Window -WindowHandle $handle
            [System.Windows.Forms.SendKeys]::SendWait("%{F4}")
            if (Wait-ForProcessExit -Process $process -TimeoutSeconds 5) {
                $details.closed = $true
                $details.closedGracefully = $true
                $details.closeMethod = "alt-f4"
            }
            else {
                $details.closed = Stop-ProcessIfRunning -Process $process -TimeoutSeconds 5
                $details.closedGracefully = $false
                $details.closeMethod = "force-stop"
            }

            if (-not $details.closed) {
                throw "Notepad did not close after the closeAfter request."
            }
        }

        return @{
            taskId = $TaskId
            status = "completed"
            finishedUtc = Get-UtcTimestamp
            message = "Notepad focused and typed through PowerShell UI automation."
            artifacts = $artifacts
            details = $details
        }
    }
    catch {
        try {
            Stop-ProcessIfRunning -Process $process -TimeoutSeconds 5 | Out-Null
        }
        catch {
            # Preserve the original failure when cleanup also fails.
        }

        throw
    }
}

function Invoke-NotepadAutomationTask {
    param(
        [string]$SharedRoot,
        [hashtable]$RunContext,
        [object]$Task,
        [string]$TaskId
    )

    $pythonWarning = ""

    try {
        $result = Invoke-PythonNotepadTask -RunContext $RunContext -Task $Task -TaskId $TaskId
        Write-ResultObject -RunContext $RunContext -ResultObject $result
    }
    catch {
        $pythonWarning = $_.Exception.Message
        Write-InstallLog -SharedRoot $SharedRoot -Message ("Python Notepad path unavailable; using PowerShell fallback. " + $pythonWarning)
        Write-RunLog -RunContext $RunContext -Message ("Python Notepad path unavailable; using PowerShell fallback. " + $pythonWarning)

        $result = Invoke-PowerShellNotepadTask -RunContext $RunContext -Task $Task -TaskId $TaskId -PythonWarning $pythonWarning
        Write-ResultObject -RunContext $RunContext -ResultObject $result
    }
}

function Mark-TaskRunning {
    param(
        [hashtable]$RunContext,
        [object]$TaskObject
    )

    if ($TaskObject.PSObject.Properties.Name -contains "status") {
        $TaskObject.status = "running"
    }
    else {
        $TaskObject | Add-Member -NotePropertyName "status" -NotePropertyValue "running" -Force
    }

    if ($TaskObject.PSObject.Properties.Name -contains "startedUtc") {
        $TaskObject.startedUtc = Get-UtcTimestamp
    }
    else {
        $TaskObject | Add-Member -NotePropertyName "startedUtc" -NotePropertyValue (Get-UtcTimestamp) -Force
    }

    Write-TaskFile -RunContext $RunContext -TaskObject $TaskObject
}

function Mark-TaskFinished {
    param(
        [hashtable]$RunContext,
        [object]$TaskObject,
        [string]$Status
    )

    # Update the task object to record completion status and timestamp.
    if ($TaskObject.PSObject.Properties.Name -contains "status") {
        $TaskObject.status = $Status
    }
    else {
        $TaskObject | Add-Member -NotePropertyName "status" -NotePropertyValue $Status -Force
    }

    if ($TaskObject.PSObject.Properties.Name -contains "completedUtc") {
        $TaskObject.completedUtc = Get-UtcTimestamp
    }
    else {
        $TaskObject | Add-Member -NotePropertyName "completedUtc" -NotePropertyValue (Get-UtcTimestamp) -Force
    }

    Write-TaskFile -RunContext $RunContext -TaskObject $TaskObject
}

function Handle-Task {
    param(
        [string]$SharedRoot,
        [object]$Task
    )

    # Execute the current task and write results, while updating logs and heartbeat.
    $taskId = if ($Task.taskId) { [string]$Task.taskId } else { "unknown-task" }
    $taskType = if ($Task.taskType) { [string]$Task.taskType } else { "unknown" }
    $runId = if ($Task.runId) { [string]$Task.runId } else { "" }
    $runContext = if ($runId) { Get-RunContext -SharedRoot $SharedRoot -RunId $runId } else { $null }

    if (-not $runContext) {
        Write-InstallLog -SharedRoot $SharedRoot -Message "Skipping task because no active run context could be resolved."
        return
    }

    Ensure-RunLayout -RunContext $runContext

    Write-InstallLog -SharedRoot $SharedRoot -Message "Handling task '$taskId' of type '$taskType'."
    Write-RunLog -RunContext $runContext -Message "Handling task '$taskId' of type '$taskType'."
    Mark-TaskRunning -RunContext $runContext -TaskObject $Task
    Write-Heartbeat -SharedRoot $SharedRoot -Status "running" -TaskName $taskType -RunId $runId

    try {
        switch ($taskType) {
            "noop" {
                # A no-op task that simply returns success.
                Write-ResultFile -RunContext $runContext -TaskId $taskId -Status "completed" -Message "No-op task completed."
            }

            "open_notepad" {
                Invoke-NotepadAutomationTask -SharedRoot $SharedRoot -RunContext $runContext -Task $Task -TaskId $taskId
            }

            "notepad_lifecycle" {
                Invoke-NotepadAutomationTask -SharedRoot $SharedRoot -RunContext $runContext -Task $Task -TaskId $taskId
            }

            "script_runner" {
                $result = Invoke-UploadedScriptRunnerTask -RunContext $runContext -Task $Task -TaskId $taskId
                Write-ResultObject -RunContext $runContext -ResultObject $result
            }

            default {
                # For unrecognized tasks, acknowledge receipt but do not fail.
                Write-ResultFile -RunContext $runContext -TaskId $taskId -Status "completed" -Message "Prototype agent acknowledged task type '$taskType'."
            }
        }

        Write-RunLog -RunContext $runContext -Message "Task '$taskId' completed successfully."
        Mark-TaskFinished -RunContext $runContext -TaskObject $Task -Status "completed"
    }
    catch {
        # If task execution fails, report failure and keep the task file updated.
        Write-InstallLog -SharedRoot $SharedRoot -Message ("Task failed: " + $_.Exception.Message)
        Write-RunLog -RunContext $runContext -Message ("Task failed: " + $_.Exception.Message)
        Write-ResultFile -RunContext $runContext -TaskId $taskId -Status "failed" -Message $_.Exception.Message
        Mark-TaskFinished -RunContext $runContext -TaskObject $Task -Status "failed"
    }
    finally {
        # Return the agent to idle state after handling the task.
        Write-Heartbeat -SharedRoot $SharedRoot -Status "idle" -TaskName "waiting_for_task"
    }
}

# Start the main agent flow:
# 1. Resolve the shared folder path.
# 2. Ensure the directory exists.
# 3. Log startup and begin the heartbeat/task loop.
$sharedRoot = Resolve-SharedRoot
Ensure-Directory -Path $sharedRoot

Write-InstallLog -SharedRoot $sharedRoot -Message "Agent startup begin."
Write-InstallLog -SharedRoot $sharedRoot -Message "Resolved shared root to: $sharedRoot"
Write-InstallLog -SharedRoot $sharedRoot -Message "Heartbeat loop starting."

while ($true) {
    try {
        # Emit heartbeat regularly so the host can see the agent is alive.
        Write-Heartbeat -SharedRoot $sharedRoot -Status "idle" -TaskName "waiting_for_task"

        # Check for a task file and only handle it if it is queued.
        $task = Read-TaskFile -SharedRoot $sharedRoot
        if ($task -and $task.status -eq "queued") {
            Handle-Task -SharedRoot $sharedRoot -Task $task
        }
    }
    catch {
        # Log any loop-level errors but keep the loop alive.
        try {
            Write-InstallLog -SharedRoot $sharedRoot -Message ("Agent loop error: " + $_.Exception.Message)
        }
        catch {
        }
    }

    Start-Sleep -Seconds $HeartbeatIntervalSeconds
}
