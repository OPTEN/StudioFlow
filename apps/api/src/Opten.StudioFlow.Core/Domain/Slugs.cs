using System.Text;

namespace Opten.StudioFlow.Core.Domain;

/// <summary>URL slugs of productions: lowercase <c>[a-z0-9-]{1,48}</c>, derived from the name on creation (spec 4.2).</summary>
public static class Slugs
{
    /// <summary>Maximum slug length.</summary>
    public const int MaxLength = 48;

    private const string Fallback = "produktion";

    private static readonly Dictionary<char, string> Transliterations = new()
    {
        ['ä'] = "ae",
        ['ö'] = "oe",
        ['ü'] = "ue",
        ['ß'] = "ss",
        ['à'] = "a",
        ['á'] = "a",
        ['â'] = "a",
        ['ã'] = "a",
        ['å'] = "a",
        ['æ'] = "ae",
        ['ç'] = "c",
        ['è'] = "e",
        ['é'] = "e",
        ['ê'] = "e",
        ['ë'] = "e",
        ['ì'] = "i",
        ['í'] = "i",
        ['î'] = "i",
        ['ï'] = "i",
        ['ñ'] = "n",
        ['ò'] = "o",
        ['ó'] = "o",
        ['ô'] = "o",
        ['õ'] = "o",
        ['ø'] = "o",
        ['œ'] = "oe",
        ['ù'] = "u",
        ['ú'] = "u",
        ['û'] = "u",
        ['ÿ'] = "y",
    };

    /// <summary>Derives the base slug of a name (without uniqueness suffix).</summary>
    public static string FromName(string name)
    {
        ArgumentNullException.ThrowIfNull(name);
        var builder = new StringBuilder(name.Length);
        foreach (var c in name.ToLowerInvariant())
        {
            if (c is (>= 'a' and <= 'z') or (>= '0' and <= '9'))
            {
                builder.Append(c);
            }
            else if (Transliterations.TryGetValue(c, out var replacement))
            {
                builder.Append(replacement);
            }
            else if (builder.Length > 0 && builder[^1] != '-')
            {
                builder.Append('-');
            }
        }

        var slug = builder.ToString().Trim('-');
        if (slug.Length > MaxLength)
        {
            slug = slug[..MaxLength].TrimEnd('-');
        }

        return slug.Length == 0 ? Fallback : slug;
    }

    /// <summary>Makes <paramref name="baseSlug"/> unique by appending <c>-2</c>, <c>-3</c> … within the length limit.</summary>
    public static string MakeUnique(string baseSlug, Func<string, bool> isTaken)
    {
        ArgumentNullException.ThrowIfNull(baseSlug);
        ArgumentNullException.ThrowIfNull(isTaken);
        if (!isTaken(baseSlug))
        {
            return baseSlug;
        }

        for (var n = 2; ; n++)
        {
            var suffix = $"-{n}";
            var stem = baseSlug.Length + suffix.Length > MaxLength ? baseSlug[..(MaxLength - suffix.Length)].TrimEnd('-') : baseSlug;
            var candidate = stem + suffix;
            if (!isTaken(candidate))
            {
                return candidate;
            }
        }
    }

    /// <summary>True when <paramref name="slug"/> has the slug format.</summary>
    public static bool IsValid(string? slug)
    {
        if (string.IsNullOrEmpty(slug) || slug.Length > MaxLength)
        {
            return false;
        }

        foreach (var c in slug)
        {
            if (c is not ((>= 'a' and <= 'z') or (>= '0' and <= '9') or '-'))
            {
                return false;
            }
        }

        return true;
    }
}
