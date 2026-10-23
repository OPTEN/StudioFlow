#Requires -Version 7.4
# Shared helpers for setup.ps1, backup.ps1, restore.ps1 and update.ps1 – the PowerShell twin of common.sh.
# Every function throws on failure; the scripts catch at the top level and print «Fehler: …».

Set-StrictMode -Version 3.0

# Commands the API image provides (see docs/architecture/implementation-spec.md section 5 and 10).
$script:ApiDll = 'Opten.StudioFlow.Web.dll'
$script:BroadcastLiveExitCode = 3
$script:WaitTimeoutSeconds = 600

# Backup layout, shared by backup.ps1 and restore.ps1 (same as in common.sh).
Set-Variable -Name BackupVolumes -Option Constant -Value @('media', 'keys', 'caddy_data')
Set-Variable -Name DbDumpName -Option Constant -Value 'database.dump'
Set-Variable -Name ChecksumsName -Option Constant -Value 'SHA256SUMS'
Set-Variable -Name BackupInfoName -Option Constant -Value 'backup-info.txt'

$script:Root = $null

# Called first by every script: remembers the repository root and writes UTF-8 when the output is redirected
# (log files of scheduled backups would otherwise use the console code page and garble «» and umlauts).
function Initialize-StudioFlow
{
    param([Parameter(Mandatory)][string] $Root)
    $script:Root = (Resolve-Path -LiteralPath $Root).Path
    if ([Console]::IsOutputRedirected) { [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false) }
}

function Get-SfRoot { $script:Root }

function Write-SfInfo { param([string] $Message = '') Write-Host $Message }
function Write-SfStep { param([string] $Message) Write-Host ''; Write-Host "==> $Message" }
function Write-SfWarn { param([string] $Message) Write-Host "Warnung: $Message" -ForegroundColor Yellow }

# Runs a native command; throws with $FailMessage when it exits with a non-zero code.
function Invoke-SfNative
{
    param(
        [Parameter(Mandatory)][string] $FilePath,
        [string[]] $ArgumentList = @(),
        [string] $FailMessage = "$FilePath ist fehlgeschlagen.",
        [switch] $Quiet
    )
    if ($Quiet) { & $FilePath @ArgumentList *> $null } else { & $FilePath @ArgumentList }
    if ($LASTEXITCODE -ne 0) { throw $FailMessage }
}

# docker compose, always from the repository root (picks up .env and docker-compose.override.yml).
function Invoke-SfCompose
{
    param(
        [Parameter(Mandatory)][string[]] $Arguments,
        [string] $FailMessage = "docker compose $($Arguments -join ' ') ist fehlgeschlagen.",
        [switch] $Quiet
    )
    Push-Location -LiteralPath $script:Root
    try { Invoke-SfNative -FilePath 'docker' -ArgumentList (@('compose') + $Arguments) -FailMessage $FailMessage -Quiet:$Quiet }
    finally { Pop-Location }
}

# docker compose that returns stdout lines and the exit code instead of throwing.
function Get-SfComposeOutput
{
    param([Parameter(Mandatory)][string[]] $Arguments)
    Push-Location -LiteralPath $script:Root
    try
    {
        $output = & docker compose @Arguments 2> $null
        [pscustomobject]@{ ExitCode = $LASTEXITCODE; Lines = @($output | ForEach-Object { "$_".TrimEnd("`r") }) }
    }
    finally { Pop-Location }
}

function Test-SfDockerAvailable
{
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { return $false }
    & docker info *> $null
    if ($LASTEXITCODE -ne 0) { return $false }
    & docker compose version *> $null
    $LASTEXITCODE -eq 0
}

function Assert-SfDocker
{
    if (-not (Get-Command docker -ErrorAction SilentlyContinue))
    {
        throw 'docker wurde nicht gefunden. Docker installieren (Linux: Docker Engine, Windows/macOS: Docker Desktop).'
    }
    & docker compose version *> $null
    if ($LASTEXITCODE -ne 0) { throw 'Docker Compose v2 fehlt («docker compose version» schlägt fehl).' }
    & docker info *> $null
    if ($LASTEXITCODE -ne 0) { throw 'Docker läuft nicht oder dieser Benutzer darf es nicht verwenden (Linux: Gruppe «docker»).' }
}

function Assert-SfEnvFile
{
    if (-not (Test-Path -LiteralPath (Join-Path $script:Root '.env') -PathType Leaf))
    {
        throw ".env fehlt in $($script:Root). Zuerst ./setup.ps1 ausführen."
    }
}

