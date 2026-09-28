<#
.SYNOPSIS
  Fetches the pinned Mizan version the end-to-end tests run against (black box, over HTTP).
  The pin is deliberate: a Mizan change that breaks the link must show up as a failing test
  when the pin is moved, not as a surprise at a customer.
  Environment: MIZAN_REPO, MIZAN_PIN, MIZAN_DIR (default .cache\mizan).
#>
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\common.ps1"

$repo = if ($env:MIZAN_REPO) { $env:MIZAN_REPO } else { 'https://github.com/coolman1984/Accounting-sys.git' }
$pin = if ($env:MIZAN_PIN) { $env:MIZAN_PIN } else { 'a23c749' }
$dest = if ($env:MIZAN_DIR) { $env:MIZAN_DIR } else { Join-Path (Join-Path $script:Root '.cache') 'mizan' }

if (-not (Test-Path -LiteralPath (Join-Path $dest '.git'))) { Invoke-Native 'git clone' 'git' @('clone', '--quiet', $repo, $dest) }
Invoke-Native 'git fetch' 'git' @('-C', $dest, 'fetch', '--quiet', 'origin')
Invoke-Native 'git checkout' 'git' @('-C', $dest, 'checkout', '--quiet', $pin)
Push-Location -LiteralPath $dest
try { Invoke-Native 'npm ci (Mizan)' 'npm' @('ci', '--no-audit', '--no-fund', '--silent') } finally { Pop-Location }
Write-Host "Mizan $(git -C $dest rev-parse --short HEAD) ready in $dest"
