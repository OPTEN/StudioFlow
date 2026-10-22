# Nimmt die Ansichten des Regie-Prototyps mit Edge (headless) auf und legt sie in .impeccable/review ab.
# Aufruf:  pwsh tools/capture.ps1                    alle Ansichten
#          pwsh tools/capture.ps1 -Only desktop, user-1280
# Braucht Microsoft Edge und für mobile.png zusätzlich ffmpeg.
param([string[]]$Only)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$out = Join-Path $root '.impeccable\review'
$tmp = Join-Path $env:TEMP 'flowstudio-capture'
New-Item -ItemType Directory -Force $out, $tmp | Out-Null
$edge = @('C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe', 'C:\Program Files\Microsoft\Edge\Application\msedge.exe') | Where-Object { Test-Path $_ } | Select-Object -First 1
$base = ([System.Uri](Join-Path $root 'prototype\regie.html')).AbsoluteUri
$wrap = ([System.Uri](Join-Path $PSScriptRoot 'mobile-wrap.html')).AbsoluteUri
$shots = @(
  @{ n = 'desktop'; w = 1440; h = 900; u = $base },
  @{ n = 'desktop-studio'; w = 1440; h = 900; u = "$base#studio" },
  @{ n = 'desktop-stoerung'; w = 1440; h = 900; u = "$base#stoerung" },
  @{ n = 'desktop-studio-stoerung'; w = 1440; h = 900; u = "$base#studio+stoerung" },
  @{ n = 'desktop-koppeln'; w = 1440; h = 900; u = "$base#koppeln" },
  @{ n = 'desktop-docks'; w = 1440; h = 900; u = "$base#studio+docks" },
  @{ n = 'user-1280'; w = 1280; h = 720; u = $base },
  @{ n = 'user-1280-studio'; w = 1280; h = 720; u = "$base#studio" },
  @{ n = 'user-1280-stoerung'; w = 1280; h = 720; u = "$base#stoerung" },
  @{ n = 'user-1280-koppeln'; w = 1280; h = 720; u = "$base#koppeln" },
  # Edge headless wird nicht schmaler als rund 500 px; das Handy-Format kommt deshalb über einen 390 px breiten iframe
  @{ n = 'mobile-raw'; w = 1000; h = 3400; u = $wrap }
)
foreach ($s in $shots) {
  if ($Only -and ($Only -notcontains $s.n)) { continue }
  $file = if ($s.n -eq 'mobile-raw') { Join-Path $tmp 'mobile-raw.png' } else { Join-Path $out ($s.n + '.png') }
  if (Test-Path $file) { Remove-Item $file }
  $argv = @('--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', "--user-data-dir=$tmp\edge-profile", '--virtual-time-budget=9000', "--window-size=$($s.w),$($s.h)", "--screenshot=$file", $s.u)
  Start-Process -FilePath $edge -ArgumentList $argv -Wait -WindowStyle Hidden
  "$($s.n): $(if (Test-Path $file) { (Get-Item $file).Length } else { 'FEHLT' })"
}
if (-not $Only -or $Only -contains 'mobile-raw') {
  ffmpeg -y -loglevel error -i (Join-Path $tmp 'mobile-raw.png') -vf crop=390:3400:0:0 (Join-Path $out 'mobile.png')
  "mobile: $((Get-Item (Join-Path $out 'mobile.png')).Length)"
}
