# Turns a complete HTML file into the version for a Claude artifact:
# without doctype, html, head, body and without the charset and viewport meta tags, which the platform sets itself.
# Usage:   pwsh tools/make-artifact.ps1 -In prototype/regie.html -Out $env:TEMP/regie-artifact.html
#          pwsh tools/make-artifact.ps1 -In "docs/history/FlowStudio Architekturplan.html" -Out $env:TEMP/plan-artifact.html
# When publishing, pass the additional files along: fonts/* for the prototype, regie-*.png for the plan.
param([Parameter(Mandatory)][string]$In, [Parameter(Mandatory)][string]$Out)
$s = Get-Content -Raw -Encoding UTF8 $In
$s = $s -replace '(?is)<!doctype html>\s*', ''
$s = $s -replace '(?is)<html[^>]*>\s*', ''
$s = $s -replace '(?is)</html>\s*', ''
$s = $s -replace '(?is)<head>\s*', ''
$s = $s -replace '(?is)</head>\s*', ''
$s = $s -replace '(?is)<body>\s*', ''
$s = $s -replace '(?is)</body>\s*', ''
$s = $s -replace '(?i)<meta charset="utf-8">\s*', ''
$s = $s -replace '(?i)<meta name="viewport"[^>]*>\s*', ''
Set-Content -Path $Out -Value $s.Trim() -Encoding UTF8 -NoNewline
