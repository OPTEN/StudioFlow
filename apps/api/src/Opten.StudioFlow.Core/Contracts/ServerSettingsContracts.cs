namespace Opten.StudioFlow.Core.Contracts;

/// <summary>
/// Reasons in the field errors (<c>errors</c>) of a <see cref="ErrorCodes.ValidationFailed"/> answer to the server
/// settings (issue #27). They are codes, not texts: the client shows its own text for each.
/// </summary>
public static class SettingsFieldErrors
{
    /// <summary>The media address is not an IPv4 address a device can reach (e.g. <c>192.168.1.50</c>).</summary>
    public const string MediaAddressInvalid = "media_address_invalid";

    /// <summary>The certificate mode is not one of <c>internal</c>, <c>custom</c> or <c>dns-*</c> of this version.</summary>
    public const string TlsModeUnknown = "tls_mode_unknown";

    /// <summary>The mode needs a domain (every mode but <c>internal</c>).</summary>
    public const string DomainRequired = "domain_required";

    /// <summary>The domain is not a valid host name.</summary>
    public const string DomainInvalid = "domain_invalid";

    /// <summary>The e-mail address is not valid.</summary>
    public const string EmailInvalid = "email_invalid";

    /// <summary>A credential of the DNS provider is missing.</summary>
    public const string CredentialRequired = "credential_required";

    /// <summary>A credential of the DNS provider has characters or a length no such credential has.</summary>
    public const string CredentialInvalid = "credential_invalid";

    /// <summary>The DNS provider does not use this credential field.</summary>
    public const string CredentialUnknown = "credential_unknown";

    /// <summary>No certificate and key were uploaded yet for the mode <c>custom</c>.</summary>
    public const string CertificateRequired = "certificate_required";

    /// <summary>The certificate is no PEM certificate (or too large).</summary>
    public const string CertificateInvalid = "certificate_invalid";

    /// <summary>The private key is no unencrypted PEM key (or too large).</summary>
    public const string PrivateKeyInvalid = "private_key_invalid";

    /// <summary>The private key is encrypted with a password; Caddy cannot use such a key.</summary>
    public const string PrivateKeyEncrypted = "private_key_encrypted";

    /// <summary>The private key does not belong to the certificate.</summary>
    public const string CertificateKeyMismatch = "certificate_key_mismatch";

    /// <summary>The certificate has expired.</summary>
    public const string CertificateExpired = "certificate_expired";

    /// <summary>The certificate is not valid yet.</summary>
    public const string CertificateNotYetValid = "certificate_not_yet_valid";

    /// <summary>The certificate does not cover the domain.</summary>
    public const string CertificateNameMismatch = "certificate_name_mismatch";

    /// <summary>The origins are missing from the request (an empty list is valid and clears them; a missing one must not).</summary>
    public const string OriginsRequired = "origins_required";

    /// <summary>An origin is no valid CSP source (<c>https://host</c>, <c>https://*.host</c>, optional port).</summary>
    public const string OriginInvalid = "origin_invalid";

    /// <summary>More origins than allowed.</summary>
    public const string TooManyOrigins = "too_many_origins";

    /// <summary>The backup schedule is no valid cron expression of five fields.</summary>
    public const string ScheduleInvalid = "schedule_invalid";

    /// <summary>The time zone is no IANA name such as <c>Europe/Zurich</c>.</summary>
    public const string TimezoneInvalid = "timezone_invalid";

    /// <summary>A retention count is outside 1 to 365 (days) or 1 to 104 (weeks).</summary>
    public const string KeepInvalid = "keep_invalid";

    /// <summary>The rclone remote is not of the form <c>name:path</c>.</summary>
    public const string RemoteInvalid = "remote_invalid";

    /// <summary>The rclone configuration is no rclone.conf (or too large).</summary>
    public const string RcloneConfigInvalid = "rclone_config_invalid";

    /// <summary>The remote is not defined in the rclone configuration.</summary>
    public const string RemoteNotInConfig = "remote_not_in_config";

    /// <summary>A public age key is not valid.</summary>
    public const string AgeRecipientInvalid = "age_recipient_invalid";

    /// <summary>An off-site copy needs a public age key, or the explicit statement that the remote encrypts by itself.</summary>
    public const string AgeRecipientRequired = "age_recipient_required";
}

/// <summary>A DNS provider and the credential fields it needs.</summary>
/// <param name="Id">Certificate mode, e.g. <c>dns-cloudflare</c>.</param>
/// <param name="Fields">Names of the credential fields (all secret, none is ever returned).</param>
public sealed record DnsProviderDto(string Id, IReadOnlyList<string> Fields);

