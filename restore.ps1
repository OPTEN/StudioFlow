<#
.SYNOPSIS
    FlowStudio wiederherstellen: ersetzt Datenbank, Medien, Login-Schlüssel und Zertifikate durch eine Sicherung.

.DESCRIPTION
    Gleiches Verhalten wie restore.sh. Ablauf: Prüfsummen prüfen → Sicherung des aktuellen Stands
    (backups/…_vor-restore) → api und caddy stoppen → Datenbank in eine neue Datenbank einspielen und erst danach
    austauschen → Volumes ersetzen → Stack starten und warten, bis alle Dienste gesund sind.
    Während einer Sendung gesperrt.

.PARAMETER BackupDir
    Sicherungsordner, z. B. backups/2026-10-22_1430.
.PARAMETER Yes
    Ohne Rückfrage.
.PARAMETER NoSafetyBackup
    Vorher keine Sicherung des aktuellen Stands anlegen.
.PARAMETER Force
    Auch wenn eine Sendung live ist oder der Sendestatus unbekannt ist.

.EXAMPLE
    ./restore.ps1 backups/2026-10-22_1430
#>
#Requires -Version 7.4
[CmdletBinding(PositionalBinding = $false)]
param(
    [Parameter(Position = 0)][string] $BackupDir,
    [switch] $Yes,
    [switch] $NoSafetyBackup,
    [switch] $Force,
    [Alias('h')][switch] $Help,
    [Parameter(ValueFromRemainingArguments)][string[]] $UnknownArguments
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Set-StrictMode -Version 3.0
Import-Module (Join-Path $PSScriptRoot 'infra/scripts/FlowStudio.psm1') -Force
Initialize-FlowStudio -Root $PSScriptRoot

function Invoke-PsqlAdmin([string[]] $Commands, [switch] $SingleTransaction, [string] $FailMessage)
{
    $arguments = @('exec', '-T', 'postgres', 'psql', '-U', 'flowstudio', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q')
    if ($SingleTransaction) { $arguments += '-1' }
    foreach ($command in $Commands) { $arguments += @('-c', $command) }
    Invoke-FsCompose -Arguments $arguments -Quiet -FailMessage $FailMessage
}

$toolbox = $null
$warnOnExit = $false
$dumpCopied = $false
try
{
    if ($UnknownArguments)
    {
        if ($UnknownArguments | Where-Object { $_ -in @('--help', '-help', '/?') }) { $Help = $true }
        else { throw "Unbekannte Option: $($UnknownArguments -join ' ') (siehe Get-Help ./restore.ps1 -Full)." }
    }
    if ($Help)
    {
        Get-Help $PSCommandPath -Full
        exit 0
    }
    if (-not $BackupDir) { throw 'Sicherungsordner fehlt. Aufruf: ./restore.ps1 backups/YYYY-MM-DD_HHMM' }
    if (-not (Test-Path -LiteralPath $BackupDir -PathType Container)) { throw "Ordner nicht gefunden: $BackupDir" }
    $sourceDir = (Resolve-Path -LiteralPath $BackupDir).Path

    Assert-FsDocker
    Assert-FsEnvFile

    # --- check the backup -----------------------------------------------------------------------------------------

    $checksumFile = Join-Path $sourceDir $ChecksumsName
    if (-not (Test-Path -LiteralPath $checksumFile -PathType Leaf)) { throw "$ChecksumsName fehlt in $sourceDir – keine vollständige FlowStudio-Sicherung." }
    if (-not (Test-Path -LiteralPath (Join-Path $sourceDir $DbDumpName) -PathType Leaf)) { throw "$DbDumpName fehlt in $sourceDir." }

    Write-FsInfo 'Prüfsummen werden geprüft …'
    foreach ($line in [IO.File]::ReadAllLines($checksumFile))
    {
        if (-not $line.Trim()) { continue }
        if ($line -notmatch '^([0-9a-f]{64})\s+\*?(.+)$') { throw "Ungültiger Eintrag in ${ChecksumsName}: $line" }
        $expected = $Matches[1]
        $file = $Matches[2].Trim()
        if ($file -match '[\\/]' -or $file.StartsWith('..')) { throw "Ungültiger Eintrag in ${ChecksumsName}: $file" }
        $path = Join-Path $sourceDir $file
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Datei aus $ChecksumsName fehlt: $file" }
        if ((Get-FsSha256 $path) -ne $expected) { throw "Prüfsumme stimmt nicht: $file (Sicherung beschädigt)." }
    }
    Write-FsInfo 'Prüfsummen in Ordnung.'
    $infoFile = Join-Path $sourceDir $BackupInfoName
    if (Test-Path -LiteralPath $infoFile) { Get-Content -LiteralPath $infoFile | ForEach-Object { Write-FsInfo "  $_" } }

    Assert-FsBroadcastIdle -Action 'Die Wiederherstellung' -Force $Force.IsPresent

    if (-not $Yes)
    {
        Write-FsWarn 'Datenbank, Medien, Login-Schlüssel und Zertifikate werden durch die Sicherung ersetzt.'
        if (-not (Read-FsConfirm "Wiederherstellen aus $(Split-Path -Leaf $sourceDir)?" 'n')) { throw 'Abgebrochen, nichts geändert.' }
    }

    # --- safety backup of the current state ----------------------------------------------------------------------

    Write-FsStep 'PostgreSQL starten'
    Start-FsStackAndWait -ExtraArguments @('postgres')

    if (-not $NoSafetyBackup)
    {
        Write-FsStep 'Sicherung des aktuellen Stands'
        & pwsh -NoProfile -File (Join-Path (Get-FsRoot) 'backup.ps1') -Label 'vor-restore'
        if ($LASTEXITCODE -ne 0) { throw 'Die Sicherung des aktuellen Stands ist fehlgeschlagen; nichts geändert (oder -NoSafetyBackup).' }
    }

    # --- database: restore into a new database, then swap (the old one stays intact if anything fails) -----------

    $warnOnExit = $true
    Write-FsStep 'API und Caddy stoppen'
    Invoke-FsCompose -Arguments @('stop', 'api', 'caddy')

    Write-FsStep 'Datenbank wiederherstellen'
    Invoke-FsCompose -Arguments @('cp', (Join-Path $sourceDir $DbDumpName), 'postgres:/tmp/flowstudio-restore.dump') -Quiet
    $dumpCopied = $true
    Invoke-PsqlAdmin -Commands @('DROP DATABASE IF EXISTS flowstudio_restore', 'CREATE DATABASE flowstudio_restore OWNER flowstudio') `
        -FailMessage 'Die Hilfsdatenbank flowstudio_restore liess sich nicht anlegen.'
    try
    {
        Invoke-FsCompose -Arguments @('exec', '-T', 'postgres', 'pg_restore', '-U', 'flowstudio', '-d', 'flowstudio_restore',
            '--no-owner', '--no-privileges', '--exit-on-error', '/tmp/flowstudio-restore.dump')
    }
    catch
    {
        Get-FsComposeOutput -Arguments @('exec', '-T', 'postgres', 'psql', '-U', 'flowstudio', '-d', 'postgres', '-c', 'DROP DATABASE IF EXISTS flowstudio_restore') | Out-Null
        Get-FsComposeOutput -Arguments @('up', '-d') | Out-Null
        $warnOnExit = $false
        throw 'pg_restore ist fehlgeschlagen. Die bisherige Datenbank ist unverändert; der Stack wurde wieder gestartet.'
    }
    Invoke-PsqlAdmin -Commands @(
        "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'flowstudio' AND pid <> pg_backend_pid()",
        'DROP DATABASE IF EXISTS flowstudio_replaced') -FailMessage 'Die Verbindungen zur Datenbank liessen sich nicht trennen.'
    Invoke-PsqlAdmin -SingleTransaction -Commands @(
        'ALTER DATABASE flowstudio RENAME TO flowstudio_replaced',
        'ALTER DATABASE flowstudio_restore RENAME TO flowstudio') -FailMessage 'Der Austausch der Datenbank ist fehlgeschlagen.'
    Invoke-PsqlAdmin -Commands @('DROP DATABASE flowstudio_replaced') -FailMessage 'Die ersetzte Datenbank liess sich nicht entfernen.'
    Write-FsInfo 'Datenbank ersetzt.'

    # --- volumes ----------------------------------------------------------------------------------------------------

    Write-FsStep 'Volumes wiederherstellen'
    $toolbox = Start-FsToolbox
    foreach ($volume in $BackupVolumes)
    {
        $archive = "$volume.tar.gz"
        $archivePath = Join-Path $sourceDir $archive
        if (-not (Test-Path -LiteralPath $archivePath -PathType Leaf))
        {
            Write-FsWarn "$archive fehlt in der Sicherung; Volume $volume bleibt unverändert."
            continue
        }
        Write-FsInfo "Volume $volume …"
        Invoke-FsNative -FilePath 'docker' -ArgumentList @('cp', $archivePath, "${toolbox}:/tmp/$archive") -Quiet `
            -FailMessage "Das Archiv $archive liess sich nicht kopieren."
        Invoke-FsNative -FilePath 'docker' -ArgumentList @('exec', $toolbox, 'sh', '-c', "find '/volumes/$volume' -mindepth 1 -delete && tar -xzf '/tmp/$archive' -C '/volumes/$volume'") `
            -FailMessage "Das Volume $volume liess sich nicht wiederherstellen."
    }
    Stop-FsToolbox $toolbox
    $toolbox = $null

    # --- start ----------------------------------------------------------------------------------------------------

    Write-FsStep 'Stack starten'
    Start-FsStackAndWait
    $warnOnExit = $false
    Invoke-FsCompose -Arguments @('ps')
    Write-FsStep "Wiederherstellung abgeschlossen aus $sourceDir"
}
catch
{
    Write-Host "Fehler: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
finally
{
    Stop-FsToolbox $toolbox
    if ($dumpCopied) { Get-FsComposeOutput -Arguments @('exec', '-T', 'postgres', 'rm', '-f', '/tmp/flowstudio-restore.dump') | Out-Null }
    if ($warnOnExit)
    {
        Write-FsWarn 'Die Wiederherstellung wurde nicht abgeschlossen; api und caddy sind evtl. gestoppt.'
        Write-FsWarn 'Ausgabe oben prüfen. Der vorherige Stand liegt in backups/…_vor-restore; Start: docker compose up -d'
    }
}
