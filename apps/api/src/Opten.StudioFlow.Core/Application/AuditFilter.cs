using System.Globalization;
using System.Text;
using Opten.StudioFlow.Core.Contracts;
using Opten.StudioFlow.Core.Domain;

namespace Opten.StudioFlow.Core.Application;

/// <summary>The filter of an audit query as it arrives from a client: every value is still text.</summary>
/// <param name="From">First moment to include (ISO 8601), or null.</param>
/// <param name="To">First moment to leave out (ISO 8601), or null.</param>
/// <param name="Production">A production id, <see cref="AuditFilter.NoProduction"/> for global entries, or null for every entry.</param>
/// <param name="Categories">Camel case names of <see cref="AuditCategory"/>.</param>
/// <param name="Actions">Action codes such as <c>scene.live</c>.</param>
/// <param name="Actor"><c>admin</c>, <c>system</c> or <c>device:{id}</c>.</param>
/// <param name="Text">Part of the action code or of a detail (device name, scene, user name), any case.</param>
public sealed record AuditFilterInput(
    string? From = null,
    string? To = null,
    string? Production = null,
    IReadOnlyList<string>? Categories = null,
    IReadOnlyList<string>? Actions = null,
    string? Actor = null,
    string? Text = null);

/// <summary>A validated audit filter. Categories and actions are merged into <see cref="Actions"/>.</summary>
/// <param name="From">First moment to include.</param>
/// <param name="To">First moment to leave out.</param>
/// <param name="ProductionId">A production id, <see cref="NoProduction"/> or null for every entry.</param>
/// <param name="Actions">Only these actions, or null for every action. Empty when categories and actions exclude each other.</param>
/// <param name="Actor">Only this actor, or null.</param>
/// <param name="Text">Case-insensitive part of the action code or of the details, or null.</param>
public sealed record AuditFilter(
    DateTimeOffset? From,
    DateTimeOffset? To,
    string? ProductionId,
    IReadOnlyList<string>? Actions,
    string? Actor,
    string? Text)
{
    /// <summary>Value of <c>production</c> for entries without a production (sign-ins, account changes).</summary>
    public const string NoProduction = "none";

    /// <summary>Longest accepted <see cref="Text"/>.</summary>
    public const int TextMaxLength = 100;

    private const int IdMaxLength = 64;
    private const int ActorMaxLength = 72;

    /// <summary>No restriction.</summary>
    public static AuditFilter Everything { get; } = new(null, null, null, null, null, null);

    /// <summary>Checks the input and throws a validation error that names every invalid field.</summary>
    public static AuditFilter Create(AuditFilterInput input)
    {
        ArgumentNullException.ThrowIfNull(input);
        var errors = new ValidationErrors();
        var from = ParseTime(input.From, "from", errors);
        var to = ParseTime(input.To, "to", errors);
        if (from is { } start && to is { } end && end <= start)
        {
            errors.Add("to", "The end must be after the start.");
        }

        var production = Clean(input.Production);
        if (production is { Length: > IdMaxLength })
        {
            errors.Add("production", "The production is unknown.");
        }

        var actor = Clean(input.Actor);
        if (actor is { Length: > ActorMaxLength })
        {
            errors.Add("actor", "The actor is unknown.");
        }

        var text = Clean(input.Text);
        if (text is { Length: > TextMaxLength })
        {
            errors.Add("q", $"The search text can have at most {TextMaxLength.ToString(CultureInfo.InvariantCulture)} characters.");
        }

        var actions = ResolveActions(input, errors);
        errors.ThrowIfAny();
        return new AuditFilter(from, to, production, actions, actor, text);
    }

    /// <summary>The filter as audit details (only the values that are set), for the entry of an export.</summary>
    public IReadOnlyDictionary<string, string> ToDetails()
    {
        var details = new Dictionary<string, string>(StringComparer.Ordinal);
        AddIfSet(details, "from", From?.ToString("O", CultureInfo.InvariantCulture));
        AddIfSet(details, "to", To?.ToString("O", CultureInfo.InvariantCulture));
        AddIfSet(details, "production", ProductionId);
        AddIfSet(details, "actions", Actions is null ? null : string.Join(',', Actions));
        AddIfSet(details, "actor", Actor);
        AddIfSet(details, "q", Text);
        return details;
    }

    private static IReadOnlyList<string>? ResolveActions(AuditFilterInput input, ValidationErrors errors)
    {
        var categories = new List<AuditCategory>();
        foreach (var name in input.Categories ?? [])
        {
            if (Enum.GetValues<AuditCategory>().Cast<AuditCategory?>().FirstOrDefault(c => string.Equals(c.ToString(), name?.Trim(), StringComparison.OrdinalIgnoreCase)) is { } category)
            {
                categories.Add(category);
            }
            else
            {
                errors.Add("category", $"The category “{TextRules.Truncate(name, 30)}” is unknown.");
            }
        }

        var actions = (input.Actions ?? []).Where(a => !string.IsNullOrWhiteSpace(a)).Select(a => a.Trim()).ToList();
        foreach (var action in actions.Where(a => !AuditCategories.IsKnown(a)))
        {
            errors.Add("action", $"The action “{TextRules.Truncate(action, 40)}” is unknown.");
        }

        var fromCategories = categories.Count > 0 ? AuditCategories.ActionsOf(categories) : null;
        return (fromCategories, actions.Count > 0 ? actions : null) switch
        {
            (null, null) => null,
            ({ } byCategory, null) => byCategory,
            (null, { } byAction) => [.. byAction.Distinct(StringComparer.Ordinal)],
            ({ } byCategory, { } byAction) => [.. byAction.Distinct(StringComparer.Ordinal).Where(byCategory.Contains)],
        };
    }

    private static DateTimeOffset? ParseTime(string? text, string field, ValidationErrors errors)
    {
        if (Clean(text) is not { } value)
        {
            return null;
        }

        if (DateTimeOffset.TryParse(value, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out var time))
        {
            return time;
        }

        errors.Add(field, "Use a date and time such as 2026-10-26T14:03:00Z.");
        return null;
    }

    private static string? Clean(string? text) => string.IsNullOrWhiteSpace(text) ? null : text.Trim();

    private static void AddIfSet(Dictionary<string, string> details, string key, string? value)
    {
        if (value is not null)
        {
            details[key] = value;
        }
    }
}

