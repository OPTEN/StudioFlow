using System.Runtime.CompilerServices;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;
using Opten.FlowStudio.Core.Contracts;

namespace Opten.FlowStudio.Infrastructure.Persistence;

/// <summary>
/// Maps a value object (record or list of records) to a <c>jsonb</c> column in the contract JSON format. The domain
/// replaces these values instead of mutating them, so change tracking compares references only (cheap and exact).
/// </summary>
internal static class JsonColumn
{
    /// <summary>Stores the property as <c>jsonb</c>.</summary>
    public static PropertyBuilder<T> AsJson<T>(this PropertyBuilder<T> property)
        where T : class?
    {
        ArgumentNullException.ThrowIfNull(property);
        var converter = new ValueConverter<T, string>(value => Serialize(value), json => Deserialize<T>(json));
        var comparer = new ValueComparer<T>((left, right) => ReferenceEquals(left, right), value => RuntimeHelpers.GetHashCode(value), value => value);
        return property.HasConversion(converter, comparer).HasColumnType("jsonb");
    }

    private static string Serialize<T>(T value) => JsonSerializer.Serialize(value, ContractJson.Options);

    private static T Deserialize<T>(string json) => JsonSerializer.Deserialize<T>(json, ContractJson.Options)
        ?? throw new InvalidOperationException($"The jsonb value of type {typeof(T).Name} is null.");
}
