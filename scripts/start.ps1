<#
.SYNOPSIS
  One-click start for Itqan: checks Node.js, installs dependencies when needed, creates the local
  configuration on the first run, starts the server and opens the screens in the browser.
  Close the window (or press Ctrl+C) to stop the server.
.PARAMETER NoBrowser
  Do not open the browser.
.PARAMETER Reinstall
  Reinstall the dependencies (npm ci) even if nothing changed.
.PARAMETER Demo
  Run the DEMONSTRATION plant instead: its own folder (data-demo), port 4701 and company id; built on the first run
  (14 invented production days of a TV plant). The real plant's data folder is never touched.
.PARAMETER Reseed
  With -Demo: throw the demonstration database away and build a fresh one (its days end at this minute).
#>
[CmdletBinding()]
param(
  [switch]$NoBrowser,
  [switch]$Reinstall,
  [switch]$Demo,
  [switch]$Reseed
)
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\common.ps1"
Set-Location -LiteralPath $script:Root

$nodeExe = Assert-Node
Install-Dependencies -Force:$Reinstall
if ($Demo) {
  $demoDir = Join-Path $script:Root 'data-demo'
  $cfg = Get-GmesConfig -DataDir $demoDir -Defaults @{ companyId = '0192f7c4-0000-7000-8000-00000000d3e0'; port = 4701; node = 'eg-tv-demo'; itemOwner = 'gmes'; personOwner = 'none' }
  $db = Join-Path $demoDir 'gmes.db'
  if ($Reseed -and (Test-Path -LiteralPath $db)) {
    if (Test-GmesRunning $cfg.port) { Fail "Close the running demo (port $($cfg.port)) before -Reseed." }
    foreach ($f in @('gmes.db', 'gmes.db-wal', 'gmes.db-shm', 'DEMO-LOGINS.txt')) { $p = Join-Path $demoDir $f; if (Test-Path -LiteralPath $p) { Remove-Item -LiteralPath $p -Force } }
  }
  if (-not (Test-Path -LiteralPath $db)) {
    Write-Host 'Building the demonstration plant (about 20 seconds) ...'
    Push-Location -LiteralPath (Join-Path $script:Root 'apps\mes-server')
    try { Invoke-Native 'Building the demo' $nodeExe @('--disable-warning=ExperimentalWarning', '--import', 'tsx', 'scripts/seed-demo.ts', $demoDir) } finally { Pop-Location }
  }
  Write-Host ''
  Write-Host "Demo logins: $(Join-Path $demoDir 'DEMO-LOGINS.txt')" -ForegroundColor Cyan
} else {
  $cfg = Get-GmesConfig
}
Set-GmesEnvironment $cfg

$browseHost = 'localhost'
$url = "http://${browseHost}:$($cfg.port)/"

if (Test-GmesRunning $cfg.port) {
  Write-Host "Itqan is already running: $url"
  if (-not $NoBrowser) { Start-Process $url }
  exit 0
}
if (Test-PortOpen $cfg.port) { Fail "Port $($cfg.port) is used by another program. Change 'port' in $($cfg.dataDir)\config.json." }

$linkSettings = Get-LinkMizanSettings $cfg   # stops with a clear message when the link is configured but its secret files are missing
Write-Host "Starting Itqan (company $($cfg.companyId), data in $($cfg.dataDir)) ..."
$link = $null
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
  Write-Host "Itqan is running: $url" -ForegroundColor Green
  if ($linkSettings) {
    $link = Start-LinkMizan $linkSettings $nodeExe
    Write-Host "The link to Mizan ($($cfg.mizan.url)) is running in its own window; the health page shows its pulse." -ForegroundColor Green
  }
  Write-Host 'Close this window or press Ctrl+C to stop it.'
  if (-not $NoBrowser) { Start-Process $url }
  $server.WaitForExit()
  if ($server.ExitCode -ne 0) { Fail "The server stopped (exit code $($server.ExitCode))." }
} finally {
  if ($link -and -not $link.HasExited) { Stop-Process -Id $link.Id -Force -ErrorAction SilentlyContinue }
  if (-not $server.HasExited) { Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue }
}
