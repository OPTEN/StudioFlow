using Opten.FlowStudio.Core.Contracts;
using Opten.FlowStudio.Core.Domain;

namespace Opten.FlowStudio.Core.Application.Services;

/// <summary>Use cases of scenes and scene items (spec 4.3). Every change emits <c>sceneUpserted</c> with the full scene.</summary>
public sealed class SceneService(ProductionCoordinator coordinator)
{
    /// <summary>Creates a scene, optionally as a copy.</summary>
    public Task<SceneDto> CreateAsync(string productionId, CreateSceneRequest request, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        return coordinator.ExecuteAsync(
            productionId,
            async context =>
            {
                var production = await context.ProductionAsync(cancellationToken);
                var (scene, programChange) = production.AddScene(request.Name, request.CloneFromSceneId, context.Now);
                var dto = Dtos.Scene(scene);
                context.Emit(revision => new SceneUpsertedEvent(revision, dto));
                if (programChange is not null)
                {
                    EmitSwitch(context, programChange);
                }

                context.UpdateOnAir(production);
                context.Audit(AuditActors.Admin, AuditActions.SceneCreated, SceneDetails(scene));
                return dto;
            },
            cancellationToken);
    }

    /// <summary>Changes name, layout mode or background.</summary>
    public Task<SceneDto> UpdateAsync(string productionId, string sceneId, UpdateSceneRequest request, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        return MutateAsync(productionId, sceneId, (scene, catalog) => scene.Update(request, catalog), cancellationToken);
    }

    /// <summary>Deletes a scene (not the program scene).</summary>
    public Task DeleteAsync(string productionId, string sceneId, CancellationToken cancellationToken) =>
        coordinator.ExecuteAsync(
            productionId,
            async context =>
            {
                var production = await context.ProductionAsync(cancellationToken);
                var (removed, previewChange, reordered) = production.RemoveScene(sceneId, context.Now);
                context.Emit(revision => new SceneRemovedEvent(revision, removed.Id));
                if (previewChange is not null)
                {
                    EmitSwitch(context, previewChange);
                }

                if (reordered)
                {
                    EmitOrder(context, production);
                }

                context.UpdateOnAir(production);
                context.Audit(AuditActors.Admin, AuditActions.SceneDeleted, SceneDetails(removed));
            },
            cancellationToken);

    /// <summary>Applies a new scene order.</summary>
    public Task ReorderAsync(string productionId, ReorderScenesRequest request, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        return coordinator.ExecuteAsync(
            productionId,
            async context =>
            {
                var production = await context.ProductionAsync(cancellationToken);
                if (production.ReorderScenes(request.SceneIds))
                {
                    EmitOrder(context, production);
                }
            },
            cancellationToken);
    }

    /// <summary>Adds a source as new item.</summary>
    public Task<SceneDto> AddItemAsync(string productionId, string sceneId, AddSceneItemRequest request, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        return MutateAsync(productionId, sceneId, (scene, catalog) => scene.AddItem(request, catalog) is not null, cancellationToken);
    }

    /// <summary>Replaces one item.</summary>
    public Task<SceneDto> UpdateItemAsync(string productionId, string sceneId, string itemId, SceneItemDto item, CancellationToken cancellationToken) =>
        MutateAsync(
            productionId,
            sceneId,
            (scene, catalog) =>
            {
                scene.UpdateItem(itemId, item, catalog);
                return true;
            },
            cancellationToken);

    /// <summary>Removes one item.</summary>
    public Task<SceneDto> RemoveItemAsync(string productionId, string sceneId, string itemId, CancellationToken cancellationToken) =>
        MutateAsync(
            productionId,
            sceneId,
            (scene, _) =>
            {
                scene.RemoveItem(itemId);
                return true;
            },
            cancellationToken);

    /// <summary>Replaces all items (templates, undo/redo).</summary>
    public Task<SceneDto> ReplaceItemsAsync(string productionId, string sceneId, ReplaceSceneItemsRequest request, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        return MutateAsync(
            productionId,
            sceneId,
            (scene, catalog) =>
            {
                scene.ReplaceItems(request.Items, request.LayoutMode, catalog);
                return true;
            },
            cancellationToken);
    }

    private static Dictionary<string, string> SceneDetails(Scene scene) => new(StringComparer.Ordinal) { [AuditDetails.Scene] = scene.Name };

    private static void EmitSwitch(MutationContext context, ProgramChange change) =>
        context.Emit(revision => new ProgramSwitchedEvent(revision, change.ProgramSceneId, change.PreviewSceneId, change.PreviousProgramSceneId, change.Transition, change.At));

    private static void EmitOrder(MutationContext context, Production production)
    {
        var order = production.OrderedScenes.Select(s => s.Id).ToArray();
        context.Emit(revision => new ScenesReorderedEvent(revision, order));
    }

    private Task<SceneDto> MutateAsync(string productionId, string sceneId, Func<Scene, SourceCatalog, bool> change, CancellationToken cancellationToken) =>
        coordinator.ExecuteAsync(
            productionId,
            async context =>
            {
                var production = await context.ProductionAsync(cancellationToken);
                var scene = production.GetScene(sceneId);
                var catalog = await context.CatalogAsync(cancellationToken);
                if (change(scene, catalog))
                {
                    var dto = Dtos.Scene(scene);
                    context.Emit(revision => new SceneUpsertedEvent(revision, dto));
                    context.UpdateOnAir(production);
                }

                return Dtos.Scene(scene);
            },
            cancellationToken);
}
