using System.Text.Json;
using System.Text.Json.Serialization;

namespace Opten.FlowStudio.Core.Contracts;

/// <summary>
/// The JSON format of every contract (spec 6): camelCase properties, enums as camelCase strings, numbers never as
/// strings, polymorphic metadata accepted in any position (PostgreSQL <c>jsonb</c> reorders keys). One definition for
/// HTTP, the SignalR JSON hub protocol and the <c>jsonb</c> columns.
/// </summary>
public static class ContractJson
{
    /// <summary>Shared, read-only options for code that serializes contracts directly.</summary>
    public static JsonSerializerOptions Options { get; } = Create();

    /// <summary>Applies the contract format to existing options (HTTP, SignalR).</summary>
    public static void Configure(JsonSerializerOptions options)
    {
        ArgumentNullException.ThrowIfNull(options);
        options.PropertyNamingPolicy = JsonNamingPolicy.CamelCase;
        options.PropertyNameCaseInsensitive = true;
        options.NumberHandling = JsonNumberHandling.Strict;
        options.AllowOutOfOrderMetadataProperties = true;
        options.Converters.Add(new JsonStringEnumConverter(JsonNamingPolicy.CamelCase));
    }

    private static JsonSerializerOptions Create()
    {
        var options = new JsonSerializerOptions(JsonSerializerDefaults.Web);
        Configure(options);
        options.MakeReadOnly(populateMissingResolver: true);
        return options;
    }
}
