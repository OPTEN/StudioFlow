<#
.SYNOPSIS
    FlowStudio sichern: Datenbank (pg_dump) und die Volumes media, keys und caddy_data.

.DESCRIPTION
    Gleiches Verhalten wie backup.sh. Ergebnis: <basis>/YYYY-MM-DD_HHMM[_label]/ mit database.dump, media.tar.gz,
    keys.tar.gz, caddy_data.tar.gz, backup-info.txt und SHA256SUMS. Die .env ist nicht dabei (Secrets): sie gehört
    in den Passwort-Tresor. Die Sicherung enthält private Schlüssel (Login, Zertifikate) – Ordner geschützt
    aufbewahren. Der Stack muss laufen (mindestens postgres); eine laufende Sendung wird nicht gestört.

.PARAMETER Dir
    Basisordner der Sicherungen (Standard: ./backups).
.PARAMETER Keep
    Nur die neusten N Sicherungen im Basisordner behalten, ältere löschen.
.PARAMETER Label
    Zusatz zum Ordnernamen, z. B. vor-update (Buchstaben, Ziffern, -).

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
Import-Module (Join-Path $PSScriptRoot 'infra/scripts/FlowStudio.psm1') -Force
Initialize-FlowStudio -Root $PSScriptRoot

$target = $null
$completed = $false
$toolbox = $null
try
{
    if ($UnknownArguments)
    {
        if ($UnknownArguments | Where-Object { $_ -in @('--help', '-help', '/?') }) { $Help = $true }
        else { throw "Unbekannte Option: $($UnknownArguments -join ' ') (siehe Get-Help ./backup.ps1 -Full)." }
    }
    if ($Help)
    {
        Get-Help $PSCommandPath -Full
        exit 0
    }
    if ($PSBoundParameters.ContainsKey('Keep') -and $Keep -lt 1) { throw '-Keep erwartet eine Zahl ab 1.' }
    if ($Label -and $Label -notmatch '^[A-Za-z0-9-]{1,40}$') { throw '-Label erlaubt nur Buchstaben, Ziffern und - (max. 40).' }

    Assert-FsDocker
    Assert-FsEnvFile
    if (-not (Test-FsServiceRunning 'postgres')) { throw 'PostgreSQL läuft nicht. Zuerst den Stack starten: docker compose up -d' }

    # --- target folder (private: it holds login keys, certificates and the CA key) -------------------------------

    if (-not $Dir) { $Dir = Join-Path (Get-FsRoot) 'backups' }
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
    Protect-FsPath -Path $target -Directory

    Write-FsStep "Sicherung nach $target"

    # --- database ---------------------------------------------------------------------------------------------------

    Write-FsInfo 'Datenbank (pg_dump) …'
    Invoke-FsCompose -Arguments @('exec', '-T', 'postgres', 'pg_dump', '-U', 'flowstudio', '-d', 'flowstudio', '-Fc', '-f', '/tmp/flowstudio-backup.dump') `
        -FailMessage 'pg_dump ist fehlgeschlagen.'
    Invoke-FsCompose -Arguments @('cp', 'postgres:/tmp/flowstudio-backup.dump', (Join-Path $target $DbDumpName)) -Quiet `
        -FailMessage 'Die Datenbanksicherung konnte nicht kopiert werden.'
    $postgresVersion = (Get-FsComposeOutput -Arguments @('exec', '-T', 'postgres', 'psql', '-U', 'flowstudio', '-d', 'flowstudio', '-tAc', 'SHOW server_version')).Lines |
        Where-Object { $_ } | Select-Object -First 1
    $postgresId = (Get-FsComposeOutput -Arguments @('ps', '-q', 'postgres')).Lines | Select-Object -First 1
    $project = if ($postgresId) { & docker inspect -f '{{ index .Config.Labels "com.docker.compose.project" }}' $postgresId 2> $null } else { $null }

    # --- volumes ----------------------------------------------------------------------------------------------------

    $toolbox = Start-FsToolbox
    foreach ($volume in $BackupVolumes)
    {
        Write-FsInfo "Volume $volume …"
        Invoke-FsNative -FilePath 'docker' -ArgumentList @('exec', $toolbox, 'tar', '-czf', "/tmp/$volume.tar.gz", '-C', "/volumes/$volume", '.') `
            -FailMessage "Das Archiv für $volume konnte nicht erstellt werden."
        Invoke-FsNative -FilePath 'docker' -ArgumentList @('cp', "${toolbox}:/tmp/$volume.tar.gz", (Join-Path $target "$volume.tar.gz")) -Quiet `
            -FailMessage "Das Archiv für $volume konnte nicht kopiert werden."
    }

    # --- description and checksums ----------------------------------------------------------------------------------

    $archives = @($BackupVolumes | ForEach-Object { "$_.tar.gz" })
    $git = if (Get-Command git -ErrorAction SilentlyContinue) { & git -C (Get-FsRoot) rev-parse --short HEAD 2> $null } else { $null }
    if ($LASTEXITCODE -ne 0) { $git = $null }
    $info = @(
        'FlowStudio-Sicherung'
        "erstellt:  $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz')"
        "rechner:   $([Environment]::MachineName)"
        "projekt:   $(if ($project) { $project } else { 'unbekannt' })"
        "git:       $(if ($git) { $git } else { 'unbekannt' })"
        "postgres:  $(if ($postgresVersion) { $postgresVersion } else { 'unbekannt' })"
        "inhalt:    $DbDumpName $($archives -join ' ') "
    )
    $utf8 = [Text.UTF8Encoding]::new($false)
    [IO.File]::WriteAllText((Join-Path $target $BackupInfoName), ($info -join "`n") + "`n", $utf8)

    $sums = foreach ($file in @($DbDumpName) + $archives + @($BackupInfoName))
    {
        "$(Get-FsSha256 (Join-Path $target $file))  $file"
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
            Write-FsInfo "Alte Sicherung entfernt: $($backups[$i].Name)"
        }
    }

    $bytes = (Get-ChildItem -LiteralPath $target -File | Measure-Object Length -Sum).Sum
    $size = if ($bytes -ge 1GB) { '{0:N1} GB' -f ($bytes / 1GB) } elseif ($bytes -ge 1MB) { '{0:N1} MB' -f ($bytes / 1MB) } else { '{0:N0} KB' -f [math]::Ceiling($bytes / 1KB) }
    Write-FsStep "Sicherung fertig: $target ($size)"
    Write-FsInfo "Wiederherstellen mit: ./restore.ps1 `"$target`""
}
catch
{
    Write-Host "Fehler: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
finally
{
    Stop-FsToolbox $toolbox
    if ($target) { Get-FsComposeOutput -Arguments @('exec', '-T', 'postgres', 'rm', '-f', '/tmp/flowstudio-backup.dump') | Out-Null }
    if ($target -and -not $completed -and (Test-Path -LiteralPath $target))
    {
        Remove-Item -LiteralPath $target -Recurse -Force
        Write-FsWarn 'Die unvollständige Sicherung wurde entfernt.'
    }
}
