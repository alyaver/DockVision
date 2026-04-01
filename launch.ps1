$root = Split-Path -Parent $MyInvocation.MyCommand.Path

$ports = @(5000, 5173)

foreach ($port in $ports) {
    $connections = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue
    if ($connections) {
        $owningProcesses = $connections | Select-Object -ExpandProperty OwningProcess -Unique
        foreach ($processId in $owningProcesses) {
            Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
        }
    }
}

$clientPath = Join-Path $root 'client'
$serverPath = Join-Path $root 'server'

Start-Process wt.exe -ArgumentList @(
    'new-tab',
    '--title', 'ProjectAtlas Client',
    'powershell.exe', '-NoExit', '-Command', "Set-Location '$clientPath'; npm.cmd run dev"
)

Start-Sleep -Milliseconds 500

Start-Process wt.exe -ArgumentList @(
    'new-tab',
    '--title', 'ProjectAtlas Server',
    'powershell.exe', '-NoExit', '-Command', "Set-Location '$serverPath'; npm.cmd run dev"
)