/// <summary>
/// The position after the last entry of a page: entries are ordered by time and id, newest first, so the next page
/// starts at the first entry that is older than <see cref="At"/>, or equally old with a smaller <see cref="Id"/>. The
/// text form is opaque to clients.
/// </summary>
/// <param name="At">Time of the last entry of the page.</param>
/// <param name="Id">Id of the last entry of the page.</param>
public readonly record struct AuditCursor(DateTimeOffset At, long Id)
{
    /// <summary>The cursor as URL-safe text.</summary>
    public string Encode() =>
        Convert.ToBase64String(Encoding.ASCII.GetBytes(string.Create(CultureInfo.InvariantCulture, $"{At.UtcTicks}.{Id}"))).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    /// <summary>Reads a cursor; false for anything that <see cref="Encode"/> did not produce.</summary>
    public static bool TryParse(string? text, out AuditCursor cursor)
    {
        cursor = default;
        if (string.IsNullOrEmpty(text) || text.Length > 64)
        {
            return false;
        }

        var padded = text.Replace('-', '+').Replace('_', '/');
        padded = padded.PadRight(padded.Length + ((4 - (padded.Length % 4)) % 4), '=');
        Span<byte> bytes = stackalloc byte[48];
        if (!Convert.TryFromBase64String(padded, bytes, out var written))
        {
            return false;
        }

        var parts = Encoding.ASCII.GetString(bytes[..written]).Split('.');
        if (parts.Length != 2
            || !long.TryParse(parts[0], NumberStyles.None, CultureInfo.InvariantCulture, out var ticks)
            || !long.TryParse(parts[1], NumberStyles.None, CultureInfo.InvariantCulture, out var id)
            || ticks > DateTimeOffset.MaxValue.UtcTicks)
        {
            return false;
        }

        cursor = new AuditCursor(new DateTimeOffset(ticks, TimeSpan.Zero), id);
        return true;
    }
}
