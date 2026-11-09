# DockVision Windows guest Python runtime setup.
#
# Purpose:
# - Uploaded Python runners execute inside the Windows guest, not on the host.
# - This script makes that guest runtime repeatable by finding or installing
#   Python, then installing the pywinauto dependency used by our UIA runner.
# - install-agent.bat calls this before starting DockVisionAgent.ps1 so the
#   agent can run uploaded .py files without a manual Python setup step.

param(
    [string]$SharedRoot = "",
    [string]$PythonVersion = "3.11.9"
)

$ErrorActionPreference = "Stop"

function Get-UtcTimestamp {
    return [DateTime]::UtcNow.ToString("o")
}

function Resolve-DockVisionSharedRoot {
    param([string]$RequestedSharedRoot)

    $candidates = @(
        $RequestedSharedRoot,
        "\\host.lan\Data",
        "C:\Users\Docker\Desktop\Shared",
        "C:\OEM"
    )

    foreach ($candidate in $candidates) {
        if ([string]::IsNullOrWhiteSpace($candidate)) {
            continue
        }

        $normalizedCandidate = ([string]$candidate).Trim().Trim([char]'"')
        if ([string]::IsNullOrWhiteSpace($normalizedCandidate)) {
            continue
        }

        try {
            if (Test-Path -LiteralPath $normalizedCandidate) {
                return (Resolve-Path -LiteralPath $normalizedCandidate).Path
            }
        }
        catch {
            # Badly quoted shell arguments can leave illegal characters in the
            # path. Ignore that candidate and continue through known locations.
        }
    }

    return $PSScriptRoot
}

function Write-SetupLog {
    param(
        [string]$Message,
        [string]$Level = "INFO"
    )

    $timestamp = Get-UtcTimestamp
    $line = "[$timestamp] [$Level] $Message"
    Write-Host $line
    Add-Content -Encoding UTF8 -Path $script:InstallLogPath -Value $line
}

function Test-IsAdministrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Resolve-PythonFromCommand {
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

function Resolve-PythonFromPath {
    param([string]$Path)

    if ([string]::IsNullOrWhiteSpace($Path) -or -not (Test-Path -LiteralPath $Path)) {
        return $null
    }

    return Resolve-PythonFromCommand -Command $Path
}

function Find-UsablePython {
    foreach ($candidate in @(
        @{ Command = "python.exe"; Arguments = @() },
        @{ Command = "python"; Arguments = @() },
        @{ Command = "py.exe"; Arguments = @("-3") },
        @{ Command = "py"; Arguments = @("-3") }
    )) {
        $pythonPath = Resolve-PythonFromCommand -Command $candidate.Command -Arguments $candidate.Arguments
        if ($pythonPath) {
            return $pythonPath
        }
    }

    $searchRoots = @(
        "C:\DockVision\Python*",
        "$env:ProgramFiles\Python*",
        "$env:LocalAppData\Programs\Python\Python*",
        "C:\Python*"
    )

    foreach ($root in $searchRoots) {
        $directories = Get-ChildItem -Path $root -Directory -ErrorAction SilentlyContinue |
            Sort-Object -Property FullName -Descending

        foreach ($directory in $directories) {
            $pythonPath = Resolve-PythonFromPath -Path (Join-Path $directory.FullName "python.exe")
            if ($pythonPath) {
                return $pythonPath
            }
        }
    }

    return $null
}

function Add-KnownPythonPathsToCurrentProcess {
    $pathParts = New-Object System.Collections.Generic.List[string]

    foreach ($candidate in @(
        "C:\DockVision\Python311",
        "C:\DockVision\Python311\Scripts",
        "$env:ProgramFiles\Python311",
        "$env:ProgramFiles\Python311\Scripts",
        "$env:LocalAppData\Programs\Python\Python311",
        "$env:LocalAppData\Programs\Python\Python311\Scripts",
        "C:\Python311",
        "C:\Python311\Scripts"
    )) {
        if (-not [string]::IsNullOrWhiteSpace($candidate) -and (Test-Path -LiteralPath $candidate)) {
            $pathParts.Add($candidate)
        }
    }

    foreach ($part in ($env:Path -split ";")) {
        if (-not [string]::IsNullOrWhiteSpace($part)) {
            $pathParts.Add($part)
        }
    }

    $env:Path = ($pathParts | Select-Object -Unique) -join ";"
}

function Install-DockVisionPython {
    param([string]$Version)

    $downloadRoot = Join-Path $env:TEMP "dockvision-python-runtime"
    New-Item -ItemType Directory -Force -Path $downloadRoot | Out-Null

    $zipName = "python-$Version-nuget.zip"
    $zipPath = Join-Path $downloadRoot $zipName
    $zipUrl = "https://www.nuget.org/api/v2/package/python/$Version"
    $extractRoot = Join-Path $downloadRoot "python-$Version-nuget"
    $targetDirectory = "C:\DockVision\Python311"

    Write-SetupLog "Downloading NuGet Python $Version from $zipUrl"
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -Uri $zipUrl -OutFile $zipPath -UseBasicParsing

    if (Test-Path -LiteralPath $extractRoot) {
        Remove-Item -LiteralPath $extractRoot -Recurse -Force
    }

    if (Test-Path -LiteralPath $targetDirectory) {
        Write-SetupLog "Removing existing DockVision Python runtime at $targetDirectory"
        Remove-Item -LiteralPath $targetDirectory -Recurse -Force
    }

    Write-SetupLog "Expanding NuGet Python $Version package."
    New-Item -ItemType Directory -Force -Path $extractRoot | Out-Null
    Expand-Archive -LiteralPath $zipPath -DestinationPath $extractRoot -Force

    $toolsDirectory = Join-Path $extractRoot "tools"
    if (-not (Test-Path -LiteralPath (Join-Path $toolsDirectory "python.exe"))) {
        throw "NuGet Python package did not contain tools\python.exe."
    }

    Write-SetupLog "Installing NuGet Python $Version to $targetDirectory"
    New-Item -ItemType Directory -Force -Path $targetDirectory | Out-Null
    Copy-Item -Path (Join-Path $toolsDirectory "*") -Destination $targetDirectory -Recurse -Force

    $pythonPath = Join-Path $targetDirectory "python.exe"
    if (-not (Test-Path -LiteralPath $pythonPath)) {
        throw "NuGet Python install did not create python.exe at $pythonPath"
    }

    Add-KnownPythonPathsToCurrentProcess
}

function Invoke-Python {
    param(
        [string]$PythonPath,
        [string[]]$Arguments
    )

    $output = @()
    $exitCode = 1
    $previousErrorActionPreference = $ErrorActionPreference

    try {
        $ErrorActionPreference = "Continue"
        $output = & $PythonPath @Arguments 2>&1
        $exitCode = $LASTEXITCODE
    }
    catch {
        $output = @($_.Exception.Message)
    }
    finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }

    return @{
        ExitCode = $exitCode
        Output = ($output | ForEach-Object { $_.ToString() } | Out-String).Trim()
    }
}

