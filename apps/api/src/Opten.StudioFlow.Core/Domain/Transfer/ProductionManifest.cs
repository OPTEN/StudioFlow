using Opten.StudioFlow.Core.Contracts;

namespace Opten.StudioFlow.Core.Domain.Transfer;

// The manifest of an exported production (`manifest.json` in the ZIP file, spec 4.2.2). It is a file format of its own, not
// the API contract: a change of the contract must not silently change the files, so every part is declared here and a
// change of this format raises FormatVersion with a migration of the older versions (ManifestMigrator).
//
// Nothing in the file is an id of the installation. Texts, media and placeholders have keys (t1, a1, p1) that only mean
// something inside the file; items name their source by "kind:key" (see ManifestRefs). The importer assigns new ids to
// everything.

/// <summary>The manifest of an exported production.</summary>
/// <param name="Format">Always <see cref="ManifestFormat.Name"/>: tells a StudioFlow export from any other JSON file.</param>
/// <param name="FormatVersion">Version of this format, 1 or more. A file with a version this installation does not know is refused.</param>
/// <param name="App">Who wrote the file.</param>
/// <param name="Production">Name, canvas, slates and text colours.</param>
/// <param name="Texts">Texts and lower thirds.</param>
/// <param name="Assets">Images and videos; the files are in the ZIP under <c>media/</c>.</param>
/// <param name="Placeholders">The device sources the scenes use, which become placeholders.</param>
/// <param name="Scenes">Scenes in list order.</param>
public sealed record ProductionManifest(
    string Format,
    int FormatVersion,
    ManifestApp App,
    ManifestProduction Production,
    IReadOnlyList<ManifestText> Texts,
    IReadOnlyList<ManifestAsset> Assets,
    IReadOnlyList<ManifestPlaceholder> Placeholders,
    IReadOnlyList<ManifestScene> Scenes);

/// <summary>The program that wrote the file.</summary>
/// <param name="Version">Version of StudioFlow, e.g. <c>0.1.0+1a2b3c4</c>.</param>
/// <param name="ExportedAt">Time of the export.</param>
public sealed record ManifestApp(string Version, DateTimeOffset ExportedAt);

/// <summary>The settings of the production that are not scenes.</summary>
public sealed record ManifestProduction(string Name, ManifestCanvas Canvas, ManifestSlate StandbySlate, ManifestSlate EndSlate, ManifestTextTheme TextTheme);

/// <summary>Format and resolution of the output canvas.</summary>
public sealed record ManifestCanvas(CanvasFormat Format, CanvasResolution Resolution);

/// <summary>A slate. <paramref name="BackgroundAsset"/> is the key of an image of <see cref="ProductionManifest.Assets"/>.</summary>
public sealed record ManifestSlate(string Title, string? Subtitle = null, string? BackgroundAsset = null);

/// <summary>Colours of all texts, each <c>#rrggbb</c>.</summary>
public sealed record ManifestTextTheme(string Accent, string Background, string Foreground);

/// <summary>A text or lower third.</summary>
public sealed record ManifestText(string Key, string Code, string Line1, TextStyle Style, TextAlign Align, string? Line2 = null);

/// <summary>An image or video. The file is <paramref name="File"/> in the ZIP; its type is decided by the importer from the content.</summary>
/// <param name="Key">Key inside the file.</param>
/// <param name="Code">Slot code M1, M2, …</param>
/// <param name="Kind">Image or video.</param>
/// <param name="Name">Display name.</param>
/// <param name="ContentType">MIME type the exporter verified (information only).</param>
/// <param name="SizeBytes">Size of the file; the importer checks it.</param>
/// <param name="File">Path of the file inside the ZIP, <c>media/{key}{extension}</c>.</param>
/// <param name="Sha256">SHA-256 of the file as 64 lowercase hex characters; the importer checks it.</param>
public sealed record ManifestAsset(string Key, string Code, AssetKind Kind, string Name, string ContentType, long SizeBytes, string File, string Sha256);

/// <summary>A device source of the original production.</summary>
/// <param name="Key">Key inside the file.</param>
/// <param name="Code">Slot code of the original source, K1… or S1…</param>
/// <param name="Kind">Camera or screen.</param>
/// <param name="Slot">Slot of the original source (<c>camera</c>, <c>screen-1</c> …).</param>
/// <param name="Label">Name of the original source, or null.</param>
public sealed record ManifestPlaceholder(string Key, string Code, SourceKind Kind, string Slot, string? Label = null);

/// <summary>A scene.</summary>
public sealed record ManifestScene(string Name, SceneLayoutMode LayoutMode, ManifestBackground Background, IReadOnlyList<ManifestItem> Items);

/// <summary>Scene background; <paramref name="Asset"/> is the key of an image.</summary>
public sealed record ManifestBackground(string Color, string? Asset = null);

/// <summary>A scene item. <paramref name="Source"/> and the fallback are references, see <see cref="ManifestRefs"/>.</summary>
public sealed record ManifestItem(
    string Source,
    int X,
    int Y,
    int W,
    int H,
    ItemFit Fit,
    ManifestCrop Crop,
    int Radius,
    bool Mirror,
    int Rotation,
    bool Hidden,
    bool Locked,
    ManifestOnLost OnLost,
    ManifestBorder? Border = null);

/// <summary>Crop per side.</summary>
public sealed record ManifestCrop(double Top, double Right, double Bottom, double Left);

/// <summary>Border of an item.</summary>
public sealed record ManifestBorder(int Width, string Color);

/// <summary>What an item does when its source fails.</summary>
/// <param name="HoldMs">How long the last frame stays sharp; null keeps it forever.</param>
/// <param name="FallbackSource">A reference like <see cref="ManifestItem.Source"/>, or null.</param>
public sealed record ManifestOnLost(int? HoldMs = null, string? FallbackSource = null);

/// <summary>Constants of the format.</summary>
public static class ManifestFormat
{
    /// <summary>Value of <see cref="ProductionManifest.Format"/>.</summary>
    public const string Name = "studioflow-production";

    /// <summary>The version this installation writes and reads without migration.</summary>
    public const int CurrentVersion = 1;

    /// <summary>Name of the manifest inside the ZIP.</summary>
    public const string ManifestEntry = "manifest.json";

    /// <summary>Folder of the media files inside the ZIP.</summary>
    public const string MediaFolder = "media/";

    /// <summary>Extension of an export (two parts: the ZIP is the container).</summary>
    public const string FileExtension = ".studioflow.zip";
}

/// <summary>References between the parts of a manifest: <c>asset:a1</c>, <c>text:t1</c>, <c>placeholder:p1</c>.</summary>
public static class ManifestRefs
{
    /// <summary>Prefix of a reference to an asset.</summary>
    public const string Asset = "asset:";

    /// <summary>Prefix of a reference to a text.</summary>
    public const string Text = "text:";

    /// <summary>Prefix of a reference to a placeholder.</summary>
    public const string Placeholder = "placeholder:";

    /// <summary>Splits a reference into its prefix and key; false for any other text.</summary>
    public static bool TryParse(string? reference, out string prefix, out string key)
    {
        prefix = string.Empty;
        key = string.Empty;
        if (reference is null)
        {
            return false;
        }

        foreach (var candidate in new[] { Asset, Text, Placeholder })
        {
            if (reference.StartsWith(candidate, StringComparison.Ordinal) && reference.Length > candidate.Length)
            {
                prefix = candidate;
                key = reference[candidate.Length..];
                return true;
            }
        }

        return false;
    }
}
