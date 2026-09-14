
<#
DockVision runner contract demo.

Purpose:
- Demonstrates the proposed DockVision runner pattern.
- The JSON file describes WHAT steps to run.
- This PowerShell file describes HOW to interpret and execute those steps.
- The future inner DockVision agent can launch this runner and collect stdout,
  stderr, exit code, logs, screenshots, and artifacts around it.

Sequential flow:
1. Accept the path to task-plan.json through ConfigPath.
2. Read and parse task-plan.json into a PowerShell object.
3. Create a small amount of runner state for the active app window.
4. Loop through every step in plan.steps in order.
5. For OPEN_APP, launch Notepad against a known demo text file.
6. Find and focus the Notepad window.
7. For TYPE, send the configured text into the active Notepad window.
8. Throw an error for unsupported or invalid steps.
9. Exit 0 when every step completes.

Run this file through PowerShell, not by double-clicking runner.ps1:
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\runner.ps1 -ConfigPath .\task-plan.json

For a double-clickable demo, use run-demo.bat in this same folder.
#>

# Script entry point. ConfigPath points to the task plan the runner should read.
param(
    # Path to the JSON task plan; defaults to task-plan.json beside this script.
    [string]$ConfigPath = (Join-Path $PSScriptRoot "task-plan.json")
)

# Stop immediately on errors so failures become visible to the terminal today
# and to the future DockVision agent result-capture logic later.
$ErrorActionPreference = "Stop"

# Read and parse the JSON task plan. This is the boundary between the frontend
# generated task list and the executable PowerShell runner.
function Read-DockVisionPlan {
    param([string]$Path)

    # Read the task-plan JSON file from disk.
    if (-not (Test-Path -LiteralPath $Path)) {
        throw "Task plan was not found at: $Path"
    }

    # Load the raw text and validate that it contains content before parsing.
    $rawPlan = Get-Content -Raw -Path $Path -Encoding UTF8
    if ([string]::IsNullOrWhiteSpace($rawPlan)) {
        throw "Task plan is empty: $Path"
    }

    # Parse the JSON into a PowerShell object so the runner can access plan.name, plan.steps, etc.
    return $rawPlan | ConvertFrom-Json
}

# Locate a visible application window by process name and optional title text.
# This avoids trusting the process returned by Start-Process, which is flaky
# for modern Notepad because it may reuse or hand off to an existing process.
function Wait-ForAppWindow {
    param(
        [string]$ProcessName,
        [string]$TitleContains = "",
        [int]$TimeoutSeconds = 15
    )

    $seenTitles = @()
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        $windows = Get-Process -Name $ProcessName -ErrorAction SilentlyContinue |
            Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero }

        foreach ($window in $windows) {
            if ($window.MainWindowTitle) {
                $seenTitles += $window.MainWindowTitle
            }

            if (
                [string]::IsNullOrWhiteSpace($TitleContains) -or
                $window.MainWindowTitle -like "*$TitleContains*"
            ) {
                return @{
                    Process = $window
                    WindowHandle = $window.MainWindowHandle
                }
            }
        }

        Start-Sleep -Milliseconds 250
    }

    $titleSummary = ($seenTitles | Select-Object -Unique) -join "; "
    if ([string]::IsNullOrWhiteSpace($titleSummary)) {
        $titleSummary = "none"
    }

    throw "Timed out waiting for '$ProcessName' window containing '$TitleContains'. Visible titles seen: $titleSummary"
}

