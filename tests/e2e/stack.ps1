# Numbered E2E stacks (1-4) on one machine - tests/e2e/README.md, "Parallel stacks". No npm script and no dependency:
# the script only sets E2E_STACK=N (tests/e2e/support/env.ts turns it into the project name, ports and subnet) and
# calls Playwright or docker compose.
#
#   .\tests\e2e\stack.ps1 up 2                       start stack 2 (fs-e2e-2) and leave it running
#   .\tests\e2e\stack.ps1 test 2 --project=smoke     run Playwright against stack 2 (fresh stack, removed afterwards;
#                                                    $env:E2E_KEEP_STACK=1 keeps it, $env:E2E_REUSE_STACK=1 uses the running one)
#   .\tests\e2e\stack.ps1 status 2                   containers and ports of stack 2
#   .\tests\e2e\stack.ps1 down 2                     remove stack 2 with its volumes
#
#   N  project    https http rtc tcp/udp api   livekit postgres subnet
#   1  fs-e2e-1   8491  8091 7901/7902  18091 17891   15491    172.31.201.0/24
#   2  fs-e2e-2   8492  8092 7903/7904  18092 17892   15492    172.31.202.0/24
#   3  fs-e2e-3   8493  8093 7905/7906  18093 17893   15493    172.31.203.0/24
#   4  fs-e2e-4   8494  8094 7907/7908  18094 17894   15494    172.31.204.0/24
param(
  [Parameter(Mandatory = $true, Position = 0)][ValidateSet('up', 'test', 'status', 'down')][string]$Action,
  [Parameter(Mandatory = $true, Position = 1)][ValidateRange(1, 4)][int]$N,
  [Parameter(ValueFromRemainingArguments = $true)][string[]]$Rest
)

$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
$repo = (Resolve-Path (Join-Path $here '..\..')).Path
$project = "fs-e2e-$N"
$envFile = Join-Path $here ".env.e2e.$project"
$env:E2E_STACK = "$N"
Set-Location $repo

function Invoke-Compose {
  param([string[]]$ComposeArgs)
  if (Test-Path $envFile) {
    & docker compose -p $project --env-file $envFile -f (Join-Path $repo 'docker-compose.yml') -f (Join-Path $here 'docker-compose.e2e.yml') --profile chaos --profile tools @ComposeArgs
  } else {
    & docker compose -p $project @ComposeArgs
  }
}

function Show-Ports {
  if (Test-Path $envFile) {
    Select-String -Path $envFile -Pattern '^(E2E_HTTPS_PORT|E2E_HTTP_PORT|FLOWSTUDIO_RTC_TCP_PORT|FLOWSTUDIO_RTC_UDP_PORT|E2E_API_PORT|E2E_LIVEKIT_PORT|E2E_POSTGRES_PORT|FLOWSTUDIO_SUBNET|FLOWSTUDIO_PUBLIC_BASE_URL)=' | ForEach-Object { $_.Line }
  }
}

switch ($Action) {
  'up' {
    # The harness starts the stack in its global setup; one tiny test makes Playwright run it and keep the result.
    $env:E2E_KEEP_STACK = '1'
    & npx playwright test -c tests/e2e/playwright.config.ts --project=smoke --grep H-STACK-01 @Rest
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    Write-Host "`nstack $project is up:"
    Show-Ports
  }
  'test' {
    & npx playwright test -c tests/e2e/playwright.config.ts @Rest
    exit $LASTEXITCODE
  }
  'status' {
    Invoke-Compose @('ps', '-a')
    Show-Ports
  }
  'down' {
    Invoke-Compose @('down', '--volumes', '--remove-orphans', '--timeout', '30')
  }
}
