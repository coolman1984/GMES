<#
.SYNOPSIS
  Fetches the pinned HR-System version the HR <-> manufacturing end-to-end test runs against
  (black box: the real Python application and its publisher, over HTTP).
  Environment: HR_REPO, HR_PIN, HR_DIR (default .cache\hr-system).
#>
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\common.ps1"

$repo = if ($env:HR_REPO) { $env:HR_REPO } else { 'https://github.com/coolman1984/HR-System.git' }
$pin = if ($env:HR_PIN) { $env:HR_PIN } else { '83cee2de68e185630e968d1dec9d56c329677410' }
$dest = if ($env:HR_DIR) { $env:HR_DIR } else { Join-Path (Join-Path $script:Root '.cache') 'hr-system' }

if (-not (Test-Path -LiteralPath (Join-Path $dest '.git'))) { Invoke-Native 'git clone' 'git' @('clone', '--quiet', $repo, $dest) }
Invoke-Native 'git fetch' 'git' @('-C', $dest, 'fetch', '--quiet', 'origin', '+refs/heads/*:refs/remotes/origin/*')
Invoke-Native 'git checkout' 'git' @('-C', $dest, 'checkout', '--quiet', $pin)
Write-Host "HR-System $(git -C $dest rev-parse --short HEAD) ready in $dest"
