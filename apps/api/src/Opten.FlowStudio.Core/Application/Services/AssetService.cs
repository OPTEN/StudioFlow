using System.Net;
using Microsoft.Extensions.Logging;
using Opten.FlowStudio.Core.Application.Ports;
using Opten.FlowStudio.Core.Contracts;
using Opten.FlowStudio.Core.Domain;

namespace Opten.FlowStudio.Core.Application.Services;

/// <summary>A stored asset file ready to be streamed.</summary>
/// <param name="Path">Absolute file path.</param>
/// <param name="ContentType">Verified MIME type.</param>
/// <param name="LastModified">Upload time (for conditional requests).</param>
/// <param name="DisplayFileName">Sanitised display name with the extension of the verified type (<c>Content-Disposition</c>).</param>
/// <param name="ETag">Strong validator; the content of an asset never changes.</param>
public sealed record AssetContent(string Path, string ContentType, DateTimeOffset LastModified, string DisplayFileName, string ETag);

/// <summary>Use cases of uploaded images and videos (spec 4.7).</summary>
public sealed class AssetService(ProductionCoordinator coordinator, IUnitOfWorkFactory data, IMediaStore media, ILogger<AssetService> logger)
{
    /// <summary>All assets of a production.</summary>
    public async Task<IReadOnlyList<AssetDto>> ListAsync(string productionId, CancellationToken cancellationToken)
    {
        await using var unit = data.Create();
        await RequireProductionAsync(unit, productionId, cancellationToken);
        return [.. (await unit.Assets.ListAsync(productionId, cancellationToken)).Select(Dtos.Asset)];
    }

    /// <summary>
    /// Stores an upload (type verified by magic bytes, size limited per type) and registers it as a media source. The file
    /// is written outside the production lock; it is deleted again when registering fails.
    /// </summary>
    public async Task<AssetDto> UploadAsync(string productionId, Stream content, long? declaredLength, string? fileName, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(content);
        await using (var unit = data.Create())
        {
            await RequireProductionAsync(unit, productionId, cancellationToken);
        }

        var assetId = EntityIds.New(EntityIds.Asset);
        var stored = await media.StoreAsync(productionId, assetId, content, declaredLength, cancellationToken);
        try
        {
            return await coordinator.ExecuteAsync(
                productionId,
                async context =>
                {
                    var catalog = await context.CatalogAsync(cancellationToken);
                    var asset = Asset.Create(assetId, productionId, Asset.NameFromFileName(fileName), stored.Kind, stored.ContentType, stored.SizeBytes, stored.Width, stored.Height, stored.FileName, context.Now, catalog.CodesInUse);
                    context.Data.Assets.Add(asset);
                    EmitAsset(context, asset);
                    context.Audit(AuditActors.Admin, AuditActions.AssetUploaded, Details(asset));
                    return Dtos.Asset(asset);
                },
                cancellationToken);
        }
        catch
        {
            media.Delete(productionId, stored.FileName);
            throw;
        }
    }

    /// <summary>Renames an asset with the rules of upload names (GAP-13); the source label follows.</summary>
    public Task<AssetDto> RenameAsync(string productionId, string assetId, RenameAssetRequest request, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        return coordinator.ExecuteAsync(
            productionId,
            async context =>
            {
                var asset = await context.AssetAsync(assetId, cancellationToken);
                var previous = asset.Name;
                asset.Rename(request.Name);
                if (!string.Equals(previous, asset.Name, StringComparison.Ordinal))
                {
                    EmitAsset(context, asset);
                }

                return Dtos.Asset(asset);
            },
            cancellationToken);
    }

    /// <summary>Deletes an asset unless a scene item, a background, a slate or a fallback uses it (<c>asset_in_use</c>).</summary>
    public Task DeleteAsync(string productionId, string assetId, CancellationToken cancellationToken) =>
        coordinator.ExecuteAsync(
            productionId,
            async context =>
            {
                var asset = await context.AssetAsync(assetId, cancellationToken);
                var production = await context.ProductionAsync(cancellationToken);
                if (production.UsesAsset(asset.Id))
                {
                    throw FlowStudioException.Conflict(ErrorCodes.AssetInUse, "Das Medium wird noch verwendet.");
                }

                context.Data.Assets.Remove(asset);
                context.Emit(revision => new AssetRemovedEvent(revision, asset.Id));
                context.Emit(revision => new SourceRemovedEvent(revision, asset.Id));
                context.Audit(AuditActors.Admin, AuditActions.AssetDeleted, Details(asset));
                context.OnCommitted(() => DeleteFile(asset));
            },
            cancellationToken);

    /// <summary>
    /// The content of an asset for the admin cookie or the output key (<c>?k=</c>) of the asset's production, from an
    /// allowed address (GAP-13): no credential at all is <c>unauthorized</c> (401); a wrong or foreign key, a forbidden
    /// address and – for key holders – an unknown production are <c>forbidden</c> (403); unknown assets are
    /// <c>not_found</c>.
    /// </summary>
    public async Task<AssetContent> GetContentAsync(string productionId, string assetId, bool isAdmin, string? outputKey, IPAddress? client, CancellationToken cancellationToken)
    {
        if (!isAdmin && string.IsNullOrEmpty(outputKey))
        {
            throw new FlowStudioException(ErrorKind.Unauthorized, ErrorCodes.Unauthorized, "Anmeldung oder Output-Schlüssel erforderlich.");
        }

        await using var unit = data.Create();
        var access = await unit.Productions.GetOutputKeyAsync(productionId, cancellationToken)
            ?? throw (isAdmin ? FlowStudioException.NotFound("Die Produktion") : OutputService.NoAccess());

        if (!isAdmin && !(Secrets.FixedTimeEquals(outputKey, access.OutputKey) && IpRule.IsAllowed(access.AllowedIps, client)))
        {
            throw OutputService.NoAccess();
        }

        var asset = await unit.Assets.GetAsync(productionId, assetId, cancellationToken) ?? throw FlowStudioException.NotFound("Das Medium");
        var path = media.GetPath(productionId, asset.FileName) ?? throw FlowStudioException.NotFound("Die Datei");
        return new AssetContent(path, asset.ContentType, asset.CreatedAt, asset.Name + Path.GetExtension(asset.FileName), $"\"{asset.Id}\"");
    }

    private static async Task RequireProductionAsync(IUnitOfWork unit, string productionId, CancellationToken cancellationToken)
    {
        if (!await unit.Productions.ExistsAsync(productionId, cancellationToken))
        {
            throw FlowStudioException.NotFound("Die Produktion");
        }
    }

    private static void EmitAsset(MutationContext context, Asset asset)
    {
        var dto = Dtos.Asset(asset);
        var source = Dtos.Source(new SourceEntry(asset.Id, asset.Code, asset.SourceKind, asset.Name, null, null, asset), null);
        context.Emit(revision => new AssetUpsertedEvent(revision, dto));
        context.Emit(revision => new SourceUpsertedEvent(revision, source));
    }

    private static Dictionary<string, string> Details(Asset asset) => new(StringComparer.Ordinal)
    {
        [AuditDetails.Code] = asset.Code,
        [AuditDetails.Name] = asset.Name,
    };

    private void DeleteFile(Asset asset)
    {
        try
        {
            media.Delete(asset.ProductionId, asset.FileName);
        }
        catch (IOException exception)
        {
            logger.LogWarning(exception, "Media file of asset {AssetId} could not be deleted", asset.Id);
        }
    }
}
