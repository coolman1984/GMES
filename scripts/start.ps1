<#
.SYNOPSIS
  One-click start for GMES: checks Node.js, installs dependencies when needed, creates the local
  configuration on the first run, starts the server and opens the screens in the browser.
  Close the window (or press Ctrl+C) to stop the server.
.PARAMETER NoBrowser
  Do not open the browser.
.PARAMETER Reinstall
  Reinstall the dependencies (npm ci) even if nothing changed.
#>
[CmdletBinding()]
param(
  [switch]$NoBrowser,
  [switch]$Reinstall
)
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\common.ps1"
Set-Location -LiteralPath $script:Root

$nodeExe = Assert-Node
Install-Dependencies -Force:$Reinstall
$cfg = Get-GmesConfig
Set-GmesEnvironment $cfg

$browseHost = 'localhost'
$url = "http://${browseHost}:$($cfg.port)/"

if (Test-GmesRunning $cfg.port) {
  Write-Host "GMES is already running: $url"
  if (-not $NoBrowser) { Start-Process $url }
  exit 0
}
if (Test-PortOpen $cfg.port) { Fail "Port $($cfg.port) is used by another program. Change 'port' in $($cfg.dataDir)\config.json." }

Write-Host "Starting GMES (company $($cfg.companyId), data in $($cfg.dataDir)) ..."
$server = Start-Process -FilePath $nodeExe -WorkingDirectory (Join-Path $script:Root 'apps\mes-server') -NoNewWindow -PassThru `
  -ArgumentList @('--disable-warning=ExperimentalWarning', '--import', 'tsx', 'src/main.ts')
$null = $server.Handle   # keeps the exit code readable after the process ends
try {
  $deadline = (Get-Date).AddSeconds(90)
  $up = $false
  while ((Get-Date) -lt $deadline) {
    if ($server.HasExited) { Fail "The server stopped during start-up (exit code $($server.ExitCode)). The reason is printed above." }
    if (Test-GmesRunning $cfg.port) { $up = $true; break }
    Start-Sleep -Milliseconds 300
  }
  if (-not $up) { Fail 'The server did not answer within 90 seconds.' }
  Write-Host ''
  Write-Host "GMES is running: $url" -ForegroundColor Green
  Write-Host 'Close this window or press Ctrl+C to stop it.'
  if (-not $NoBrowser) { Start-Process $url }
  $server.WaitForExit()
  if ($server.ExitCode -ne 0) { Fail "The server stopped (exit code $($server.ExitCode))." }
} finally {
  if (-not $server.HasExited) { Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue }
}
