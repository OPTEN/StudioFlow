using System.Globalization;

namespace Opten.StudioFlow.Core.Domain;

/// <summary>Names of copied productions (duplicate and import).</summary>
public static class ProductionNames
{
    /// <summary>The name of a copy that was not named: “Webinar (copy)”.</summary>
    public static string CopyOf(string name)
    {
        ArgumentNullException.ThrowIfNull(name);
        return Fit(name, " (copy)");
    }

    /// <summary>
    /// The name, or – when a production has it already (ignoring case and surrounding spaces) – the name with “ (2)”, “ (3)” …
    /// appended. The base is cut where needed so the result stays within the length of a production name.
    /// </summary>
    public static string Unique(string name, IEnumerable<string> taken)
    {
        ArgumentNullException.ThrowIfNull(name);
        ArgumentNullException.ThrowIfNull(taken);
        var used = taken.Select(t => t.Trim()).ToHashSet(StringComparer.OrdinalIgnoreCase);
        if (!used.Contains(name.Trim()))
        {
            return name;
        }

        for (var n = 2; ; n++)
        {
            var candidate = Fit(name, string.Create(CultureInfo.InvariantCulture, $" ({n})"));
            if (!used.Contains(candidate))
            {
                return candidate;
            }
        }
    }

    /// <summary>The name with the suffix, the name cut (in text elements, so an emoji stays whole) to leave room for it.</summary>
    private static string Fit(string name, string suffix)
    {
        var info = new StringInfo(name);
        var room = TextRules.NameMax - new StringInfo(suffix).LengthInTextElements;
        return info.LengthInTextElements <= room ? name + suffix : info.SubstringByTextElements(0, room).TrimEnd() + suffix;
    }
}
