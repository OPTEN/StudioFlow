using Opten.StudioFlow.Core.Contracts;

namespace Opten.StudioFlow.Core.Domain;

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

    /// <summary>The file has an audio track (videos only). It becomes a channel of the audio mixer.</summary>
    public bool HasAudio { get; private set; }

    /// <summary>File name inside the production's media folder, e.g. <c>ast_….png</c>.</summary>
    public string FileName { get; private set; } = string.Empty;

    /// <summary>Upload time.</summary>
    public DateTimeOffset CreatedAt { get; private set; }

    /// <summary>Relative URL of the content endpoint.</summary>
    public string ContentUrl => $"/api/productions/{ProductionId}/assets/{Id}/content";

    /// <summary>Source kind of the asset.</summary>
    public SourceKind SourceKind => Kind == AssetKind.Image ? SourceKind.Image : SourceKind.Video;

    /// <summary>Creates an asset for stored content.</summary>
    public static Asset Create(string id, string productionId, string name, AssetKind kind, string contentType, long sizeBytes, int? width, int? height, string fileName, DateTimeOffset now, IEnumerable<string> codesInUse, bool hasAudio = false) =>
        Create(id, productionId, SlotCodes.Allocate(SourceKind.Image, codesInUse), name, kind, contentType, sizeBytes, width, height, fileName, now, hasAudio);

    /// <summary>
    /// Creates an asset with a given slot code: the copy of a production keeps the codes of the original, so M2 stays M2
    /// (the caller makes sure the codes are unique).
    /// </summary>
    public static Asset Create(string id, string productionId, string code, string name, AssetKind kind, string contentType, long sizeBytes, int? width, int? height, string fileName, DateTimeOffset now, bool hasAudio = false) =>
        new()
        {
            Id = id,
            ProductionId = productionId,
            Code = code,
            Kind = kind,
            Name = TextRules.RequireName(name, TextRules.NameMax, "name"),
            ContentType = contentType,
            SizeBytes = sizeBytes,
            Width = width,
            Height = height,
            HasAudio = kind == AssetKind.Video && hasAudio,
            FileName = fileName,
            CreatedAt = now,
        };

    /// <summary>Name of an upload whose file name leaves nothing usable (GAP-13).</summary>
    public const string FallbackName = "Media";

    /// <summary>
    /// Display name for an uploaded file (GAP-13): the last path segment without its extension (informational only; the
    /// stored file name is <c>{assetId}{ext of the verified type}</c>), without control or bidi characters, at most 80
    /// characters; <see cref="FallbackName"/> when nothing or only dots are left.
    /// </summary>
    public static string NameFromFileName(string? fileName)
    {
        var name = LastSegment(fileName);
        var dot = name.LastIndexOf('.');
        if (dot > 0)
        {
            name = name[..dot];
        }

        return Usable(TextRules.Truncate(name, TextRules.NameMax)) ?? FallbackName;
    }

    /// <summary>Renames the asset with the same rules as an upload name; an empty result is <c>validation_failed</c>.</summary>
    public void Rename(string name)
    {
        var segment = Usable(TextRules.Truncate(LastSegment(name), int.MaxValue));
        Name = TextRules.RequireName(segment, TextRules.NameMax, "name");
    }

    /// <summary>The part after the last <c>/</c>, <c>\</c> or <c>:</c>, so a name is never a path.</summary>
    private static string LastSegment(string? value)
    {
        var text = value ?? string.Empty;
        var separator = text.LastIndexOfAny(['/', '\\', ':']);
        return separator < 0 ? text : text[(separator + 1)..];
    }

    /// <summary>Null for names made of dots and spaces only (“...”).</summary>
    private static string? Usable(string? name) => name is null || name.All(c => c is '.' || char.IsWhiteSpace(c)) ? null : name;
}
