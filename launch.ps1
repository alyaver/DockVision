$root = Split-Path -Parent $MyInvocation.MyCommand.Path

$ports = @(5000, 5173)

foreach ($port in $ports) {
    $connections = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue
    if ($connections) {
        $pids = $connections | Select-Object -ExpandProperty OwningProcess -Unique
        foreach ($pid in $pids) {
            Write-Host "Stopping PID $pid on port $port"
            Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
        }
    }
}

Start-Process wt.exe -ArgumentList @(
    'new-tab',
    '--title', 'Client',
    'cmd.exe',
    '/k',
    "cd /d `"$root`" && npm.cmd run client"
)

Start-Process wt.exe -ArgumentList @(
    'new-tab',
    '--title', 'Server',
    'cmd.exe',
    '/k',
    "cd /d `"$root`" && npm.cmd run server"
)