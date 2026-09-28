<#
.SYNOPSIS
  Creates an API key for a link, a station device or an administrator. The key is printed ONCE;
  only its hash is stored.
.EXAMPLE
  .\scripts\new-key.ps1 -Name admin -Scopes '*'
  .\scripts\new-key.ps1 -Name station-3 -Scopes 'exe.orders.write,exe.orders.read,mdm.items.read'
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$Name,
  [Parameter(Mandatory)][string]$Scopes
)
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\common.ps1"
Set-Location -LiteralPath $script:Root

$nodeExe = Assert-Node
Install-Dependencies
Set-GmesEnvironment (Get-GmesConfig)
Push-Location -LiteralPath (Join-Path $script:Root 'apps\mes-server')
try {
  Invoke-Native 'Creating the key' $nodeExe @('--disable-warning=ExperimentalWarning', '--import', 'tsx', 'src/main.ts', 'key', 'add', $Name, $Scopes)
} finally { Pop-Location }
