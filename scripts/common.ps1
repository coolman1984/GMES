# Shared helpers for the Itqan PowerShell scripts (dot-source: . "$PSScriptRoot\common.ps1").
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
# -DataDir / -Defaults: the demonstration plant keeps its own folder, port and company id (scripts\start.ps1 -Demo).
function Get-GmesConfig([string]$DataDir = (Join-Path $script:Root 'data'), [hashtable]$Defaults = @{}) {
  $dataDir = $DataDir
  New-Item -ItemType Directory -Force -Path $dataDir | Out-Null
  $file = Join-Path $dataDir 'config.json'
  $overrides = $Defaults
  $defaults = [ordered]@{
    companyId          = [guid]::NewGuid().ToString().ToLowerInvariant()
    port               = 4700
    host               = '127.0.0.1'      # 0.0.0.0 lets other computers on the plant network reach it
    node               = 'plant-1'
    timeZone           = 'Africa/Cairo'
    productionDayStart = '07:00'
    itemOwner          = 'gmes'           # gmes: items and warehouses are created here; mizan: they come from accounting
    personOwner        = 'none'           # hr: people come from HR-System; none: no people registry
    mizan              = $null            # set to run the link to Mizan: { url, user, passwordFile, mesKeyFile, wipAccount, varianceAccount }
  }
  foreach ($k in $overrides.Keys) { $defaults[$k] = $overrides[$k] }
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
  # a plant that runs the link to Mizan has its pulse judged on the health page (missing or stale = not healthy)
  if ($Cfg.mizan) { $env:GMES_LINK_MIZAN_HEARTBEAT = (Join-Path $Cfg.dataDir 'link-mizan.heartbeat.json') } else { Remove-Item Env:\GMES_LINK_MIZAN_HEARTBEAT -ErrorAction SilentlyContinue }
}

# The environment of the link to Mizan (apps\link-mizan), or $null when this plant does not run it.
# Secrets are read from files named in the configuration (relative paths start in the data folder), never from config.json.
function Get-LinkMizanSettings($Cfg) {
  $m = $Cfg.mizan
  if (-not $m) { return $null }
  function Read-Secret([string]$Name, $Path) {
    if (-not $Path) { Fail "mizan.$Name is missing in $($Cfg.dataDir)\config.json (the link to Mizan needs a file holding it)." }
    $full = $(if ([System.IO.Path]::IsPathRooted([string]$Path)) { [string]$Path } else { Join-Path $Cfg.dataDir ([string]$Path) })
    if (-not (Test-Path -LiteralPath $full)) { Fail "The file for mizan.$Name does not exist: $full" }
    $text = (Get-Content -LiteralPath $full -Raw).Trim()
    if (-not $text) { Fail "The file for mizan.$Name is empty: $full" }
    return $text
  }
  if (-not $m.url) { Fail "mizan.url is missing in $($Cfg.dataDir)\config.json." }
  if (-not $m.user) { Fail "mizan.user is missing in $($Cfg.dataDir)\config.json (the Mizan user made for the link)." }
  return [ordered]@{
    LINK_COMPANY_ID       = [string]$Cfg.companyId
    LINK_MIZAN_URL        = [string]$m.url
    LINK_MIZAN_USER       = [string]$m.user
    LINK_MIZAN_PASSWORD   = (Read-Secret 'passwordFile' $m.passwordFile)
    LINK_MES_URL          = "http://127.0.0.1:$($Cfg.port)"
    LINK_MES_KEY          = (Read-Secret 'mesKeyFile' $m.mesKeyFile)
    LINK_WIP_ACCOUNT      = $(if ($m.wipAccount) { [string]$m.wipAccount } else { '1145' })
    LINK_VARIANCE_ACCOUNT = $(if ($m.varianceAccount) { [string]$m.varianceAccount } else { '5170' })
    LINK_STATE            = (Join-Path $Cfg.dataDir 'link-mizan.db')
    LINK_HEARTBEAT        = (Join-Path $Cfg.dataDir 'link-mizan.heartbeat.json')
  }
}

# Starts the link in its own (minimised) window. The secrets are put in the environment only for this one start
# and removed again at once, so the server (started earlier) and the shell never carry them.
function Start-LinkMizan($Settings, [string]$NodeExe) {
  foreach ($k in $Settings.Keys) { Set-Item -Path "Env:\$k" -Value $Settings[$k] }
  try {
    return Start-Process -FilePath $NodeExe -WorkingDirectory (Join-Path $script:Root 'apps\link-mizan') -WindowStyle Minimized -PassThru `
      -ArgumentList '--disable-warning=ExperimentalWarning --import tsx src/main.ts'
  } finally {
    foreach ($k in $Settings.Keys) { Remove-Item -Path "Env:\$k" -ErrorAction SilentlyContinue }
  }
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
