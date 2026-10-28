using Microsoft.Extensions.Options;
using Opten.StudioFlow.Core.Application;
using Opten.StudioFlow.Core.Application.Runtime;
using Opten.StudioFlow.Core.Application.Services;
using Opten.StudioFlow.Infrastructure.LiveKit;
using Opten.StudioFlow.Infrastructure.Media;
using Opten.StudioFlow.Infrastructure.Persistence;
using Opten.StudioFlow.Infrastructure.Security;
using Opten.StudioFlow.Web.Errors;
using Opten.StudioFlow.Web.Security;

namespace Opten.StudioFlow.Web.Hosting;

/// <summary>
/// Startup work that must finish before Kestrel listens (an <see cref="IHostedService"/>, not a background service):
/// configuration validation (the host does not start with missing secrets or invalid durations and limits), migrations,
/// the default production, the channels of the audio mixer (productions that exist since before it get theirs), the Regie account (while there is none, the first-run setup code is logged) and a warning for
/// the account settings that older versions read from the configuration and that are ignored now.
/// </summary>
internal sealed class StartupInitializer(
    IServiceProvider services,
    ProductionService productions,
    AudioMixerService audioMixer,
    AdminAccountState account,
    AdminSessions adminSessions,
    ServerSettingsState serverSettings,
    ServerConfigApplier serverConfig,
    IConfiguration configuration,
    IOptions<AdminOptions> admin,
    IOptions<LiveKitOptions> liveKit,
    IOptions<MediaOptions> media,
    IOptions<StudioFlowOptions> studio,
    IOptions<PairingOptions> pairing,
    IOptions<LoginLockoutOptions> lockout,
    IOptions<SourceMonitorOptions> sources,
    IOptions<OutputMonitorOptions> output,
    IOptions<RealtimeOptions> realtime,
    IOptions<DatabaseOptions> database,
    IOptions<BackupOptions> backup,
    IOptions<AuditOptions> audit,
    IOptions<TransferOptions> transfer,
    IOptions<InstallOptions> install,
    ILogger<StartupInitializer> logger) : IHostedService
{
    /// <summary>Keys of <c>Admin:</c> that older versions used for the account.</summary>
    private static readonly string[] IgnoredAccountSettings = ["Username", "Password", "PasswordHash"];

    public async Task StartAsync(CancellationToken cancellationToken)
    {
        // Reading the values runs the validators and throws OptionsValidationException for invalid settings.
        _ = (admin.Value, liveKit.Value, media.Value, studio.Value);
        _ = (pairing.Value, lockout.Value, sources.Value, output.Value, realtime.Value, database.Value, backup.Value, audit.Value, transfer.Value, install.Value);
        await DatabaseMaintenance.MigrateAsync(services, cancellationToken);
        await productions.EnsureDefaultProductionAsync(cancellationToken);
        await audioMixer.SyncAllAsync(cancellationToken);
        await account.RefreshAsync(cancellationToken);
        await adminSessions.LoadAsync(cancellationToken);
        await serverSettings.RefreshAsync(cancellationToken);
        await ApplyServerSettingsAsync(cancellationToken);
        WarnAboutIgnoredAccountSettings();
    }

    /// <summary>
    /// Brings Caddy, LiveKit and the backup service to the saved settings at once. They may still be starting; the
    /// maintenance loop tries again every few seconds, so a failure here only delays the first apply.
    /// </summary>
    private async Task ApplyServerSettingsAsync(CancellationToken cancellationToken)
    {
        try
        {
            await serverConfig.ApplyAsync(cancellationToken);
        }
        catch (Exception exception) when (exception is not OperationCanceledException and not OutOfMemoryException)
        {
            logger.LogWarning(exception, "The server settings could not be applied at startup; the maintenance loop tries again");
        }
    }

    /// <summary>The Regie account moved into the database (issue #4); say so instead of silently ignoring the old settings.</summary>
    private void WarnAboutIgnoredAccountSettings()
    {
        var ignored = IgnoredAccountSettings.Where(key => !string.IsNullOrEmpty(configuration[$"{AdminOptions.Section}:{key}"])).ToList();
        if (ignored.Count > 0)
        {
            logger.LogWarning(
                "The settings {Settings} are ignored: the Regie account is created in the first-run setup and stored in the database. Remove them from the configuration",
                string.Join(", ", ignored.Select(key => $"{AdminOptions.Section}:{key}")));
        }
    }

    public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;
}

