using Opten.StudioFlow.Core.Application.Ports;
using Opten.StudioFlow.Core.Application.Runtime;
using Opten.StudioFlow.Core.Domain;

namespace Opten.StudioFlow.Core.Application.Services;

/// <summary>
/// No outage goes unnoticed across an API restart (spec 12, GAP-08): the last-live time of every device source is
/// persisted (on each change of «live», and every <c>Sources:LiveMarkInterval</c> while it stays live). Once
/// <c>Sources:RestartGrace</c> (15 s) after the start has passed, every source that was live within
/// <c>Sources:RestartLiveWindow</c> (12 h), is used in the program or preview scene and whose device has not come back
/// becomes <c>reconnecting</c> with an incident («K1 verbindet neu»). Devices that return in time show no incident.
/// </summary>
public sealed class SourceRestartWatch(
    ProductionCoordinator coordinator,
    IUnitOfWorkFactory data,
    ProductionRuntimeRegistry runtimes,
    SourceMonitorOptions options,
    TimeProvider clock)
{
    private int checkedAfterStart;

    /// <summary>True once the check after the start has run.</summary>
    public bool HasChecked => Volatile.Read(ref checkedAfterStart) == 1;

    /// <summary>
    /// Runs the check once the grace time after the start has passed (called every second; a failure, e.g. while the
    /// database is down, is retried on the next call).
    /// </summary>
    public async Task CheckAfterStartAsync(CancellationToken cancellationToken)
    {
        var now = clock.GetUtcNow();
        if (HasChecked || now - runtimes.StartedAt < options.RestartGrace)
        {
            return;
        }

        IReadOnlyList<SourceLastLive> recent;
        await using (var unit = data.Create())
        {
            recent = await unit.SourceActivity.ListLiveSinceAsync(now - options.RestartLiveWindow, cancellationToken);
        }

        foreach (var production in recent.GroupBy(r => r.ProductionId, StringComparer.Ordinal))
        {
            await FlagMissingAsync(production.Key, [.. production], cancellationToken);
        }

        Volatile.Write(ref checkedAfterStart, 1);
    }

    /// <summary>Persists the last-live time of every live source (every <c>Sources:LiveMarkInterval</c>).</summary>
    public async Task MarkLiveSourcesAsync(CancellationToken cancellationToken)
    {
        foreach (var runtime in runtimes.All)
        {
            await coordinator.ExecuteAsync(
                runtime.ProductionId,
                context =>
                {
                    SourceMonitor.MarkLiveSources(context);
                    return Task.CompletedTask;
                },
                cancellationToken);
        }
    }

    private async Task FlagMissingAsync(string productionId, IReadOnlyList<SourceLastLive> sources, CancellationToken cancellationToken)
    {
        try
        {
            await coordinator.ExecuteAsync(
                productionId,
                async context =>
                {
                    var production = await context.ProductionAsync(cancellationToken);
                    var onAir = OnAirState.From(production);
                    foreach (var source in sources.Where(s => onAir.ProgramSources.Contains(s.SourceId) || onAir.PreviewSources.Contains(s.SourceId)))
                    {
                        var device = await context.Data.Devices.GetAsync(source.DeviceId, cancellationToken);
                        var slot = device?.Slots.FirstOrDefault(s => string.Equals(device.SourceIdOf(s), source.SourceId, StringComparison.Ordinal));
                        if (device is not null && slot is not null && string.Equals(device.ProductionId, productionId, StringComparison.Ordinal))
                        {
                            SourceMonitor.MarkMissingAfterRestart(context, device, slot, runtimes.StartedAt);
                        }
                    }
                },
                cancellationToken);
        }
        catch (StudioFlowException exception) when (exception.Kind == ErrorKind.NotFound)
        {
            // The production was deleted meanwhile: nothing to watch.
        }
    }
}
