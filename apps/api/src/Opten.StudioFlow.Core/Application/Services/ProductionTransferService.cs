using System.Globalization;
using Microsoft.Extensions.Logging;
using Opten.StudioFlow.Core.Application.Ports;
using Opten.StudioFlow.Core.Application.Transfer;
using Opten.StudioFlow.Core.Contracts;
using Opten.StudioFlow.Core.Domain;
using Opten.StudioFlow.Core.Domain.Transfer;

namespace Opten.StudioFlow.Core.Application.Services;

/// <summary>An export that is ready to be written: the content of the files is open, so it stays consistent while it is written.</summary>
public sealed class PreparedExport : IAsyncDisposable
{
    private readonly ProductionManifest manifest;
    private readonly IReadOnlyList<ExportMedia> media;
    private readonly IReadOnlyList<Stream> files;

    internal PreparedExport(string fileName, ProductionManifest manifest, IReadOnlyList<ExportMedia> media, IReadOnlyList<Stream> files)
    {
        FileName = fileName;
        this.manifest = manifest;
        this.media = media;
        this.files = files;
    }

    /// <summary>The name of the download, <c>{slug}-{date}.studioflow.zip</c>.</summary>
    public string FileName { get; }

    /// <summary>Writes the ZIP file to the stream (it needs no seeking), then the files are closed.</summary>
    public Task WriteAsync(Stream output, CancellationToken cancellationToken) =>
        ExportArchive.WriteAsync(output, manifest, media, files, cancellationToken);

    /// <inheritdoc />
    public async ValueTask DisposeAsync()
    {
        foreach (var file in files)
        {
            await file.DisposeAsync();
        }
    }
}

