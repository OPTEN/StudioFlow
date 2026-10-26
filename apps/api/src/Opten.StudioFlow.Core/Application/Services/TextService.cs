using Opten.StudioFlow.Core.Contracts;
using Opten.StudioFlow.Core.Domain;

namespace Opten.StudioFlow.Core.Application.Services;

/// <summary>
/// Use cases of texts and lower thirds (spec 4.4). A text is a source like a camera: it is created once and shown by
/// scene items, so editing it changes every scene that shows it. The content reaches the clients as
/// <c>sourceUpserted</c>, the removal as <c>sourceRemoved</c> (after the <c>sceneUpserted</c> of the scenes that lost the items).
/// </summary>
public sealed class TextService(ProductionCoordinator coordinator)
{
    /// <summary>Creates a text; it gets the lowest free slot code T1, T2, …</summary>
    public Task<TextSourceDto> CreateAsync(string productionId, CreateTextSourceRequest request, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        return coordinator.ExecuteAsync(
            productionId,
            async context =>
            {
                var production = await context.ProductionAsync(cancellationToken);
                var catalog = await context.CatalogAsync(cancellationToken);
                var text = production.AddTextSource(request, catalog.CodesInUse);
                EmitText(context, text);
                context.Audit(AuditActors.Admin, AuditActions.TextCreated, Details(text));
                return text;
            },
            cancellationToken);
    }

    /// <summary>Replaces the content of a text; the clients see the change at once, without a scene change.</summary>
    public Task<TextSourceDto> UpdateAsync(string productionId, string textId, UpdateTextSourceRequest request, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        return coordinator.ExecuteAsync(
            productionId,
            async context =>
            {
                var production = await context.ProductionAsync(cancellationToken);
                var (text, changed) = production.UpdateTextSource(textId, request);
                if (changed)
                {
                    EmitText(context, text);
                }

                return text;
            },
            cancellationToken);
    }

    /// <summary>Deletes a text and removes it from every scene that shows it.</summary>
    public Task DeleteAsync(string productionId, string textId, CancellationToken cancellationToken) =>
        coordinator.ExecuteAsync(
            productionId,
            async context =>
            {
                var production = await context.ProductionAsync(cancellationToken);
                var (text, changedScenes) = production.RemoveTextSource(textId);
                foreach (var scene in changedScenes)
                {
                    var dto = Dtos.Scene(scene);
                    context.Emit(revision => new SceneUpsertedEvent(revision, dto));
                }

                context.Emit(revision => new SourceRemovedEvent(revision, text.Id));
                if (changedScenes.Count > 0)
                {
                    context.UpdateOnAir(production);
                }

                context.Audit(AuditActors.Admin, AuditActions.TextDeleted, Details(text));
            },
            cancellationToken);

    private static void EmitText(MutationContext context, TextSourceDto text)
    {
        var source = Dtos.Source(SourceCatalog.TextEntry(text), null);
        context.Emit(revision => new SourceUpsertedEvent(revision, source));
    }

    private static Dictionary<string, string> Details(TextSourceDto text) => new(StringComparer.Ordinal)
    {
        [AuditDetails.Code] = text.Code,
        [AuditDetails.Name] = text.Line1,
    };
}
