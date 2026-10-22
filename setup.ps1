<#
.SYNOPSIS
    FlowStudio einrichten: schreibt die .env mit zufälligen Secrets und dem Hash des Admin-Passworts.

.DESCRIPTION
    Gleiches Verhalten wie setup.sh. Fragt Domain, LAN-IPv4 (automatisch erkannt), TLS-Modus (+ E-Mail und
    Zugangsdaten des DNS-Anbieters), weitere Adressen, frame-ancestors und das Admin-Konto ab und erzeugt
    LiveKit-Schlüssel und Datenbank-Passwort. Den Passwort-Hash erzeugt das API-Image («hash-password»).
    Eine bestehende .env wird nur mit -Force ersetzt (Kopie .env.backup-<zeit>; Secrets werden übernommen).

    Zugangsdaten der DNS-Anbieter (dns-*) kommen aus der Umgebung, aus der bestehenden .env oder werden verdeckt
    abgefragt: CF_API_TOKEN, INFOMANIAK_API_TOKEN, HETZNER_API_TOKEN, DESEC_TOKEN, GANDI_BEARER_TOKEN,
    AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY + AWS_REGION, OVH_ENDPOINT + OVH_APPLICATION_KEY +
    OVH_APPLICATION_SECRET + OVH_CONSUMER_KEY.

    Danach: docker compose up -d --build (Details: docs/runbook.md).

.PARAMETER Domain
    Hostname der Regie, z. B. flowstudio.opten.ch (Test: localhost).
.PARAMETER NodeIp
    LAN-IPv4 des Servers für die Medien (Standard: automatisch erkannt).
.PARAMETER TlsMode
    internal | acme | custom | dns-cloudflare | dns-infomaniak | dns-hetzner | dns-desec | dns-route53 | dns-gandi | dns-ovh
.PARAMETER AcmeEmail
    E-Mail für Let's Encrypt (acme, dns-*).
.PARAMETER DnsChallengeDomain
    CNAME-Ziel, wenn _acme-challenge delegiert ist (dns-*; z. B. für Hostpoint, cyon).
.PARAMETER ExtraHosts
    Weitere Adressen derselben Site, mit Leerzeichen getrennt, z. B. die IP (nur internal).
.PARAMETER FrameAncestors
    Origins, die den Output einbetten dürfen, mit Leerzeichen getrennt ('self' ist immer erlaubt).
.PARAMETER AdminUser
    Benutzername des Admin-Kontos (Standard: admin).
.PARAMETER AdminPasswordStdin
    Admin-Passwort von der Standardeingabe lesen (eine Zeile; nur mit -NonInteractive).
.PARAMETER GeneratePassword
    Starkes Admin-Passwort erzeugen und einmal anzeigen.
.PARAMETER PlainPassword
    Passwort im Klartext speichern statt als Hash (nur lokale Entwicklung).
.PARAMETER EnvFile
    Ziel statt ./.env.
.PARAMETER NonInteractive
    Nichts fragen; fehlende Pflichtwerte sind ein Fehler.
.PARAMETER Force
    Bestehende .env ersetzen.

.EXAMPLE
    ./setup.ps1
.EXAMPLE
    ./setup.ps1 -NonInteractive -Domain flowstudio.opten.ch -TlsMode dns-cloudflare -GeneratePassword
.EXAMPLE
    $passwort | pwsh -NoProfile -File ./setup.ps1 -NonInteractive -Domain localhost -NodeIp 127.0.0.1 -TlsMode internal -AdminPasswordStdin
