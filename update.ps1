<#
.SYNOPSIS
    Update StudioFlow: fetch the new version and restart the stack. Never during a broadcast.

.DESCRIPTION
    Same behaviour as update.sh.
    Ready-made images (docker-compose.release.yml, a release installation): check the broadcast status (API:
    broadcast-status) -> optional backup -> docker compose pull -> docker compose up -d -> wait until all services are
    healthy -> show the status.
    Building from the source (a Git checkout with docker-compose.yml): check the broadcast status -> optional backup ->
    git pull --ff-only -> docker compose up -d --build -> wait until all services are healthy -> show the status.
    Volumes are kept in both cases.

.PARAMETER Backup
    Back up first (./backup.ps1 -Label pre-update).
.PARAMETER Version
    Ready-made images only: the version to run - 0.4.2 (a release; also the way back to an earlier one), latest (the
    newest release, default), main or sha-1a2b3c4. Written to .env as STUDIOFLOW_IMAGE_TAG, so the stack keeps this
    version.
.PARAMETER NoPull
    Fetch nothing (no git pull, no image pull), only restart (e.g. after a change to .env).
.PARAMETER Force
    Even if a broadcast is live or the broadcast status is unknown (the picture will drop out).

.EXAMPLE
    ./update.ps1
.EXAMPLE
    ./update.ps1 -Backup -Version 0.4.2
