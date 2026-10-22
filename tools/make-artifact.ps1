# Macht aus einer vollständigen HTML-Datei die Fassung für ein Claude-Artifact:
# ohne doctype, html, head, body und ohne charset- und viewport-Meta, die setzt die Plattform selbst.
# Aufruf:  pwsh tools/make-artifact.ps1 -In prototype/regie.html -Out $env:TEMP/regie-artifact.html
#          pwsh tools/make-artifact.ps1 -In "plan/FlowStudio Architekturplan.html" -Out $env:TEMP/plan-artifact.html
# Beim Veröffentlichen die Zusatzdateien mitgeben: fonts/* beim Prototyp, regie-*.png beim Plan.
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
