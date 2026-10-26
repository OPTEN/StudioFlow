namespace Opten.StudioFlow.Core.Domain;

/// <summary>
/// The settings of the installation that the first-run wizard collects and the "Server settings" page changes (issue
/// #27; table <c>server_settings</c>). There is exactly one row: the primary key is the constant <see cref="OnlyId"/>.
/// Secrets (DNS credentials, private key of a custom certificate, rclone configuration) are stored protected with ASP.NET
/// Core Data Protection (the properties ending in <c>Protected</c>); no endpoint returns them.
/// </summary>
public sealed class ServerSettings
{
    /// <summary>Id of the only row.</summary>
    public const int OnlyId = 1;

    private ServerSettings()
    {
    }

    /// <summary>Always <see cref="OnlyId"/>.</summary>
    public int Id { get; private set; } = OnlyId;

    /// <summary>Counts every change, so a process notices that another process (a restore) changed the row.</summary>
    public long Revision { get; private set; }

    /// <summary>
    /// The IPv4 address LiveKit announces to the devices. Null until the wizard saved it; the installation counts as
    /// configured from then on (<see cref="IsConfigured"/>).
    /// </summary>
    public string? MediaAddress { get; private set; }

    /// <summary>Certificate mode, see <see cref="TlsModes"/>.</summary>
    public string TlsMode { get; private set; } = TlsModes.Internal;

    /// <summary>Host name of the Regie. Optional in mode <c>internal</c>, required in the others.</summary>
    public string? Domain { get; private set; }

    /// <summary>E-mail for the Let's Encrypt account (dns-* modes); optional.</summary>
    public string? AcmeEmail { get; private set; }

    /// <summary>Where the TXT record of the DNS challenge is written when <c>_acme-challenge</c> is delegated by CNAME; optional.</summary>
    public string? DnsChallengeDomain { get; private set; }

    /// <summary>The credentials of the DNS provider as a protected JSON object (field name → value).</summary>
    public string? DnsCredentialsProtected { get; private set; }

    /// <summary>The uploaded certificate chain (PEM; public, so stored as it is).</summary>
    public string? CertificatePem { get; private set; }

    /// <summary>The private key of the uploaded certificate, protected.</summary>
    public string? PrivateKeyProtected { get; private set; }

    /// <summary>Origins allowed to embed the output, separated by spaces (<c>'self'</c> is always allowed and not stored).</summary>
    public string FrameAncestors { get; private set; } = string.Empty;

    /// <summary>Cron expression of the automatic backups; null: off.</summary>
    public string? BackupSchedule { get; private set; }

    /// <summary>Time zone of the schedule and of the backup folder names (IANA name); null: UTC.</summary>
    public string? BackupTimezone { get; private set; }

    /// <summary>How many daily backups are kept.</summary>
    public int BackupKeepDaily { get; private set; } = DefaultKeepDaily;

    /// <summary>How many weekly backups are kept.</summary>
    public int BackupKeepWeekly { get; private set; } = DefaultKeepWeekly;

    /// <summary>The rclone remote (<c>name:path</c>) of the optional off-site copy; null: none.</summary>
    public string? RcloneRemote { get; private set; }

    /// <summary>The rclone.conf that defines the remote, protected.</summary>
    public string? RcloneConfigProtected { get; private set; }

    /// <summary>Public age keys that encrypt the off-site copy, separated by spaces.</summary>
    public string AgeRecipients { get; private set; } = string.Empty;

    /// <summary>The off-site copy may be unencrypted because the remote encrypts it itself.</summary>
    public bool OffsiteUnencrypted { get; private set; }

    /// <summary>When the row was last changed.</summary>
    public DateTimeOffset UpdatedAt { get; private set; }

    /// <summary>Default of <see cref="BackupKeepDaily"/>.</summary>
    public static int DefaultKeepDaily => 7;

    /// <summary>Default of <see cref="BackupKeepWeekly"/>.</summary>
    public static int DefaultKeepWeekly => 4;

    /// <summary>True once the wizard saved the media address: the installation can serve devices.</summary>
    public bool IsConfigured => !string.IsNullOrEmpty(MediaAddress);

    /// <summary>The origins allowed to embed the output as a list.</summary>
    public IReadOnlyList<string> FrameAncestorList => FrameAncestors.Split(' ', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

    /// <summary>The age recipients as a list.</summary>
    public IReadOnlyList<string> AgeRecipientList => AgeRecipients.Split(' ', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

    /// <summary>A new, still unconfigured row with the defaults.</summary>
    public static ServerSettings CreateDefault(DateTimeOffset now) => new() { UpdatedAt = now };

    /// <summary>Sets the media address.</summary>
    public void ChangeMediaAddress(string address, DateTimeOffset now)
    {
        MediaAddress = address;
        Touch(now);
    }

    /// <summary>Sets the address and certificate mode. The credentials stay as they are when <paramref name="dnsCredentialsProtected"/> is null.</summary>
    public void ChangeAddress(string tlsMode, string? domain, string? acmeEmail, string? dnsChallengeDomain, string? dnsCredentialsProtected, DateTimeOffset now)
    {
        TlsMode = tlsMode;
        Domain = domain;
        AcmeEmail = acmeEmail;
        DnsChallengeDomain = dnsChallengeDomain;
        DnsCredentialsProtected = TlsModes.IsDns(tlsMode) ? dnsCredentialsProtected ?? DnsCredentialsProtected : null;
        if (!string.Equals(tlsMode, TlsModes.Custom, StringComparison.Ordinal))
        {
            CertificatePem = null;
            PrivateKeyProtected = null;
        }

        Touch(now);
    }

    /// <summary>Stores an uploaded certificate with its protected key.</summary>
    public void ChangeCertificate(string certificatePem, string privateKeyProtected, DateTimeOffset now)
    {
        CertificatePem = certificatePem;
        PrivateKeyProtected = privateKeyProtected;
        Touch(now);
    }

    /// <summary>Sets the origins allowed to embed the output.</summary>
    public void ChangeEmbedding(IEnumerable<string> origins, DateTimeOffset now)
    {
        FrameAncestors = string.Join(' ', origins);
        Touch(now);
    }

    /// <summary>Sets the backup schedule and the off-site target. The rclone configuration stays when <paramref name="rcloneConfigProtected"/> is null and the remote stays set.</summary>
    public void ChangeBackup(
        string? schedule,
        string? timezone,
        int keepDaily,
        int keepWeekly,
        string? rcloneRemote,
        string? rcloneConfigProtected,
        IEnumerable<string> ageRecipients,
        bool offsiteUnencrypted,
        DateTimeOffset now)
    {
        BackupSchedule = schedule;
        BackupTimezone = timezone;
        BackupKeepDaily = keepDaily;
        BackupKeepWeekly = keepWeekly;
        RcloneRemote = rcloneRemote;
        RcloneConfigProtected = rcloneRemote is null ? null : rcloneConfigProtected ?? RcloneConfigProtected;
        AgeRecipients = string.Join(' ', ageRecipients);
        OffsiteUnencrypted = offsiteUnencrypted;
        Touch(now);
    }

    private void Touch(DateTimeOffset now)
    {
        Revision++;
        UpdatedAt = now;
    }
}
