using Opten.StudioFlow.Core.Application.Runtime;
using Opten.StudioFlow.Core.Contracts;
using Opten.StudioFlow.Core.Domain;

namespace Opten.StudioFlow.Core.Application;

/// <summary>Builds the full Regie and output snapshots inside the production lock, so their revision is exact.</summary>
public sealed class SnapshotBuilder(PairingRequestStore pairingRequests, StudioFlowOptions options)
{
    /// <summary>Entries of "Recent events" in the snapshot.</summary>
    public const int RecentLogSize = 20;

    /// <summary>The Regie snapshot.</summary>
    public async Task<ProductionSnapshot> BuildAsync(MutationContext context, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(context);
        var (production, devices, assets) = await LoadAsync(context, cancellationToken);
        var runtime = context.Runtime;
        var catalog = new SourceCatalog(devices, assets);
        var invites = await context.Data.Invites.ListOpenAsync(production.Id, context.Now, cancellationToken);
        var log = await context.Data.Audit.ListRecentAsync(production.Id, LogTexts.Actions, RecentLogSize * 3, cancellationToken);
        var sourceIds = catalog.All.Select(s => s.Id).ToHashSet(StringComparer.Ordinal);
        return new ProductionSnapshot(
            runtime.Revision,
            context.Now,
            Dtos.Production(production),
            [.. production.OrderedScenes.Select(Dtos.Scene)],
            [.. catalog.All.Select(e => Dtos.Source(e, runtime.Sources.GetValueOrDefault(e.Id)))],
            [.. devices.Select(d => Dtos.Device(d, runtime.FindDevice(d.Id)))],
            [.. assets.Select(Dtos.Asset)],
            [.. pairingRequests.Pending(production.Id, context.Now).Select(r => r.ToDto())],
            [.. invites.OrderBy(i => i.CreatedAt).Select(i => Dtos.Invite(i, options.BaseUrl))],
            [.. runtime.Sources.Values.Where(h => h.Incident is not null && sourceIds.Contains(h.SourceId)).Select(h => h.Incident!).OrderBy(i => i.StartedAt)],
            runtime.Output.Current(context.Now),
            [.. log.Select(e => (e.At, Described: LogTexts.Describe(e))).Where(e => e.Described is not null).Take(RecentLogSize).Select(e => new LogEntryDto(e.At, e.Described!.Value.Code, e.Described.Value.Params, e.Described.Value.Text))],
            runtime.StudioConnections.Count);
    }

    /// <summary>The output snapshot: no devices, pairing, incidents, log or output status; sources without health.</summary>
    public static async Task<OutputSnapshot> BuildOutputAsync(MutationContext context, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(context);
        var (production, devices, assets) = await LoadAsync(context, cancellationToken);
        var catalog = new SourceCatalog(devices, assets);
        return new OutputSnapshot(
            context.Runtime.Revision,
            context.Now,
            Dtos.Production(production),
            [.. production.OrderedScenes.Select(Dtos.Scene)],
            [.. catalog.All.Select(e => OutputView.WithoutHealth(Dtos.Source(e, null)))],
            [.. assets.Select(Dtos.Asset)]);
    }

    /// <summary>
    /// Answers a (re)subscribe (GAP-20): the missed events when the ring still has all of them (also an empty list when
    /// the client is current), else a snapshot (unknown, too old or future revision, or none given). A negative
    /// revision is <c>validation_failed</c>.
    /// </summary>
    public async Task<ProductionChangesDto> ChangesAsync(MutationContext context, long? sinceRevision, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(context);
        EnsureValid(sinceRevision);
        if (sinceRevision is { } since && context.Runtime.Events.TryGetSince(since, context.Runtime.Revision, out var missed))
        {
            return new ProductionChangesDto(context.Runtime.Revision, missed, null);
        }

        var snapshot = await BuildAsync(context, cancellationToken);
        return new ProductionChangesDto(snapshot.Revision, null, snapshot);
    }

    /// <summary>The output variant of <see cref="ChangesAsync"/>: private and health-only changes are <c>revisionOnly</c>.</summary>
    public static async Task<OutputChangesDto> OutputChangesAsync(MutationContext context, long? sinceRevision, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(context);
        EnsureValid(sinceRevision);
        if (sinceRevision is { } since && context.Runtime.Events.TryGetOutputSince(since, context.Runtime.Revision, out var missed))
        {
            return new OutputChangesDto(context.Runtime.Revision, missed, null);
        }

        var snapshot = await BuildOutputAsync(context, cancellationToken);
        return new OutputChangesDto(snapshot.Revision, null, snapshot);
    }

    private static void EnsureValid(long? sinceRevision)
    {
        if (sinceRevision < 0)
        {
            throw StudioFlowException.Invalid("since", "Die Revision muss 0 oder grösser sein.");
        }
    }

    private static async Task<(Production Production, IReadOnlyList<Device> Devices, IReadOnlyList<Asset> Assets)> LoadAsync(MutationContext context, CancellationToken cancellationToken)
    {
        var production = await context.Data.Productions.GetAsync(context.ProductionId, cancellationToken) ?? throw StudioFlowException.NotFound("Die Produktion");
        context.Runtime.OnAir ??= OnAirState.From(production);
        var devices = await context.Data.Devices.ListAsync(production.Id, cancellationToken);
        var assets = await context.Data.Assets.ListAsync(production.Id, cancellationToken);
        return (production, devices, assets);
    }
}