/// <summary>
/// Duplicate, export and import of productions (spec 4.2.2, issue #14). All three go through the manifest: a duplicate
/// describes the production like an export does and builds the copy like an import does, so a copy can only contain what an
/// export would carry. Devices become placeholders; pairings, invites, secrets, output links, the broadcast state and the
/// logs are not taken over (see <see cref="ProductionExport"/>).
/// A new production is made all or nothing: the media files are written first under the id of the new production – nothing
/// can reach them while no production has that id – then one transaction saves production, scenes, media and audit entry,
/// and a failure at any point deletes the folder again. The new production is never the active one.
/// </summary>
public sealed class ProductionTransferService(
    ProductionCoordinator coordinator,
    ProductionService productions,
    IUnitOfWorkFactory data,
    IMediaStore media,
    TransferOptions options,
    TimeProvider clock,
    string appVersion,
    ILogger<ProductionTransferService> logger)
{
    /// <summary>
    /// Creates a copy of a production, also while it is live (the original is only read). The copy is named
    /// <paramref name="request"/> (or “… (copy)”), gets “ (2)” appended when the name is taken, and is not active.
    /// </summary>
    public async Task<ProductionDto> DuplicateAsync(string productionId, DuplicateProductionRequest request, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        var requested = request.Name is null ? null : TextRules.RequireName(request.Name, TextRules.NameMax, "name");
        await using var source = await CaptureAsync(productionId, export: false, cancellationToken);
        var plan = TransferPlan.Create(source.Manifest);
        try
        {
            var stored = new List<StoredAsset>(plan.Assets.Count);
            for (var i = 0; i < plan.Assets.Count; i++)
            {
                var original = source.Assets[i];
                var extension = Path.GetExtension(source.Media[i].FileName);
                var fileName = await media.CopyAsync(plan.ProductionId, plan.Assets[i].AssetId, extension, source.Files[i], cancellationToken);
                stored.Add(new StoredAsset(original.Kind, original.ContentType, original.SizeBytes, original.Width, original.Height, fileName, original.HasAudio));
            }

            var desired = requested ?? ProductionNames.CopyOf(source.Name);
            var created = await productions.CreateExclusivelyAsync(existing => CommitAsync(plan, stored, desired, AuditActions.ProductionDuplicated, source.Name, existing), cancellationToken);
            logger.LogInformation("Production {ProductionId} duplicated as {NewProductionId}", productionId, created.Id);
            return created;
        }
        catch
        {
            Discard(plan.ProductionId);
            throw;
        }
    }

    /// <summary>
    /// Prepares the export of a production, also while it is live (nothing of the production changes; the audit log notes the
    /// export). The caller writes it to the response and disposes it.
    /// </summary>
    public async Task<PreparedExport> PrepareExportAsync(string productionId, CancellationToken cancellationToken)
    {
        var captured = await CaptureAsync(productionId, export: true, cancellationToken);
        var fileName = string.Create(CultureInfo.InvariantCulture, $"{captured.Slug}-{clock.GetUtcNow():yyyy-MM-dd}{ManifestFormat.FileExtension}");
        return captured.ToExport(fileName);
    }

    /// <summary>
    /// What importing the file would do – name, counts, size, placeholders, warnings – after checking it completely, down to
    /// every medium. Nothing is kept.
    /// </summary>
    public async Task<ImportPreviewDto> PreviewImportAsync(Stream archive, CancellationToken cancellationToken)
    {
        await using var staged = await StageAsync(archive, cancellationToken);
        var existing = await ListProductionsAsync(cancellationToken);
        var plan = staged.Plan;
        var name = ProductionNames.Unique(plan.Name, existing.Select(p => p.Name));
        var warnings = new List<ImportWarningDto>();
        if (!string.Equals(name, plan.Name, StringComparison.Ordinal))
        {
            warnings.Add(new ImportWarningDto(ImportWarningCode.NameChanged, new Dictionary<string, string>(StringComparer.Ordinal) { ["name"] = name }));
        }

        if (plan.Placeholders.Count > 0)
        {
            warnings.Add(new ImportWarningDto(ImportWarningCode.Placeholders, new Dictionary<string, string>(StringComparer.Ordinal) { ["count"] = plan.Placeholders.Count.ToString(CultureInfo.InvariantCulture) }));
        }

        return new ImportPreviewDto(
            name,
            plan.AppVersion,
            plan.SceneCount,
            plan.TextCount,
            plan.Assets.Count,
            plan.MediaBytes,
            [.. plan.Placeholders.Select(p => new ImportPlaceholderDto(p.Code, p.Kind, p.Label))],
            warnings);
    }

    /// <summary>
    /// Creates a production from the file. Everything is checked first; an invalid file leaves nothing behind. The name gets
    /// “ (2)” appended when it is taken, the production is not active, and devices are placeholders.
    /// </summary>
    public async Task<ProductionDto> ImportAsync(Stream archive, CancellationToken cancellationToken)
    {
        await using var staged = await StageAsync(archive, cancellationToken);
        var plan = staged.Plan;
        var created = await productions.CreateExclusivelyAsync(existing => CommitAsync(plan, staged.Stored, plan.Name, AuditActions.ProductionImported, null, existing), cancellationToken);
        staged.Keep();
        logger.LogInformation("Production {ProductionId} imported ({Scenes} scenes, {Media} media files)", created.Id, plan.SceneCount, plan.Assets.Count);
        return created;
    }

    private async Task<CapturedProduction> CaptureAsync(string productionId, bool export, CancellationToken cancellationToken)
    {
        var streams = new List<Stream>();
        try
        {
            return await coordinator.ExecuteAsync(
                productionId,
                async context =>
                {
                    var production = await context.ProductionAsync(cancellationToken);
                    var devices = await context.Data.Devices.ListAsync(productionId, cancellationToken);
                    var assets = await context.Data.Assets.ListAsync(productionId, cancellationToken);
                    var (manifest, files) = ProductionExport.Capture(production, devices, assets, appVersion, context.Now);
                    foreach (var file in files)
                    {
                        streams.Add(media.OpenRead(productionId, file.FileName)
                            ?? throw StudioFlowException.Conflict(ErrorCodes.Conflict, $"The medium {file.Entry.Name} is missing on the server."));
                    }

                    if (export)
                    {
                        context.Audit(AuditActors.Admin, AuditActions.ProductionExported, new Dictionary<string, string>(StringComparer.Ordinal) { [AuditDetails.Name] = production.Name });
                    }

                    return new CapturedProduction(production.Name, production.Slug, manifest, files, assets, streams);
                },
                cancellationToken);
        }
        catch
        {
            foreach (var stream in streams)
            {
                await stream.DisposeAsync();
            }

            throw;
        }
    }

    /// <summary>
    /// Opens the archive, checks the manifest and every medium (type by content, size, SVG, checksum) and stores the media files
    /// under the id of the new production. Anything wrong throws and the folder is gone again.
    /// </summary>
    private async Task<StagedImport> StageAsync(Stream archive, CancellationToken cancellationToken)
    {
        using var zip = ImportArchive.Open(archive, options);
        var plan = TransferPlan.Create(zip.ReadManifest());
        zip.RequireFiles(plan.Assets.Select(a => a.Entry.File));
        var staged = new StagedImport(plan, () => Discard(plan.ProductionId));
        try
        {
            foreach (var asset in plan.Assets)
            {
                await using var content = zip.OpenMedia(asset.Entry.File, asset.Entry.SizeBytes);
                using var hashing = new HashingReadStream(content);
                var stored = await media.StoreAsync(plan.ProductionId, asset.AssetId, hashing, asset.Entry.SizeBytes, cancellationToken);
                if (!string.Equals(hashing.Finish(), asset.Entry.Sha256, StringComparison.OrdinalIgnoreCase))
                {
                    throw TransferErrors.Invalid($"The checksum of {asset.Entry.File} does not match the manifest.");
                }

                if (stored.Kind != asset.Entry.Kind)
                {
                    throw TransferErrors.Invalid($"{asset.Entry.File} is not the {asset.Entry.Kind.ToString().ToLowerInvariant()} the manifest says.");
                }

                staged.Stored.Add(new StoredAsset(stored.Kind, stored.ContentType, stored.SizeBytes, stored.Width, stored.Height, stored.FileName, stored.HasAudio));
            }

            return staged;
        }
        catch
        {
            await staged.DisposeAsync();
            throw;
        }
    }

    /// <summary>Saves the production, its media, the default output link and the audit entry in one transaction.</summary>
    private async Task<ProductionDto> CommitAsync(TransferPlan plan, IReadOnlyList<StoredAsset> stored, string desiredName, string action, string? original, IReadOnlyList<Production> existing)
    {
        var name = ProductionNames.Unique(desiredName, existing.Select(p => p.Name));
        var slugs = existing.Select(p => p.Slug).ToHashSet(StringComparer.Ordinal);
        var slug = Slugs.MakeUnique(Slugs.FromName(name), slugs.Contains);
        var now = clock.StorageNow();
        var production = plan.Build(name, slug, now);
        await using var unit = data.Create();
        unit.Productions.Add(production);
        unit.OutputLinks.Add(OutputLink.Create(production.Id, OutputLink.DefaultName, [], now));
        var assets = new List<Asset>(plan.Assets.Count);
        for (var i = 0; i < plan.Assets.Count; i++)
        {
            var asset = plan.Assets[i];
            var file = stored[i];

            // One microsecond apart, so the media keep the order of the original (the list is ordered by upload time).
            assets.Add(Asset.Create(asset.AssetId, production.Id, asset.Code, asset.Name, file.Kind, file.ContentType, file.SizeBytes, file.Width, file.Height, file.FileName, now.AddTicks(i * 10L), file.HasAudio));
        }

        foreach (var asset in assets)
        {
            unit.Assets.Add(asset);
        }

        plan.SeedAudioChannels(production, assets);

        var details = new Dictionary<string, string>(StringComparer.Ordinal) { [AuditDetails.Name] = production.Name };
        if (original is not null)
        {
            details[AuditDetails.From] = original;
        }

        unit.Audit.Add(AuditEntry.Create(production.Id, now, AuditActors.Admin, action, details));

        // Once the production is decided it is saved, even when the client has gone: a half-made production is worse.
        await unit.SaveChangesAsync(CancellationToken.None);
        return Dtos.Production(production);
    }

    private async Task<IReadOnlyList<Production>> ListProductionsAsync(CancellationToken cancellationToken)
    {
        await using var unit = data.Create();
        return await unit.Productions.ListAsync(cancellationToken);
    }

    /// <summary>Deletes the folder of a production that was never saved; a failure is logged, the request goes on with its error.</summary>
    private void Discard(string productionId)
    {
        try
        {
            media.DeleteProduction(productionId);
        }
        catch (IOException exception)
        {
            logger.LogWarning(exception, "The media folder of the unsaved production {ProductionId} could not be deleted", productionId);
        }
    }

    /// <summary>A stored medium: what the asset needs to know of its file.</summary>
    private sealed record StoredAsset(AssetKind Kind, string ContentType, long SizeBytes, int? Width, int? Height, string FileName, bool HasAudio);

    /// <summary>A production described for a copy, with its open media files.</summary>
    private sealed class CapturedProduction(
        string name,
        string slug,
        ProductionManifest manifest,
        IReadOnlyList<ExportMedia> mediaFiles,
        IReadOnlyList<Asset> assets,
        IReadOnlyList<Stream> files) : IAsyncDisposable
    {
        public string Name => name;

        public string Slug => slug;

        public ProductionManifest Manifest => manifest;

        public IReadOnlyList<ExportMedia> Media => mediaFiles;

        public IReadOnlyList<Asset> Assets => assets;

        public IReadOnlyList<Stream> Files => files;

        /// <summary>Hands the open files over to an export, which disposes them.</summary>
        public PreparedExport ToExport(string fileName) => new(fileName, manifest, mediaFiles, files);

        public async ValueTask DisposeAsync()
        {
            foreach (var file in files)
            {
                await file.DisposeAsync();
            }
        }
    }

    /// <summary>An import whose media are stored but whose production is not saved; disposing it deletes the files unless it was kept.</summary>
    private sealed class StagedImport(TransferPlan plan, Action discard) : IAsyncDisposable
    {
        private bool kept;

        public TransferPlan Plan => plan;

        public List<StoredAsset> Stored { get; } = [];

        public void Keep() => kept = true;

        public ValueTask DisposeAsync()
        {
            if (!kept)
            {
                discard();
            }

            return ValueTask.CompletedTask;
        }
    }
}
