$root = Split-Path -Parent $MyInvocation.MyCommand.Path

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