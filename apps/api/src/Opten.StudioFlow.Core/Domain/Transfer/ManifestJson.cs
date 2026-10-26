using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;

namespace Opten.StudioFlow.Core.Domain.Transfer;

/// <summary>
/// Writes and reads the manifest of an export. Reading is strict: a part that is missing, of the wrong type or null where
/// the format needs a value, an enum text or a whole number the format does not know, and a nesting deeper than 32 levels
/// make the file <c>invalid_archive</c>; the answer names the JSON path. The format version is checked and migrated before
/// the typed reading, so a file of a newer version is <c>unsupported_format</c> and not a pile of errors.
/// </summary>
public static class ManifestJson
{
    private const int MaxDepth = 32;

    private static readonly JsonSerializerOptions Options = Create();

    /// <summary>The manifest as UTF-8 JSON (camelCase, enums as camelCase texts, indented so the file can be read by people).</summary>
    public static byte[] Serialize(ProductionManifest manifest)
    {
        ArgumentNullException.ThrowIfNull(manifest);
        return JsonSerializer.SerializeToUtf8Bytes(manifest, Options);
    }

    /// <summary>Reads and migrates a manifest with the migrator of this version of StudioFlow.</summary>
    public static ProductionManifest Read(ReadOnlySpan<byte> json) => Read(json, ManifestMigrator.Default);

    /// <summary>Reads a manifest and brings it to the format version of <paramref name="migrator"/>.</summary>
    public static ProductionManifest Read(ReadOnlySpan<byte> json, ManifestMigrator migrator)
    {
        ArgumentNullException.ThrowIfNull(migrator);
        JsonObject root;
        try
        {
            root = JsonNode.Parse(json, documentOptions: new JsonDocumentOptions { MaxDepth = MaxDepth }) as JsonObject
                ?? throw TransferErrors.Invalid("The manifest is not a JSON object.");
        }
        catch (JsonException exception)
        {
            throw TransferErrors.Invalid("The manifest is not valid JSON.", exception.Path);
        }

        if (root["format"] is not JsonValue format || !format.TryGetValue<string>(out var name) || !string.Equals(name, ManifestFormat.Name, StringComparison.Ordinal))
        {
            throw TransferErrors.Invalid("The file is not a StudioFlow export.", "format");
        }

        var upgraded = migrator.Upgrade(root);
        try
        {
            return upgraded.Deserialize<ProductionManifest>(Options) ?? throw TransferErrors.Invalid("The manifest is empty.");
        }
        catch (Exception exception) when (exception is JsonException or InvalidOperationException or NotSupportedException or FormatException)
        {
            var path = (exception as JsonException)?.Path;
            throw TransferErrors.Invalid($"The manifest is damaged{(path is null ? string.Empty : " at " + path)}.", path);
        }
    }

    private static JsonSerializerOptions Create()
    {
        var options = new JsonSerializerOptions
        {
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
            WriteIndented = true,
            NumberHandling = JsonNumberHandling.Strict,
            RespectNullableAnnotations = true,
            RespectRequiredConstructorParameters = true,
            UnmappedMemberHandling = JsonUnmappedMemberHandling.Skip,
            DefaultIgnoreCondition = JsonIgnoreCondition.Never,
            MaxDepth = MaxDepth,
            Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
        };
        options.Converters.Add(new JsonStringEnumConverter(JsonNamingPolicy.CamelCase, allowIntegerValues: false));
        options.MakeReadOnly(populateMissingResolver: true);
        return options;
    }
}
