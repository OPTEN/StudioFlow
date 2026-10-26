using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Opten.StudioFlow.Core.Application;
using Opten.StudioFlow.Core.Application.Ports;

namespace Opten.StudioFlow.Infrastructure.Install;

/// <summary>Writes files into the shared volumes through which the API configures LiveKit, Caddy and the backup service.</summary>
internal static class SharedVolumeFiles
{
    /// <summary>
    /// Writes <paramref name="content"/> to <paramref name="path"/> when the file differs (a temporary file next to it, then
    /// a rename, so a reader never sees half a file). Returns true when it wrote. <paramref name="worldReadable"/> files
    /// are readable by the service on the other side of the volume (it runs as another user); the others are for the owner
    /// and the backup service, which reads with <c>DAC_READ_SEARCH</c>.
    /// </summary>
    public static async Task<bool> WriteIfChangedAsync(string path, string content, bool worldReadable, string what, CancellationToken cancellationToken)
    {
        try
        {
            if (File.Exists(path) && string.Equals(await File.ReadAllTextAsync(path, cancellationToken), content, StringComparison.Ordinal))
            {
                return false;
            }

            var temporary = Path.Combine(Path.GetDirectoryName(path)!, "." + Path.GetFileName(path) + ".tmp");
            await File.WriteAllTextAsync(temporary, content, new UTF8Encoding(false), cancellationToken);
            Protect(temporary, worldReadable);
            File.Move(temporary, path, overwrite: true);
            return true;
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
        {
            throw new ServerConfigException($"The folder of the {what} is not writable. Check: docker compose logs init", exception);
        }
    }

    /// <summary>Sets the mode of a file the API wrote (owner read and write; others read only when <paramref name="worldReadable"/>).</summary>
    public static void Protect(string path, bool worldReadable)
    {
        if (!OperatingSystem.IsWindows())
        {
            File.SetUnixFileMode(path, worldReadable ? UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.GroupRead | UnixFileMode.OtherRead : UnixFileMode.UserRead | UnixFileMode.UserWrite);
        }
    }

    /// <summary>Lower case hex SHA-256 of a text.</summary>
    public static string Hash(string content) => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(content)));
}

/// <summary>
/// <c>livekit.yaml</c> in the volume the LiveKit supervisor watches (<c>infra/livekit</c>): it restarts the server when the
/// file changes and writes <c>applied.json</c> with the hash of the file it started the server with. The file holds the
/// LiveKit secret; the volume is mounted into the API and the LiveKit container only.
/// </summary>
internal sealed class LiveKitConfigFiles(InstallOptions install) : ILiveKitConfigGateway
{
    private const string ConfigName = "livekit.yaml";
    private const string AppliedName = "applied.json";

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public bool IsConfigured => !string.IsNullOrEmpty(install.LiveKitConfigPath);

    public Task<bool> WriteAsync(string yaml, CancellationToken cancellationToken) =>
        SharedVolumeFiles.WriteIfChangedAsync(Path.Combine(install.LiveKitConfigPath, ConfigName), yaml, worldReadable: true, "LiveKit configuration", cancellationToken);

    public async Task<string?> ReadAppliedHashAsync(CancellationToken cancellationToken)
    {
        try
        {
            await using var stream = File.OpenRead(Path.Combine(install.LiveKitConfigPath, AppliedName));
            return (await JsonSerializer.DeserializeAsync<Applied>(stream, JsonOptions, cancellationToken))?.ConfigSha256;
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException or JsonException)
        {
            return null;
        }
    }

    private sealed record Applied(string? ConfigSha256);
}

/// <summary>The uploaded certificate and key in the volume Caddy reads them from (<c>/certs</c> in the Caddy container).</summary>
internal sealed class CaddyCertificateFiles(InstallOptions install) : ICertificateGateway
{
    public bool IsConfigured => !string.IsNullOrEmpty(install.CaddyCertsPath);