# Yes/no question. Without an interactive host the default applies.
function Read-SfConfirm
{
    param([Parameter(Mandatory)][string] $Question, [ValidateSet('j', 'n')][string] $Default = 'n')
    if (-not [Environment]::UserInteractive -or [Console]::IsInputRedirected) { return $Default -eq 'j' }
    $hint = if ($Default -eq 'j') { '[J/n]' } else { '[j/N]' }
    $answer = Read-Host "$Question $hint"
    if ([string]::IsNullOrWhiteSpace($answer)) { $answer = $Default }
    $answer.Trim() -in @('j', 'J', 'ja', 'Ja', 'JA', 'y', 'Y', 'yes')
}

function Get-SfRunningService
{
    (Get-SfComposeOutput -Arguments @('ps', '--status', 'running', '--services')).Lines | Where-Object { $_ }
}

function Test-SfServiceRunning
{
    param([Parameter(Mandatory)][string] $Service)
    @(Get-SfRunningService) -contains $Service
}

# live | idle | stopped | unknown (see sf_broadcast_status in common.sh).
function Get-SfBroadcastStatus
{
    $running = @(Get-SfRunningService)
    if ($running.Count -eq 0) { return 'stopped' }
    if ($running -notcontains 'api') { return 'unknown' }
    $result = Get-SfComposeOutput -Arguments @('exec', '-T', 'api', 'dotnet', $script:ApiDll, 'broadcast-status')
    switch ($result.ExitCode)
    {
        0 { 'idle' }
        { $_ -eq $script:BroadcastLiveExitCode } { 'live' }
        default { 'unknown' }
    }
}

# Refuses to continue while a broadcast may be on air. $Action = German noun («Das Update»).
function Assert-SfBroadcastIdle
{
    param([Parameter(Mandatory)][string] $Action, [bool] $Force = $false)
    switch (Get-SfBroadcastStatus)
    {
        'idle' { Write-SfInfo 'Sendestatus: keine Sendung live.' }
        'stopped' { Write-SfInfo 'Sendestatus: Stack läuft nicht, keine Sendung live.' }
        'live'
        {
            if (-not $Force)
            {
                throw "Eine Sendung ist LIVE. $Action ist während einer Sendung gesperrt. Zuerst «Sendung beenden» in der Regie (oder -Force, wenn es wirklich sein muss)."
            }
            Write-SfWarn "Eine Sendung ist LIVE. $Action wird wegen -Force trotzdem ausgeführt – das Bild beim Proxy bricht ab."
        }
        default
        {
            if (-not $Force)
            {
                throw 'Sendestatus unbekannt: die API läuft nicht oder antwortet nicht. Prüfen mit «docker compose ps» und «docker compose logs api»; mit -Force trotzdem fortfahren.'
            }
            Write-SfWarn "Sendestatus unbekannt (API antwortet nicht). $Action wird wegen -Force trotzdem ausgeführt."
        }
    }
}

# Starts the stack (or the given services) and waits until every healthcheck passes.
function Start-SfStackAndWait
{
    param([string[]] $ExtraArguments = @())
    Push-Location -LiteralPath $script:Root
    try
    {
        & docker compose up -d --wait --wait-timeout $script:WaitTimeoutSeconds @ExtraArguments
        if ($LASTEXITCODE -ne 0)
        {
            & docker compose ps
            throw 'Nicht alle Dienste sind gesund. Logs: docker compose logs --tail 100 <dienst>'
        }
    }
    finally { Pop-Location }
}

# Toolbox container (profile "tools") with the media, keys and caddy_data volumes under /volumes.
function Start-SfToolbox
{
    $result = Get-SfComposeOutput -Arguments @('--profile', 'tools', 'run', '-d', '--rm', '--no-deps', 'toolbox')
    $id = $result.Lines | Where-Object { $_ -match '^[0-9a-f]{12,64}$' } | Select-Object -Last 1
    if ($result.ExitCode -ne 0 -or -not $id) { throw 'Der Hilfscontainer (toolbox) liess sich nicht starten.' }
    $id
}

function Stop-SfToolbox
{
    param([string] $Id)
    if ($Id) { & docker rm -f $Id *> $null }
}

function Get-SfSha256
{
    param([Parameter(Mandatory)][string] $Path)
    (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

# Restricts a file or folder to the current user (chmod 600/700 on Linux and macOS; Windows keeps its ACL).
function Protect-SfPath
{
    param([Parameter(Mandatory)][string] $Path, [switch] $Directory)
    if ($IsWindows) { return }
    $mode = if ($Directory) { [IO.UnixFileMode]'UserRead, UserWrite, UserExecute' } else { [IO.UnixFileMode]'UserRead, UserWrite' }
    [IO.File]::SetUnixFileMode($Path, $mode)
}

Export-ModuleMember -Function * -Variable BackupVolumes, DbDumpName, ChecksumsName, BackupInfoName
