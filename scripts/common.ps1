# Shared helpers for the GMES PowerShell scripts (dot-source: . "$PSScriptRoot\common.ps1").
# Plain ASCII and Windows PowerShell 5.1 compatible, so it runs on any Windows machine.

$script:Root = Split-Path -Parent $PSScriptRoot

function Fail([string]$Message) {
  Write-Host ''
  Write-Host "ERROR: $Message" -ForegroundColor Red
  exit 1
}

# Runs a native command and stops the script when it fails (PowerShell does not do that by itself).
function Invoke-Native([string]$What, [string]$File, [string[]]$Arguments) {
  & $File @Arguments
  if ($LASTEXITCODE -ne 0) { Fail "$What failed (exit code $LASTEXITCODE)." }
}

function Assert-Node {
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if (-not $cmd) { Fail 'Node.js 22.13 or newer is required. Install it with:  winget install OpenJS.NodeJS.LTS  and run this file again.' }
  $version = [version]((& node --version).TrimStart('v'))
  if ($version -lt [version]'22.13.0') { Fail "Node.js $version is too old; 22.13 or newer is required." }
  return $cmd.Source
}

# npm ci once, and again only when package-lock.json changes (a stamp inside node_modules remembers it).
function Install-Dependencies([switch]$Force) {
  $stamp = Join-Path $script:Root 'node_modules\.gmes-install'
  $want = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $script:Root 'package-lock.json')).Hash
  $have = ''
  if (Test-Path -LiteralPath $stamp) { $have = (Get-Content -LiteralPath $stamp -Raw).Trim() }
  if ($Force -or $have -ne $want) {
    Write-Host 'Installing dependencies (needs internet, first run only) ...'
    Push-Location -LiteralPath $script:Root
    try { Invoke-Native 'npm ci' 'npm' @('ci', '--no-audit', '--no-fund') } finally { Pop-Location }
    Set-Content -LiteralPath $stamp -Value $want -Encoding Ascii
  }
}

# data\config.json: created on the first run, then owned by the person who runs the plant.
function Get-GmesConfig {
  $dataDir = Join-Path $script:Root 'data'
  New-Item -ItemType Directory -Force -Path $dataDir | Out-Null
  $file = Join-Path $dataDir 'config.json'
  $defaults = [ordered]@{
    companyId          = [guid]::NewGuid().ToString().ToLowerInvariant()
    port               = 4700
    host               = '127.0.0.1'      # 0.0.0.0 lets other computers on the plant network reach it
    node               = 'plant-1'
    timeZone           = 'Africa/Cairo'
    productionDayStart = '07:00'
    itemOwner          = 'gmes'           # gmes: items and warehouses are created here; mizan: they come from accounting
    personOwner        = 'none'           # hr: people come from HR-System; none: no people registry
  }
  if (-not (Test-Path -LiteralPath $file)) {
    ($defaults | ConvertTo-Json) | Set-Content -LiteralPath $file -Encoding Ascii
    Write-Host "First run: created $file (company id $($defaults.companyId))."
  }
  try { $loaded = Get-Content -LiteralPath $file -Raw | ConvertFrom-Json } catch { Fail "$file is not valid JSON: $($_.Exception.Message)" }
  $cfg = [ordered]@{}
  foreach ($k in $defaults.Keys) {
    $prop = $loaded.PSObject.Properties[$k]
    if ($prop) { $cfg[$k] = $prop.Value } else { $cfg[$k] = $defaults[$k] }
  }
  if ($cfg.companyId -notmatch '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') { Fail "companyId in $file must be a lower-case UUID." }
  $port = 0   # JSON numbers arrive as Int32, Int64 or Double depending on the PowerShell version
  if (-not [int]::TryParse([string]$cfg.port, [ref]$port) -or $port -lt 1 -or $port -gt 65535) { Fail "port in $file must be a whole number from 1 to 65535." }
  $cfg.port = $port
  if ($cfg.itemOwner -notin @('gmes', 'mizan')) { Fail "itemOwner in $file must be 'gmes' or 'mizan'." }
  if ($cfg.personOwner -notin @('hr', 'none')) { Fail "personOwner in $file must be 'hr' or 'none'." }
  $cfg['dataDir'] = $dataDir
  return $cfg
}

# The server reads its settings from GMES_* environment variables.
function Set-GmesEnvironment($Cfg) {
  $env:GMES_DATA_DIR = $Cfg.dataDir
  $env:GMES_PORT = [string]$Cfg.port
  $env:GMES_HOST = $Cfg.host
  $env:GMES_COMPANY_ID = $Cfg.companyId
  $env:GMES_NODE = $Cfg.node
  $env:GMES_TZ = $Cfg.timeZone
  $env:GMES_DAY_START = $Cfg.productionDayStart
  $env:GMES_OWNER = $Cfg.itemOwner
  $env:GMES_PERSON_OWNER = $Cfg.personOwner
}

function Test-GmesRunning([int]$Port) {
  try {
    $r = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/health" -TimeoutSec 2
    return ($r.ok -eq $true -and $r.name -eq 'gmes')
  } catch { return $false }
}

function Test-PortOpen([int]$Port) {
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $async = $client.BeginConnect('127.0.0.1', $Port, $null, $null)
    return ($async.AsyncWaitHandle.WaitOne(500) -and $client.Connected)
  } catch { return $false } finally { $client.Close() }
}
