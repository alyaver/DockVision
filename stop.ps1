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
    else {
        Write-Host "No process found on port $port"
    }
}