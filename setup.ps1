<#
.SYNOPSIS
    Set up StudioFlow: writes .env with random secrets and the hash of the admin password.

.DESCRIPTION
    Same behaviour as setup.sh. Asks for the domain, LAN IPv4 (detected automatically), TLS mode (plus e-mail and
    DNS provider credentials), extra hosts, frame-ancestors and the admin account, and generates the LiveKit keys
    and the database password. The API image ("hash-password") creates the password hash.
    An existing .env is replaced only with -Force (copy .env.backup-<time>; secrets are carried over).

    Credentials of the DNS providers (dns-*) come from the environment, from the existing .env or are asked for
    without echo: CF_API_TOKEN, INFOMANIAK_API_TOKEN, HETZNER_API_TOKEN, DESEC_TOKEN, GANDI_BEARER_TOKEN,
    AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY + AWS_REGION, OVH_ENDPOINT + OVH_APPLICATION_KEY +
    OVH_APPLICATION_SECRET + OVH_CONSUMER_KEY.

    Then: docker compose up -d --build (details: docs/runbook.md).

.PARAMETER Domain
    Host name of the Regie, e.g. studioflow.opten.ch (test: localhost).
.PARAMETER NodeIp
    LAN IPv4 of the server for media (default: detected automatically).
.PARAMETER TlsMode
    internal | acme | custom | dns-cloudflare | dns-infomaniak | dns-hetzner | dns-desec | dns-route53 | dns-gandi | dns-ovh
.PARAMETER AcmeEmail
    E-mail for Let's Encrypt (acme, dns-*).
.PARAMETER DnsChallengeDomain
    CNAME target if _acme-challenge is delegated (dns-*; e.g. for Hostpoint, cyon).
.PARAMETER ExtraHosts
    Further addresses of the same site, separated by spaces, e.g. the IP (internal only).
.PARAMETER FrameAncestors
    Origins allowed to embed the output, separated by spaces ('self' is always allowed).
.PARAMETER AdminUser
    User name of the admin account (default: admin).
.PARAMETER AdminPasswordStdin
    Read the admin password from standard input (one line; only with -NonInteractive).
.PARAMETER GeneratePassword
    Generate a strong admin password and show it once.
.PARAMETER PlainPassword
    Store the password in plain text instead of as a hash (local development only).
.PARAMETER EnvFile
    Target file instead of ./.env.
.PARAMETER NonInteractive
    Ask nothing; missing required values are an error.
.PARAMETER Force
    Replace an existing .env.

.EXAMPLE
    ./setup.ps1
.EXAMPLE
    ./setup.ps1 -NonInteractive -Domain studioflow.opten.ch -TlsMode dns-cloudflare -GeneratePassword