#>
#Requires -Version 7.4
[CmdletBinding(PositionalBinding = $false)]
param(
    [string] $Domain,
    [string] $NodeIp,
    [string] $TlsMode,
    [string] $AcmeEmail,
    [string] $DnsChallengeDomain,
    [string] $ExtraHosts,
    [string] $FrameAncestors,
    [string] $AdminUser,
    [switch] $AdminPasswordStdin,
    [switch] $GeneratePassword,
    [switch] $PlainPassword,
    [string] $EnvFile,
    [switch] $NonInteractive,
    [switch] $Force,
    [Alias('h')][switch] $Help,
    [Parameter(ValueFromRemainingArguments)][string[]] $UnknownArguments
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Set-StrictMode -Version 3.0
Import-Module (Join-Path $PSScriptRoot 'infra/scripts/FlowStudio.psm1') -Force
Initialize-FlowStudio -Root $PSScriptRoot

$TlsModes = @('internal', 'acme', 'custom', 'dns-cloudflare', 'dns-infomaniak', 'dns-hetzner', 'dns-desec', 'dns-route53', 'dns-gandi', 'dns-ovh')
$MinPasswordLength = 12
$GeneratedPasswordLength = 24
$InternalHstsMaxAge = '3600'
$Alphanumeric = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'

# --- validation -----------------------------------------------------------------------------------------------------

function Test-Ipv4([string] $Value)
{
    if ($Value -notmatch '^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$') { return $false }
    @($Matches[1..4] | Where-Object { [int]$_ -gt 255 }).Count -eq 0
}
function Test-Hostname([string] $Value)
{
    $label = '[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?'
    $Value.Length -le 253 -and $Value -cmatch "^$label(\.$label)*$"
}
function Test-Host([string] $Value) { (Test-Ipv4 $Value) -or (Test-Hostname $Value) }
function Test-Email([string] $Value) { $Value -match '^[^\s@''"]+@[^\s@''"]+\.[^\s@''"]+$' }
function Test-FrameAncestor([string] $Value) { $Value -match '^(https?://)?(\*\.)?[A-Za-z0-9.-]+(:(\d{1,5}|\*))?$|^https?:$' }
function Test-AdminUser([string] $Value) { $Value -match '^[A-Za-z0-9._@-]{1,64}$' }
function Test-LiveKitSecret([string] $Value) { $Value -cmatch '^[A-Za-z][A-Za-z0-9]{31,}$' }
function Test-PasswordHash([string] $Value) { $Value -cmatch '^AQAAAA[A-Za-z0-9+/]{20,}={0,2}$' }

# --- helpers ----------------------------------------------------------------------------------------------------

function New-RandomHex([int] $Bytes)
{
    [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes($Bytes)).ToLowerInvariant()
}
function New-RandomAlphanumeric([int] $Length)
{
    -join (1..$Length | ForEach-Object { $Alphanumeric[[Security.Cryptography.RandomNumberGenerator]::GetInt32($Alphanumeric.Length)] })
}

# Primary LAN IPv4: the source address the routing table picks for an outside address (no packet is sent).
function Get-NodeIp
{
    $socket = [Net.Sockets.Socket]::new([Net.Sockets.AddressFamily]::InterNetwork, [Net.Sockets.SocketType]::Dgram, [Net.Sockets.ProtocolType]::Udp)
    try
    {
        $socket.Connect('192.0.2.1', 9)
        $ip = $socket.LocalEndPoint.Address.ToString()
        if (Test-Ipv4 $ip) { $ip } else { '' }
    }
    catch { '' }
    finally { $socket.Dispose() }
}

# Values of an existing .env (quotes removed).
function Read-EnvFile([string] $Path)
{
    $values = @{}
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $values }
    foreach ($line in [IO.File]::ReadAllLines($Path))
    {
        if ($line -match '^\s*#' -or $line -notmatch '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$') { continue }
        $key = $Matches[1]
        $value = $Matches[2].TrimEnd("`r")
        if ($value -match "^'(.*)'$" -or $value -match '^"(.*)"$') { $value = $Matches[1] }
        $values[$key] = $value
    }
    $values
}

