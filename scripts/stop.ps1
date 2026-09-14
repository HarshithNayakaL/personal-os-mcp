$ErrorActionPreference = 'Stop'
$env:PSModulePath = [IO.Path]::Combine($env:SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'Modules')
Set-Location (Split-Path $PSScriptRoot -Parent)
if (Test-Path '.local/pids.json') {
  $saved = Get-Content '.local/pids.json' -Raw | ConvertFrom-Json
  foreach ($servicePid in @($saved.core, $saved.agent)) {
    $p = Get-CimInstance Win32_Process -Filter "ProcessId=$servicePid"
    if ($p -and $p.Name -eq 'node.exe' -and $p.CommandLine -match 'dist/apps/(mcp-server/src/daemon|windows-agent/src/main)\.js') { Stop-Process -Id $servicePid }
  }
  Remove-Item -LiteralPath '.local/pids.json'
}
