using Microsoft.Extensions.Logging;
using Opten.StudioFlow.Core.Application.Ports;
using Opten.StudioFlow.Core.Domain;

namespace Opten.StudioFlow.Core.Application;

/// <summary>
/// The server settings in memory (issue #27), so URLs, QR codes and the output's embedding list are built without a
/// database round trip and keep working while the database is down. The use cases that change the settings replace the
/// state; <see cref="RefreshAsync"/> re-reads the row and notices a change made in another process (a restore).
/// </summary>
public sealed class ServerSettingsState(IServerSettingsStore store, InstallOptions install, ILogger<ServerSettingsState> logger)
{
    private readonly Lock gate = new();
    private volatile ServerSettings? current;
    private long version;

    /// <summary>The saved row, or null while nothing was saved.</summary>
    public ServerSettings? Row => current;

    /// <summary>True once the wizard saved the media address.</summary>
    public bool Configured => current?.IsConfigured == true;

    /// <summary>The published HTTPS port.</summary>
    public int HttpsPort => install.HttpsPort;

    /// <summary>
    /// The address devices open: <c>https://</c>, the domain (else the media address, else <c>localhost</c>) and the HTTPS
    /// port unless it is 443. Every link the API builds starts with it.
    /// </summary>
    public string BaseUrl
    {
        get
        {
            var row = current;
            var host = row?.Domain ?? row?.MediaAddress ?? "localhost";
            return install.HttpsPort == 443 ? $"https://{host}" : $"https://{host}:{install.HttpsPort}";
        }
    }

    /// <summary>The CSP sources that may frame the output: <c>'self'</c> and the saved origins.</summary>
    public IReadOnlyList<string> FrameAncestorSources => ["'self'", .. current?.FrameAncestorList ?? []];

    /// <summary>The cron expression of the automatic backups, or null when they are off.</summary>
    public string? BackupSchedule => current?.BackupSchedule;

    /// <summary>Takes over a row that a use case saved.</summary>
    public void Replace(ServerSettings settings)
    {
        ArgumentNullException.ThrowIfNull(settings);
        lock (gate)
        {
            current = settings;
            version++;
        }
    }

    /// <summary>
    /// Reads the row. Returns true when it differs from what was known (it was saved, changed or removed elsewhere). A use
    /// case that saves while the row is read wins: its newer state is kept.
    /// </summary>
    public async Task<bool> RefreshAsync(CancellationToken cancellationToken)
    {
        var versionBefore = Volatile.Read(ref version);
        var stored = await store.GetAsync(cancellationToken);
        lock (gate)
        {
            if (version != versionBefore || (stored?.Revision == current?.Revision && (stored is null) == (current is null)))
            {
                return false;
            }

            current = stored;
            version++;
        }

        logger.LogInformation("The server settings were {Change}", stored is null ? "removed" : "loaded");
        return true;
    }
}
