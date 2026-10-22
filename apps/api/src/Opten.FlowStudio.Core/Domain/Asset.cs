using Opten.FlowStudio.Core.Contracts;

namespace Opten.FlowStudio.Core.Domain;

/// <summary>An uploaded image or video (spec 4.7). The asset id is also its source reference.</summary>
public sealed class Asset
{
    private Asset()
    {
    }

    /// <summary>Asset id.</summary>
    public string Id { get; private set; } = string.Empty;

    /// <summary>Production the asset belongs to.</summary>
    public string ProductionId { get; private set; } = string.Empty;

    /// <summary>Slot code M1, M2, …</summary>
    public string Code { get; private set; } = string.Empty;

    /// <summary>Image or video.</summary>
    public AssetKind Kind { get; private set; }

    /// <summary>Display name (1–80 characters).</summary>
    public string Name { get; private set; } = string.Empty;

    /// <summary>Verified MIME type.</summary>
    public string ContentType { get; private set; } = string.Empty;

    /// <summary>File size.</summary>
    public long SizeBytes { get; private set; }

    /// <summary>Pixel width of images.</summary>
    public int? Width { get; private set; }

    /// <summary>Pixel height of images.</summary>
    public int? Height { get; private set; }

    /// <summary>File name inside the production's media folder, e.g. <c>ast_….png</c>.</summary>
    public string FileName { get; private set; } = string.Empty;

    /// <summary>Upload time.</summary>
    public DateTimeOffset CreatedAt { get; private set; }

    /// <summary>Relative URL of the content endpoint.</summary>
    public string ContentUrl => $"/api/productions/{ProductionId}/assets/{Id}/content";

    /// <summary>Source kind of the asset.</summary>
    public SourceKind SourceKind => Kind == AssetKind.Image ? SourceKind.Image : SourceKind.Video;

    /// <summary>Creates an asset for stored content.</summary>
    public static Asset Create(string id, string productionId, string name, AssetKind kind, string contentType, long sizeBytes, int? width, int? height, string fileName, DateTimeOffset now, IEnumerable<string> codesInUse) =>
        new()
        {
            Id = id,
            ProductionId = productionId,
            Code = SlotCodes.Allocate(SourceKind.Image, codesInUse),
            Kind = kind,
            Name = TextRules.RequireName(name, TextRules.NameMax, "name"),
            ContentType = contentType,
            SizeBytes = sizeBytes,
            Width = width,
            Height = height,
            FileName = fileName,
            CreatedAt = now,
        };

    /// <summary>
    /// Display name for an uploaded file: the file name without directory and extension, without control characters,
    /// at most 80 characters; «Bild» or «Video» when nothing is left.
    /// </summary>
    public static string NameFromFileName(string? fileName, AssetKind kind)
    {
        var name = Path.GetFileName((fileName ?? string.Empty).Replace('\\', '/'));
        var dot = name.LastIndexOf('.');
        if (dot > 0)
        {
            name = name[..dot];
        }

        return TextRules.Truncate(name, TextRules.NameMax) ?? (kind == AssetKind.Image ? "Bild" : "Video");
    }

    /// <summary>Renames the asset.</summary>
    public void Rename(string name) => Name = TextRules.RequireName(name, TextRules.NameMax, "name");
}
