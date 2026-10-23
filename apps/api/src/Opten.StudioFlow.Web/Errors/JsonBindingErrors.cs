using System.Text;
using System.Text.Json;

namespace Opten.StudioFlow.Web.Errors;

/// <summary>
/// Field errors for request bodies that cannot be bound (BUG-08): an unknown enum text, a wrong type or broken JSON is
/// answered like any other validation error – 400 <c>validation_failed</c> with <c>errors</c> naming the field as a
/// camelCase path (<c>kind</c>, <c>items[2].fit</c>) – and never with the serializer's message, which names .NET types.
/// </summary>
internal static class JsonBindingErrors
{
    /// <summary>Field name of an error that belongs to the body as a whole (broken JSON, wrong top-level type).</summary>
    public const string BodyField = "body";

    /// <summary>Message of a value that cannot be read.</summary>
    public const string InvalidValue = "Invalid value.";

    /// <summary>The validation errors of a binding failure, or null when <paramref name="exception"/> is none.</summary>
    public static IReadOnlyDictionary<string, string[]>? From(BadHttpRequestException exception)
    {
        ArgumentNullException.ThrowIfNull(exception);
        return exception.InnerException is JsonException json
            ? new Dictionary<string, string[]>(StringComparer.Ordinal) { [FieldOf(json.Path)] = [InvalidValue] }
            : null;
    }

    /// <summary>
    /// Turns a JSON path of System.Text.Json (<c>$.items[2].Fit</c>, <c>$['odd name']</c>) into the field path of the
    /// validation errors (<c>items[2].fit</c>); the root becomes <see cref="BodyField"/>.
    /// </summary>
    public static string FieldOf(string? path)
    {
        if (string.IsNullOrEmpty(path) || path == "$")
        {
            return BodyField;
        }

        var field = new StringBuilder(path.Length);
        var index = path.StartsWith('$') ? 1 : 0;
        while (index < path.Length)
        {
            switch (path[index])
            {
                case '.':
                    index++;
                    break;
                case '[' when index + 1 < path.Length && path[index + 1] == '\'':
                    var end = path.IndexOf("']", index + 2, StringComparison.Ordinal);
                    var name = end < 0 ? path[(index + 2)..] : path[(index + 2)..end];
                    AppendName(field, name);
                    index = end < 0 ? path.Length : end + 2;
                    continue;
                case '[':
                    var close = path.IndexOf(']', index);
                    var segment = close < 0 ? path[index..] : path[index..(close + 1)];
                    field.Append(segment);
                    index = close < 0 ? path.Length : close + 1;
                    continue;
            }

            var next = path.IndexOfAny(['.', '['], index);
            AppendName(field, next < 0 ? path[index..] : path[index..next]);
            index = next < 0 ? path.Length : next;
        }

        return field.Length == 0 ? BodyField : field.ToString();
    }

    private static void AppendName(StringBuilder field, string name)
    {
        if (name.Length == 0)
        {
            return;
        }

        if (field.Length > 0)
        {
            field.Append('.');
        }

        field.Append(char.ToLowerInvariant(name[0])).Append(name.AsSpan(1));
    }
}
