using Microsoft.Extensions.Logging;
using Opten.StudioFlow.Core.Application.Ports;
using Opten.StudioFlow.Core.Application.Runtime;
using Opten.StudioFlow.Core.Domain;

namespace Opten.StudioFlow.Core.Application.Services;

/// <summary>
/// Keeps the published-track state in sync with LiveKit (spec 7): applies verified webhooks, reconciles with
/// <c>ListParticipants</c> at startup and every 15 s, and removes blocked or deleted devices that join again with a
/// still valid token (a kick is not a ban).
/// </summary>
public sealed class LiveKitSyncService(
    ProductionCoordinator coordinator,
    IUnitOfWorkFactory data,
    ProductionRuntimeRegistry runtimes,
    ILiveKitRoomClient rooms,
    LiveKitKicker kicker,
    ILogger<LiveKitSyncService> logger)
{
    /// <summary>Applies a webhook. Events of unknown rooms are ignored.</summary>
    public async Task HandleAsync(LiveKitEvent webhook, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(webhook);
        if (webhook.Kind == LiveKitEventKind.Other || !EntityIds.IsValid(webhook.Room, EntityIds.Production) || !await ProductionExistsAsync(webhook.Room, cancellationToken))
        {
            return;
        }

        var unwanted = await coordinator.ExecuteAsync(
            webhook.Room,
            context =>
            {
                var present = webhook.Kind == LiveKitEventKind.ParticipantJoined && webhook.Identity is { } joined ? new HashSet<string>(StringComparer.Ordinal) { joined } : [];
                return ApplyAsync(context, context.Runtime.Room.Apply(webhook), present, cancellationToken);
            },
            cancellationToken);
        await KickAsync(webhook.Room, unwanted);
    }

    /// <summary>Replaces the track state of every production with the participants LiveKit lists.</summary>
    public async Task ReconcileAsync(CancellationToken cancellationToken)
    {
        IReadOnlyList<string> productionIds;
        await using (var unit = data.Create())
        {
            productionIds = [.. (await unit.Productions.ListAsync(cancellationToken)).Select(p => p.Id)];
        }

        foreach (var productionId in productionIds)
        {
            IReadOnlyList<LiveKitParticipant> participants;
            try
            {
                participants = await rooms.ListParticipantsAsync(productionId, cancellationToken);
            }
            catch (LiveKitUnavailableException exception)
            {
                // LiveKit being down is an operational state, not a bug: no stack trace every 15 s.
                logger.LogWarning("LiveKit reconcile skipped: {Reason}", exception.Message);
                return;
            }

            var unwanted = await coordinator.ExecuteAsync(
                productionId,
                context => ApplyAsync(context, context.Runtime.Room.Replace(participants), participants.Select(p => p.Identity).ToHashSet(StringComparer.Ordinal), cancellationToken),
                cancellationToken);
            await KickAsync(productionId, unwanted);
        }
    }

    /// <summary>
    /// Re-evaluates the devices whose tracks may have changed and returns the device identities that are in the room but
    /// must not be (blocked, deleted or from another production).
    /// </summary>
    private static async Task<IReadOnlyList<string>> ApplyAsync(MutationContext context, IEnumerable<string> affected, HashSet<string> present, CancellationToken cancellationToken)
    {
        var unwanted = new List<string>();
        foreach (var identity in affected.Concat(present).Where(i => EntityIds.IsValid(i, EntityIds.Device)).Distinct(StringComparer.Ordinal))
        {
            var device = await context.Data.Devices.GetAsync(identity, cancellationToken);
            if (device is null || !string.Equals(device.ProductionId, context.ProductionId, StringComparison.Ordinal))
            {
                if (present.Contains(identity))
                {
                    unwanted.Add(identity);
                }

                continue;
            }

            if (device.IsBlocked && present.Contains(identity))
            {
                unwanted.Add(identity);
            }

            SourceMonitor.Reevaluate(context, device);
        }

        return unwanted;
    }

    private async Task<bool> ProductionExistsAsync(string productionId, CancellationToken cancellationToken)
    {
        if (runtimes.Find(productionId) is not null)
        {
            return true;
        }

        await using var unit = data.Create();
        return await unit.Productions.ExistsAsync(productionId, cancellationToken);
    }

    private async Task KickAsync(string room, IReadOnlyList<string> identities)
    {
        foreach (var identity in identities)
        {
            logger.LogInformation("Removing {Identity} from {Room}: blocked or unknown device", identity, room);
            await kicker.KickAsync(room, identity);
        }
    }
}
