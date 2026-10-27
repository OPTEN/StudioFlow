using System.Text.Json.Nodes;

namespace Opten.StudioFlow.Core.Domain.Transfer;

/// <summary>
/// Brings the manifest of an older export to the current format. Every step changes the JSON of version <c>n</c> into the
/// JSON of version <c>n + 1</c>; a file of version 1 passes through all steps up to <see cref="ManifestFormat.CurrentVersion"/>.
/// Older files stay importable that way: when a change of the format raises the version, the step from the old version is
/// added to <see cref="ManifestMigrations.Steps"/> (and a test for it). A file of a newer version is refused with
/// <c>unsupported_format</c>: an older program cannot know what a newer one wrote.
/// </summary>
public sealed class ManifestMigrator
{
    private readonly int currentVersion;
    private readonly IReadOnlyDictionary<int, Func<JsonObject, JsonObject>> steps;

    /// <summary>Creates a migrator for a format version and the steps that lead to it.</summary>
    /// <param name="currentVersion">The newest version; the result of <see cref="Upgrade"/> has it.</param>
    /// <param name="steps">For every older version the step to the next one.</param>
    public ManifestMigrator(int currentVersion, IReadOnlyDictionary<int, Func<JsonObject, JsonObject>> steps)
    {
        ArgumentNullException.ThrowIfNull(steps);
        this.currentVersion = currentVersion;
        this.steps = steps;
    }

    /// <summary>The migrator of this version of StudioFlow.</summary>
    public static ManifestMigrator Default { get; } = new(ManifestFormat.CurrentVersion, ManifestMigrations.Steps);

    /// <summary>The version a manifest claims, or null when <c>formatVersion</c> is missing or not a whole number of 1 or more.</summary>
    public static int? VersionOf(JsonObject manifest)
    {
        ArgumentNullException.ThrowIfNull(manifest);
        return manifest["formatVersion"] is JsonValue value && value.TryGetValue<int>(out var version) && version >= 1 ? version : null;
    }

    /// <summary>
    /// Migrates the manifest to the current version (the object is changed in place and returned). A manifest without a
    /// usable <c>formatVersion</c> is <c>invalid_archive</c>, a newer one <c>unsupported_format</c>.
    /// </summary>
    public JsonObject Upgrade(JsonObject manifest)
    {
        var version = VersionOf(manifest) ?? throw TransferErrors.Invalid("The manifest has no valid format version.", "formatVersion");
        if (version > currentVersion)
        {
            throw TransferErrors.Unsupported(version);
        }

        while (version < currentVersion)
        {
            if (!steps.TryGetValue(version, out var step))
            {
                throw TransferErrors.Invalid($"There is no migration from format version {version}.", "formatVersion");
            }

            manifest = step(manifest);
            version++;
            manifest["formatVersion"] = version;
        }

        return manifest;
    }
}

/// <summary>
/// The migration steps of this version of StudioFlow. A change of the format (a new part of the production) raises
/// <see cref="ManifestFormat.CurrentVersion"/> by one and adds the step <c>[oldVersion] = manifest =&gt; …</c> here, so exports
/// of the old version still import.
/// </summary>
public static class ManifestMigrations
{
    /// <summary>The step from each older version to the next one.</summary>
    public static IReadOnlyDictionary<int, Func<JsonObject, JsonObject>> Steps { get; } = new Dictionary<int, Func<JsonObject, JsonObject>>
    {
        // 1 → 2 (issue #7): the audio mixer. A file of version 1 has no sound settings; its videos start with the defaults of
        // a new video (0 dB, not muted, follows the picture).
        [1] = manifest =>
        {
            manifest["audioChannels"] = new JsonArray();
            return manifest;
        },
    };
}
