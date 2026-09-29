# Prints what start.ps1 would give the link to Mizan for a data folder, as JSON (no process is started).
# Used by apps\mes-server\test\start-config.test.ts. Exit code 1 (with the message) when the configuration is broken.
param([Parameter(Mandatory = $true)][string]$DataDir)
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\common.ps1"
$cfg = Get-GmesConfig -DataDir $DataDir
$settings = Get-LinkMizanSettings $cfg
if ($null -eq $settings) { Write-Output 'null' } else { $settings | ConvertTo-Json -Compress }
