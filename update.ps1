<#
.SYNOPSIS
    Update StudioFlow: fetch the new version, build the images, restart the stack. Never during a broadcast.

.DESCRIPTION
    Same behaviour as update.sh. Sequence: check the broadcast status (API: broadcast-status) -> optional backup ->
    git pull --ff-only -> docker compose up -d --build -> wait until all services are healthy -> show the status.
    Volumes are kept.

.PARAMETER Backup
    Back up first (./backup.ps1 -Label pre-update).
.PARAMETER NoPull
    No git pull, only rebuild and restart (e.g. after a change to .env).
.PARAMETER Force
    Even if a broadcast is live or the broadcast status is unknown (the picture will drop out).

.EXAMPLE
    ./update.ps1
.EXAMPLE
    ./update.ps1 -Backup
#>
#Requires -Version 7.4
[CmdletBinding(PositionalBinding = $false)]
param(
    [switch] $Backup,
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

    Write-SfStep 'Check the broadcast status'
    Assert-SfBroadcastIdle -Action 'The update' -Force $Force.IsPresent

    if ($Backup)
    {
        Write-SfStep 'Back up before the update'
        & pwsh -NoProfile -File (Join-Path $root 'backup.ps1') -Label 'pre-update'
        if ($LASTEXITCODE -ne 0) { throw 'The backup failed; update aborted.' }
    }

    if (-not $NoPull)
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

    Write-SfStep 'Status'
    Invoke-SfCompose -Arguments @('ps')
    Write-SfInfo 'Update complete.'
}
catch
{
    Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
