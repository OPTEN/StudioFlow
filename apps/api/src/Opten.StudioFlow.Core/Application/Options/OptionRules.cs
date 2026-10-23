using System.Globalization;

namespace Opten.StudioFlow.Core.Application;

/// <summary>
/// Settings that check their own values (GAP-01: every duration and limit is configurable, with the spec value as
/// default). The web host binds them from configuration and refuses to start when <see cref="Validate"/> reports errors.
/// </summary>
public interface IValidatedOptions
{
    /// <summary>Messages for every invalid value, naming the configuration key; empty when everything is valid.</summary>
    IEnumerable<string> Validate();
}

/// <summary>Range checks with messages that name the configuration key and the allowed range (never the value of secrets).</summary>
public static class OptionRules
{
    /// <summary>Checks that a duration lies within [<paramref name="min"/>, <paramref name="max"/>].</summary>
    public static IEnumerable<string> Duration(string key, TimeSpan value, TimeSpan min, TimeSpan max)
    {
        if (value < min || value > max)
        {
            yield return string.Create(CultureInfo.InvariantCulture, $"{key} must be between {min:c} and {max:c} (is {value:c}).");
        }
    }

    /// <summary>Checks that a count lies within [<paramref name="min"/>, <paramref name="max"/>].</summary>
    public static IEnumerable<string> Count(string key, int value, int min, int max)
    {
        if (value < min || value > max)
        {
            yield return string.Create(CultureInfo.InvariantCulture, $"{key} must be between {min} and {max} (is {value}).");
        }
    }
}
