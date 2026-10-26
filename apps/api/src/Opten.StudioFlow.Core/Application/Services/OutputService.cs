using System.Globalization;
using System.Net;
using Opten.StudioFlow.Core.Application.Ports;
using Opten.StudioFlow.Core.Application.Runtime;
using Opten.StudioFlow.Core.Contracts;
using Opten.StudioFlow.Core.Domain;

namespace Opten.StudioFlow.Core.Application.Services;

/// <summary>
/// The output page (spec 4.8): the named output links of a production (create, rename, IP restriction, key rotation,
/// revocation), key and IP checks, snapshot and changes without private data, LiveKit token and consumer status per link.
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

    /// <summary>LiveKit identity prefix of the output pages of one link.</summary>
    public static string LinkIdentityPrefix(string slug, string linkId) => $"{IdentityPrefix(slug)}{linkId}_";

    /// <summary>Output links and settings for the Regie.</summary>
    public Task<OutputSettingsDto> GetSettingsAsync(string productionId, CancellationToken cancellationToken) =>
        coordinator.ExecuteAsync(
            productionId,
            async context =>
            {
                var production = await context.ProductionAsync(cancellationToken);
                await context.EnsureOutputLinksAsync(cancellationToken);
                var links = await context.Data.OutputLinks.ListAsync(productionId, cancellationToken);
                return Settings(production.Slug, links);
            },
            cancellationToken);

    /// <summary>Creates a named output link with a new key.</summary>
    public Task<OutputLinkDto> CreateLinkAsync(string productionId, CreateOutputLinkRequest request, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        return coordinator.ExecuteAsync(
            productionId,
            async context =>
            {
                var production = await context.ProductionAsync(cancellationToken);
                await context.EnsureOutputLinksAsync(cancellationToken);
                var links = await context.Data.OutputLinks.ListAsync(productionId, cancellationToken);
                var link = OutputLink.Create(productionId, request.Name, links, context.Now);
                context.Data.OutputLinks.Add(link);
                context.Audit(AuditActors.Admin, AuditActions.OutputLinkCreated, LinkDetails(link));
                PublishLinks(context, [.. links, link]);
                return Link(production.Slug, link);
            },
            cancellationToken);
    }

    /// <summary>Renames an output link.</summary>
    public Task<OutputLinkDto> RenameLinkAsync(string productionId, string linkId, RenameOutputLinkRequest request, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        return coordinator.ExecuteAsync(
            productionId,
            async context =>
            {
                var production = await context.ProductionAsync(cancellationToken);
                await context.EnsureOutputLinksAsync(cancellationToken);
                var link = await RequireLinkAsync(context, linkId, cancellationToken);
                var links = await context.Data.OutputLinks.ListAsync(productionId, cancellationToken);
                link.Rename(request.Name, links);
                context.Audit(AuditActors.Admin, AuditActions.OutputLinkRenamed, LinkDetails(link));
                PublishLinks(context, links);
                return Link(production.Slug, link);
            },
            cancellationToken);
    }

    /// <summary>Sets the IP restriction of a link; connected pages of the link from addresses no longer allowed are disconnected.</summary>
    public Task<OutputLinkDto> UpdateAccessAsync(string productionId, string linkId, UpdateOutputAccessRequest request, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        return coordinator.ExecuteAsync(
            productionId,
            async context =>
            {
                var production = await context.ProductionAsync(cancellationToken);
                await context.EnsureOutputLinksAsync(cancellationToken);
                var link = await RequireLinkAsync(context, linkId, cancellationToken);
                link.SetAllowedIps(request.AllowedIps);
                var details = LinkDetails(link);
                details[AuditDetails.Count] = link.AllowedIps.Count.ToString(CultureInfo.InvariantCulture);
                context.Audit(AuditActors.Admin, AuditActions.OutputAccessChanged, details);
                var tracker = context.Runtime.Output;
                foreach (var connectionId in tracker.ConnectionIdsOf(link.Id))
                {
                    var address = tracker.AddressOf(connectionId);
                    if (!IpRule.IsAllowed(link.AllowedIps, address is not null && IPAddress.TryParse(address, out var ip) ? ip : null))
                    {
                        AbortOutput(context, connectionId);
                    }
                }

                PublishStatus(context);
                return Link(production.Slug, link);
            },
            cancellationToken);
    }

    /// <summary>
    /// Creates a new key for a link: the old one is invalid immediately and the pages of this link are disconnected (hub
    /// abort and LiveKit removal of <c>output_{slug}_{linkId}_*</c>); the other links are not affected.
    /// </summary>
    public async Task<OutputLinkDto> RegenerateKeyAsync(string productionId, string linkId, CancellationToken cancellationToken)
    {
        var (link, slug) = await coordinator.ExecuteAsync(
            productionId,
            async context =>
            {
                var production = await context.ProductionAsync(cancellationToken);
                await context.EnsureOutputLinksAsync(cancellationToken);
                var link = await RequireLinkAsync(context, linkId, cancellationToken);
                link.RegenerateKey(context.Now);
                context.Audit(AuditActors.Admin, AuditActions.OutputKeyRegenerated, LinkDetails(link));
                AbortLink(context, link.Id);
                PublishStatus(context);
                return (Link(production.Slug, link), production.Slug);
            },
            cancellationToken);
        await kicker.KickPrefixAsync(productionId, LinkIdentityPrefix(slug, linkId));
        return link;
    }

    /// <summary>Revokes a link: its key is invalid immediately and its pages are disconnected; the other links are not affected.</summary>
    public async Task RevokeLinkAsync(string productionId, string linkId, CancellationToken cancellationToken)
    {
        var slug = await coordinator.ExecuteAsync(
            productionId,
            async context =>
            {
                var production = await context.ProductionAsync(cancellationToken);
                await context.EnsureOutputLinksAsync(cancellationToken);
                var links = await context.Data.OutputLinks.ListAsync(productionId, cancellationToken);
                var link = links.FirstOrDefault(l => string.Equals(l.Id, linkId, StringComparison.Ordinal)) ?? throw StudioFlowException.NotFound("Output link");
                context.Data.OutputLinks.Remove(link);
                context.Audit(AuditActors.Admin, AuditActions.OutputLinkRevoked, LinkDetails(link));
                AbortLink(context, link.Id);
                PublishLinks(context, links.Where(l => l != link));
                return production.Slug;
            },
            cancellationToken);
        await kicker.KickPrefixAsync(productionId, LinkIdentityPrefix(slug, linkId));
    }

    /// <summary>
    /// Checks key and address for a REST call. A missing key, a wrong key, an unknown slug and a forbidden address all
    /// give the same 403 (GAP-06: no hint whether the slug exists).
    /// </summary>
    public async Task<OutputLinkAccess> AuthorizeAsync(string slug, string? key, IPAddress? client, CancellationToken cancellationToken)
    {
        await using var unit = data.Create();
        var links = Slugs.IsValid(slug) ? await unit.OutputLinks.ListAccessBySlugAsync(slug, cancellationToken) : [];
        return Allowed(OutputLinkAccess.Find(links, key), client) ?? throw NoAccess();
    }

    /// <summary>The one answer for every refused output request.</summary>
    public static StudioFlowException NoAccess() => new(ErrorKind.Forbidden, ErrorCodes.Forbidden, "No access.");

    /// <summary>Finds the link of a key for the output hub (the hub URL carries no slug).</summary>
    public async Task<OutputLinkAccess?> FindByKeyAsync(string? key, IPAddress? client, CancellationToken cancellationToken)
    {
        if (string.IsNullOrEmpty(key))
        {
            return null;
        }

        await using var unit = data.Create();
        return Allowed(OutputLinkAccess.Find(await unit.OutputLinks.ListAllAccessAsync(cancellationToken), key), client);
    }

    /// <summary>The output snapshot.</summary>
    public Task<OutputSnapshot> GetSnapshotAsync(OutputLinkAccess access, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(access);
        return coordinator.ExecuteAsync(access.ProductionId, context => SnapshotBuilder.BuildOutputAsync(context, cancellationToken), cancellationToken);
    }

    /// <summary>
    /// Changes since a revision for the output page over REST (the same answer as <c>SubscribeOutput</c>, without joining
    /// the event stream): missed events with private and health-only changes as <c>revisionOnly</c>, or a snapshot.
    /// </summary>
    public Task<OutputChangesDto> GetChangesAsync(OutputLinkAccess access, long since, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(access);
        return coordinator.ExecuteAsync(access.ProductionId, context => SnapshotBuilder.OutputChangesAsync(context, since, cancellationToken), cancellationToken);
    }

    /// <summary>LiveKit token for an output page (hidden subscriber <c>output_{slug}_{linkId}_{random}</c>).</summary>
    public LiveKitTokenDto IssueToken(OutputLinkAccess access)
    {
        ArgumentNullException.ThrowIfNull(access);
        return tokens.IssueViewerToken(access.ProductionId, LinkIdentityPrefix(access.Slug, access.LinkId) + EntityIds.RandomBase32(EntityIds.RandomLength), "Output");
    }

    /// <summary>Records a report (REST or hub) of a link.</summary>
    public Task ReportAsync(string productionId, string linkId, OutputReport report, CancellationToken cancellationToken)
    {
        if (report is null)
        {
            throw StudioFlowException.Invalid("report", "The report is missing.");
        }

        return Track(productionId, (tracker, now) => tracker.Report(linkId, report, now), cancellationToken);
    }

    /// <summary>
    /// An output page connected to the hub. A page whose link was revoked a moment ago is disconnected at once.
    /// </summary>
    public Task ConnectedAsync(string productionId, string linkId, string connectionId, string address, CancellationToken cancellationToken) =>
        coordinator.ExecuteAsync(
            productionId,
            async context =>
            {
                await context.EnsureOutputLinksAsync(cancellationToken);
                if (await context.Data.OutputLinks.GetAsync(productionId, linkId, cancellationToken) is not { } link)
                {
                    AbortOutput(context, connectionId);
                    return;
                }

                link.MarkSeen(context.Now);
                context.Runtime.Output.Connect(connectionId, linkId, address);
                PublishStatus(context);
            },
            cancellationToken);

    /// <summary>An output page left the hub; nothing to publish while the host shuts down (OBS-01).</summary>
    public Task DisconnectedAsync(string productionId, string connectionId, CancellationToken cancellationToken) =>
        coordinator.IsHostStopping
            ? Task.CompletedTask
            : coordinator.ExecuteAsync(
                productionId,
                async context =>
                {
                    await context.EnsureOutputLinksAsync(cancellationToken);
                    var tracker = context.Runtime.Output;
                    if (tracker.LinkOf(connectionId) is not { } linkId)
                    {
                        return;
                    }

                    tracker.Disconnect(connectionId);
                    (await context.Data.OutputLinks.GetAsync(productionId, linkId, cancellationToken))?.MarkSeen(context.Now);
                    PublishStatus(context);
                },
                cancellationToken);

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

    private static OutputLinkAccess? Allowed(OutputLinkAccess? access, IPAddress? client) =>
        access is not null && IpRule.IsAllowed(access.AllowedIps, client) ? access : null;

    private static async Task<OutputLink> RequireLinkAsync(MutationContext context, string linkId, CancellationToken cancellationToken) =>
        await context.Data.OutputLinks.GetAsync(context.ProductionId, linkId, cancellationToken) ?? throw StudioFlowException.NotFound("Output link");

    private static Dictionary<string, string> LinkDetails(OutputLink link) =>
        new(StringComparer.Ordinal) { [AuditDetails.Name] = link.Name };

    private static void AbortLink(MutationContext context, string linkId)
    {
        foreach (var connectionId in context.Runtime.Output.ConnectionIdsOf(linkId))
        {
            AbortOutput(context, connectionId);
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
    }

    /// <summary>The links changed (created, renamed, revoked): the status names them again and is published.</summary>
    private static void PublishLinks(MutationContext context, IEnumerable<OutputLink> links)
    {
        context.Runtime.Output.SetLinks(links.Select(l => (l.Id, l.Name)));
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
            async context =>
            {
                await context.EnsureOutputLinksAsync(cancellationToken);
                change(context.Runtime.Output, context.Now);
                PublishStatus(context);
            },
            cancellationToken);

    private OutputSettingsDto Settings(string slug, IReadOnlyList<OutputLink> links) =>
        new([.. links.Select(l => Link(slug, l))], OutputLink.MaxPerProduction, options.FrameAncestorList);

    private OutputLinkDto Link(string slug, OutputLink link) =>
        new(link.Id, link.Name, $"{options.BaseUrl}/o/{slug}?k={link.Key}", link.KeyCreatedAt, link.LastSeenAt, link.AllowedIps);
}