/// <summary>An uploaded certificate as the Regie shows it (never the key).</summary>
/// <param name="Subject">Subject of the leaf certificate.</param>
/// <param name="Names">The DNS names it covers.</param>
/// <param name="NotAfter">When it expires.</param>
/// <param name="Fingerprint">SHA-256 of the leaf certificate (hex).</param>
public sealed record CertificateInfoDto(string Subject, IReadOnlyList<string> Names, DateTimeOffset NotAfter, string Fingerprint);

/// <summary>The media address.</summary>
/// <param name="Address">The IPv4 address LiveKit announces; null until the wizard saved it.</param>
public sealed record MediaSettingsDto(string? Address);

/// <summary>The address and the certificate.</summary>
/// <param name="TlsMode"><c>internal</c>, <c>custom</c> or <c>dns-*</c>.</param>
/// <param name="Domain">The host name of the Regie, if one is set.</param>
/// <param name="AcmeEmail">E-mail of the Let's Encrypt account (dns-* modes).</param>
/// <param name="DnsChallengeDomain">Delegation target of <c>_acme-challenge</c>, if one is set.</param>
/// <param name="CredentialFields">Which credential fields are stored (names only).</param>
/// <param name="Certificate">The uploaded certificate (mode <c>custom</c>).</param>
public sealed record AddressSettingsDto(
    string TlsMode,
    string? Domain,
    string? AcmeEmail,
    string? DnsChallengeDomain,
    IReadOnlyList<string> CredentialFields,
    CertificateInfoDto? Certificate);

/// <summary>The origins that may embed the output.</summary>
/// <param name="Origins">The origins; <c>'self'</c> is always allowed and not listed.</param>
public sealed record EmbeddingSettingsDto(IReadOnlyList<string> Origins);

/// <summary>The backup schedule and the off-site target.</summary>
/// <param name="Schedule">Cron expression; null: automatic backups are off.</param>
/// <param name="Timezone">IANA time zone of the schedule; null: UTC.</param>
/// <param name="KeepDaily">Daily backups kept.</param>
/// <param name="KeepWeekly">Weekly backups kept.</param>
/// <param name="RcloneRemote">The rclone remote of the off-site copy; null: none.</param>
/// <param name="RcloneConfigured">True when an rclone.conf is stored (it is never returned).</param>
/// <param name="AgeRecipients">Public age keys that encrypt the off-site copy.</param>
/// <param name="OffsiteUnencrypted">The remote encrypts by itself, so the copy is not encrypted here.</param>
public sealed record BackupSettingsDto(
    string? Schedule,
    string? Timezone,
    int KeepDaily,
    int KeepWeekly,
    string? RcloneRemote,
    bool RcloneConfigured,
    IReadOnlyList<string> AgeRecipients,
    bool OffsiteUnencrypted);

/// <summary>Everything the wizard and the "Server settings" page show.</summary>
/// <param name="Configured">True once the media address was saved; before that the wizard continues after the account step.</param>
/// <param name="BaseUrl">The address devices open, e.g. <c>https://studioflow.example.com:8443</c>.</param>
/// <param name="HttpsPort">The published HTTPS port (<c>STUDIOFLOW_HTTPS_PORT</c>, default 8443).</param>
/// <param name="Media">The media address.</param>
/// <param name="Address">The address and the certificate.</param>
/// <param name="Embedding">The embedding origins.</param>
/// <param name="Backup">The backup settings.</param>
/// <param name="DnsProviders">The DNS providers this version supports.</param>
public sealed record ServerSettingsDto(
    bool Configured,
    string BaseUrl,
    int HttpsPort,
    MediaSettingsDto Media,
    AddressSettingsDto Address,
    EmbeddingSettingsDto Embedding,
    BackupSettingsDto Backup,
    IReadOnlyList<DnsProviderDto> DnsProviders);

/// <summary>Sets the media address.</summary>
/// <param name="Address">The IPv4 address LiveKit announces to the devices.</param>
public sealed record UpdateMediaRequest(string Address);

/// <summary>Sets the address and the certificate mode.</summary>
/// <param name="TlsMode"><c>internal</c>, <c>custom</c> or <c>dns-*</c>.</param>
/// <param name="Domain">Host name; optional in mode <c>internal</c>, required in the others.</param>
/// <param name="AcmeEmail">E-mail of the Let's Encrypt account (dns-* modes); optional.</param>
/// <param name="DnsChallengeDomain">Delegation target of <c>_acme-challenge</c> (dns-* modes); optional.</param>
/// <param name="DnsCredentials">The credentials of the provider; omitted: the stored ones stay.</param>
public sealed record UpdateAddressRequest(
    string TlsMode,
    string? Domain,
    string? AcmeEmail,
    string? DnsChallengeDomain,
    IReadOnlyDictionary<string, string>? DnsCredentials);

