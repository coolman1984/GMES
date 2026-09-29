<#
.SYNOPSIS
  Adds screen texts to apps\mes-web\i18n\en.json and ar.json in one step (one line per key, appended before the closing
  brace, in the order given), refusing a key that exists in either file or is missing from either language. English and
  Arabic must carry the same keys (a test enforces it). Usage: . .\scripts\Add-Texts.ps1; Add-Texts @( @('key','English','العربية'), ... )
#>
function Add-Texts([object[]]$Rows) {
  $dir = Join-Path (Split-Path -Parent $PSScriptRoot) 'apps\mes-web\i18n'
  $files = @{ en = Join-Path $dir 'en.json'; ar = Join-Path $dir 'ar.json' }
  $have = @{}
  foreach ($l in 'en', 'ar') { $have[$l] = Get-Content -LiteralPath $files[$l] -Raw -Encoding utf8 | ConvertFrom-Json -AsHashtable }
  foreach ($r in $Rows) {
    if ($r.Count -ne 3 -or -not $r[0] -or -not $r[1] -or -not $r[2]) { throw "bad row: $($r -join ' | ')" }
    foreach ($l in 'en', 'ar') { if ($have[$l].ContainsKey($r[0])) { throw "key already exists in ${l}: $($r[0])" } }
  }
  foreach ($l in 'en', 'ar') {
    $i = if ($l -eq 'en') { 1 } else { 2 }
    $lines = [System.Collections.Generic.List[string]]([IO.File]::ReadAllLines($files[$l], [Text.Encoding]::UTF8))
    $close = $lines.FindLastIndex({ param($x) $x.Trim() -eq '}' })
    $last = $close - 1
    if (-not $lines[$last].TrimEnd().EndsWith(',')) { $lines[$last] = $lines[$last].TrimEnd() + ',' }
    $new = [string[]]@(foreach ($r in $Rows) { '"' + $r[0] + '": ' + (ConvertTo-Json -InputObject $r[$i] -Compress) + ',' })
    $new[-1] = $new[-1].TrimEnd(',')
    $lines.InsertRange($close, [string[]]$new)
    [IO.File]::WriteAllLines($files[$l], $lines, [Text.UTF8Encoding]::new($false))
    $null = Get-Content -LiteralPath $files[$l] -Raw -Encoding utf8 | ConvertFrom-Json -AsHashtable   # must still parse
  }
  Write-Host "Added $($Rows.Count) texts to en.json and ar.json."
}
