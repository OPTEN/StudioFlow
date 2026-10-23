namespace Opten.FlowStudio.Core.Contracts;

/// <summary>An uploaded image or video.</summary>
/// <param name="Id">Asset id, e.g. <c>ast_…</c>; also the source reference.</param>
/// <param name="Code">Slot code M1, M2, …</param>
/// <param name="Kind">Image or video.</param>
/// <param name="Name">Display name (from the file name, editable).</param>
/// <param name="ContentType">Verified MIME type.</param>
/// <param name="SizeBytes">File size.</param>
/// <param name="Width">Pixel width where known.</param>
/// <param name="Height">Pixel height where known.</param>
/// <param name="CreatedAt">Upload time.</param>
/// <param name="ContentUrl">Relative URL of the content. The output appends its key as <c>?k=</c>.</param>
public sealed record AssetDto(
    string Id,
    string Code,
    AssetKind Kind,
    string Name,
    string ContentType,
    long SizeBytes,
    int? Width,
    int? Height,
    DateTimeOffset CreatedAt,
    string ContentUrl);

/// <summary>Renames an asset.</summary>
public sealed record RenameAssetRequest(string Name);
