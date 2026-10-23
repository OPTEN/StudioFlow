using System.Globalization;
using System.Text;

namespace Opten.FlowStudio.Core.Domain;

/// <summary>Validation and normalisation of user-entered names and short texts.</summary>
public static class TextRules
{
    /// <summary>Maximum length of production and scene names.</summary>
    public const int NameMax = 80;

    /// <summary>Maximum length of device names.</summary>
    public const int DeviceNameMax = 60;

    /// <summary>Maximum length of the platform text of a device.</summary>
    public const int PlatformMax = 80;

    /// <summary>Maximum length of a Regie message to a device.</summary>
    public const int MessageMax = 140;

    /// <summary>
    /// Trims a required name and checks its length (in text elements, so emoji count once). Adds an error and returns
    /// null when it is invalid.
    /// </summary>
    public static string? RequiredName(string? value, int maxLength, string field, ValidationErrors errors)
    {
        ArgumentNullException.ThrowIfNull(errors);
        var trimmed = Clean(value);
        var length = trimmed is null ? 0 : new StringInfo(trimmed).LengthInTextElements;
        if (length < 1 || length > maxLength)
        {
            errors.Add(field, $"Muss 1–{maxLength} Zeichen lang sein.");
            return null;
        }

        return trimmed;
    }

    /// <summary>Validates a required name and throws a validation error when it is invalid.</summary>
    public static string RequireName(string? value, int maxLength, string field)
    {
        var errors = new ValidationErrors();
        var name = RequiredName(value, maxLength, field, errors);
        errors.ThrowIfAny();
        return name!;
    }

    /// <summary>Trims an optional text and cuts it to <paramref name="maxLength"/> characters; empty becomes null.</summary>
    public static string? Truncate(string? value, int maxLength)
    {
        var trimmed = Clean(value);
        if (trimmed is null)
        {
            return null;
        }

        var info = new StringInfo(trimmed);
        return info.LengthInTextElements <= maxLength ? trimmed : info.SubstringByTextElements(0, maxLength).TrimEnd();
    }

    /// <summary>
    /// True for the invisible bidirectional formatting characters (embeddings, overrides, isolates, marks). They can make
    /// a name look different from what it is («‮gnp.exe» shows as «exe.png»), so names never keep them.
    /// </summary>
    public static bool IsBidiControl(char c) => c is (>= '‪' and <= '‮') or (>= '⁦' and <= '⁩') or '‎' or '‏' or '؜';

    /// <summary>Removes control and bidi formatting characters and surrounding whitespace; returns null for empty input.</summary>
    private static string? Clean(string? value)
    {
        if (value is null)
        {
            return null;
        }

        var builder = new StringBuilder(value.Length);
        foreach (var c in value)
        {
            if (!char.IsControl(c) && !IsBidiControl(c))
            {
                builder.Append(c);
            }
        }

        var cleaned = builder.ToString().Trim();
        return cleaned.Length == 0 ? null : cleaned;
    }
}
