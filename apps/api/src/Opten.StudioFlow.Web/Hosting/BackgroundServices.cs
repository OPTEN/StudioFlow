using Microsoft.Extensions.Options;
using Opten.StudioFlow.Core.Application;
using Opten.StudioFlow.Core.Application.Runtime;
using Opten.StudioFlow.Core.Application.Services;
using Opten.StudioFlow.Infrastructure.LiveKit;
using Opten.StudioFlow.Infrastructure.Media;
using Opten.StudioFlow.Infrastructure.Persistence;
using Opten.StudioFlow.Infrastructure.Security;
using Opten.StudioFlow.Web.Errors;

namespace Opten.StudioFlow.Web.Hosting;

/// <summary>
/// Startup work that must finish before Kestrel listens (an <see cref="IHostedService"/>, not a background service):
/// configuration validation (the host does not start with missing secrets or invalid durations and limits), migrations,
/// the default production, and a warning when the plain admin password is in use.
/// </summary>
internal sealed class StartupInitializer(
    IServiceProvider services,
    ProductionService productions,
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
    ILogger<StartupInitializer> logger) : IHostedService
{
    public async Task StartAsync(CancellationToken cancellationToken)
    {
        // Reading the values runs the validators and throws OptionsValidationException for invalid settings.
        _ = (admin.Value, liveKit.Value, media.Value, studio.Value);
        _ = (pairing.Value, lockout.Value, sources.Value, output.Value, realtime.Value, database.Value);
        await DatabaseMaintenance.MigrateAsync(services, cancellationToken);
        await productions.EnsureDefaultProductionAsync(cancellationToken);
        if (admin.Value.UsesPlainPassword)
        {
            logger.LogWarning("The admin password is configured in plain text (Admin:Password); use Admin:PasswordHash outside local setups");
        }
    }

    public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;
}

/// <summary>
/// Periodic maintenance in independent loops, so a slow step (LiveKit unreachable, database down) never delays the
/// others: every second output staleness, expired knocks, silent devices with held-back telemetry and the restart
/// watch; invites every 10 s; LiveKit reconcile at startup and every 15 s; last-live times every
/// <c>Sources:LiveMarkInterval</c>; lockout cleanup every minute. A failing step is logged and retried on the next tick.
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
    SourceMonitorOptions sources,
    HostShutdown shutdown,
    TimeProvider clock,
    ILogger<MaintenanceWorker> logger) : BackgroundService
{
    private static readonly TimeSpan Second = TimeSpan.FromSeconds(1);
    private static readonly TimeSpan InviteInterval = TimeSpan.FromSeconds(10);
    private static readonly TimeSpan ReconcileInterval = TimeSpan.FromSeconds(15);
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
            ReconcileLoopAsync(token),
            LoopAsync(sources.LiveMarkInterval, token, ("last-live times", restartWatch.MarkLiveSourcesAsync)),
            LoopAsync(PruneInterval, token, ("lockout cleanup", PruneLockoutsAsync)));
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