# KEY=VALUE for .env; values with other characters than [A-Za-z0-9_.,:/@+=-] in single quotes (literal).
function Format-EnvLine([string] $Key, [string] $Value)
{
    if ($Value -match "['`r`n]") { throw "Der Wert für $Key enthält ein Hochkomma oder einen Zeilenumbruch; das ist in .env nicht möglich." }
    if ($Value -cmatch '^[A-Za-z0-9_.,:/@+=-]*$') { "$Key=$Value" } else { "$Key='$Value'" }
}

function Read-Prompt([string] $Question, [string] $Default = '')
{
    $label = if ($Default) { "$Question [$Default]" } else { $Question }
    $answer = Read-Host $label
    if ([string]::IsNullOrEmpty($answer)) { $Default } else { $answer }
}

function Read-SecretPrompt([string] $Question) { Read-Host $Question -MaskInput }

# Collapses whitespace in a space-separated list.
function ConvertTo-WordList([string] $Value) { (@($Value -split '\s+' | Where-Object { $_ })) -join ' ' }

function Get-ProviderVariable([string] $Mode)
{
    switch ($Mode)
    {
        'dns-cloudflare' { @('CF_API_TOKEN') }
        'dns-infomaniak' { @('INFOMANIAK_API_TOKEN') }
        'dns-hetzner' { @('HETZNER_API_TOKEN') }
        'dns-desec' { @('DESEC_TOKEN') }
        'dns-route53' { @('AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_REGION') }
        'dns-gandi' { @('GANDI_BEARER_TOKEN') }
        'dns-ovh' { @('OVH_ENDPOINT', 'OVH_APPLICATION_KEY', 'OVH_APPLICATION_SECRET', 'OVH_CONSUMER_KEY') }
        default { @() }
    }
}

function Test-SecretVariable([string] $Name) { $Name -notin @('AWS_REGION', 'OVH_ENDPOINT') }

# Hashes the password with the API image: `hash-password` reads it from stdin (sent without a newline) and prints
# the ASP.NET Identity v3 hash. Returns the hash, or $null after showing the end of the error output.
function Get-PasswordHash
{
    # The password comes from Read-Host / stdin as a string and goes to the process stdin; SecureString would not
    # protect it on Linux and is not recommended for new code.
    [Diagnostics.CodeAnalysis.SuppressMessageAttribute('PSAvoidUsingPlainTextForPassword', 'Password')]
    param([string] $EnvPath, [string] $Password)

    Write-FsInfo 'API-Image wird gebaut (für den Passwort-Hash) …'
    $build = Get-FsComposeOutput -Arguments @('--env-file', $EnvPath, 'build', '--quiet', 'api')
    if ($build.ExitCode -ne 0)
    {
        Write-FsWarn 'Das API-Image liess sich nicht bauen.'
        return $null
    }

    $startInfo = [Diagnostics.ProcessStartInfo]::new('docker')
    foreach ($argument in @('compose', '--env-file', $EnvPath, 'run', '--rm', '--no-deps', '-T', '--entrypoint', 'dotnet', 'api', 'Opten.FlowStudio.Web.dll', 'hash-password'))
    {
        $startInfo.ArgumentList.Add($argument)
    }
    $startInfo.WorkingDirectory = Get-FsRoot
    $startInfo.UseShellExecute = $false
    $startInfo.RedirectStandardInput = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $startInfo.StandardInputEncoding = [Text.UTF8Encoding]::new($false)
    $process = [Diagnostics.Process]::Start($startInfo)
    $stderrTask = $process.StandardError.ReadToEndAsync()
    $process.StandardInput.Write($Password)
    $process.StandardInput.Close()
    $stdout = $process.StandardOutput.ReadToEnd()
    $process.WaitForExit()
    $stderr = $stderrTask.GetAwaiter().GetResult()

    $hash = @($stdout -split "`n" | ForEach-Object { $_.Trim() } | Where-Object { $_ }) | Select-Object -Last 1
    if ($process.ExitCode -eq 0 -and $hash -and (Test-PasswordHash $hash)) { return $hash }
    $stderr -split "`n" | Where-Object { $_.Trim() -and $_ -notmatch 'View build details' } | Select-Object -Last 5 | ForEach-Object { Write-Host $_ }
    $null
}

