<#
.SYNOPSIS
    Restore StudioFlow: replaces database, media, login keys and certificates with a backup.

.DESCRIPTION
    Same behaviour as restore.sh. Sequence: verify checksums -> back up the current state
    (backups/..._pre-restore) -> stop api and caddy -> restore the database into a new database and swap it in
    only afterwards -> replace volumes -> start the stack and wait until all services are healthy.
    Blocked during a broadcast.

    Backups of the backup service have no media.tar.gz: the media come from the folder media/ next to the backup
    folder (the incremental copy), if it exists.

.PARAMETER BackupDir
    Backup folder, e.g. backups/2026-10-22_1430.
.PARAMETER Verify
    Only check the backup: verify the checksums and load the dump into a throwaway database. Nothing is replaced
    and nothing is stopped.
.PARAMETER Yes
    No confirmation prompt.
.PARAMETER NoSafetyBackup
    Do not back up the current state first.
.PARAMETER Force
    Even if a broadcast is live or the broadcast status is unknown.

.EXAMPLE
    ./restore.ps1 backups/2026-10-22_1430
.EXAMPLE
    ./restore.ps1 backups/2026-10-22_1430 -Verify
#>
#Requires -Version 7.4
[CmdletBinding(PositionalBinding = $false)]
param(
    [Parameter(Position = 0)][string] $BackupDir,
    [switch] $Verify,
    [switch] $Yes,
    [switch] $NoSafetyBackup,
    [switch] $Force,
    [Alias('h')][switch] $Help,
    [Parameter(ValueFromRemainingArguments)][string[]] $UnknownArguments
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Set-StrictMode -Version 3.0
Import-Module (Join-Path $PSScriptRoot 'infra/scripts/StudioFlow.psm1') -Force
Initialize-StudioFlow -Root $PSScriptRoot

function Invoke-PsqlAdmin([string[]] $Commands, [switch] $SingleTransaction, [string] $FailMessage)
{
    $arguments = @('exec', '-T', 'postgres', 'psql', '-U', 'studioflow', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q')
    if ($SingleTransaction) { $arguments += '-1' }
    foreach ($command in $Commands) { $arguments += @('-c', $command) }
    Invoke-SfCompose -Arguments $arguments -Quiet -FailMessage $FailMessage
}

$toolbox = $null
$warnOnExit = $false
$dumpCopied = $false
$verifyStarted = $false
try
{
    if ($UnknownArguments)
    {
        if ($UnknownArguments | Where-Object { $_ -in @('--help', '-help', '/?') }) { $Help = $true }
        else { throw "Unknown option: $($UnknownArguments -join ' ') (see Get-Help ./restore.ps1 -Full)." }
    }
    if ($Help)
    {
        Get-Help $PSCommandPath -Full
        exit 0
    }
    if (-not $BackupDir) { throw 'Backup folder missing. Usage: ./restore.ps1 backups/YYYY-MM-DD_HHMM' }
    if (-not (Test-Path -LiteralPath $BackupDir -PathType Container)) { throw "Folder not found: $BackupDir" }
    $sourceDir = (Resolve-Path -LiteralPath $BackupDir).Path

    Assert-SfDocker
    Assert-SfEnvFile

    # --- check the backup -----------------------------------------------------------------------------------------

    $checksumFile = Join-Path $sourceDir $ChecksumsName
    if (-not (Test-Path -LiteralPath $checksumFile -PathType Leaf)) { throw "$ChecksumsName is missing in $sourceDir - not a complete StudioFlow backup." }
    if (-not (Test-Path -LiteralPath (Join-Path $sourceDir $DbDumpName) -PathType Leaf)) { throw "$DbDumpName is missing in $sourceDir." }

    Write-SfInfo 'Verifying checksums ...'
    foreach ($line in [IO.File]::ReadAllLines($checksumFile))
    {
        if (-not $line.Trim()) { continue }
        if ($line -notmatch '^([0-9a-f]{64})\s+\*?(.+)$') { throw "Invalid entry in ${ChecksumsName}: $line" }
        $expected = $Matches[1]
        $file = $Matches[2].Trim()
        if ($file -match '[\\/]' -or $file.StartsWith('..')) { throw "Invalid entry in ${ChecksumsName}: $file" }
        $path = Join-Path $sourceDir $file
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "File listed in $ChecksumsName is missing: $file" }
        if ((Get-SfSha256 $path) -ne $expected) { throw "Checksum mismatch: $file (the backup is damaged)." }
    }
    Write-SfInfo 'Checksums OK.'
    $infoFile = Join-Path $sourceDir $BackupInfoName
    if (Test-Path -LiteralPath $infoFile) { Get-Content -LiteralPath $infoFile | ForEach-Object { Write-SfInfo "  $_" } }

    # --- -Verify: load the dump into a throwaway database ----------------------------------------------------------

    if ($Verify)
    {
        Write-SfStep "Load the dump into a throwaway database ($VerifyDbName)"
        Start-SfStackAndWait -ExtraArguments @('postgres')
        $verifyStarted = $true
        Invoke-SfCompose -Arguments @('cp', (Join-Path $sourceDir $DbDumpName), 'postgres:/tmp/studioflow-verify.dump') -Quiet
        Invoke-PsqlAdmin -Commands @("DROP DATABASE IF EXISTS $VerifyDbName", "CREATE DATABASE $VerifyDbName OWNER studioflow") `
            -FailMessage 'The throwaway database could not be created.'
        Invoke-SfCompose -Arguments @('exec', '-T', 'postgres', 'pg_restore', '-U', 'studioflow', '-d', $VerifyDbName,
            '--no-owner', '--no-privileges', '--exit-on-error', '/tmp/studioflow-verify.dump') `
            -FailMessage 'The dump could not be loaded (pg_restore failed). This backup cannot be restored.'
        $report = (Get-SfComposeOutput -Arguments @('exec', '-T', 'postgres', 'psql', '-U', 'studioflow', '-d', $VerifyDbName, '-tA', '-c', $VerifyQuery)).Lines |
            Where-Object { $_ } | Select-Object -First 1
        if (-not $report) { throw 'The dump was loaded, but the database is empty. This backup cannot be restored.' }
        Write-SfInfo "Dump loaded: $report"
        Write-SfStep "Backup verified: $sourceDir"
        exit 0
    }

    Assert-SfBroadcastIdle -Action 'The restore' -Force $Force.IsPresent

    if (-not $Yes)
    {
        Write-SfWarn 'Database, media, login keys and certificates will be replaced by the backup.'
        if (-not (Read-SfConfirm "Restore from $(Split-Path -Leaf $sourceDir)?" 'n')) { throw 'Aborted, nothing changed.' }
    }

    # --- safety backup of the current state ----------------------------------------------------------------------

    Write-SfStep 'Start PostgreSQL'
    Start-SfStackAndWait -ExtraArguments @('postgres')

    if (-not $NoSafetyBackup)
    {
        Write-SfStep 'Back up the current state'
        & pwsh -NoProfile -File (Join-Path (Get-SfRoot) 'backup.ps1') -Label 'pre-restore'
        if ($LASTEXITCODE -ne 0) { throw 'The safety backup of the current state failed; nothing was changed (use -NoSafetyBackup to skip it).' }
    }

    # --- database: restore into a new database, then swap (the old one stays intact if anything fails) -----------

    $warnOnExit = $true
    Write-SfStep 'Stop API and Caddy'
    Invoke-SfCompose -Arguments @('stop', 'api', 'caddy')

    Write-SfStep 'Restore the database'
    Invoke-SfCompose -Arguments @('cp', (Join-Path $sourceDir $DbDumpName), 'postgres:/tmp/studioflow-restore.dump') -Quiet
    $dumpCopied = $true
    Invoke-PsqlAdmin -Commands @('DROP DATABASE IF EXISTS studioflow_restore', 'CREATE DATABASE studioflow_restore OWNER studioflow') `
        -FailMessage 'The helper database studioflow_restore could not be created.'
    try
    {
        Invoke-SfCompose -Arguments @('exec', '-T', 'postgres', 'pg_restore', '-U', 'studioflow', '-d', 'studioflow_restore',
            '--no-owner', '--no-privileges', '--exit-on-error', '/tmp/studioflow-restore.dump')
    }
    catch
    {
        Get-SfComposeOutput -Arguments @('exec', '-T', 'postgres', 'psql', '-U', 'studioflow', '-d', 'postgres', '-c', 'DROP DATABASE IF EXISTS studioflow_restore') | Out-Null
        Get-SfComposeOutput -Arguments @('up', '-d') | Out-Null
        $warnOnExit = $false
        throw 'pg_restore failed. The previous database is unchanged; the stack was started again.'
    }
    Invoke-PsqlAdmin -Commands @(
        "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'studioflow' AND pid <> pg_backend_pid()",
        'DROP DATABASE IF EXISTS studioflow_replaced') -FailMessage 'The connections to the database could not be closed.'
    Invoke-PsqlAdmin -SingleTransaction -Commands @(
        'ALTER DATABASE studioflow RENAME TO studioflow_replaced',
        'ALTER DATABASE studioflow_restore RENAME TO studioflow') -FailMessage 'Swapping the database failed.'
    Invoke-PsqlAdmin -Commands @('DROP DATABASE studioflow_replaced') -FailMessage 'The replaced database could not be removed.'
    Write-SfInfo 'Database replaced.'

    # --- volumes ----------------------------------------------------------------------------------------------------

    # The backup service keeps the media as an incremental copy next to the dated folders instead of a media.tar.gz.
    $mediaCopy = Join-Path (Split-Path -Parent $sourceDir) 'media'
    $useMediaCopy = (-not (Test-Path -LiteralPath (Join-Path $sourceDir 'media.tar.gz') -PathType Leaf)) -and (Test-Path -LiteralPath $mediaCopy -PathType Container)

    Write-SfStep 'Restore the volumes'
    $toolbox = Start-SfToolbox -RunArguments $(if ($useMediaCopy) { @('-v', "${mediaCopy}:/restore-media:ro") } else { @() })
    foreach ($volume in $BackupVolumes)
    {
        $archive = "$volume.tar.gz"
        $archivePath = Join-Path $sourceDir $archive
        if (-not (Test-Path -LiteralPath $archivePath -PathType Leaf))
        {
            if ($volume -eq 'media' -and $useMediaCopy)
            {
                Write-SfInfo "Volume media from the incremental copy $mediaCopy ..."
                # The copy keeps the owner of the files; the API user owns the keys volume, so the media get the same owner.
                Invoke-SfNative -FilePath 'docker' -ArgumentList @('exec', $toolbox, 'sh', '-c', "find /volumes/media -mindepth 1 -delete && cp -a /restore-media/. /volumes/media/ && chown -R `"`$(stat -c '%u:%g' /volumes/keys)`" /volumes/media") `
                    -FailMessage 'The volume media could not be restored from the incremental copy.'
                continue
            }
            Write-SfWarn "$archive is missing in the backup; volume $volume is left unchanged."
            continue
        }
        Write-SfInfo "Volume $volume ..."
        Invoke-SfNative -FilePath 'docker' -ArgumentList @('cp', $archivePath, "${toolbox}:/tmp/$archive") -Quiet `
            -FailMessage "The archive $archive could not be copied."
        Invoke-SfNative -FilePath 'docker' -ArgumentList @('exec', $toolbox, 'sh', '-c', "find '/volumes/$volume' -mindepth 1 -delete && tar -xzf '/tmp/$archive' -C '/volumes/$volume'") `
            -FailMessage "The volume $volume could not be restored."
    }
    Stop-SfToolbox $toolbox
    $toolbox = $null

    # --- start ----------------------------------------------------------------------------------------------------

    Write-SfStep 'Start the stack'
    Start-SfStackAndWait
    $warnOnExit = $false
    Invoke-SfCompose -Arguments @('ps')
    Write-SfStep "Restore complete from $sourceDir"
}
catch
{
    Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
finally
{
    Stop-SfToolbox $toolbox
    if ($verifyStarted)
    {
        Get-SfComposeOutput -Arguments @('exec', '-T', 'postgres', 'psql', '-U', 'studioflow', '-d', 'postgres', '-c', "DROP DATABASE IF EXISTS $VerifyDbName") | Out-Null
        Get-SfComposeOutput -Arguments @('exec', '-T', 'postgres', 'rm', '-f', '/tmp/studioflow-verify.dump') | Out-Null
    }
    if ($dumpCopied) { Get-SfComposeOutput -Arguments @('exec', '-T', 'postgres', 'rm', '-f', '/tmp/studioflow-restore.dump') | Out-Null }
    if ($warnOnExit)
    {
        Write-SfWarn 'The restore did not complete; api and caddy may be stopped.'
        Write-SfWarn 'Check the output above. The previous state is in backups/..._pre-restore; start with: docker compose up -d'
    }
}
