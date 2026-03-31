$ports = @(5000, 5173)

foreach ($port in $ports) {
    $lines = netstat -ano | Select-String ":$port"
    foreach ($line in $lines) {
        $parts = ($line.ToString() -split '\s+') | Where-Object { $_ -ne '' }
        $pid = $parts[-1]

        if ($pid -match '^\d+$') {
            Write-Host "Killing PID $pid on port $port"
            taskkill /PID $pid /F | Out-Null
        }
    }
}