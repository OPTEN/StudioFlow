using Opten.StudioFlow.Core.Domain;

namespace Opten.StudioFlow.Core.Application.Ports;

/// <summary>Persistence of the server settings (issue #27): one row.</summary>
public interface IServerSettingsStore
{
    /// <summary>The settings, or null while nothing was saved yet.</summary>
    Task<ServerSettings?> GetAsync(CancellationToken cancellationToken);

    /// <summary>
    /// Creates the row if there is none, applies <paramref name="change"/> and saves it with <paramref name="audit"/> in one
    /// transaction. A concurrent change is retried, so <paramref name="change"/> may run more than once. Returns the saved row.
    /// </summary>
    Task<ServerSettings> UpdateAsync(DateTimeOffset now, Action<ServerSettings> change, AuditEntry audit, CancellationToken cancellationToken);
}

/// <summary>Protects secrets before they are stored (ASP.NET Core Data Protection in the web host).</summary>
public interface ISecretProtector
{
    /// <summary>Encrypts a text.</summary>
    string Protect(string plain);

    /// <summary>Decrypts a text from <see cref="Protect"/>; null when it cannot be read (the keys are gone or the text is damaged).</summary>
    string? Unprotect(string? protectedValue);
}

/// <summary>The admin API of Caddy, reachable on the compose network only.</summary>
public interface ICaddyGateway
{
    /// <summary>False when no admin address is configured (development and tests): nothing is pushed then.</summary>
    bool IsConfigured { get; }

    /// <summary>True when Caddy runs the configuration whose server carries this name.</summary>
    Task<bool> IsLoadedAsync(string serverName, CancellationToken cancellationToken);

    /// <summary>Loads a Caddyfile (<c>POST /load</c>). Throws <see cref="ServerConfigException"/> when Caddy refuses it or cannot be reached.</summary>
    Task LoadAsync(string caddyfile, CancellationToken cancellationToken);
}

/// <summary>The configuration file of the LiveKit supervisor (a shared volume).</summary>
public interface ILiveKitConfigGateway
{
    /// <summary>False when no path is configured (development and tests).</summary>
    bool IsConfigured { get; }

    /// <summary>Writes the configuration when it differs from the file. Returns true when it was written.</summary>
    Task<bool> WriteAsync(string yaml, CancellationToken cancellationToken);

    /// <summary>SHA-256 (lower case hex) of the configuration the supervisor started LiveKit with; null when it has not reported.</summary>
    Task<string?> ReadAppliedHashAsync(CancellationToken cancellationToken);
}

/// <summary>The certificate files for Caddy (a shared volume).</summary>
public interface ICertificateGateway
{
    /// <summary>False when no path is configured (development and tests).</summary>
    bool IsConfigured { get; }

    /// <summary>
    /// Makes the volume hold exactly this pair (names carry <paramref name="fingerprint"/>, so a new certificate changes the
    /// Caddyfile) or nothing when both are null. Returns the paths as Caddy sees them.
    /// </summary>
    Task<CertificateFiles?> SyncAsync(string? fingerprint, string? certificatePem, string? privateKeyPem, CancellationToken cancellationToken);
}

/// <summary>Where Caddy finds the certificate and the key.</summary>
/// <param name="Certificate">Path of the certificate chain in the Caddy container.</param>
/// <param name="Key">Path of the private key in the Caddy container.</param>
public sealed record CertificateFiles(string Certificate, string Key);

/// <summary>The backup service: settings and requests go in, its status file comes out (shared volumes).</summary>
public interface IBackupGateway
{
    /// <summary>False when no path is configured (development and tests).</summary>
    bool IsConfigured { get; }

    /// <summary>Writes the settings file and the rclone configuration when they differ. Returns the SHA-256 of the settings file.</summary>
    Task<string> WriteSettingsAsync(string settingsJson, string? rcloneConfig, CancellationToken cancellationToken);

    /// <summary>Asks the service for a backup now (it removes the request when it starts).</summary>
    Task RequestBackupAsync(CancellationToken cancellationToken);

    /// <summary>The status file of the service, or null when it has not written one.</summary>
    Task<BackupServiceStatus?> ReadStatusAsync(CancellationToken cancellationToken);
}

/// <summary>An expected failure while a configuration is applied (Caddy refused it, the volume is not writable).</summary>
public sealed class ServerConfigException : Exception
{
    /// <summary>Creates the exception; <paramref name="message"/> is shown in the Regie, so it names no secret.</summary>
    public ServerConfigException(string message, Exception? innerException = null)
        : base(message, innerException)
    {
    }
}

/// <summary>The status file of the backup service (<c>infra/backup/status.sh</c> describes every field).</summary>
public sealed record BackupServiceStatus(
    DateTimeOffset? CreatedAt,
    string? State,
    string? SettingsSha256,
    BackupAttemptStatus? LastAttempt,
    BackupSuccessStatus? LastSuccess,
    OffsiteBackupStatus? Offsite,
    IReadOnlyList<BackupFolderStatus>? Backups);

/// <summary>The outcome of a run; <see cref="Message"/> tells why it failed.</summary>
public sealed record BackupAttemptStatus(DateTimeOffset? At, bool Ok, string? Message);

/// <summary>The last complete, verified backup folder.</summary>
public sealed record BackupSuccessStatus(DateTimeOffset At, string? Name, long Bytes);

/// <summary>The optional second target.</summary>
public sealed record OffsiteBackupStatus(bool Configured, bool Encrypted, BackupAttemptStatus? LastAttempt, OffsiteSuccessStatus? LastSuccess);

/// <summary>The last complete off-site copy.</summary>
public sealed record OffsiteSuccessStatus(DateTimeOffset At, string? Name);

/// <summary>A complete backup folder as the service lists it.</summary>
public sealed record BackupFolderStatus(string Name, DateTimeOffset At, long Bytes, string Kind);