/// <summary>
/// Periodic maintenance in independent loops, so a slow step (LiveKit unreachable, database down) never delays the
/// others: every second output staleness, expired knocks, silent devices with held-back telemetry and the restart
/// watch; invites every 10 s; LiveKit reconcile at startup and every 15 s; last-live times every
/// <c>Sources:LiveMarkInterval</c>; the Regie account every 5 s; lockout cleanup every minute; the audit retention every
/// <c>Audit:MaintenanceInterval</c>. A failing step is logged and retried on the next tick.
/// The loops end as soon as the host begins to stop (OBS-01): a tick during the shutdown would only see the hub
/// connections closing and must not evaluate sources.
/// </summary>
internal sealed class MaintenanceWorker(
    OutputService outputs,
    PairingService pairing,
    DeviceSessionService devices,
    SourceRestartWatch restartWatch,
    LiveKitSyncService liveKit,
    LoginThrottle throttle,
    AdminAccountState account,
    ServerSettingsState serverSettings,
    ServerConfigApplier serverConfig,
    AdminSessions adminSessions,
    AuditRetentionService auditRetention,
    AuditOptions audit,
    SourceMonitorOptions sources,
    HostShutdown shutdown,
    TimeProvider clock,
    ILogger<MaintenanceWorker> logger) : BackgroundService
{
    private static readonly TimeSpan Second = TimeSpan.FromSeconds(1);
    private static readonly TimeSpan InviteInterval = TimeSpan.FromSeconds(10);
    private static readonly TimeSpan ReconcileInterval = TimeSpan.FromSeconds(15);
    private static readonly TimeSpan AccountInterval = TimeSpan.FromSeconds(5);
    private static readonly TimeSpan PruneInterval = TimeSpan.FromMinutes(1);
    private static readonly TimeSpan OutageWarningInterval = TimeSpan.FromMinutes(1);

    private readonly System.Collections.Concurrent.ConcurrentDictionary<string, DateTimeOffset> outageWarnings = new(StringComparer.Ordinal);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var stopping = CancellationTokenSource.CreateLinkedTokenSource(stoppingToken, shutdown.Token);
        var token = stopping.Token;
        await Task.WhenAll(
            LoopAsync(Second, token, ("output status", outputs.TickAsync), ("pairing requests", pairing.ExpireRequestsAsync), ("devices", devices.TickAsync), ("restart watch", restartWatch.CheckAfterStartAsync)),
            LoopAsync(InviteInterval, token, ("invites", pairing.MaintainInvitesAsync)),
            LoopAsync(AccountInterval, token, ("admin account", RefreshAccountAsync), ("signed-out sessions", adminSessions.StorePendingAsync), ("server settings", ApplyServerSettingsAsync)),
            ReconcileLoopAsync(token),
            LoopAsync(sources.LiveMarkInterval, token, ("last-live times", restartWatch.MarkLiveSourcesAsync)),
            LoopAsync(PruneInterval, token, ("lockout cleanup", PruneLockoutsAsync), ("signed-out sessions cleanup", adminSessions.PruneAsync)),
            LoopAsync(audit.MaintenanceInterval, token, ("audit retention", auditRetention.RunAsync)));
    }

    /// <summary>Notices a <c>reset-admin</c> (or any change made in another process) and ends the sessions that are no longer valid.</summary>
    private async Task RefreshAccountAsync(CancellationToken cancellationToken)
    {
        if (await account.RefreshAsync(cancellationToken))
        {
            adminSessions.EndAllExcept(null);
        }
    }

    /// <summary>Notices settings saved by another process (a restore) and brings Caddy, LiveKit and the backup service to the saved state, also after one of them restarted.</summary>
    private async Task ApplyServerSettingsAsync(CancellationToken cancellationToken)
    {
        await serverSettings.RefreshAsync(cancellationToken);
        await serverConfig.ApplyAsync(cancellationToken);
    }

    private Task PruneLockoutsAsync(CancellationToken cancellationToken)
    {
        throttle.Prune();
        return Task.CompletedTask;
    }

    private async Task ReconcileLoopAsync(CancellationToken stoppingToken)
    {
        try
        {
            await RunAsync("LiveKit reconcile", liveKit.ReconcileAsync, stoppingToken);
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
            return;
        }

        await LoopAsync(ReconcileInterval, stoppingToken, ("LiveKit reconcile", liveKit.ReconcileAsync));
    }

    private async Task LoopAsync(TimeSpan interval, CancellationToken stoppingToken, params (string Step, Func<CancellationToken, Task> Work)[] steps)
    {
        using var timer = new PeriodicTimer(interval, clock);
        try
        {
            while (await timer.WaitForNextTickAsync(stoppingToken))
            {
                foreach (var (step, work) in steps)
                {
                    await RunAsync(step, work, stoppingToken);
                }
            }
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
            // Host shutdown.
        }
    }

    private async Task RunAsync(string step, Func<CancellationToken, Task> work, CancellationToken stoppingToken)
    {
        try
        {
            await work(stoppingToken);
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception exception) when (DatabaseOutage.IsOutage(exception))
        {
            // An operational state (GAP-32): one warning per step and minute instead of a stack trace every second.
            var now = clock.GetUtcNow();
            if (!outageWarnings.TryGetValue(step, out var last) || now - last >= OutageWarningInterval)
            {
                outageWarnings[step] = now;
                logger.LogWarning("Maintenance step {Step} skipped: the database is not reachable", step);
            }
        }
        catch (Exception exception) when (exception is not OutOfMemoryException)
        {
            // Maintenance must never stop the host; the next tick retries.
            logger.LogError(exception, "Maintenance step {Step} failed", step);
        }
    }
}