# Register the tiny Win32 focus helper once. PowerShell does not expose
# SetForegroundWindow directly, so we add the user32.dll calls through C#.
function Enable-WindowFocusApi {
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

# Bring the target app window to the foreground before sending user-like input.
# TYPE and CLICK steps need a known active window to be predictable.
function Focus-Window {
    param([IntPtr]$WindowHandle)

    Enable-WindowFocusApi
    [DockVision.User32]::ShowWindow($WindowHandle, 9) | Out-Null
    [DockVision.User32]::SetForegroundWindow($WindowHandle) | Out-Null
    Start-Sleep -Milliseconds 300
}

# Convert a relative demo file path from task-plan.json into an absolute path
# beside this runner. Absolute paths are preserved as-is.
function Resolve-DockVisionDemoPath {
    param([string]$PathValue)

    if ([string]::IsNullOrWhiteSpace($PathValue)) {
        return $null
    }

    if ([System.IO.Path]::IsPathRooted($PathValue)) {
        return $PathValue
    }

    return Join-Path $PSScriptRoot $PathValue
}

# Execute an OPEN_APP step. For the Notepad demo, this opens a known text file
# instead of relying on a blank Notepad window that may restore an old tab.
function Invoke-DockVisionOpenApp {
    param([object]$Step)

    $executable = [string]$Step.executable
    if ([string]::IsNullOrWhiteSpace($executable)) {
        throw "OPEN_APP step '$($Step.id)' requires executable."
    }

    # For Notepad demos, open a known text file instead of launching a blank
    # Notepad window. Windows 11 Notepad can restore previous tabs, which made
    # it look like the runner.ps1 file was being opened by the batch launcher.
    $targetFile = Resolve-DockVisionDemoPath -PathValue ([string]$Step.fileName)
    if ($targetFile) {
        if ($Step.resetFile) {
            "" | Set-Content -Path $targetFile -Encoding UTF8
        }
        elseif (-not (Test-Path -LiteralPath $targetFile)) {
            New-Item -ItemType File -Path $targetFile -Force | Out-Null
        }

        $process = Start-Process -FilePath $executable -ArgumentList "`"$targetFile`"" -PassThru
        $processName = [System.IO.Path]::GetFileNameWithoutExtension($executable)
        $titleContains = [System.IO.Path]::GetFileName($targetFile)
        return Wait-ForAppWindow -ProcessName $processName -TitleContains $titleContains
    }

    $process = Start-Process -FilePath $executable -PassThru
    $processName = [System.IO.Path]::GetFileNameWithoutExtension($executable)
    return Wait-ForAppWindow -ProcessName $processName
}

# Translate raw text characters into SendKeys-safe tokens. Some characters have
# special meaning to SendKeys, so they need escaping before we send them.
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

# Execute a TYPE step by sending each character to the currently focused window.
# The JSON step owns the text value; this function owns how typing is performed.
function Invoke-DockVisionType {
    param(
        [object]$Step,
        [int]$DelayMs = 25
    )

    $text = [string]$Step.text
    if ([string]::IsNullOrEmpty($text)) {
        throw "TYPE step '$($Step.id)' requires text."
    }

    Add-Type -AssemblyName System.Windows.Forms

    foreach ($character in $text.ToCharArray()) {
        $keys = ConvertTo-SendKeysLiteral -Character ([string]$character)
        if ($null -ne $keys) {
            [System.Windows.Forms.SendKeys]::SendWait($keys)
        }

        if ($DelayMs -gt 0) {
            Start-Sleep -Milliseconds $DelayMs
        }
    }
}

# Load the plan and initialize runner state. The active window handle is set by
# OPEN_APP and reused by later steps such as TYPE.
$plan = Read-DockVisionPlan -Path $ConfigPath
$activeProcess = $null
$activeWindowHandle = [IntPtr]::Zero

Write-Output "DockVision runner started: $($plan.name)"

# Main interpreter loop. This is the contract pattern Task-i-fy and uploaded
# task plans will use: ordered JSON steps become concrete runner actions.
foreach ($step in $plan.steps) {
    Write-Output "Running $($step.id): $($step.action)"

    # Dispatch each step by action name. CLICK, WAIT, SCREENSHOT, and ASSERT can
    # be added here later without changing the JSON plan structure.
    switch ($step.action) {
        "OPEN_APP" {
            $openedApp = Invoke-DockVisionOpenApp -Step $step
            $activeProcess = $openedApp.Process
            $activeWindowHandle = $openedApp.WindowHandle
            Focus-Window -WindowHandle $activeWindowHandle
        }

        "TYPE" {
            if ($activeWindowHandle -eq [IntPtr]::Zero) {
                throw "TYPE step '$($step.id)' requires an active window. Add OPEN_APP first."
            }

            Focus-Window -WindowHandle $activeWindowHandle
            Invoke-DockVisionType -Step $step
        }

        default {
            throw "Unsupported action '$($step.action)' in step '$($step.id)'."
        }
    }

    # Optional delay between steps so UI state has a moment to settle.
    Start-Sleep -Milliseconds ([int]$plan.settings.stepDelayMs)
}

# A successful exit code tells the future agent that the runner completed.
Write-Output "DockVision runner completed."
exit 0
