using System.Net;
using Opten.StudioFlow.Core.Application.Ports;
using Opten.StudioFlow.Core.Application.Runtime;
using Opten.StudioFlow.Core.Contracts;
using Opten.StudioFlow.Core.Domain;

namespace Opten.StudioFlow.Core.Application.Services;

/// <summary>
/// The output page (spec 4.8): key and IP checks, snapshot and changes without private data, LiveKit token, consumer
/// status, key rotation and IP restriction.
/// </summary>
public sealed class OutputService(
    ProductionCoordinator coordinator,
    IUnitOfWorkFactory data,
    ProductionRuntimeRegistry runtimes,
    ILiveKitTokenIssuer tokens,
    LiveKitKicker kicker,
    StudioFlowOptions options)
{
    /// <summary>LiveKit identity prefix of the output pages of a slug.</summary>
    public static string IdentityPrefix(string slug) => $"output_{slug}_";

    /// <summary>Output settings for the Regie.</summary>
    public Task<OutputSettingsDto> GetSettingsAsync(string productionId, CancellationToken cancellationToken) =>
        coordinator.ExecuteAsync(productionId, async context => Settings(await context.ProductionAsync(cancellationToken)), cancellationToken);

    /// <summary>Sets the IP restriction; connected pages from addresses no longer allowed are disconnected.</summary>
    public Task<OutputSettingsDto> UpdateAccessAsync(string productionId, UpdateOutputAccessRequest request, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        return coordinator.ExecuteAsync(
            productionId,
            async context =>
            {
                var production = await context.ProductionAsync(cancellationToken);
                production.SetAllowedIps(request.AllowedIps);
                context.Audit(AuditActors.Admin, AuditActions.OutputAccessChanged, new Dictionary<string, string>(StringComparer.Ordinal) { [AuditDetails.Count] = production.AllowedIps.Count.ToString(System.Globalization.CultureInfo.InvariantCulture) });
                var tracker = context.Runtime.Output;
                foreach (var connectionId in tracker.ConnectionIds.ToList())
                {
                    var address = tracker.AddressOf(connectionId);
                    if (!IpRule.IsAllowed(production.AllowedIps, address is not null && IPAddress.TryParse(address, out var ip) ? ip : null))
                    {
                        AbortOutput(context, connectionId);
                    }
                }

                return Settings(production);
            },
            cancellationToken);
    }

    /// <summary>
    /// Creates a new output key: the old one is invalid immediately, connected pages are disconnected (hub abort and
    /// LiveKit removal of <c>output_{slug}_*</c>).
    /// </summary>
    public async Task<OutputSettingsDto> RegenerateKeyAsync(string productionId, CancellationToken cancellationToken)
    {
        var settings = await coordinator.ExecuteAsync(
            productionId,
            async context =>
            {
                var production = await context.ProductionAsync(cancellationToken);
                production.RegenerateOutputKey(context.Now);
                context.Audit(AuditActors.Admin, AuditActions.OutputKeyRegenerated);
                foreach (var connectionId in context.Runtime.Output.ConnectionIds.ToList())
                {
                    AbortOutput(context, connectionId);
                }

                return (Settings: Settings(production), production.Slug);
            },
            cancellationToken);
        await kicker.KickPrefixAsync(productionId, IdentityPrefix(settings.Slug));
        return settings.Settings;
    }

    /// <summary>
    /// Checks key and address for a REST call. A missing key, a wrong key, an unknown slug and a forbidden address all
    /// give the same 403 (GAP-06: no hint whether the slug exists).
    /// </summary>
    public async Task<OutputKeyInfo> AuthorizeAsync(string slug, string? key, IPAddress? client, CancellationToken cancellationToken)
    {
        await using var unit = data.Create();
        var access = Slugs.IsValid(slug) ? await unit.Productions.GetOutputKeyBySlugAsync(slug, cancellationToken) : null;
        return access is not null && Secrets.FixedTimeEquals(key, access.OutputKey) && IpRule.IsAllowed(access.AllowedIps, client)
            ? access
            : throw NoAccess();
    }

    /// <summary>The one answer for every refused output request.</summary>
    public static StudioFlowException NoAccess() => new(ErrorKind.Forbidden, ErrorCodes.Forbidden, "No access.");

    /// <summary>Finds the production of a key for the output hub (the hub URL carries no slug).</summary>
    public async Task<OutputKeyInfo?> FindByKeyAsync(string? key, IPAddress? client, CancellationToken cancellationToken)
    {
        if (string.IsNullOrEmpty(key))
        {
            return null;
        }

        await using var unit = data.Create();
        OutputKeyInfo? match = null;
        foreach (var access in await unit.Productions.ListOutputKeysAsync(cancellationToken))
        {
            // Compare with every key so the time does not depend on which production matches.
            if (Secrets.FixedTimeEquals(key, access.OutputKey))
            {
                match = access;
            }
        }

        return match is not null && IpRule.IsAllowed(match.AllowedIps, client) ? match : null;
    }

    /// <summary>The output snapshot.</summary>
    public Task<OutputSnapshot> GetSnapshotAsync(OutputKeyInfo access, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(access);
        return coordinator.ExecuteAsync(access.ProductionId, context => SnapshotBuilder.BuildOutputAsync(context, cancellationToken), cancellationToken);
    }

    /// <summary>
    /// Changes since a revision for the output page over REST (the same answer as <c>SubscribeOutput</c>, without joining
    /// the event stream): missed events with private and health-only changes as <c>revisionOnly</c>, or a snapshot.
    /// </summary>
    public Task<OutputChangesDto> GetChangesAsync(OutputKeyInfo access, long since, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(access);
        return coordinator.ExecuteAsync(access.ProductionId, context => SnapshotBuilder.OutputChangesAsync(context, since, cancellationToken), cancellationToken);
    }

    /// <summary>LiveKit token for an output page (hidden subscriber <c>output_{slug}_{random}</c>).</summary>
    public LiveKitTokenDto IssueToken(OutputKeyInfo access)
    {
        ArgumentNullException.ThrowIfNull(access);
        return tokens.IssueViewerToken(access.ProductionId, IdentityPrefix(access.Slug) + EntityIds.RandomBase32(EntityIds.RandomLength), "Output");
    }

    /// <summary>Records a report (REST or hub).</summary>
    public Task ReportAsync(string productionId, OutputReport report, CancellationToken cancellationToken)
    {
        if (report is null)
        {
            throw StudioFlowException.Invalid("report", "The report is missing.");
        }

        return Track(productionId, (tracker, now) => tracker.Report(report, now), cancellationToken);
    }

    /// <summary>An output page connected to the hub.</summary>
    public Task ConnectedAsync(string productionId, string connectionId, string address, CancellationToken cancellationToken) =>
        Track(productionId, (tracker, _) => tracker.Connect(connectionId, address), cancellationToken);

    /// <summary>An output page left the hub; nothing to publish while the host shuts down (OBS-01).</summary>
    public Task DisconnectedAsync(string productionId, string connectionId, CancellationToken cancellationToken) =>
        coordinator.IsHostStopping ? Task.CompletedTask : Track(productionId, (tracker, _) => tracker.Disconnect(connectionId), cancellationToken);

    /// <summary>Subscribes an output hub connection: delta or snapshot, then <c>event</c> messages.</summary>
    public Task<OutputChangesDto> SubscribeAsync(string productionId, string connectionId, long? sinceRevision, CancellationToken cancellationToken) =>
        coordinator.ExecuteAsync(
            productionId,
            async context =>
            {
                var changes = await SnapshotBuilder.OutputChangesAsync(context, sinceRevision, cancellationToken);
                context.Send(p => p.JoinOutputAsync(connectionId, productionId));
                return changes;
            },
            cancellationToken);

    /// <summary>Publishes staleness changes of the output status (1 s maintenance tick).</summary>
    public async Task TickAsync(CancellationToken cancellationToken)
    {
        foreach (var runtime in runtimes.All.Where(r => r.Output.ConnectionIds.Count > 0 || r.Output.Published.State != OutputState.None))
        {
            await Track(runtime.ProductionId, (_, _) => { }, cancellationToken);
        }
    }

    private static void AbortOutput(MutationContext context, string connectionId)
    {
        context.Runtime.Output.Disconnect(connectionId);
        context.Send(p =>
        {
            p.Abort(connectionId);
            return Task.CompletedTask;
        });
        PublishStatus(context);
    }

    private static void PublishStatus(MutationContext context)
    {
        if (context.Runtime.Output.TakeChange(context.Now) is { } status)
        {
            context.Emit(revision => new OutputStatusChangedEvent(revision, status));
        }
    }

    private Task Track(string productionId, Action<OutputTracker, DateTimeOffset> change, CancellationToken cancellationToken) =>
        coordinator.ExecuteAsync(
            productionId,
            context =>
            {
                change(context.Runtime.Output, context.Now);
                PublishStatus(context);
                return Task.CompletedTask;
            },
            cancellationToken);

    private OutputSettingsDto Settings(Production production) => new(
        $"{options.BaseUrl}/o/{production.Slug}?k={production.OutputKey}",
        production.OutputKeyCreatedAt,
        production.AllowedIps,
        options.FrameAncestorList);
}
