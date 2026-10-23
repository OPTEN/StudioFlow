using Opten.StudioFlow.Core.Contracts;

namespace Opten.StudioFlow.Core.Domain;

/// <summary>Collects field errors (camelCase field paths such as <c>items[2].crop.top</c>) and throws them at once.</summary>
public sealed class ValidationErrors
{
    private readonly Dictionary<string, List<string>> errors = new(StringComparer.Ordinal);

    /// <summary>True when at least one error was added.</summary>
    public bool HasErrors => errors.Count > 0;

    /// <summary>Adds an error for a field.</summary>
    public void Add(string field, string message)
    {
        if (!errors.TryGetValue(field, out var messages))
        {
            messages = [];
            errors[field] = messages;
        }

        messages.Add(message);
    }

    /// <summary>Throws a validation <see cref="StudioFlowException"/> when errors were collected.</summary>
    public void ThrowIfAny()
    {
        if (HasErrors)
        {
            throw new StudioFlowException(ErrorKind.Validation, ErrorCodes.ValidationFailed, "The input is invalid.", ToDictionary());
        }
    }

    /// <summary>The collected errors.</summary>
    public IReadOnlyDictionary<string, string[]> ToDictionary() =>
        errors.ToDictionary(e => e.Key, e => e.Value.ToArray(), StringComparer.Ordinal);
}
