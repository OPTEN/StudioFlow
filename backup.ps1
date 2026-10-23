<#
.SYNOPSIS
    Back up StudioFlow: database (pg_dump) and the volumes media, keys and caddy_data.

.DESCRIPTION
    Same behaviour as backup.sh. Result: <base>/YYYY-MM-DD_HHMM[_label]/ with database.dump, media.tar.gz,
    keys.tar.gz, caddy_data.tar.gz, backup-info.txt and SHA256SUMS. The .env is not included (secrets): keep it
    in the password vault. The backup contains private keys (login, certificates) - store the folder protected.
    The stack must be running (at least postgres); a running broadcast is not disturbed.

.PARAMETER Dir
    Base folder of the backups (default: ./backups).
.PARAMETER Keep
    Keep only the newest N backups in the base folder, delete older ones.
.PARAMETER Label
    Suffix for the folder name, e.g. pre-update (letters, digits, -).

.EXAMPLE
    ./backup.ps1
.EXAMPLE
    ./backup.ps1 -Keep 10
#>
#Requires -Version 7.4
[CmdletBinding(PositionalBinding = $false)]
param(
    [string] $Dir,
    [int] $Keep = 0,
    [string] $Label = '',
    [Alias('h')][switch] $Help,
    [Parameter(ValueFromRemainingArguments)][string[]] $UnknownArguments
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Set-StrictMode -Version 3.0
Import-Module (Join-Path $PSScriptRoot 'infra/scripts/StudioFlow.psm1') -Force
Initialize-StudioFlow -Root $PSScriptRoot

$target = $null
$completed = $false
$toolbox = $null
try
{
    if ($UnknownArguments)
    {
        if ($UnknownArguments | Where-Object { $_ -in @('--help', '-help', '/?') }) { $Help = $true }
        else { throw "Unknown option: $($UnknownArguments -join ' ') (see Get-Help ./backup.ps1 -Full)." }
    }
    if ($Help)
    {
        Get-Help $PSCommandPath -Full
        exit 0
    }
    if ($PSBoundParameters.ContainsKey('Keep') -and $Keep -lt 1) { throw '-Keep expects a number of 1 or more.' }
    if ($Label -and $Label -notmatch '^[A-Za-z0-9-]{1,40}$') { throw '-Label allows only letters, digits and - (max. 40).' }

    Assert-SfDocker
    Assert-SfEnvFile
    if (-not (Test-SfServiceRunning 'postgres')) { throw 'PostgreSQL is not running. Start the stack first: docker compose up -d' }

    # --- target folder (private: it holds login keys, certificates and the CA key) -------------------------------

    if (-not $Dir) { $Dir = Join-Path (Get-SfRoot) 'backups' }
    $baseDir = (New-Item -ItemType Directory -Path $Dir -Force).FullName
    $name = (Get-Date -Format 'yyyy-MM-dd_HHmm') + $(if ($Label) { "_$Label" } else { '' })
    $target = Join-Path $baseDir $name
    $suffix = 2
    while (Test-Path -LiteralPath $target)
    {
        $target = Join-Path $baseDir "$name-$suffix"
        $suffix++
    }
    New-Item -ItemType Directory -Path $target | Out-Null
    Protect-SfPath -Path $target -Directory

    Write-SfStep "Backing up to $target"

    # --- database ---------------------------------------------------------------------------------------------------

    Write-SfInfo 'Database (pg_dump) ...'
    Invoke-SfCompose -Arguments @('exec', '-T', 'postgres', 'pg_dump', '-U', 'studioflow', '-d', 'studioflow', '-Fc', '-f', '/tmp/studioflow-backup.dump') `
        -FailMessage 'pg_dump failed.'
    Invoke-SfCompose -Arguments @('cp', 'postgres:/tmp/studioflow-backup.dump', (Join-Path $target $DbDumpName)) -Quiet `
        -FailMessage 'The database dump could not be copied.'
    $postgresVersion = (Get-SfComposeOutput -Arguments @('exec', '-T', 'postgres', 'psql', '-U', 'studioflow', '-d', 'studioflow', '-tAc', 'SHOW server_version')).Lines |
        Where-Object { $_ } | Select-Object -First 1
    $postgresId = (Get-SfComposeOutput -Arguments @('ps', '-q', 'postgres')).Lines | Select-Object -First 1
    $project = if ($postgresId) { & docker inspect -f '{{ index .Config.Labels "com.docker.compose.project" }}' $postgresId 2> $null } else { $null }
    # Which release the data belongs to: a rollback after an update needs the backup of the version it goes back to.
    $version = Get-SfRunningVersion

    # --- volumes ----------------------------------------------------------------------------------------------------

    $toolbox = Start-SfToolbox
    foreach ($volume in $BackupVolumes)
    {
        Write-SfInfo "Volume $volume ..."
        Invoke-SfNative -FilePath 'docker' -ArgumentList @('exec', $toolbox, 'tar', '-czf', "/tmp/$volume.tar.gz", '-C', "/volumes/$volume", '.') `
            -FailMessage "The archive for $volume could not be created."
        Invoke-SfNative -FilePath 'docker' -ArgumentList @('cp', "${toolbox}:/tmp/$volume.tar.gz", (Join-Path $target "$volume.tar.gz")) -Quiet `
            -FailMessage "The archive for $volume could not be copied."
    }

    # --- description and checksums ----------------------------------------------------------------------------------

    $archives = @($BackupVolumes | ForEach-Object { "$_.tar.gz" })
    $git = if (Get-Command git -ErrorAction SilentlyContinue) { & git -C (Get-SfRoot) rev-parse --short HEAD 2> $null } else { $null }
    if ($LASTEXITCODE -ne 0) { $git = $null }
    $info = @(
        'StudioFlow backup'
        "created:   $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz')"
        "host:      $([Environment]::MachineName)"
        "project:   $(if ($project) { $project } else { 'unknown' })"
        "version:   $(if ($version) { $version } else { 'unknown' })"
        "git:       $(if ($git) { $git } else { 'unknown' })"
        "postgres:  $(if ($postgresVersion) { $postgresVersion } else { 'unknown' })"
        "contents:  $DbDumpName $($archives -join ' ') "
    )
    $utf8 = [Text.UTF8Encoding]::new($false)
    [IO.File]::WriteAllText((Join-Path $target $BackupInfoName), ($info -join "`n") + "`n", $utf8)

    $sums = foreach ($file in @($DbDumpName) + $archives + @($BackupInfoName))
    {
        "$(Get-SfSha256 (Join-Path $target $file))  $file"
    }
    [IO.File]::WriteAllText((Join-Path $target $ChecksumsName), ($sums -join "`n") + "`n", $utf8)
    $completed = $true

    # --- retention ----------------------------------------------------------------------------------------------------

    if ($Keep -gt 0)
    {
        # Only folders written by this script (date-named, with a checksum file), newest first by the time the
        # checksum file was written: names have minute resolution and labels, so they do not sort reliably.
        $backups = @(Get-ChildItem -LiteralPath $baseDir -Directory |
            Where-Object { $_.Name -match '^\d{4}-\d{2}-\d{2}_\d{4}' -and (Test-Path -LiteralPath (Join-Path $_.FullName $ChecksumsName)) } |
            Sort-Object { (Get-Item -LiteralPath (Join-Path $_.FullName $ChecksumsName)).LastWriteTimeUtc } -Descending)
        for ($i = $Keep; $i -lt $backups.Count; $i++)
        {
            if ($backups[$i].FullName -eq $target) { continue }
            Remove-Item -LiteralPath $backups[$i].FullName -Recurse -Force
            Write-SfInfo "Old backup removed: $($backups[$i].Name)"
        }
    }

    $bytes = (Get-ChildItem -LiteralPath $target -File | Measure-Object Length -Sum).Sum
    $size = if ($bytes -ge 1GB) { '{0:N1} GB' -f ($bytes / 1GB) } elseif ($bytes -ge 1MB) { '{0:N1} MB' -f ($bytes / 1MB) } else { '{0:N0} KB' -f [math]::Ceiling($bytes / 1KB) }
    Write-SfStep "Backup complete: $target ($size)"
    Write-SfInfo "Restore with: ./restore.ps1 `"$target`""
}
catch
{
    Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
finally
{
    Stop-SfToolbox $toolbox
    if ($target) { Get-SfComposeOutput -Arguments @('exec', '-T', 'postgres', 'rm', '-f', '/tmp/studioflow-backup.dump') | Out-Null }
    if ($target -and -not $completed -and (Test-Path -LiteralPath $target))
    {
        Remove-Item -LiteralPath $target -Recurse -Force
        Write-SfWarn 'The incomplete backup was removed.'
    }
}
