using Microsoft.Extensions.Options;
using Opten.FlowStudio.Core.Application;
using Opten.FlowStudio.Core.Application.Services;
using Opten.FlowStudio.Infrastructure.LiveKit;
using Opten.FlowStudio.Infrastructure.Media;
using Opten.FlowStudio.Infrastructure.Persistence;
using Opten.FlowStudio.Infrastructure.Security;
using Opten.FlowStudio.Web.Errors;

namespace Opten.FlowStudio.Web.Hosting;

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
    IOptions<FlowStudioOptions> studio,
    IOptions<PairingOptions> pairing,
    IOptions<LoginLockoutOptions> lockout,
    IOptions<SourceMonitorOptions> sources,
    IOptions<OutputMonitorOptions> output,
    IOptions<RealtimeOptions> realtime,
    ILogger<StartupInitializer> logger) : IHostedService
{
    public async Task StartAsync(CancellationToken cancellationToken)
    {
        // Reading the values runs the validators and throws OptionsValidationException for invalid settings.
        _ = (admin.Value, liveKit.Value, media.Value, studio.Value);
        _ = (pairing.Value, lockout.Value, sources.Value, output.Value, realtime.Value);
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
/// others: every second output staleness, expired knocks, silent devices and the restart watch; invites every 10 s;
/// LiveKit reconcile at startup and every 15 s; last-live times every <c>Sources:LiveMarkInterval</c>; lockout cleanup
/// every minute. A failing step is logged and retried on the next tick.
/// </summary>
internal sealed class MaintenanceWorker(
    OutputService outputs,
    PairingService pairing,
    DeviceSessionService devices,
    SourceRestartWatch restartWatch,
    LiveKitSyncService liveKit,
    LoginThrottle throttle,
    SourceMonitorOptions sources,
    TimeProvider clock,
    ILogger<MaintenanceWorker> logger) : BackgroundService
{
    private static readonly TimeSpan Second = TimeSpan.FromSeconds(1);
    private static readonly TimeSpan InviteInterval = TimeSpan.FromSeconds(10);
    private static readonly TimeSpan ReconcileInterval = TimeSpan.FromSeconds(15);
    private static readonly TimeSpan PruneInterval = TimeSpan.FromMinutes(1);
    private static readonly TimeSpan OutageWarningInterval = TimeSpan.FromMinutes(1);

    private readonly System.Collections.Concurrent.ConcurrentDictionary<string, DateTimeOffset> outageWarnings = new(StringComparer.Ordinal);

    protected override Task ExecuteAsync(CancellationToken stoppingToken) => Task.WhenAll(
        LoopAsync(Second, stoppingToken, ("output status", outputs.TickAsync), ("pairing requests", pairing.ExpireRequestsAsync), ("device reports", devices.ExpireStaleReportsAsync), ("restart watch", restartWatch.CheckAfterStartAsync)),
        LoopAsync(InviteInterval, stoppingToken, ("invites", pairing.MaintainInvitesAsync)),
        ReconcileLoopAsync(stoppingToken),
        LoopAsync(sources.LiveMarkInterval, stoppingToken, ("last-live times", restartWatch.MarkLiveSourcesAsync)),
        LoopAsync(PruneInterval, stoppingToken, ("lockout cleanup", _ =>
        {
            throttle.Prune();
            return Task.CompletedTask;
        })));

    private async Task ReconcileLoopAsync(CancellationToken stoppingToken)
    {
        await RunAsync("LiveKit reconcile", liveKit.ReconcileAsync, stoppingToken);
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