    public async Task<CertificateFiles?> SyncAsync(string? fingerprint, string? certificatePem, string? privateKeyPem, CancellationToken cancellationToken)
    {
        var directory = install.CaddyCertsPath;
        if (fingerprint is null || certificatePem is null || privateKeyPem is null)
        {
            Remove(directory, keep: []);
            return null;
        }

        // The file names carry the fingerprint: a new certificate changes the Caddyfile, so Caddy loads it.
        var suffix = fingerprint[..16];
        var certificate = $"cert-{suffix}.pem";
        var key = $"key-{suffix}.pem";

        // The key is readable by Caddy, which runs as another user; the volume is mounted into the API and Caddy only.
        await SharedVolumeFiles.WriteIfChangedAsync(Path.Combine(directory, certificate), certificatePem, worldReadable: true, "certificate", cancellationToken);
        await SharedVolumeFiles.WriteIfChangedAsync(Path.Combine(directory, key), privateKeyPem, worldReadable: true, "certificate", cancellationToken);
        Remove(directory, keep: [certificate, key]);
        var mount = install.CaddyCertsMount.TrimEnd('/');
        return new CertificateFiles($"{mount}/{certificate}", $"{mount}/{key}");
    }

    private static void Remove(string directory, string[] keep)
    {
        try
        {
            foreach (var file in Directory.EnumerateFiles(directory, "*.pem").Where(f => !keep.Contains(Path.GetFileName(f), StringComparer.Ordinal)))
            {
                File.Delete(file);
            }
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
        {
            // Old files that stay behind do no harm; the next call tries again.
        }
    }
}

/// <summary>
/// The backup service's side of the shared volumes: <c>backup-settings.json</c>, the optional <c>rclone.conf</c> and the
/// request file of "Back up now" go in; the status file of the service comes out (the API mounts that volume read-only).
/// </summary>
internal sealed class BackupFiles(InstallOptions install, BackupOptions backup) : IBackupGateway
{
    private const string SettingsName = "backup-settings.json";
    private const string RcloneName = "rclone.conf";
    private const string RequestName = "backup-now";

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public bool IsConfigured => !string.IsNullOrEmpty(install.BackupConfigPath);

    public async Task<string> WriteSettingsAsync(string settingsJson, string? rcloneConfig, CancellationToken cancellationToken)
    {
        var directory = install.BackupConfigPath;
        var rclonePath = Path.Combine(directory, RcloneName);
        if (rcloneConfig is null)
        {
            DeleteQuietly(rclonePath);
        }
        else
        {
            // Secret: the owner and the backup service (DAC_READ_SEARCH) read it.
            await SharedVolumeFiles.WriteIfChangedAsync(rclonePath, rcloneConfig, worldReadable: false, "backup settings", cancellationToken);
        }

        await SharedVolumeFiles.WriteIfChangedAsync(Path.Combine(directory, SettingsName), settingsJson, worldReadable: true, "backup settings", cancellationToken);
        return SharedVolumeFiles.Hash(settingsJson);
    }

    public async Task RequestBackupAsync(CancellationToken cancellationToken)
    {
        try
        {
            await File.WriteAllTextAsync(Path.Combine(install.BackupConfigPath, RequestName), DateTimeOffset.UtcNow.ToString("O", System.Globalization.CultureInfo.InvariantCulture), cancellationToken);
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
        {
            throw new ServerConfigException("The folder of the backup settings is not writable. Check: docker compose logs init", exception);
        }
    }

    public Task<BackupServiceStatus?> ReadStatusAsync(CancellationToken cancellationToken) => ReadStatusFileAsync(backup.StatusFile, cancellationToken);

    /// <summary>Reads the status file of the backup service; null when it does not exist, is empty or cannot be read.</summary>
    internal static async Task<BackupServiceStatus?> ReadStatusFileAsync(string path, CancellationToken cancellationToken)
    {
        if (string.IsNullOrEmpty(path))
        {
            return null;
        }

        try
        {
            await using var stream = File.OpenRead(path);
            return await JsonSerializer.DeserializeAsync<BackupServiceStatus>(stream, JsonOptions, cancellationToken);
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException or JsonException)
        {
            return null;
        }
    }

    private static void DeleteQuietly(string path)
    {
        try
        {
            File.Delete(path);
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
        {
            // The next call tries again.
        }
    }
}
