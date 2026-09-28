<#
.SYNOPSIS
  The definition of done (CLAUDE.md), in one command: typecheck, the whole test suite against the pinned
  real Mizan and HR-System, and the planted-bug run (every planted bug must be caught).
.PARAMETER Quick
  Typecheck and the tests that need no other application (skips the Mizan / HR downloads and the planted bugs).
.PARAMETER SkipMutations
  Everything except the planted-bug run.
#>
[CmdletBinding()]
param(
  [switch]$Quick,
  [switch]$SkipMutations
)
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\common.ps1"
Set-Location -LiteralPath $script:Root

$null = Assert-Node
Install-Dependencies

# HR-System's end-to-end test starts Python. On Windows "python3" is often the Microsoft Store stub, so pick a real one.
function Resolve-Python {
  foreach ($c in @($env:PYTHON, 'python', 'python3', 'py')) {
    if (-not $c) { continue }
    if (-not (Get-Command $c -ErrorAction SilentlyContinue)) { continue }
    $v = & $c -c 'import sys; print(sys.version_info[0] * 100 + sys.version_info[1])' 2>$null
    if ($LASTEXITCODE -eq 0 -and [int]$v -ge 310) { return $c }
  }
  return $null
}

Write-Host '== typecheck'
Invoke-Native 'typecheck' 'npm' @('run', 'typecheck')

if (-not $Quick) {
  $python = Resolve-Python
  if (-not $python) { Fail 'Python 3.10 or newer is needed for the HR-System test (install it with: winget install Python.Python.3.12).' }
  Write-Host '== pinned Mizan'
  & "$PSScriptRoot\fetch-mizan.ps1"
  Write-Host '== pinned HR-System'
  & "$PSScriptRoot\fetch-hr.ps1"
  $env:MIZAN_DIR = Join-Path (Join-Path $script:Root '.cache') 'mizan'
  $env:HR_DIR = Join-Path (Join-Path $script:Root '.cache') 'hr-system'
  $env:PYTHON = $python
  $env:ECO_E2E_REQUIRED = '1'
}

Write-Host '== tests'
Invoke-Native 'npm test' 'npm' @('test')

if (-not $Quick -and -not $SkipMutations) {
  Write-Host '== planted bugs (each one must be caught)'
  Invoke-Native 'planted bugs' 'node' @('scripts/mutations.mjs')
}
Write-Host ''
Write-Host 'ALL GREEN' -ForegroundColor Green
