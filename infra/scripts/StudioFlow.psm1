#Requires -Version 7.4
# Shared helpers for setup.ps1, backup.ps1, restore.ps1 and update.ps1 - the PowerShell twin of common.sh.
# Every function throws on failure; the scripts catch at the top level and print "Error: ...".

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
# (log files of scheduled backups would otherwise use the console code page and garble non-ASCII tool output).
function Initialize-StudioFlow
{
    param([Parameter(Mandatory)][string] $Root)
    $script:Root = (Resolve-Path -LiteralPath $Root).Path
    if ([Console]::IsOutputRedirected) { [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false) }
}

function Get-SfRoot { $script:Root }

function Write-SfInfo { param([string] $Message = '') Write-Host $Message }
function Write-SfStep { param([string] $Message) Write-Host ''; Write-Host "==> $Message" }
function Write-SfWarn { param([string] $Message) Write-Host "Warning: $Message" -ForegroundColor Yellow }

# Runs a native command; throws with $FailMessage when it exits with a non-zero code.
function Invoke-SfNative
{
    param(
        [Parameter(Mandatory)][string] $FilePath,
        [string[]] $ArgumentList = @(),
        [string] $FailMessage = "$FilePath failed.",
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
        [string] $FailMessage = "docker compose $($Arguments -join ' ') failed.",
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
        throw 'docker was not found. Install Docker (Linux: Docker Engine, Windows/macOS: Docker Desktop).'
    }
    & docker compose version *> $null
    if ($LASTEXITCODE -ne 0) { throw "Docker Compose v2 is missing ('docker compose version' fails)." }
    & docker info *> $null
    if ($LASTEXITCODE -ne 0) { throw "Docker is not running, or this user is not allowed to use it (Linux: group 'docker')." }
}

function Assert-SfEnvFile
{
    if (-not (Test-Path -LiteralPath (Join-Path $script:Root '.env') -PathType Leaf))
    {
        throw ".env is missing in $($script:Root). Run ./setup.ps1 first."
    }
}

# Yes/no question. Without an interactive host the default applies.
function Read-SfConfirm
{
    param([Parameter(Mandatory)][string] $Question, [ValidateSet('y', 'n')][string] $Default = 'n')
    if (-not [Environment]::UserInteractive -or [Console]::IsInputRedirected) { return $Default -eq 'y' }
    $hint = if ($Default -eq 'y') { '[Y/n]' } else { '[y/N]' }
    $answer = Read-Host "$Question $hint"
    if ([string]::IsNullOrWhiteSpace($answer)) { $answer = $Default }
    $answer.Trim() -in @('y', 'Y', 'yes', 'Yes', 'YES')
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

# Refuses to continue while a broadcast may be on air. $Action = a noun phrase such as "The update".
function Assert-SfBroadcastIdle
{
    param([Parameter(Mandatory)][string] $Action, [bool] $Force = $false)
    switch (Get-SfBroadcastStatus)
    {
        'idle' { Write-SfInfo 'Broadcast status: no broadcast is live.' }
        'stopped' { Write-SfInfo 'Broadcast status: the stack is not running, no broadcast is live.' }
        'live'
        {
            if (-not $Force)
            {
                throw "A broadcast is LIVE. $Action is blocked during a broadcast. First click 'End broadcast' in the Regie (or use -Force if you really must)."
            }
            Write-SfWarn "A broadcast is LIVE. $Action will run anyway because of -Force - the picture at the proxy will drop out."
        }
        default
        {
            if (-not $Force)
            {
                throw "Broadcast status unknown: the API is not running or does not answer. Check with 'docker compose ps' and 'docker compose logs api'; use -Force to continue anyway."
            }
            Write-SfWarn "Broadcast status unknown (the API does not answer). $Action will run anyway because of -Force."
        }
    }
}

# --- ready-made images (docker-compose.release.yml, docs/releasing.md) ---------------------------------------------

# $true when the Compose file pulls ready-made images (an installation from a release), $false when it builds the
# images from the source (a Git checkout with docker-compose.yml) or cannot be read.
function Test-SfUsesImages
{
    $result = Get-SfComposeOutput -Arguments @('config', '--no-interpolate')
    $result.ExitCode -eq 0 -and -not ($result.Lines | Where-Object { $_ -match '^    build:' })
}

# Image reference of the API for the given tag (default: the tag that is configured), e.g. ghcr.io/opten/studioflow-api:0.4.2.
function Get-SfApiImage
{
    param([string] $Tag = '')
    $saved = $env:STUDIOFLOW_IMAGE_TAG
    try
    {
        if ($Tag) { $env:STUDIOFLOW_IMAGE_TAG = $Tag }
        $result = Get-SfComposeOutput -Arguments @('config', '--images')
    }
    finally { $env:STUDIOFLOW_IMAGE_TAG = $saved }
    $image = @($result.Lines | Where-Object { $_ -match 'studioflow-api' }) | Select-Object -First 1
    if ($image) { $image } else { '' }
}

# Value of a label of a local image or container; empty if there is none.
function Get-SfLabel
{
    param([string] $Reference = '', [Parameter(Mandatory)][string] $Name)
    if (-not $Reference) { return '' }
    # All labels as JSON: a template with a quoted label name loses its quotes in some PowerShell versions.
    $json = & docker inspect -f '{{json .Config.Labels}}' $Reference 2> $null
    if ($LASTEXITCODE -ne 0 -or -not $json) { return '' }
    $labels = "$json" | ConvertFrom-Json
    $label = if ($labels) { $labels.PSObject.Properties[$Name] } else { $null }
    if ($label) { "$($label.Value)".Trim() } else { '' }
}

# Version of the API that runs now, as it reports itself (0.4.2+1a2b3c4); empty if the API container does not exist
# or comes from a build without a version label.
function Get-SfRunningVersion
{
    $id = (Get-SfComposeOutput -Arguments @('ps', '-q', 'api')).Lines | Select-Object -First 1
    if ($id) { Get-SfLabel -Reference $id -Name 'org.opencontainers.image.version' } else { '' }
}

# Sets KEY=VALUE in .env: replaces the line or appends it. The file stays private (mode 600 on Linux and macOS).
function Set-SfEnvValue
{
    param([Parameter(Mandatory)][string] $Key, [Parameter(Mandatory)][string] $Value)
    $path = Join-Path $script:Root '.env'
    $lines = [Collections.Generic.List[string]]::new()
    $found = $false
    foreach ($line in [IO.File]::ReadAllLines($path))
    {
        if (($line -replace '=.*$', '').Trim() -eq $Key)
        {
            if (-not $found) { $lines.Add("$Key=$Value") }
            $found = $true
        }
        else { $lines.Add($line) }
    }
    if (-not $found) { $lines.Add("$Key=$Value") }
    [IO.File]::WriteAllText($path, ($lines -join "`n") + "`n", [Text.UTF8Encoding]::new($false))
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
            throw 'Not all services are healthy. Logs: docker compose logs --tail 100 <service>'
        }
    }
    finally { Pop-Location }
}

# Toolbox container (profile "tools") with the media, keys and caddy_data volumes under /volumes.
function Start-SfToolbox
{
    $result = Get-SfComposeOutput -Arguments @('--profile', 'tools', 'run', '-d', '--rm', '--no-deps', 'toolbox')
    $id = $result.Lines | Where-Object { $_ -match '^[0-9a-f]{12,64}$' } | Select-Object -Last 1
    if ($result.ExitCode -ne 0 -or -not $id) { throw 'The helper container (toolbox) could not be started.' }
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