#>
#Requires -Version 7.4
[CmdletBinding(PositionalBinding = $false)]
param(
    [switch] $Backup,
    [string] $Version,
    [switch] $NoPull,
    [switch] $Force,
    [Alias('h')][switch] $Help,
    [Parameter(ValueFromRemainingArguments)][string[]] $UnknownArguments
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Set-StrictMode -Version 3.0
Import-Module (Join-Path $PSScriptRoot 'infra/scripts/StudioFlow.psm1') -Force
Initialize-StudioFlow -Root $PSScriptRoot

$semver = '^[0-9]+\.[0-9]+\.[0-9]+$'

# Ready-made images: pull the version, keep it in .env, restart.
function Update-Images
{
    param([string] $Version, [bool] $Pull)
    $root = Get-SfRoot
    Invoke-SfCompose -Arguments @('config', '--quiet') `
        -FailMessage 'The configuration is invalid - is a new variable missing? Compare .env with .env.example.'

    # The way back: the version that runs now, or else the tag that is configured.
    $previous = (Get-SfRunningVersion) -replace '\+.*$', ''
    if ($previous -notmatch $semver) { $previous = (Get-SfApiImage) -replace '^.*:', '' }

    $resolved = ''
    if ($Pull)
    {
        $resolved = if ($Version) { $Version } else { 'latest' }
        Write-SfStep "Pull the images ($resolved)"
        $saved = $env:STUDIOFLOW_IMAGE_TAG
        try
        {
            $env:STUDIOFLOW_IMAGE_TAG = $resolved
            Invoke-SfCompose -Arguments @('pull') -FailMessage 'The images could not be pulled. Nothing was restarted. While the repository is private, sign in first: docker login ghcr.io (user name and a token with read:packages).'
        }
        finally { $env:STUDIOFLOW_IMAGE_TAG = $saved }
        # "latest" moves on with every release: keep the number it stands for, so that the stack stays on this version.
        if ($resolved -eq 'latest')
        {
            $label = (Get-SfLabel -Reference (Get-SfApiImage -Tag 'latest') -Name 'org.opencontainers.image.version') -replace '\+.*$', ''
            if ($label -match $semver) { $resolved = $label }
        }
    }
    else
    {
        # Nothing is pulled; `up` fetches the images of a new version if they are missing.
        $resolved = $Version
    }
    if ($resolved) { Set-SfEnvValue -Key 'STUDIOFLOW_IMAGE_TAG' -Value $resolved }

    $apiImage = Get-SfApiImage
    $bundle = ''
    $versionFile = Join-Path $root 'VERSION'
    if ($resolved -match $semver -and (Test-Path -LiteralPath $versionFile -PathType Leaf)) { $bundle = (Get-Content -LiteralPath $versionFile -Raw).Trim() }
    if ($bundle -and $bundle -ne $resolved)
    {
        $repoUrl = Get-SfLabel -Reference $apiImage -Name 'org.opencontainers.image.source'
        $notes = if ($repoUrl) { " ($repoUrl/releases/tag/v$resolved)" } else { '' }
        Write-SfWarn "The Compose file and the scripts in this folder are from release $bundle, the images are $resolved. If the release notes of $resolved$notes mention changed files, unpack the bundle of that release over this folder (.env and backups/ stay) and run ./update.ps1 again."
    }

    $images = if ($apiImage) { " (images $($apiImage -replace '^.*:', ''))" } else { '' }
    Write-SfStep "Restart the stack$images"
    Write-SfInfo "If the new version does not start, go back with: ./update.ps1 -Version $(if ($previous) { $previous } else { 'VERSION' })"
    Write-SfInfo 'A database migration of the new version stays; when the schema changed, restore the backup that was taken before the update (docs/runbook.md, section 14).'
    Start-SfStackAndWait -ExtraArguments @('--remove-orphans')
    Write-SfInfo "Version running now: $(Get-SfRunningVersion)"
}

# Source build: git pull --ff-only, then docker compose up -d --build.
function Update-Source
{
    param([bool] $Pull)
    $root = Get-SfRoot
    if ($Pull)
    {
        Write-SfStep 'Pull the new version (git pull --ff-only)'
        if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw 'git was not found. Apply the new version by hand and run ./update.ps1 -NoPull.' }
        & git -C $root rev-parse --is-inside-work-tree *> $null
        if ($LASTEXITCODE -ne 0) { throw "$root is not a Git working directory. Apply the new version by hand and run ./update.ps1 -NoPull." }
        $before = & git -C $root rev-parse --short HEAD
        Invoke-SfNative -FilePath 'git' -ArgumentList @('-C', $root, 'pull', '--ff-only') `
            -FailMessage 'git pull --ff-only failed (local changes or diverged history). Nothing was restarted.'
        $after = & git -C $root rev-parse --short HEAD
        if ($before -eq $after) { Write-SfInfo "Already up to date ($after); the images are rebuilt and checked anyway." }
        else { Write-SfInfo "Updated: $before -> $after" }
    }

    Write-SfStep 'Build the images and restart the stack'
    Invoke-SfCompose -Arguments @('config', '--quiet') `
        -FailMessage 'The configuration is invalid - is a new variable missing? Compare .env with .env.example.'
    Start-SfStackAndWait -ExtraArguments @('--build', '--remove-orphans')
}

try
{
    if ($UnknownArguments)
    {
        if ($UnknownArguments | Where-Object { $_ -in @('--help', '-help', '/?') }) { $Help = $true }
        else { throw "Unknown option: $($UnknownArguments -join ' ') (see Get-Help ./update.ps1 -Full)." }
    }
    if ($Help)
    {
        Get-Help $PSCommandPath -Full
        exit 0
    }

    Assert-SfDocker
    Assert-SfEnvFile
    $root = Get-SfRoot

    $images = Test-SfUsesImages
    if ($Version)
    {
        if (-not $images) { throw '-Version is for the ready-made images. This installation builds from the source: check out the version with git, then run ./update.ps1 -NoPull.' }
        if ($Version -cnotmatch '^(latest|main|sha-[0-9a-f]{7,40}|[0-9]+\.[0-9]+\.[0-9]+)$') { throw "Invalid version '$Version' (examples: 0.4.2, latest, main, sha-1a2b3c4)." }
    }

    Write-SfStep 'Check the broadcast status'
    Assert-SfBroadcastIdle -Action 'The update' -Force $Force.IsPresent

    if ($Backup)
    {
        Write-SfStep 'Back up before the update'
        & pwsh -NoProfile -File (Join-Path $root 'backup.ps1') -Label 'pre-update'
        if ($LASTEXITCODE -ne 0) { throw 'The backup failed; update aborted.' }
    }

    if ($images) { Update-Images -Version $Version -Pull (-not $NoPull) }
    else { Update-Source -Pull (-not $NoPull) }

    Write-SfStep 'Status'
    Invoke-SfCompose -Arguments @('ps')
    Write-SfInfo 'Update complete.'
}
catch
{
    Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