# --- main ---------------------------------------------------------------------------------------------------------

try
{
    if ($UnknownArguments)
    {
        if ($UnknownArguments | Where-Object { $_ -in @('--help', '-help', '/?') }) { $Help = $true }
        else { throw "Unbekannte Option: $($UnknownArguments -join ' ') (siehe Get-Help ./setup.ps1 -Full)." }
    }
    if ($Help)
    {
        Get-Help $PSCommandPath -Full
        exit 0
    }

    $interactive = -not $NonInteractive
    if ($AdminPasswordStdin -and $interactive) { throw '-AdminPasswordStdin geht nur zusammen mit -NonInteractive.' }
    if ($interactive -and ([Console]::IsInputRedirected -or -not [Environment]::UserInteractive))
    {
        throw 'Kein Terminal für Rückfragen. Mit -NonInteractive und den Optionen aufrufen (siehe Get-Help ./setup.ps1 -Full).'
    }

    if (-not $EnvFile) { $EnvFile = Join-Path (Get-FsRoot) '.env' }
    $envDirectory = Split-Path -Parent ([IO.Path]::GetFullPath($EnvFile))
    if (-not (Test-Path -LiteralPath $envDirectory -PathType Container)) { throw "Verzeichnis $envDirectory existiert nicht." }
    $EnvFile = [IO.Path]::GetFullPath($EnvFile)

    if ((Test-Path -LiteralPath $EnvFile) -and -not $Force)
    {
        throw "$EnvFile existiert bereits. Mit -Force ersetzen (eine Kopie bleibt erhalten, Secrets werden übernommen)."
    }
    $existing = Read-EnvFile $EnvFile
    function Get-Existing([string] $Key) { if ($existing.ContainsKey($Key)) { [string]$existing[$Key] } else { '' } }

    Write-FsStep 'FlowStudio einrichten'
    if (Test-Path -LiteralPath $EnvFile) { Write-FsInfo "Bestehende $(Split-Path -Leaf $EnvFile) wird ersetzt; Secrets und Admin-Konto werden übernommen." }

    # Node IP
    $nodeIpValue = $NodeIp
    if (-not $nodeIpValue)
    {
        $detectedIp = Get-NodeIp
        $defaultIp = Get-Existing 'FLOWSTUDIO_NODE_IP'
        if (-not $defaultIp) { $defaultIp = $detectedIp }
        if ($interactive)
        {
            if ($detectedIp) { Write-FsInfo "Erkannte LAN-IPv4 dieses Rechners: $detectedIp" }
            $nodeIpValue = Read-Prompt 'LAN-IPv4 des Servers (Medien für Handys und Laptops)' $defaultIp
        }
        else { $nodeIpValue = $defaultIp }
    }
    if (-not (Test-Ipv4 $nodeIpValue)) { throw "Ungültige oder fehlende LAN-IPv4: «$nodeIpValue» (Option -NodeIp)." }

    # TLS mode
    $tlsModeValue = $TlsMode
    if (-not $tlsModeValue)
    {
        $tlsModeValue = Get-Existing 'FLOWSTUDIO_TLS_MODE'
        if (-not $tlsModeValue) { $tlsModeValue = 'internal' }
        if ($interactive)
        {
            Write-FsInfo 'TLS-Modi: internal (lokale CA, Test) | acme (VPS, öffentlich erreichbar) | custom (eigenes Zertifikat)'
            Write-FsInfo '          dns-cloudflare | dns-infomaniak | dns-hetzner | dns-desec | dns-route53 | dns-gandi | dns-ovh'
            $tlsModeValue = Read-Prompt 'TLS-Modus' $tlsModeValue
        }
    }
    if ($tlsModeValue -cnotin $TlsModes) { throw "Unbekannter TLS-Modus: «$tlsModeValue». Erlaubt: $($TlsModes -join ' ')" }

    # Domain
    $domainValue = $Domain
    if (-not $domainValue)
    {
        $domainValue = Get-Existing 'FLOWSTUDIO_DOMAIN'
        if (-not $domainValue -and $tlsModeValue -eq 'internal') { $domainValue = $nodeIpValue }
        if ($interactive) { $domainValue = Read-Prompt 'Domain der Regie (z. B. flowstudio.opten.ch; im Modus internal auch die IP)' $domainValue }
    }
    $domainValue = "$domainValue".ToLowerInvariant()
    if (-not (Test-Host $domainValue)) { throw "Ungültige oder fehlende Domain: «$domainValue» (Option -Domain)." }
    if ((Test-Ipv4 $domainValue) -and $tlsModeValue -notin @('internal', 'custom'))
    {
        throw "Für eine IP-Adresse gibt es kein Zertifikat per $tlsModeValue. TLS-Modus internal verwenden."
    }

    # ACME e-mail and DNS challenge delegation
    $acmeEmailValue = ''
    $challengeDomainValue = ''
    if ($tlsModeValue -eq 'acme' -or $tlsModeValue -like 'dns-*')
    {
        if ($PSBoundParameters.ContainsKey('AcmeEmail')) { $acmeEmailValue = $AcmeEmail }
        else
        {
            $acmeEmailValue = Get-Existing 'FLOWSTUDIO_ACME_EMAIL'
            if ($interactive) { $acmeEmailValue = Read-Prompt "E-Mail für Let's Encrypt (leer erlaubt)" $acmeEmailValue }
        }
        if ($acmeEmailValue -and -not (Test-Email $acmeEmailValue)) { throw "Ungültige E-Mail: «$acmeEmailValue»." }
    }
    if ($tlsModeValue -like 'dns-*')
    {
        if ($PSBoundParameters.ContainsKey('DnsChallengeDomain')) { $challengeDomainValue = $DnsChallengeDomain }
        else
        {
            $challengeDomainValue = Get-Existing 'FLOWSTUDIO_DNS_CHALLENGE_DOMAIN'
            if ($interactive) { $challengeDomainValue = Read-Prompt '_acme-challenge per CNAME delegiert? Dann das CNAME-Ziel, sonst leer' $challengeDomainValue }
        }
        $challengeDomainValue = "$challengeDomainValue".ToLowerInvariant()
        if ($challengeDomainValue -and -not (Test-Hostname ($challengeDomainValue -replace '^_acme-challenge\.', '')))
        {
            throw "Ungültiges CNAME-Ziel: «$challengeDomainValue»."
        }
    }

    # DNS provider credentials: environment > existing .env > prompt
    $providerLines = [Collections.Generic.List[string]]::new()
    foreach ($variable in Get-ProviderVariable $tlsModeValue)
    {
        $value = [Environment]::GetEnvironmentVariable($variable)
        if (-not $value) { $value = Get-Existing $variable }
        if (-not $value -and $interactive)
        {
            $value = if (Test-SecretVariable $variable) { Read-SecretPrompt "$variable (wird verdeckt eingegeben)" } else { Read-Prompt $variable }
        }
        if (-not $value) { throw "$variable fehlt für den TLS-Modus $tlsModeValue (Umgebungsvariable setzen oder interaktiv eingeben)." }
        $providerLines.Add((Format-EnvLine $variable $value))
    }

    # Extra hosts (internal mode) and the certificate for clients without SNI
    $extraHostsValue = ''
    $defaultSni = ''
    if ($PSBoundParameters.ContainsKey('ExtraHosts')) { $extraHostsValue = $ExtraHosts }
    elseif ($tlsModeValue -eq 'internal')
    {
        $extraHostsValue = Get-Existing 'FLOWSTUDIO_EXTRA_HOSTS'
        if ($interactive -and -not (Test-Ipv4 $domainValue))
        {
            $extraHostsValue = Read-Prompt "Weitere Adressen, z. B. $nodeIpValue für den Zugriff per IP (leer = keine)" $extraHostsValue
        }
    }
    $extraHostsValue = ConvertTo-WordList "$extraHostsValue".ToLowerInvariant()
    foreach ($extraHost in @($extraHostsValue -split ' ' | Where-Object { $_ }))
    {
        if (-not (Test-Host $extraHost)) { throw "Ungültige weitere Adresse: «$extraHost»." }
        if (-not $defaultSni -and (Test-Ipv4 $extraHost)) { $defaultSni = $extraHost }
    }
    if ($extraHostsValue -and $tlsModeValue -ne 'internal')
    {
        Write-FsWarn "Weitere Adressen sind nur im Modus internal sinnvoll; für $tlsModeValue braucht jede ein eigenes Zertifikat."
    }

    # Frame ancestors
    if ($PSBoundParameters.ContainsKey('FrameAncestors')) { $frameAncestorsValue = $FrameAncestors }
    else
    {
        $frameAncestorsValue = Get-Existing 'FLOWSTUDIO_FRAME_ANCESTORS'
        if ($interactive)
        {
            $frameAncestorsValue = Read-Prompt 'Origins, die den Output einbetten dürfen (z. B. https://proxy.example.ch; leer = nur FlowStudio selbst)' $frameAncestorsValue
        }
    }
    $frameAncestorsValue = ConvertTo-WordList $frameAncestorsValue
    foreach ($origin in @($frameAncestorsValue -split ' ' | Where-Object { $_ }))
    {
        if ($origin -eq "'self'") { throw "'self' ist immer erlaubt und gehört nicht in -FrameAncestors." }
        if (-not (Test-FrameAncestor $origin)) { throw "Ungültige Quelle für frame-ancestors: «$origin» (Beispiel: https://proxy.example.ch)." }
    }

    # Admin account
    $adminUserValue = $AdminUser
    if (-not $adminUserValue)
    {
        $adminUserValue = Get-Existing 'ADMIN__USERNAME'
        if (-not $adminUserValue) { $adminUserValue = 'admin' }
        if ($interactive) { $adminUserValue = Read-Prompt 'Benutzername des Admin-Kontos' $adminUserValue }
    }
    if (-not (Test-AdminUser $adminUserValue)) { throw "Ungültiger Benutzername «$adminUserValue» (1–64 Zeichen: Buchstaben, Ziffern, . _ @ -)." }

    $existingHash = Get-Existing 'ADMIN__PASSWORDHASH'
    $existingPlain = Get-Existing 'ADMIN__PASSWORD'
    $password = ''
    $passwordGenerated = $false
    $keepCredentials = $false
    if ($AdminPasswordStdin)
    {
        $password = [Console]::In.ReadLine()
        if ($null -eq $password) { throw 'Kein Passwort auf der Standardeingabe.' }
        $password = $password.TrimEnd("`r")
    }
    elseif ($GeneratePassword) { $passwordGenerated = $true }
    elseif (($existingHash -or $existingPlain) -and (-not $interactive -or (Read-FsConfirm 'Bestehendes Admin-Passwort behalten?' 'j')))
    {
        $keepCredentials = $true
    }
    elseif ($interactive)
    {
        while ($true)
        {
            $password = Read-SecretPrompt "Admin-Passwort (mind. $MinPasswordLength Zeichen; leer = starkes Passwort erzeugen)"
            if (-not $password) { break }
            if ($password.Length -lt $MinPasswordLength) { Write-FsWarn 'Zu kurz.'; continue }
            if ((Read-SecretPrompt 'Admin-Passwort wiederholen') -ceq $password) { break }
            Write-FsWarn 'Die Eingaben stimmen nicht überein.'
        }
        if (-not $password) { $passwordGenerated = $true }
    }
    else { $passwordGenerated = $true }

    if ($passwordGenerated) { $password = New-RandomAlphanumeric $GeneratedPasswordLength }
    elseif (-not $keepCredentials -and $password.Length -lt $MinPasswordLength)
    {
        throw "Das Admin-Passwort braucht mindestens $MinPasswordLength Zeichen."
    }

    # Secrets: keep existing ones (the database password is fixed once PostgreSQL is initialised).
    $postgresPassword = Get-Existing 'POSTGRES_PASSWORD'
    if ($postgresPassword -cnotmatch '^[A-Za-z0-9]{16,}$') { $postgresPassword = New-RandomAlphanumeric 32 }
    $liveKitKey = Get-Existing 'LIVEKIT_API_KEY'
    if ($liveKitKey -cnotmatch '^[A-Za-z][A-Za-z0-9_-]{2,63}$') { $liveKitKey = 'flowstudio' }
    $liveKitSecret = Get-Existing 'LIVEKIT_API_SECRET'
    if (-not (Test-LiveKitSecret $liveKitSecret)) { $liveKitSecret = 'sk' + (New-RandomHex 20) }

    # --- write .env -----------------------------------------------------------------------------------------------

    function New-EnvContent([string[]] $AdminLines)
    {
        $lines = [Collections.Generic.List[string]]::new()
        $lines.Add("# FlowStudio – erzeugt von setup.ps1 am $(Get-Date -Format 'yyyy-MM-dd HH:mm'). Nie ins Git; Kopie in den Passwort-Tresor.")
        $lines.Add('# Alle Variablen: .env.example und docs/architecture/implementation-spec.md (Abschnitt 10).')
        $lines.Add('')
        $lines.Add((Format-EnvLine 'FLOWSTUDIO_DOMAIN' $domainValue))
        $lines.Add((Format-EnvLine 'FLOWSTUDIO_NODE_IP' $nodeIpValue))
        if ($extraHostsValue) { $lines.Add((Format-EnvLine 'FLOWSTUDIO_EXTRA_HOSTS' $extraHostsValue)) }
        if ($defaultSni) { $lines.Add((Format-EnvLine 'FLOWSTUDIO_DEFAULT_SNI' $defaultSni)) }
        $lines.Add((Format-EnvLine 'FLOWSTUDIO_TLS_MODE' $tlsModeValue))
        if ($acmeEmailValue) { $lines.Add((Format-EnvLine 'FLOWSTUDIO_ACME_EMAIL' $acmeEmailValue)) }
        if ($challengeDomainValue) { $lines.Add((Format-EnvLine 'FLOWSTUDIO_DNS_CHALLENGE_DOMAIN' $challengeDomainValue)) }
        foreach ($line in $providerLines) { $lines.Add($line) }
        if ($tlsModeValue -eq 'internal') { $lines.Add((Format-EnvLine 'FLOWSTUDIO_HSTS_MAX_AGE' $InternalHstsMaxAge)) }
        if ($frameAncestorsValue) { $lines.Add((Format-EnvLine 'FLOWSTUDIO_FRAME_ANCESTORS' $frameAncestorsValue)) }
        $lines.Add('')
        $lines.Add((Format-EnvLine 'ADMIN__USERNAME' $adminUserValue))
        foreach ($line in $AdminLines) { $lines.Add($line) }
        $lines.Add('')
        $lines.Add((Format-EnvLine 'LIVEKIT_API_KEY' $liveKitKey))
        $lines.Add((Format-EnvLine 'LIVEKIT_API_SECRET' $liveKitSecret))
        $lines.Add((Format-EnvLine 'POSTGRES_PASSWORD' $postgresPassword))
        ($lines -join "`n") + "`n"
    }

    $utf8 = [Text.UTF8Encoding]::new($false)
    $tmpEnv = Join-Path $envDirectory ('.env.setup.' + (New-RandomAlphanumeric 6))
    function Write-EnvFile([string[]] $AdminLines)
    {
        [IO.File]::WriteAllText($tmpEnv, (New-EnvContent $AdminLines), $utf8)
        Protect-FsPath -Path $tmpEnv
    }

    try
    {
        if ($keepCredentials)
        {
            $adminLines = @()
            if ($existingHash) { $adminLines += Format-EnvLine 'ADMIN__PASSWORDHASH' $existingHash }
            if ($existingPlain) { $adminLines += Format-EnvLine 'ADMIN__PASSWORD' $existingPlain }
            Write-EnvFile $adminLines
        }
        elseif ($PlainPassword)
        {
            Write-FsWarn 'Das Admin-Passwort wird im Klartext gespeichert (-PlainPassword). Nur für lokale Entwicklung.'
            Write-EnvFile @(Format-EnvLine 'ADMIN__PASSWORD' $password)
        }
        else
        {
            Write-EnvFile @()
            $dockerAvailable = Test-FsDockerAvailable
            $hash = if ($dockerAvailable) { Get-PasswordHash -EnvPath $tmpEnv -Password $password } else { $null }
            if ($hash)
            {
                Write-EnvFile @(Format-EnvLine 'ADMIN__PASSWORDHASH' $hash)
                Write-FsInfo 'Admin-Passwort als Hash gespeichert.'
            }
            else
            {
                if (-not $dockerAvailable) { Write-FsWarn 'Docker ist nicht verfügbar; der Passwort-Hash braucht das API-Image.' }
                Write-FsWarn 'Der Passwort-Hash konnte nicht über das API-Image erzeugt werden (Build fehlgeschlagen oder «hash-password» fehlt).'
                Write-FsWarn 'Das Passwort wird vorerst im Klartext (ADMIN__PASSWORD) gespeichert. Später ./setup.ps1 -Force ausführen und ein neues Passwort setzen.'
                Write-EnvFile @(Format-EnvLine 'ADMIN__PASSWORD' $password)
            }
        }

        if (Test-Path -LiteralPath $EnvFile)
        {
            $backupFile = "$EnvFile.backup-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
            Copy-Item -LiteralPath $EnvFile -Destination $backupFile
            Protect-FsPath -Path $backupFile
            Write-FsInfo "Bisherige Datei gesichert: $backupFile (eigene Ergänzungen von dort übernehmen)."
        }
        Move-Item -LiteralPath $tmpEnv -Destination $EnvFile -Force
    }
    finally
    {
        if (Test-Path -LiteralPath $tmpEnv) { Remove-Item -LiteralPath $tmpEnv -Force }
    }

    # --- summary ----------------------------------------------------------------------------------------------------

    Write-FsStep "Fertig: $EnvFile"
    Write-FsInfo "Regie:      https://$domainValue/"
    Write-FsInfo "Sender:     https://$domainValue/join"
    Write-FsInfo "Medien:     $nodeIpValue (7881/tcp, 7882/udp)   TLS: $tlsModeValue"
    switch -Wildcard ($tlsModeValue)
    {
        'internal' { Write-FsInfo "Zertifikat: lokale CA – auf jedem Gerät einmal https://$domainValue/ca.crt installieren (docs/runbook.md)." }
        'dns-*' { Write-FsInfo "Zertifikat: Let's Encrypt per DNS-Challenge; der A-Record von $domainValue zeigt auf $nodeIpValue." }
        'acme' { Write-FsInfo "Zertifikat: Let's Encrypt per HTTP-01; 80/tcp und 443/tcp müssen öffentlich erreichbar sein." }
        'custom' { Write-FsInfo 'Zertifikat: ./certs/fullchain.pem und privkey.pem nach /certs mounten (docker-compose.override.example.yml).' }
    }
    if ($passwordGenerated)
    {
        Write-FsInfo ''
        Write-FsInfo "Admin-Konto: $adminUserValue"
        Write-FsInfo "Passwort:    $password"
        Write-FsInfo 'Das Passwort wird nur jetzt angezeigt. Im Passwort-Tresor ablegen.'
    }
    Write-FsInfo ''
    Write-FsInfo 'Nächster Schritt: docker compose up -d --build'
}
catch
{
    Write-Host "Fehler: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