/// <summary>Uploads the certificate and the private key of the mode <c>custom</c> (PEM text).</summary>
/// <param name="CertificatePem">The certificate chain, leaf first.</param>
/// <param name="PrivateKeyPem">The unencrypted private key.</param>
/// <param name="Domain">
/// The host name the certificate must cover, when the address is about to change to it (the certificate comes first, the
/// address second); omitted: the saved domain, and no check of the name while there is none.
/// </param>
public sealed record UploadCertificateRequest(string CertificatePem, string PrivateKeyPem, string? Domain = null);

/// <summary>Sets the origins that may embed the output.</summary>
/// <param name="Origins">Origins such as <c>https://proxy.example.ch</c> or <c>https://*.example.com</c>.</param>
public sealed record UpdateEmbeddingRequest(IReadOnlyList<string> Origins);

/// <summary>Sets the backup schedule and the off-site target.</summary>
/// <param name="Schedule">Cron expression of five fields; empty: off.</param>
/// <param name="Timezone">IANA time zone; empty: UTC.</param>
/// <param name="KeepDaily">Daily backups kept (1 to 365).</param>
/// <param name="KeepWeekly">Weekly backups kept (1 to 104).</param>
/// <param name="RcloneRemote">The rclone remote <c>name:path</c>; empty: no off-site copy.</param>
/// <param name="RcloneConfig">The text of the rclone.conf; omitted: the stored one stays.</param>
/// <param name="AgeRecipients">Public age keys.</param>
/// <param name="OffsiteUnencrypted">The remote encrypts by itself.</param>
public sealed record UpdateBackupRequest(
    string? Schedule,
    string? Timezone,
    int KeepDaily,
    int KeepWeekly,
    string? RcloneRemote,
    string? RcloneConfig,
    IReadOnlyList<string>? AgeRecipients,
    bool OffsiteUnencrypted);

/// <summary>Where the media address could come from.</summary>
/// <param name="FromHost">The IPv4 address the admin opened the page with (the <c>Host</c> header), if it is one.</param>
/// <param name="Interfaces">IPv4 addresses of the interfaces the API sees (inside Docker these are not the addresses of the host).</param>
public sealed record MediaSuggestionsDto(string? FromHost, IReadOnlyList<string> Interfaces);

/// <summary>Asks for a test of a media address.</summary>
/// <param name="Address">The IPv4 address to announce for the test.</param>
public sealed record MediaTestRequest(string Address);

/// <summary>
/// What the browser needs for the round trip: two participants of a throw-away room. LiveKit announces the tested address
/// for the test (it was restarted with it); the browser connects over the same origin as the page and sends a message from
/// one participant to the other and back.
/// </summary>
/// <param name="Room">The throw-away room.</param>
/// <param name="First">Token of the first participant.</param>
/// <param name="Second">Token of the second participant.</param>
/// <param name="ExpiresAt">When the trial configuration of LiveKit ends if nobody saves the address.</param>
public sealed record MediaTestDto(string Room, LiveKitTokenDto First, LiveKitTokenDto Second, DateTimeOffset ExpiresAt);

/// <summary>Whether the services run the saved settings.</summary>
/// <param name="Caddy">The edge proxy.</param>
/// <param name="LiveKit">The media server.</param>
/// <param name="Backup">The backup service.</param>
public sealed record ApplyStatusDto(ApplyTargetDto Caddy, ApplyTargetDto LiveKit, ApplyTargetDto Backup);

/// <summary>State of one service.</summary>
/// <param name="Applied">True when the service runs the saved settings.</param>
/// <param name="Error">Why not, if the last attempt failed (English, no secrets).</param>
public sealed record ApplyTargetDto(bool Applied, string? Error);

/// <summary>A backup folder.</summary>
/// <param name="Name">Folder name, e.g. <c>2026-10-26_0300_auto</c>; the argument of <c>restore</c>.</param>
/// <param name="At">When it finished.</param>
/// <param name="Bytes">Size of the folder.</param>
/// <param name="Kind"><c>auto</c> or <c>manual</c>.</param>
public sealed record BackupEntryDto(string Name, DateTimeOffset At, long Bytes, string Kind);

/// <summary>The latest backups and the state of the backup service.</summary>
/// <param name="Running">True while a backup runs or waits for the end of a broadcast.</param>
/// <param name="Postponed">True while a run waits for the end of a broadcast.</param>
/// <param name="LastError">Why the last run failed, if it did.</param>
/// <param name="Backups">The latest backups, newest first.</param>
/// <param name="ServiceSeen">False when the backup service has not reported yet (not started, or the status file is missing).</param>
public sealed record BackupsDto(bool ServiceSeen, bool Running, bool Postponed, string? LastError, IReadOnlyList<BackupEntryDto> Backups);