.EXAMPLE
    $password | pwsh -NoProfile -File ./setup.ps1 -NonInteractive -Domain localhost -NodeIp 127.0.0.1 -TlsMode internal -AdminPasswordStdin
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
Import-Module (Join-Path $PSScriptRoot 'infra/scripts/StudioFlow.psm1') -Force
Initialize-StudioFlow -Root $PSScriptRoot

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
    if ($Value -match "['`r`n]") { throw "The value for $Key contains a single quote or a line break; that is not possible in .env." }
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

    Write-SfInfo 'Building the API image (for the password hash) ...'
    $build = Get-SfComposeOutput -Arguments @('--env-file', $EnvPath, 'build', '--quiet', 'api')
    if ($build.ExitCode -ne 0)
    {
        Write-SfWarn 'The API image could not be built.'
        return $null
    }

    $startInfo = [Diagnostics.ProcessStartInfo]::new('docker')
    foreach ($argument in @('compose', '--env-file', $EnvPath, 'run', '--rm', '--no-deps', '-T', '--entrypoint', 'dotnet', 'api', 'Opten.StudioFlow.Web.dll', 'hash-password'))
    {
        $startInfo.ArgumentList.Add($argument)
    }
    $startInfo.WorkingDirectory = Get-SfRoot
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
        else { throw "Unknown option: $($UnknownArguments -join ' ') (see Get-Help ./setup.ps1 -Full)." }
    }
    if ($Help)
    {
        Get-Help $PSCommandPath -Full
        exit 0
    }

    $interactive = -not $NonInteractive
    if ($AdminPasswordStdin -and $interactive) { throw '-AdminPasswordStdin only works together with -NonInteractive.' }
    if ($interactive -and ([Console]::IsInputRedirected -or -not [Environment]::UserInteractive))
    {
        throw 'No terminal for questions. Run with -NonInteractive and the options (see Get-Help ./setup.ps1 -Full).'
    }

    if (-not $EnvFile) { $EnvFile = Join-Path (Get-SfRoot) '.env' }
    $envDirectory = Split-Path -Parent ([IO.Path]::GetFullPath($EnvFile))
    if (-not (Test-Path -LiteralPath $envDirectory -PathType Container)) { throw "Directory $envDirectory does not exist." }
    $EnvFile = [IO.Path]::GetFullPath($EnvFile)

    if ((Test-Path -LiteralPath $EnvFile) -and -not $Force)
    {
        throw "$EnvFile already exists. Replace it with -Force (a copy is kept, secrets are carried over)."
    }
    $existing = Read-EnvFile $EnvFile
    function Get-Existing([string] $Key) { if ($existing.ContainsKey($Key)) { [string]$existing[$Key] } else { '' } }

    Write-SfStep 'Set up StudioFlow'
    if (Test-Path -LiteralPath $EnvFile) { Write-SfInfo "The existing $(Split-Path -Leaf $EnvFile) will be replaced; secrets and admin account are carried over." }

    # Node IP
    $nodeIpValue = $NodeIp
    if (-not $nodeIpValue)
    {
        $detectedIp = Get-NodeIp
        $defaultIp = Get-Existing 'STUDIOFLOW_NODE_IP'
        if (-not $defaultIp) { $defaultIp = $detectedIp }
        if ($interactive)
        {
            if ($detectedIp) { Write-SfInfo "Detected LAN IPv4 of this machine: $detectedIp" }
            $nodeIpValue = Read-Prompt 'LAN IPv4 of the server (media for phones and laptops)' $defaultIp
        }
        else { $nodeIpValue = $defaultIp }
    }
    if (-not (Test-Ipv4 $nodeIpValue)) { throw "Invalid or missing LAN IPv4: '$nodeIpValue' (option -NodeIp)." }

    # TLS mode
    $tlsModeValue = $TlsMode
    if (-not $tlsModeValue)
    {
        $tlsModeValue = Get-Existing 'STUDIOFLOW_TLS_MODE'
        if (-not $tlsModeValue) { $tlsModeValue = 'internal' }
        if ($interactive)
        {
            Write-SfInfo 'TLS modes: internal (local CA, test) | acme (VPS, publicly reachable) | custom (own certificate)'
            Write-SfInfo '           dns-cloudflare | dns-infomaniak | dns-hetzner | dns-desec | dns-route53 | dns-gandi | dns-ovh'
            $tlsModeValue = Read-Prompt 'TLS mode' $tlsModeValue
        }
    }
    if ($tlsModeValue -cnotin $TlsModes) { throw "Unknown TLS mode: '$tlsModeValue'. Allowed: $($TlsModes -join ' ')" }

    # Domain
    $domainValue = $Domain
    if (-not $domainValue)
    {
        $domainValue = Get-Existing 'STUDIOFLOW_DOMAIN'
        if (-not $domainValue -and $tlsModeValue -eq 'internal') { $domainValue = $nodeIpValue }
        if ($interactive) { $domainValue = Read-Prompt 'Domain of the Regie (e.g. studioflow.opten.ch; in mode internal also the IP)' $domainValue }
    }
    $domainValue = "$domainValue".ToLowerInvariant()
    if (-not (Test-Host $domainValue)) { throw "Invalid or missing domain: '$domainValue' (option -Domain)." }
    if ((Test-Ipv4 $domainValue) -and $tlsModeValue -notin @('internal', 'custom'))
    {
        throw "No certificate can be issued for an IP address with $tlsModeValue. Use TLS mode internal."
    }

    # ACME e-mail and DNS challenge delegation
    $acmeEmailValue = ''
    $challengeDomainValue = ''
    if ($tlsModeValue -eq 'acme' -or $tlsModeValue -like 'dns-*')
    {
        if ($PSBoundParameters.ContainsKey('AcmeEmail')) { $acmeEmailValue = $AcmeEmail }
        else
        {
            $acmeEmailValue = Get-Existing 'STUDIOFLOW_ACME_EMAIL'
            if ($interactive) { $acmeEmailValue = Read-Prompt "E-mail for Let's Encrypt (may be empty)" $acmeEmailValue }
        }
        if ($acmeEmailValue -and -not (Test-Email $acmeEmailValue)) { throw "Invalid e-mail: '$acmeEmailValue'." }
    }
    if ($tlsModeValue -like 'dns-*')
    {
        if ($PSBoundParameters.ContainsKey('DnsChallengeDomain')) { $challengeDomainValue = $DnsChallengeDomain }
        else
        {
            $challengeDomainValue = Get-Existing 'STUDIOFLOW_DNS_CHALLENGE_DOMAIN'
            if ($interactive) { $challengeDomainValue = Read-Prompt 'Is _acme-challenge delegated by CNAME? Then enter the CNAME target, otherwise leave empty' $challengeDomainValue }
        }
        $challengeDomainValue = "$challengeDomainValue".ToLowerInvariant()
        if ($challengeDomainValue -and -not (Test-Hostname ($challengeDomainValue -replace '^_acme-challenge\.', '')))
        {
            throw "Invalid CNAME target: '$challengeDomainValue'."
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
            $value = if (Test-SecretVariable $variable) { Read-SecretPrompt "$variable (input is hidden)" } else { Read-Prompt $variable }
        }
        if (-not $value) { throw "$variable is missing for TLS mode $tlsModeValue (set the environment variable or enter it interactively)." }
        $providerLines.Add((Format-EnvLine $variable $value))
    }

    # Extra hosts (internal mode) and the certificate for clients without SNI
    $extraHostsValue = ''
    $defaultSni = ''
    if ($PSBoundParameters.ContainsKey('ExtraHosts')) { $extraHostsValue = $ExtraHosts }
    elseif ($tlsModeValue -eq 'internal')
    {
        $extraHostsValue = Get-Existing 'STUDIOFLOW_EXTRA_HOSTS'
        if ($interactive -and -not (Test-Ipv4 $domainValue))
        {
            $extraHostsValue = Read-Prompt "Extra hosts, e.g. $nodeIpValue for access by IP (empty = none)" $extraHostsValue
        }
    }
    $extraHostsValue = ConvertTo-WordList "$extraHostsValue".ToLowerInvariant()
    foreach ($extraHost in @($extraHostsValue -split ' ' | Where-Object { $_ }))
    {
        if (-not (Test-Host $extraHost)) { throw "Invalid extra host: '$extraHost'." }
        if (-not $defaultSni -and (Test-Ipv4 $extraHost)) { $defaultSni = $extraHost }
    }
    if ($extraHostsValue -and $tlsModeValue -ne 'internal')
    {
        Write-SfWarn "Extra hosts only make sense in mode internal; with $tlsModeValue each one needs its own certificate."
    }

    # Frame ancestors
    if ($PSBoundParameters.ContainsKey('FrameAncestors')) { $frameAncestorsValue = $FrameAncestors }
    else
    {
        $frameAncestorsValue = Get-Existing 'STUDIOFLOW_FRAME_ANCESTORS'
        if ($interactive)
        {
            $frameAncestorsValue = Read-Prompt 'Origins allowed to embed the output (e.g. https://proxy.example.ch; empty = StudioFlow only)' $frameAncestorsValue
        }
    }
    $frameAncestorsValue = ConvertTo-WordList $frameAncestorsValue
    foreach ($origin in @($frameAncestorsValue -split ' ' | Where-Object { $_ }))
    {
        if ($origin -eq "'self'") { throw "'self' is always allowed and does not belong in -FrameAncestors." }
        if (-not (Test-FrameAncestor $origin)) { throw "Invalid source for frame-ancestors: '$origin' (example: https://proxy.example.ch)." }
    }

    # Admin account
    $adminUserValue = $AdminUser
    if (-not $adminUserValue)
    {
        $adminUserValue = Get-Existing 'ADMIN__USERNAME'
        if (-not $adminUserValue) { $adminUserValue = 'admin' }
        if ($interactive) { $adminUserValue = Read-Prompt 'User name of the admin account' $adminUserValue }
    }
    if (-not (Test-AdminUser $adminUserValue)) { throw "Invalid user name '$adminUserValue' (1-64 characters: letters, digits, . _ @ -)." }

    $existingHash = Get-Existing 'ADMIN__PASSWORDHASH'
    $existingPlain = Get-Existing 'ADMIN__PASSWORD'
    $password = ''
    $passwordGenerated = $false
    $keepCredentials = $false
    if ($AdminPasswordStdin)
    {
        $password = [Console]::In.ReadLine()
        if ($null -eq $password) { throw 'No password on standard input.' }
        $password = $password.TrimEnd("`r")
    }
    elseif ($GeneratePassword) { $passwordGenerated = $true }
    elseif (($existingHash -or $existingPlain) -and (-not $interactive -or (Read-SfConfirm 'Keep the existing admin password?' 'y')))
    {
        $keepCredentials = $true
    }
    elseif ($interactive)
    {
        while ($true)
        {
            $password = Read-SecretPrompt "Admin password (at least $MinPasswordLength characters; empty = generate a strong password)"
            if (-not $password) { break }
            if ($password.Length -lt $MinPasswordLength) { Write-SfWarn 'Too short.'; continue }
            if ((Read-SecretPrompt 'Repeat the admin password') -ceq $password) { break }
            Write-SfWarn 'The entries do not match.'
        }
        if (-not $password) { $passwordGenerated = $true }
    }
    else { $passwordGenerated = $true }

    if ($passwordGenerated) { $password = New-RandomAlphanumeric $GeneratedPasswordLength }
    elseif (-not $keepCredentials -and $password.Length -lt $MinPasswordLength)
    {
        throw "The admin password needs at least $MinPasswordLength characters."
    }

    # Secrets: keep existing ones (the database password is fixed once PostgreSQL is initialised).
    $postgresPassword = Get-Existing 'POSTGRES_PASSWORD'
    if ($postgresPassword -cnotmatch '^[A-Za-z0-9]{16,}$') { $postgresPassword = New-RandomAlphanumeric 32 }
    $liveKitKey = Get-Existing 'LIVEKIT_API_KEY'
    if ($liveKitKey -cnotmatch '^[A-Za-z][A-Za-z0-9_-]{2,63}$') { $liveKitKey = 'studioflow' }
    $liveKitSecret = Get-Existing 'LIVEKIT_API_SECRET'
    if (-not (Test-LiveKitSecret $liveKitSecret)) { $liveKitSecret = 'sk' + (New-RandomHex 20) }

    # --- write .env -----------------------------------------------------------------------------------------------

    function New-EnvContent([string[]] $AdminLines)
    {
        $lines = [Collections.Generic.List[string]]::new()
        $lines.Add("# StudioFlow - generated by setup.ps1 on $(Get-Date -Format 'yyyy-MM-dd HH:mm'). Never commit it to Git; keep a copy in the password vault.")
        $lines.Add('# All variables: .env.example and docs/architecture/implementation-spec.md (section 10).')
        $lines.Add('')
        $lines.Add((Format-EnvLine 'STUDIOFLOW_DOMAIN' $domainValue))
        $lines.Add((Format-EnvLine 'STUDIOFLOW_NODE_IP' $nodeIpValue))
        if ($extraHostsValue) { $lines.Add((Format-EnvLine 'STUDIOFLOW_EXTRA_HOSTS' $extraHostsValue)) }
        if ($defaultSni) { $lines.Add((Format-EnvLine 'STUDIOFLOW_DEFAULT_SNI' $defaultSni)) }
        $lines.Add((Format-EnvLine 'STUDIOFLOW_TLS_MODE' $tlsModeValue))
        if ($acmeEmailValue) { $lines.Add((Format-EnvLine 'STUDIOFLOW_ACME_EMAIL' $acmeEmailValue)) }
        if ($challengeDomainValue) { $lines.Add((Format-EnvLine 'STUDIOFLOW_DNS_CHALLENGE_DOMAIN' $challengeDomainValue)) }
        foreach ($line in $providerLines) { $lines.Add($line) }
        if ($tlsModeValue -eq 'internal') { $lines.Add((Format-EnvLine 'STUDIOFLOW_HSTS_MAX_AGE' $InternalHstsMaxAge)) }
        if ($frameAncestorsValue) { $lines.Add((Format-EnvLine 'STUDIOFLOW_FRAME_ANCESTORS' $frameAncestorsValue)) }
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
        Protect-SfPath -Path $tmpEnv
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
            Write-SfWarn 'The admin password is stored in plain text (-PlainPassword). For local development only.'
            Write-EnvFile @(Format-EnvLine 'ADMIN__PASSWORD' $password)
        }
        else
        {
            Write-EnvFile @()
            $dockerAvailable = Test-SfDockerAvailable
            $hash = if ($dockerAvailable) { Get-PasswordHash -EnvPath $tmpEnv -Password $password } else { $null }
            if ($hash)
            {
                Write-EnvFile @(Format-EnvLine 'ADMIN__PASSWORDHASH' $hash)
                Write-SfInfo 'Admin password stored as a hash.'
            }
            else
            {
                if (-not $dockerAvailable) { Write-SfWarn 'Docker is not available; the password hash needs the API image.' }
                Write-SfWarn "The password hash could not be generated with the API image (build failed or 'hash-password' is missing)."
                Write-SfWarn 'The password is stored in plain text (ADMIN__PASSWORD) for now. Later run ./setup.ps1 -Force and set a new password.'
                Write-EnvFile @(Format-EnvLine 'ADMIN__PASSWORD' $password)
            }
        }

        if (Test-Path -LiteralPath $EnvFile)
        {
            $backupFile = "$EnvFile.backup-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
            Copy-Item -LiteralPath $EnvFile -Destination $backupFile
            Protect-SfPath -Path $backupFile
            Write-SfInfo "Previous file saved as: $backupFile (copy your own additions from there)."
        }
        Move-Item -LiteralPath $tmpEnv -Destination $EnvFile -Force
    }
    finally
    {
        if (Test-Path -LiteralPath $tmpEnv) { Remove-Item -LiteralPath $tmpEnv -Force }
    }

    # --- summary ----------------------------------------------------------------------------------------------------

    Write-SfStep "Done: $EnvFile"
    Write-SfInfo "Regie:       https://$domainValue/"
    Write-SfInfo "Sender:      https://$domainValue/join"
    Write-SfInfo "Media:       $nodeIpValue (7881/tcp, 7882/udp)   TLS: $tlsModeValue"
    switch -Wildcard ($tlsModeValue)
    {
        'internal' { Write-SfInfo "Certificate: local CA - install https://$domainValue/ca.crt once on every device (docs/runbook.md)." }
        'dns-*' { Write-SfInfo "Certificate: Let's Encrypt via DNS challenge; the A record of $domainValue points to $nodeIpValue." }
        'acme' { Write-SfInfo "Certificate: Let's Encrypt via HTTP-01; 80/tcp and 443/tcp must be publicly reachable." }
        'custom' { Write-SfInfo 'Certificate: mount ./certs/fullchain.pem and privkey.pem to /certs (docker-compose.override.example.yml).' }
    }
    if ($passwordGenerated)
    {
        Write-SfInfo ''
        Write-SfInfo "Admin user:  $adminUserValue"
        Write-SfInfo "Password:    $password"
        Write-SfInfo 'The password is shown only now. Store it in the password vault.'
    }
    Write-SfInfo ''
    Write-SfInfo 'Next step: docker compose up -d --build'
}
catch
{
    Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
