using System.Collections.Concurrent;
using Opten.FlowStudio.Core.Contracts;

namespace Opten.FlowStudio.Core.Application.Services;

/// <summary>
/// Regie hub sessions (spec 6): subscribe with delta or snapshot, presence counting and switching between productions.
/// </summary>
public sealed class StudioSessionService(ProductionCoordinator coordinator, SnapshotBuilder snapshots)
{
    private readonly ConcurrentDictionary<string, string> subscriptions = new(StringComparer.Ordinal);

    /// <summary>
    /// Subscribes a connection to a production. The connection joins the event group inside the production lock, so it
    /// misses no event after the returned revision.
    /// </summary>
    public async Task<ProductionChangesDto> SubscribeAsync(string connectionId, string productionId, long? sinceRevision, CancellationToken cancellationToken)
    {
        if (subscriptions.TryGetValue(connectionId, out var previous) && !string.Equals(previous, productionId, StringComparison.Ordinal))
        {
            await LeaveAsync(connectionId, previous);
        }

        // Registered before entering the lock: a disconnect that races with this call removes it, and the lock body
        // below then does not count the closed connection.
        subscriptions[connectionId] = productionId;
        try
        {
            return await coordinator.ExecuteAsync(
                productionId,
                async context =>
                {
                    var result = await snapshots.ChangesAsync(context, sinceRevision, cancellationToken);
                    if (!IsSubscribed(connectionId, productionId) || !context.Runtime.StudioConnections.Add(connectionId))
                    {
                        return result;
                    }

                    var count = context.Runtime.StudioConnections.Count;
                    context.Send(p => p.JoinStudioAsync(connectionId, productionId));
                    context.Send(p => p.PublishPresenceAsync(productionId, count));
                    return result with { Snapshot = result.Snapshot is null ? null : result.Snapshot with { OperatorsOnline = count } };
                },
                cancellationToken);
        }
        catch
        {
            subscriptions.TryRemove(new KeyValuePair<string, string>(connectionId, productionId));
            throw;
        }
    }

    /// <summary>A Regie connection closed; while the host shuts down every Regie goes away, so no presence is published (OBS-01).</summary>
    public async Task DisconnectedAsync(string connectionId)
    {
        if (subscriptions.TryRemove(connectionId, out var productionId) && !coordinator.IsHostStopping)
        {
            await LeaveAsync(connectionId, productionId);
        }
    }

    private bool IsSubscribed(string connectionId, string productionId) =>
        subscriptions.TryGetValue(connectionId, out var current) && string.Equals(current, productionId, StringComparison.Ordinal);

    private Task LeaveAsync(string connectionId, string productionId) =>
        coordinator.ExecuteAsync(
            productionId,
            context =>
            {
                if (context.Runtime.StudioConnections.Remove(connectionId))
                {
                    var count = context.Runtime.StudioConnections.Count;
                    context.Send(p => p.LeaveStudioAsync(connectionId, productionId));
                    context.Send(p => p.PublishPresenceAsync(productionId, count));
                }

                return Task.CompletedTask;
            },
            CancellationToken.None);
}