function Ensure-PythonPackage {
    param(
        [string]$PythonPath,
        [string]$PackageName
    )

    $showResult = Invoke-Python -PythonPath $PythonPath -Arguments @("-m", "pip", "show", $PackageName)
    if ($showResult.ExitCode -eq 0) {
        Write-SetupLog "Python package '$PackageName' is already installed."
        return
    }

    Write-SetupLog "Installing Python package '$PackageName'."
    $installResult = Invoke-Python -PythonPath $PythonPath -Arguments @(
        "-m",
        "pip",
        "install",
        "--disable-pip-version-check",
        $PackageName
    )

    if ($installResult.ExitCode -ne 0) {
        throw "Failed to install Python package '$PackageName': $($installResult.Output)"
    }
}

function Ensure-Pip {
    param([string]$PythonPath)

    $pipResult = Invoke-Python -PythonPath $PythonPath -Arguments @("-m", "pip", "--version")
    if ($pipResult.ExitCode -eq 0) {
        return
    }

    Write-SetupLog "pip was not available; running ensurepip."
    $ensureResult = Invoke-Python -PythonPath $PythonPath -Arguments @("-m", "ensurepip", "--upgrade")
    if ($ensureResult.ExitCode -ne 0) {
        throw "Failed to enable pip: $($ensureResult.Output)"
    }
}

