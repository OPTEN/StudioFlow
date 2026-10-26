namespace Opten.StudioFlow.Core.Contracts;

/// <summary>Request to duplicate a production.</summary>
/// <param name="Name">Name of the copy; “{name} (copy)” when missing. A name that is taken gets “ (2)”, “ (3)” … appended.</param>
public sealed record DuplicateProductionRequest(string? Name);

/// <summary>What an import would do; the answer of <c>POST /api/productions/import?dryRun=true</c>. Nothing is stored.</summary>
/// <param name="Name">Name the production would get (with “ (2)” appended when the name is taken).</param>
/// <param name="AppVersion">Version of StudioFlow that wrote the file.</param>
/// <param name="Scenes">Number of scenes.</param>
/// <param name="Texts">Number of texts and lower thirds.</param>
/// <param name="Media">Number of media files (images and videos).</param>
/// <param name="MediaBytes">Size of the media files together.</param>
/// <param name="Placeholders">The device sources that become placeholders.</param>
/// <param name="Warnings">What the operator should know before importing.</param>
public sealed record ImportPreviewDto(
    string Name,
    string AppVersion,
    int Scenes,
    int Texts,
    int Media,
    long MediaBytes,
    IReadOnlyList<ImportPlaceholderDto> Placeholders,
    IReadOnlyList<ImportWarningDto> Warnings);

/// <summary>A device source of the imported production, which becomes a placeholder.</summary>
/// <param name="Code">Slot code.</param>
/// <param name="Kind">Camera or screen.</param>
/// <param name="Label">Name of the source, or null.</param>
public sealed record ImportPlaceholderDto(string Code, SourceKind Kind, string? Label);

/// <summary>A warning of the import preview. Clients show their own text for the code.</summary>
/// <param name="Code">What the warning is about.</param>
/// <param name="Params">Values for the text of the code, keyed in camelCase.</param>
public sealed record ImportWarningDto(ImportWarningCode Code, IReadOnlyDictionary<string, string> Params);

/// <summary>What an <see cref="ImportWarningDto"/> reports.</summary>
public enum ImportWarningCode
{
    /// <summary>The name is taken, so the production is imported under another name. Params: <c>name</c>.</summary>
    NameChanged,

    /// <summary>
    /// The file holds device sources: they become placeholders that show “Source missing” until devices are paired and
    /// assigned. Params: <c>count</c>.
    /// </summary>
    Placeholders,
}

/// <summary>Assigns a placeholder to a source: every scene item that shows the placeholder shows the source from now on.</summary>
/// <param name="SourceId">The source: a device slot, an image or a video. A text cannot take the place of a camera.</param>
public sealed record AssignPlaceholderRequest(string SourceId);

/// <summary>What assigning or removing a placeholder changed.</summary>
/// <param name="Scenes">Scenes that changed.</param>
/// <param name="Items">Scene items that show the source now (assigned) or were removed (removed).</param>
public sealed record PlaceholderChangeDto(int Scenes, int Items);
