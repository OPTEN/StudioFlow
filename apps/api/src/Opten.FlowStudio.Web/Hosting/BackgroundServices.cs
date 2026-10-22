using Microsoft.Extensions.Options;
using Opten.FlowStudio.Core.Application;
using Opten.FlowStudio.Core.Application.Services;
using Opten.FlowStudio.Infrastructure.LiveKit;
using Opten.FlowStudio.Infrastructure.Media;
using Opten.FlowStudio.Infrastructure.Persistence;
using Opten.FlowStudio.Infrastructure.Security;

namespace Opten.FlowStudio.Web.Hosting;

/// <summary>
/// Startup work that must finish before Kestrel listens (an <see cref="IHostedService"/>, not a background service):
/// configuration validation (the host does not start with missing secrets), migrations, the default production, and a
/// warning when the plain admin password is in use.
/// </summary>
internal sealed class StartupInitializer(
    IServiceProvider services,
    ProductionService productions,
    IOptions<AdminOptions> admin,
    IOptions<LiveKitOptions> liveKit,
    IOptions<MediaOptions> media,
    IOptions<FlowStudioOptions> studio,
    ILogger<StartupInitializer> logger) : IHostedService
{
    public async Task StartAsync(CancellationToken cancellationToken)
    {
        // Reading the values runs the validators and throws OptionsValidationException for invalid settings.
        _ = (admin.Value, liveKit.Value, media.Value, studio.Value);
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
/// Periodic maintenance: output staleness and expired knocks every second, invites every 10 s, LiveKit reconcile at
/// startup and every 15 s, lockout cleanup every minute. A failing step is logged and retried on the next tick.
/// </summary>
internal sealed class MaintenanceWorker(
    OutputService outputs,
    PairingService pairing,
    LiveKitSyncService liveKit,
    LoginThrottle throttle,
    TimeProvider clock,
    ILogger<MaintenanceWorker> logger) : BackgroundService
{
    private static readonly TimeSpan Tick = TimeSpan.FromSeconds(1);
    private const int InviteEvery = 10;
    private const int ReconcileEvery = 15;
    private const int PruneEvery = 60;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await RunAsync("LiveKit reconcile", liveKit.ReconcileAsync, stoppingToken);
        using var timer = new PeriodicTimer(Tick, clock);
        for (var tick = 1L; await timer.WaitForNextTickAsync(stoppingToken); tick++)
        {
            await RunAsync("output status", outputs.TickAsync, stoppingToken);
            await RunAsync("pairing requests", pairing.ExpireRequestsAsync, stoppingToken);
            if (tick % InviteEvery == 0)
            {
                await RunAsync("invites", pairing.MaintainInvitesAsync, stoppingToken);
            }

            if (tick % ReconcileEvery == 0)
            {
                await RunAsync("LiveKit reconcile", liveKit.ReconcileAsync, stoppingToken);
            }

            if (tick % PruneEvery == 0)
            {
                throttle.Prune();
            }
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
        catch (Exception exception) when (exception is not OutOfMemoryException)
        {
            // Maintenance must never stop the host; the next tick retries.
            logger.LogError(exception, "Maintenance step {Step} failed", step);
        }
    }
}