function Add-PythonRuntimePathsToCurrentProcess {
    param([string]$PythonPath)

    $pythonRoot = Split-Path -Parent $PythonPath
    $candidates = New-Object System.Collections.Generic.List[string]
    $candidates.Add($pythonRoot)
    $candidates.Add((Join-Path $pythonRoot "Scripts"))

    $sitePackagesResult = Invoke-Python -PythonPath $PythonPath -Arguments @(
        "-c",
        "import site; print(site.getsitepackages()[0])"
    )

    if ($sitePackagesResult.ExitCode -eq 0 -and -not [string]::IsNullOrWhiteSpace($sitePackagesResult.Output)) {
        $sitePackages = ($sitePackagesResult.Output -split "`r?`n" | Select-Object -First 1).Trim()
        $candidates.Add($sitePackages)
        $candidates.Add((Join-Path $sitePackages "pywin32_system32"))
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

function Ensure-VisualCppRuntime {
    $requiredDlls = @(
        (Join-Path $env:WINDIR "System32\vcruntime140.dll"),
        (Join-Path $env:WINDIR "System32\mfc140u.dll")
    )

    $missingDlls = @($requiredDlls | Where-Object { -not (Test-Path -LiteralPath $_) })
    if ($missingDlls.Count -eq 0) {
        Write-SetupLog "Visual C++ runtime DLLs needed by pywin32 are present."
        return
    }

    $downloadRoot = Join-Path $env:TEMP "dockvision-python-runtime"
    New-Item -ItemType Directory -Force -Path $downloadRoot | Out-Null

    $installerPath = Join-Path $downloadRoot "vc_redist.x64.exe"
    $installerUrl = "https://aka.ms/vs/17/release/vc_redist.x64.exe"

    Write-SetupLog "Installing Visual C++ runtime for pywin32 from $installerUrl"
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -Uri $installerUrl -OutFile $installerPath -UseBasicParsing

    $process = Start-Process `
        -FilePath $installerPath `
        -ArgumentList @("/install", "/quiet", "/norestart") `
        -Wait `
        -PassThru

    if ($process.ExitCode -ne 0 -and $process.ExitCode -ne 3010 -and $process.ExitCode -ne 1638) {
        throw "Visual C++ runtime installer exited with code $($process.ExitCode)."
    }
}

function Repair-PyWin32Package {
    param([string]$PythonPath)

    Ensure-PythonPackage -PythonPath $PythonPath -PackageName "pywin32"
    Ensure-VisualCppRuntime
    Add-PythonRuntimePathsToCurrentProcess -PythonPath $PythonPath

    $pythonRoot = Split-Path -Parent $PythonPath
    $postInstallPath = Join-Path $pythonRoot "Scripts\pywin32_postinstall.py"
    if (Test-Path -LiteralPath $postInstallPath) {
        Write-SetupLog "Running pywin32 post-install repair."
        $postInstallResult = Invoke-Python -PythonPath $PythonPath -Arguments @($postInstallPath, "-install")
        if ($postInstallResult.ExitCode -ne 0) {
            Write-SetupLog "pywin32 post-install reported a warning: $($postInstallResult.Output)" "WARN"
        }
    }
    else {
        Write-SetupLog "pywin32 post-install script was not found at $postInstallPath" "WARN"
    }
}

function Assert-PythonAutomationRuntime {
    param([string]$PythonPath)

    Add-PythonRuntimePathsToCurrentProcess -PythonPath $PythonPath

    $verifyResult = Invoke-Python -PythonPath $PythonPath -Arguments @(
        "-c",
        "import win32ui, win32gui, pythoncom, pywinauto; print('automation-runtime-ok')"
    )

    if ($verifyResult.ExitCode -ne 0) {
        throw "Python automation runtime import verification failed: $($verifyResult.Output)"
    }

    Write-SetupLog "Verified pywinauto and pywin32 imports."
}

function Ensure-AutomationPackages {
    param([string]$PythonPath)

    Ensure-Pip -PythonPath $PythonPath
    Repair-PyWin32Package -PythonPath $PythonPath
    Ensure-PythonPackage -PythonPath $PythonPath -PackageName "pywinauto"
    Assert-PythonAutomationRuntime -PythonPath $PythonPath
}

function Write-RuntimeManifest {
    param(
        [string]$PythonPath,
        [string]$SharedRoot
    )

    $pythonVersion = (& $PythonPath --version 2>&1 | Out-String).Trim()
    $pywinautoVersionResult = Invoke-Python -PythonPath $PythonPath -Arguments @(
        "-c",
        "import pywinauto; print(pywinauto.__version__)"
    )

    if ($pywinautoVersionResult.ExitCode -ne 0) {
        throw "Could not read pywinauto version: $($pywinautoVersionResult.Output)"
    }

    $manifest = [ordered]@{
        updatedUtc = Get-UtcTimestamp
        pythonExecutable = $PythonPath
        pythonVersion = $pythonVersion
        pywinautoVersion = $pywinautoVersionResult.Output
        pywin32Verified = $true
    }

    $manifestPath = Join-Path $SharedRoot "python-runtime.json"
    $manifest | ConvertTo-Json -Depth 5 | Set-Content -Encoding UTF8 -Path $manifestPath
    Write-SetupLog "Wrote Python runtime manifest to $manifestPath"
}

$script:SharedRootPath = Resolve-DockVisionSharedRoot -RequestedSharedRoot $SharedRoot
$script:InstallLogPath = Join-Path $script:SharedRootPath "agent-install-log.txt"

try {
    Write-SetupLog "Preparing DockVision Python runtime."

    $pythonPath = Find-UsablePython
    if (-not $pythonPath) {
        Write-SetupLog "No usable Python runtime was found inside the Windows guest."
        Install-DockVisionPython -Version $PythonVersion
        $pythonPath = Find-UsablePython
    }

    if (-not $pythonPath) {
        throw "Python installation completed, but no usable python.exe could be resolved."
    }

    Write-SetupLog "Using Python runtime: $pythonPath"
    try {
        Ensure-AutomationPackages -PythonPath $pythonPath
    }
    catch {
        Write-SetupLog "Python package setup failed for ${pythonPath}: $($_.Exception.Message). Rebuilding DockVision Python runtime." "WARN"
        Install-DockVisionPython -Version $PythonVersion
        $pythonPath = Find-UsablePython
        if (-not $pythonPath) {
            throw "DockVision Python runtime was rebuilt, but no usable python.exe could be resolved."
        }

        Write-SetupLog "Using Python runtime after rebuild: $pythonPath"
        Ensure-AutomationPackages -PythonPath $pythonPath
    }

    Write-RuntimeManifest -PythonPath $pythonPath -SharedRoot $script:SharedRootPath
    Write-SetupLog "DockVision Python runtime is ready."
    exit 0
}
catch {
    Write-SetupLog "DockVision Python runtime setup failed: $($_.Exception.Message)" "ERROR"
    exit 1
}
