$ErrorActionPreference = 'Stop'
$env:PSModulePath = [IO.Path]::Combine($env:SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'Modules')
Set-Location (Split-Path $PSScriptRoot -Parent)
$runtimeVersion = [version]((& node --version).TrimStart('v'))
if ($runtimeVersion -lt [version]'22.13.0') { throw 'Node.js 22.13 or later is required.' }
if (!(Test-Path 'node_modules/@modelcontextprotocol/sdk')) { & npm install; if ($LASTEXITCODE) { throw 'Dependency installation failed.' } }
& npm run build
if ($LASTEXITCODE) { throw 'TypeScript build failed.' }
& node scripts/setup.mjs
if ($LASTEXITCODE) { throw 'Setup failed.' }
try {
  $existingHealth = & node scripts/admin.mjs health 2>$null
  if ($LASTEXITCODE -eq 0) {
    $existingState = ($existingHealth -join "`n") | ConvertFrom-Json
    if ($existingState.ok -and ($existingState.devices | Where-Object online)) {
      $existingHealth
      Write-Host 'Services are already healthy. MCP client configuration: .local/mcp-client.json'
      exit 0
    }
  }
} catch { }
$coreProcess = Start-Process node -ArgumentList 'dist/apps/mcp-server/src/daemon.js' -WorkingDirectory (Get-Location).Path -WindowStyle Hidden -RedirectStandardError '.local/core.log' -RedirectStandardOutput '.local/core.stdout.log' -PassThru
$agentProcess = Start-Process node -ArgumentList 'dist/apps/windows-agent/src/main.js' -WorkingDirectory (Get-Location).Path -WindowStyle Hidden -RedirectStandardError '.local/agent.log' -RedirectStandardOutput '.local/agent.stdout.log' -PassThru
@{ core = $coreProcess.Id; agent = $agentProcess.Id } | ConvertTo-Json | Set-Content '.local/pids.json'
$ready = $false
for ($attempt = 0; $attempt -lt 20; $attempt++) {
  Start-Sleep -Seconds 1
  if ($coreProcess.HasExited -or $agentProcess.HasExited) { throw 'Service exited. Inspect .local/core.log and .local/agent.log.' }
  $health = & node scripts/admin.mjs health 2>$null
  if ($LASTEXITCODE -eq 0) {
    $state = ($health -join "`n") | ConvertFrom-Json
    if ($state.ok -and ($state.devices | Where-Object online)) { $ready = $true; $health; break }
  }
}
if (!$ready) { throw 'No registered device passed health verification.' }
Write-Host 'MCP transport: stdio. Copy the generated settings from .local/mcp-client.json into your MCP client configuration.'
Write-Host 'Inspect approvals: node scripts/admin.mjs pending'
Write-Host 'Stop services: powershell -File scripts/stop.ps1'
