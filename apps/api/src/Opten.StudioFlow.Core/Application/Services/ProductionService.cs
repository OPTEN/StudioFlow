using Opten.StudioFlow.Core.Application.Ports;
using Opten.StudioFlow.Core.Application.Runtime;
using Opten.StudioFlow.Core.Contracts;
using Opten.StudioFlow.Core.Domain;

namespace Opten.StudioFlow.Core.Application.Services;

/// <summary>Use cases of productions: list, create, activate, broadcast, switching, incidents, snapshot (spec 4.2, 5).</summary>
public sealed class ProductionService(
    ProductionCoordinator coordinator,
    IUnitOfWorkFactory data,
    SnapshotBuilder snapshots,
    ILiveKitTokenIssuer tokens,
    PairingRequestStore requests,
    TimeProvider clock) : IDisposable
{
    /// <summary>LiveKit identity prefix of Regie sessions.</summary>
    public const string StudioIdentityPrefix = "studio_";

    // Creating and activating productions touch the tenant as a whole (unique slug, exactly one active production).
    private readonly SemaphoreSlim tenantGate = new(1, 1);

    /// <summary>All productions.</summary>
    public async Task<IReadOnlyList<ProductionSummaryDto>> ListAsync(CancellationToken cancellationToken)
    {
        await using var unit = data.Create();
        var productions = await unit.Productions.ListAsync(cancellationToken);
        return [.. productions.Select(Dtos.Summary)];
    }

    /// <summary>The active production (the one /join pairs into).</summary>
    public async Task<ProductionSummaryDto> GetActiveAsync(CancellationToken cancellationToken)
    {
        await using var unit = data.Create();
        var active = await unit.Productions.GetActiveAsync(Production.DefaultTenant, cancellationToken) ?? throw StudioFlowException.NotFound("Active production");
        return Dtos.Summary(active);
    }

    /// <summary>Creates a production with the default scenes; it becomes active only when no other production is.</summary>
    public async Task<ProductionDto> CreateAsync(CreateProductionRequest request, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        var name = TextRules.RequireName(request.Name, TextRules.NameMax, "name");
        await tenantGate.WaitAsync(cancellationToken);
        try
        {
            await using var unit = data.Create();
            var existing = await unit.Productions.ListAsync(cancellationToken);
            var slugs = existing.Select(p => p.Slug).ToHashSet(StringComparer.Ordinal);
            var slug = Slugs.MakeUnique(Slugs.FromName(name), slugs.Contains);
            var now = clock.StorageNow();
            var production = Production.Create(
                name,
                slug,
                isActive: !existing.Any(p => p.IsActive),
                now,
                request.Format ?? Canvases.DefaultFormat,
                request.Resolution ?? Canvases.DefaultResolution);
            AddWithDefaultLink(unit, production, now);
            unit.Audit.Add(ProductionCreatedEntry(production, AuditActors.Admin));
            await unit.SaveChangesAsync(CancellationToken.None);
            return Dtos.Production(production);
        }
        finally
        {
            tenantGate.Release();
        }
    }

    /// <summary>Creates the default production “Webinar” (slug <c>webinar</c>, active) when there is none (spec 4.2).</summary>
    public async Task EnsureDefaultProductionAsync(CancellationToken cancellationToken)
    {
        await tenantGate.WaitAsync(cancellationToken);
        try
        {
            await using var unit = data.Create();
            if ((await unit.Productions.ListAsync(cancellationToken)).Count > 0)
            {
                return;
            }

            var now = clock.StorageNow();
            var production = Production.Create("Webinar", "webinar", isActive: true, now);
            AddWithDefaultLink(unit, production, now);
            unit.Audit.Add(ProductionCreatedEntry(production, AuditActors.System));
            await unit.SaveChangesAsync(cancellationToken);
        }
        finally
        {
            tenantGate.Release();
        }
    }

    /// <summary>Every production starts with one output link, so the output page is usable right away.</summary>
    private static void AddWithDefaultLink(IUnitOfWork unit, Production production, DateTimeOffset now)
    {
        unit.Productions.Add(production);
        unit.OutputLinks.Add(OutputLink.Create(production.Id, OutputLink.DefaultName, [], now));
    }

    /// <summary>The full Regie snapshot.</summary>
    public Task<ProductionSnapshot> GetSnapshotAsync(string productionId, CancellationToken cancellationToken) =>
        coordinator.ExecuteAsync(productionId, context => snapshots.BuildAsync(context, cancellationToken), cancellationToken);

    /// <summary>Events since a revision, or a snapshot when they are no longer buffered.</summary>
    public Task<ProductionChangesDto> GetChangesAsync(string productionId, long since, CancellationToken cancellationToken) =>
        coordinator.ExecuteAsync(productionId, context => snapshots.ChangesAsync(context, since, cancellationToken), cancellationToken);

    /// <summary>Renames the production or changes its slates.</summary>
    public Task<ProductionDto> UpdateAsync(string productionId, UpdateProductionRequest request, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        return coordinator.ExecuteAsync(
            productionId,
            async context =>
            {
                var production = await context.ProductionAsync(cancellationToken);
                var catalog = await context.CatalogAsync(cancellationToken);
                var (name, standbySlate, endSlate) = (production.Name, production.StandbySlate, production.EndSlate);
                if (production.Update(request, catalog))
                {
                    EmitProduction(context, production);
                    AuditUpdate(context, production, name, standbySlate, endSlate);
                }

                return Dtos.Production(production);
            },
            cancellationToken);
    }

    /// <summary>
    /// Changes format and resolution of the output canvas; the rescaled scenes and the new canvas reach every client in
    /// one event. Refused while the broadcast is live (<c>broadcast_live</c>).
    /// </summary>
    public Task<ProductionDto> ChangeCanvasAsync(string productionId, ChangeCanvasRequest request, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        var (format, resolution) = Canvases.Required(request.Format, request.Resolution);
        return coordinator.ExecuteAsync(
            productionId,
            async context =>
            {
                var production = await context.ProductionAsync(cancellationToken);
                var from = CanvasText(production);
                if (production.ChangeCanvas(format, resolution) is { } rescaled)
                {
                    var dto = Dtos.Production(production);
                    var scenes = rescaled.Select(Dtos.Scene).ToArray();
                    context.Emit(revision => new ProductionCanvasChangedEvent(revision, dto, scenes));
                    context.Audit(
                        AuditActors.Admin,
                        AuditActions.CanvasChanged,
                        new Dictionary<string, string>(StringComparer.Ordinal) { [AuditDetails.From] = from, [AuditDetails.To] = CanvasText(production) });
                }

                return Dtos.Production(production);
            },
            cancellationToken);
    }

    /// <summary>
    /// Makes the production the active one; every Regie gets <c>resync</c>. Knocks still pending for the previously
    /// active production are dropped with outcome <c>expired</c> (GAP-36: /join always pairs into the active one).
    /// </summary>
    public async Task<ProductionDto> ActivateAsync(string productionId, CancellationToken cancellationToken)
    {
        await tenantGate.WaitAsync(cancellationToken);
        try
        {
            string? previous;
            await using (var unit = data.Create())
            {
                if (!await unit.Productions.ExistsAsync(productionId, cancellationToken))
                {
                    throw StudioFlowException.NotFound("Production");
                }

                previous = (await unit.Productions.GetActiveAsync(Production.DefaultTenant, cancellationToken))?.Id;
            }

            if (string.Equals(previous, productionId, StringComparison.Ordinal))
            {
                return await coordinator.ExecuteAsync(productionId, async context => Dtos.Production(await context.ProductionAsync(cancellationToken)), cancellationToken);
            }

            if (previous is not null)
            {
                await SetActiveAsync(previous, active: false);
                await DropPendingKnocksAsync(previous);
            }

            var activated = await SetActiveAsync(productionId, active: true);
            coordinator.Send(productionId, p => p.RequestStudioResyncAsync(productionId));
            return activated;
        }
        finally
        {
            tenantGate.Release();
        }
    }

    /// <summary>Starts the broadcast.</summary>
    public Task<ProductionDto> StartBroadcastAsync(string productionId, CancellationToken cancellationToken) =>
        ChangeBroadcastAsync(productionId, (p, now) => p.StartBroadcast(now), AuditActions.BroadcastStarted, cancellationToken);

    /// <summary>Ends the broadcast.</summary>
    public Task<ProductionDto> EndBroadcastAsync(string productionId, CancellationToken cancellationToken) =>
        ChangeBroadcastAsync(productionId, (p, now) => p.EndBroadcast(now), AuditActions.BroadcastEnded, cancellationToken);

    /// <summary>Resets the broadcast to standby.</summary>
    public Task<ProductionDto> ResetBroadcastAsync(string productionId, CancellationToken cancellationToken) =>
        ChangeBroadcastAsync(productionId, (p, _) => p.ResetBroadcast(), AuditActions.BroadcastReset, cancellationToken);

    /// <summary>Sets or clears the preview scene.</summary>
    public Task<ProductionDto> SetPreviewAsync(string productionId, SetPreviewRequest request, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        return SwitchAsync(productionId, AuditVia.Click, (p, now) => p.SetPreview(request.SceneId, now), cancellationToken);
    }

    /// <summary>Direct program switch (Studio-Modus off).</summary>
    public Task<ProductionDto> SwitchProgramAsync(string productionId, SwitchProgramRequest request, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        return SwitchAsync(productionId, AuditVia.Click, (p, now) => p.SwitchProgram(request.SceneId, request.Transition, now), cancellationToken);
    }

    /// <summary>Take: the preview goes on air, the old program becomes the preview.</summary>
    public Task<ProductionDto> TakeAsync(string productionId, TakeRequest request, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        return SwitchAsync(productionId, AuditVia.Take, (p, now) => p.Take(request.Transition, now), cancellationToken);
    }

    /// <summary>
    /// Acknowledges a recovered incident (“Seen”); shared by every Regie session. An open incident is
    /// <c>conflict</c>, an unknown or already acknowledged one <c>not_found</c> (UNIT-SRC-02).
    /// </summary>
    public Task AcknowledgeIncidentAsync(string productionId, string incidentId, CancellationToken cancellationToken) =>
        coordinator.ExecuteAsync(
            productionId,
            context =>
            {
                var health = context.Runtime.Sources.Values.FirstOrDefault(h => string.Equals(h.Incident?.Id, incidentId, StringComparison.Ordinal))
                    ?? throw StudioFlowException.NotFound("Message");
                health.Acknowledge(incidentId);
                context.Emit(revision => new IncidentRemovedEvent(revision, incidentId));
                context.Audit(AuditActors.Admin, AuditActions.IncidentAcknowledged, new Dictionary<string, string>(StringComparer.Ordinal) { [AuditDetails.Code] = health.Code });
                return Task.CompletedTask;
            },
            cancellationToken);

    /// <summary>LiveKit token for a Regie session (hidden subscriber).</summary>
    public async Task<LiveKitTokenDto> IssueStudioTokenAsync(string productionId, CancellationToken cancellationToken)
    {
        await using var unit = data.Create();
        if (!await unit.Productions.ExistsAsync(productionId, cancellationToken))
        {
            throw StudioFlowException.NotFound("Production");
        }

        return tokens.IssueViewerToken(productionId, StudioIdentityPrefix + EntityIds.RandomBase32(EntityIds.RandomLength), "Regie");
    }

    /// <summary>The latest telemetry of every device that reported.</summary>
    public Task<IReadOnlyList<DeviceTelemetryMessage>> GetTelemetryAsync(string productionId, CancellationToken cancellationToken) =>
        coordinator.ExecuteAsync<IReadOnlyList<DeviceTelemetryMessage>>(
            productionId,
            context => Task.FromResult<IReadOnlyList<DeviceTelemetryMessage>>(
                [.. context.Runtime.Devices.Where(d => d.Telemetry is not null).Select(d => new DeviceTelemetryMessage(d.DeviceId, d.Telemetry!))]),
            cancellationToken);

    /// <inheritdoc />
    public void Dispose() => tenantGate.Dispose();

    /// <summary>The canvas for the audit log, e.g. <c>Widescreen 1920x1080</c>.</summary>
    private static string CanvasText(Production production) => $"{production.CanvasFormat} {production.Canvas.Width}x{production.Canvas.Height}";

    private static void EmitProduction(MutationContext context, Production production)
    {
        var dto = Dtos.Production(production);
        context.Emit(revision => new ProductionChangedEvent(revision, dto));
    }

    private Task DropPendingKnocksAsync(string productionId) =>
        coordinator.ExecuteAsync(
            productionId,
            context =>
            {
                foreach (var request in requests.RemovePending(productionId, context.Now))
                {
                    context.Emit(revision => new PairingRequestRemovedEvent(revision, request.Id, PairingRequestStatus.Expired));
                }

                return Task.CompletedTask;
            },
            CancellationToken.None);

    private Task<ProductionDto> SetActiveAsync(string productionId, bool active) =>
        coordinator.ExecuteAsync(
            productionId,
            async context =>
            {
                var production = await context.ProductionAsync(CancellationToken.None);
                if (production.SetActive(active))
                {
                    EmitProduction(context, production);
                    if (active)
                    {
                        context.Audit(AuditActors.Admin, AuditActions.ProductionActivated, new Dictionary<string, string>(StringComparer.Ordinal) { [AuditDetails.Name] = production.Name });
                    }
                }

                return Dtos.Production(production);
            },
            CancellationToken.None);

    private Task<ProductionDto> ChangeBroadcastAsync(string productionId, Func<Production, DateTimeOffset, bool> change, string auditAction, CancellationToken cancellationToken) =>
        coordinator.ExecuteAsync(
            productionId,
            async context =>
            {
                var production = await context.ProductionAsync(cancellationToken);
                if (change(production, context.Now))
                {
                    EmitProduction(context, production);
                    context.UpdateOnAir(production);
                    context.Audit(AuditActors.Admin, auditAction);
                }

                return Dtos.Production(production);
            },
            cancellationToken);

    private static AuditEntry ProductionCreatedEntry(Production production, string actor) =>
        AuditEntry.Create(production.Id, production.CreatedAt, actor, AuditActions.ProductionCreated, new Dictionary<string, string>(StringComparer.Ordinal) { [AuditDetails.Name] = production.Name });

    private static void AuditUpdate(MutationContext context, Production production, string previousName, SlateDto previousStandbySlate, SlateDto previousEndSlate)
    {
        if (!string.Equals(production.Name, previousName, StringComparison.Ordinal))
        {
            context.Audit(AuditActors.Admin, AuditActions.ProductionRenamed, new Dictionary<string, string>(StringComparer.Ordinal) { [AuditDetails.From] = previousName, [AuditDetails.Name] = production.Name });
        }

        if (production.StandbySlate != previousStandbySlate)
        {
            context.Audit(AuditActors.Admin, AuditActions.SlateChanged, new Dictionary<string, string>(StringComparer.Ordinal) { [AuditDetails.Slate] = AuditSlates.Standby });
        }

        if (production.EndSlate != previousEndSlate)
        {
            context.Audit(AuditActors.Admin, AuditActions.SlateChanged, new Dictionary<string, string>(StringComparer.Ordinal) { [AuditDetails.Slate] = AuditSlates.End });
        }
    }

    private Task<ProductionDto> SwitchAsync(string productionId, string via, Func<Production, DateTimeOffset, ProgramChange?> change, CancellationToken cancellationToken) =>
        coordinator.ExecuteAsync(
            productionId,
            async context =>
            {
                var production = await context.ProductionAsync(cancellationToken);
                if (change(production, context.Now) is { } switched)
                {
                    context.Emit(revision => new ProgramSwitchedEvent(revision, switched.ProgramSceneId, switched.PreviewSceneId, switched.PreviousProgramSceneId, switched.Transition, switched.At));
                    context.UpdateOnAir(production);
                    if (!string.Equals(switched.ProgramSceneId, switched.PreviousProgramSceneId, StringComparison.Ordinal) && production.FindScene(switched.ProgramSceneId) is { } live)
                    {
                        context.Audit(AuditActors.Admin, AuditActions.SceneLive, new Dictionary<string, string>(StringComparer.Ordinal) { [AuditDetails.Scene] = live.Name, [AuditDetails.Via] = via });
                    }
                }

                return Dtos.Production(production);
            },
            cancellationToken);
}
