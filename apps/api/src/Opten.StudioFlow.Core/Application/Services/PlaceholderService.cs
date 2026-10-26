using Opten.StudioFlow.Core.Contracts;
using Opten.StudioFlow.Core.Domain;

namespace Opten.StudioFlow.Core.Application.Services;

/// <summary>
/// Use cases of the placeholders of a copied production (spec 4.4, issue #14): assign a placeholder to a source, or remove it
/// with its scene items. Both change every scene that shows the placeholder, so the clients get the changed scenes as
/// <c>sceneUpserted</c> and then <c>placeholderRemoved</c>.
/// </summary>
public sealed class PlaceholderService(ProductionCoordinator coordinator)
{
    /// <summary>
    /// Every scene item that shows the placeholder shows the source from now on. A device source that no scene uses yet takes
    /// over the code of the placeholder (“Use as K1” makes the new phone K1, as in the production it was copied from);
    /// a source that is in use already keeps its code, because the operators know it by it.
    /// </summary>
    public Task<PlaceholderChangeDto> AssignAsync(string productionId, string placeholderId, AssignPlaceholderRequest request, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        return coordinator.ExecuteAsync(
            productionId,
            async context =>
            {
                var production = await context.ProductionAsync(cancellationToken);
                var catalog = await context.CatalogAsync(cancellationToken);
                var placeholder = production.GetPlaceholder(placeholderId);
                var target = request.SourceId is null ? null : catalog.Find(request.SourceId);
                var takesCode = target is { Device: not null, Slot: not null } && target.Kind == placeholder.Kind && !production.UsesSource(target.Id);

                var change = production.AssignPlaceholder(placeholderId, request.SourceId, catalog);
                var label = target!.Label;
                var code = target.Code;
                if (takesCode)
                {
                    var device = target.Device!;
                    var slot = device.RecodeSlot(target.Slot!.Slot, placeholder.Code);
                    code = slot.Code;
                    SourceMonitor.Recoded(context, device, slot);
                    await DeviceEvents.SendSelfAsync(context, device, cancellationToken);
                    context.RefreshTallies();
                }

                EmitChange(context, production, change);
                context.Audit(
                    AuditActors.Admin,
                    AuditActions.PlaceholderAssigned,
                    new Dictionary<string, string>(StringComparer.Ordinal)
                    {
                        [AuditDetails.Code] = placeholder.Code,
                        [AuditDetails.Target] = $"{code} {label}",
                    });
                return new PlaceholderChangeDto(change.Scenes.Count, change.Items);
            },
            cancellationToken);
    }

    /// <summary>Removes the placeholder and every scene item that shows it (and every fallback that names it).</summary>
    public Task<PlaceholderChangeDto> RemoveAsync(string productionId, string placeholderId, CancellationToken cancellationToken) =>
        coordinator.ExecuteAsync(
            productionId,
            async context =>
            {
                var production = await context.ProductionAsync(cancellationToken);
                var change = production.RemovePlaceholder(placeholderId);
                EmitChange(context, production, change);
                context.Audit(AuditActors.Admin, AuditActions.PlaceholderRemoved, new Dictionary<string, string>(StringComparer.Ordinal) { [AuditDetails.Code] = change.Placeholder.Code });
                return new PlaceholderChangeDto(change.Scenes.Count, change.Items);
            },
            cancellationToken);

    private static void EmitChange(MutationContext context, Production production, PlaceholderChange change)
    {
        foreach (var scene in change.Scenes)
        {
            var dto = Dtos.Scene(scene);
            context.Emit(revision => new SceneUpsertedEvent(revision, dto));
        }

        var id = change.Placeholder.Id;
        context.Emit(revision => new PlaceholderRemovedEvent(revision, id));
        if (change.Scenes.Count > 0)
        {
            context.UpdateOnAir(production);
        }
    }
}
