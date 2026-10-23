<#
.SYNOPSIS
    StudioFlow aktualisieren: neuen Stand holen, Images bauen, Stack neu starten. Nie während einer Sendung.

.DESCRIPTION
    Gleiches Verhalten wie update.sh. Ablauf: Sendestatus prüfen (API: broadcast-status) → optional Sicherung →
    git pull --ff-only → docker compose up -d --build → warten, bis alle Dienste gesund sind → Status anzeigen.
    Volumes bleiben erhalten.

.PARAMETER Backup
    Vorher eine Sicherung anlegen (./backup.ps1 -Label vor-update).
.PARAMETER NoPull
    Kein git pull, nur neu bauen und starten (z. B. nach einer Änderung an .env).
.PARAMETER Force
    Auch wenn eine Sendung live ist oder der Sendestatus unbekannt ist (das Bild bricht ab).

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
        else { throw "Unbekannte Option: $($UnknownArguments -join ' ') (siehe Get-Help ./update.ps1 -Full)." }
    }
    if ($Help)
    {
        Get-Help $PSCommandPath -Full
        exit 0
    }

    Assert-SfDocker
    Assert-SfEnvFile
    $root = Get-SfRoot

    Write-SfStep 'Sendestatus prüfen'
    Assert-SfBroadcastIdle -Action 'Das Update' -Force $Force.IsPresent

    if ($Backup)
    {
        Write-SfStep 'Sicherung vor dem Update'
        & pwsh -NoProfile -File (Join-Path $root 'backup.ps1') -Label 'vor-update'
        if ($LASTEXITCODE -ne 0) { throw 'Die Sicherung ist fehlgeschlagen; Update abgebrochen.' }
    }

    if (-not $NoPull)
    {
        Write-SfStep 'Neuen Stand holen (git pull --ff-only)'
        if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw 'git wurde nicht gefunden. Neuen Stand von Hand einspielen und ./update.ps1 -NoPull ausführen.' }
        & git -C $root rev-parse --is-inside-work-tree *> $null
        if ($LASTEXITCODE -ne 0) { throw "$root ist kein Git-Arbeitsverzeichnis. Neuen Stand von Hand einspielen und ./update.ps1 -NoPull ausführen." }
        $before = & git -C $root rev-parse --short HEAD
        Invoke-SfNative -FilePath 'git' -ArgumentList @('-C', $root, 'pull', '--ff-only') `
            -FailMessage 'git pull --ff-only ist fehlgeschlagen (lokale Änderungen oder abweichender Stand). Nichts neu gestartet.'
        $after = & git -C $root rev-parse --short HEAD
        if ($before -eq $after) { Write-SfInfo "Bereits aktuell ($after); die Images werden trotzdem neu gebaut und geprüft." }
        else { Write-SfInfo "Aktualisiert: $before → $after" }
    }

    Write-SfStep 'Images bauen und Stack neu starten'
    Invoke-SfCompose -Arguments @('config', '--quiet') `
        -FailMessage 'Die Konfiguration ist ungültig – fehlt eine neue Variable? .env mit .env.example vergleichen.'
    Start-SfStackAndWait -ExtraArguments @('--build', '--remove-orphans')

    Write-SfStep 'Status'
    Invoke-SfCompose -Arguments @('ps')
    Write-SfInfo 'Update abgeschlossen.'
}
catch
{
    Write-Host "Fehler: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
