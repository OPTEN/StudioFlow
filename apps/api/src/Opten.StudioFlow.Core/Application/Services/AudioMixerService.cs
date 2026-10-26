using System.Globalization;
using Opten.StudioFlow.Core.Application.Ports;
using Opten.StudioFlow.Core.Contracts;
using Opten.StudioFlow.Core.Domain;

namespace Opten.StudioFlow.Core.Application.Services;

/// <summary>
/// Use cases of the audio mixer (spec 4.4, issue #7). The mixer is one state per production, changed like a scene: every
/// change is one revisioned <c>audioChannelsChanged</c> event for the Regie and the output page, which mixes the sound from
/// it. The channels follow the sources: a source that can carry sound gets its channel when it is created, and loses it
/// with the source (<see cref="AudioMixerSync"/>).
/// </summary>
public sealed class AudioMixerService(ProductionCoordinator coordinator, IUnitOfWorkFactory data)
{
    /// <summary>
    /// Sets channels (fader, mute, mode, sync offset). Every listed channel replaces the stored one; the others stay, so two
    /// Regie seats that move different faders never undo each other. A request is applied completely or not at all
    /// (<c>validation_failed</c> with the field paths). A request that changes nothing sends no event. The audit log gets one
    /// entry per change, except while a fader is dragged (<see cref="SetAudioChannelsRequest.Adjusting"/>). Returns the
    /// channels of the production.
    /// </summary>
    public Task<IReadOnlyList<AudioChannelDto>> SetChannelsAsync(string productionId, SetAudioChannelsRequest request, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        return coordinator.ExecuteAsync(
            productionId,
            async context =>
            {
                var production = await context.ProductionAsync(cancellationToken);
                var catalog = await context.CatalogAsync(cancellationToken);
                var changes = production.ApplyAudioChannels(request.Channels, catalog);
                if (changes.Count > 0)
                {
                    var changed = changes.Select(c => c.After).ToList();
                    context.Emit(revision => new AudioChannelsChangedEvent(revision, changed));
                    context.UpdateOnAir(production);
                    if (!request.Adjusting)
                    {
                        foreach (var change in changes)
                        {
                            AuditChange(context, catalog.Find(change.After.SourceId)!, change);
                        }
                    }
                }

                return production.AudioChannels;
            },
            cancellationToken);
    }

    /// <summary>
    /// Gives every production the channels of the sources it has (idempotent; run at the start of the API). Productions that
    /// exist since before the mixer get theirs here, and a source whose channel went missing gets it back.
    /// </summary>
    public async Task SyncAllAsync(CancellationToken cancellationToken)
    {
        IReadOnlyList<string> productionIds;
        await using (var unit = data.Create())
        {
            productionIds = [.. (await unit.Productions.ListAsync(cancellationToken)).Select(p => p.Id)];
        }

        foreach (var productionId in productionIds)
        {
            await coordinator.ExecuteAsync(
                productionId,
                async context =>
                {
                    var production = await context.ProductionAsync(cancellationToken);
                    var created = production.SyncAudioChannels(await context.CatalogAsync(cancellationToken));
                    if (created.Count > 0)
                    {
                        context.Emit(revision => new AudioChannelsChangedEvent(revision, created));
                        context.UpdateOnAir(production);
                    }
                },
                cancellationToken);
        }
    }

    private static void AuditChange(MutationContext context, SourceEntry source, AudioChannelChange change)
    {
        var (before, after) = (change.Before, change.After);
        if (before.Muted != after.Muted)
        {
            Audit(context, source, after.Muted ? AuditAudioChanges.Muted : AuditAudioChanges.Unmuted, null);
        }

        if (before.GainDb != after.GainDb)
        {
            Audit(context, source, AuditAudioChanges.Gain, after.GainDb.ToString("0.#", CultureInfo.InvariantCulture));
        }

        if (before.Mode != after.Mode)
        {
            Audit(context, source, AuditAudioChanges.Mode, after.Mode.ToString().ToLowerInvariant());
        }

        if (before.SyncOffsetMs != after.SyncOffsetMs)
        {
            Audit(context, source, AuditAudioChanges.SyncOffset, after.SyncOffsetMs.ToString(CultureInfo.InvariantCulture));
        }
    }

    private static void Audit(MutationContext context, SourceEntry source, string change, string? value)
    {
        var details = new Dictionary<string, string>(StringComparer.Ordinal)
        {
            [AuditDetails.Code] = source.Code,
            [AuditDetails.Name] = source.Label,
            [AuditDetails.Change] = change,
        };
        if (value is not null)
        {
            details[AuditDetails.Value] = value;
        }

        context.Audit(AuditActors.Admin, AuditActions.AudioChanged, details);
    }
}

/// <summary>
/// Keeps the mixer in step with the sources inside the mutation that creates or removes them: a new source that can carry
/// sound gets its channel (with the defaults of <see cref="AudioMixerRules.DefaultChannel"/>) and the clients get it as
/// <c>audioChannelsChanged</c>; a removed source takes its channel with it (clients drop it on <c>sourceRemoved</c>).
/// </summary>
internal static class AudioMixerSync
{
    /// <summary>The slots of a device were created.</summary>
    public static Task AddAsync(MutationContext context, Device device, IEnumerable<DeviceSlot> slots, CancellationToken cancellationToken) =>
        AddAsync(context, slots.Select(slot => SourceCatalog.DeviceEntry(device, slot)), cancellationToken);

    /// <summary>An asset was created.</summary>
    public static Task AddAsync(MutationContext context, Asset asset, CancellationToken cancellationToken) =>
        AddAsync(context, [SourceCatalog.AssetEntry(asset)], cancellationToken);

    /// <summary>Sources were removed (a released slot, a deleted device or asset).</summary>
    public static async Task RemoveAsync(MutationContext context, IEnumerable<string> sourceIds, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(context);
        var production = await context.ProductionAsync(cancellationToken);
        if (production.RemoveAudioChannels(sourceIds))
        {
            context.UpdateOnAir(production);
        }
    }

    private static async Task AddAsync(MutationContext context, IEnumerable<SourceEntry> sources, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(context);
        var production = await context.ProductionAsync(cancellationToken);
        var created = production.AddAudioChannels(sources);
        if (created.Count > 0)
        {
            context.Emit(revision => new AudioChannelsChangedEvent(revision, created));
            context.UpdateOnAir(production);
        }
    }
}
