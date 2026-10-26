namespace Opten.StudioFlow.Core.Domain;

/// <summary>
/// A named output link of a production (spec 4.8): one consumer of the output page (a proxy, an OBS machine for the
/// Teams camera, …) with its own secret key and its own IP restriction. Revoking the link deletes it, so its key is
/// invalid at once; regenerating replaces only the key.
/// </summary>
public sealed class OutputLink
{
    /// <summary>Maximum number of output links per production.</summary>
    public const int MaxPerProduction = 10;

    /// <summary>Maximum length of a link name.</summary>
    public const int NameMax = 40;

    /// <summary>Name of the link every production starts with (and that the migrated key of an old production gets).</summary>
    public const string DefaultName = "Proxy";

    private OutputLink()
    {
    }

    /// <summary>Link id (also part of the LiveKit identity of its output pages).</summary>
    public string Id { get; private set; } = string.Empty;

    /// <summary>Production the link belongs to.</summary>
    public string ProductionId { get; private set; } = string.Empty;

    /// <summary>Name shown in the Regie (unique per production, ignoring case).</summary>
    public string Name { get; private set; } = string.Empty;

    /// <summary>Secret key of the link (shown to the Regie, therefore not hashed).</summary>
    public string Key { get; private set; } = string.Empty;

    /// <summary>When the current key was created.</summary>
    public DateTimeOffset KeyCreatedAt { get; private set; }

    /// <summary>IP addresses or CIDR ranges allowed to open the link; empty allows every address.</summary>
    public IReadOnlyList<string> AllowedIps { get; private set; } = [];

    /// <summary>Creation time.</summary>
    public DateTimeOffset CreatedAt { get; private set; }

    /// <summary>When a page of this link last connected or disconnected; null while it was never used.</summary>
    public DateTimeOffset? LastSeenAt { get; private set; }

    /// <summary>Creates a link with a new key; the name must not be used by one of <paramref name="existing"/>.</summary>
    public static OutputLink Create(string productionId, string name, IReadOnlyCollection<OutputLink> existing, DateTimeOffset now)
    {
        ArgumentException.ThrowIfNullOrEmpty(productionId);
        ArgumentNullException.ThrowIfNull(existing);
        if (existing.Count >= MaxPerProduction)
        {
            throw StudioFlowException.LimitReached($"At most {MaxPerProduction} output links per production. Revoke one first.");
        }

        return new OutputLink
        {
            Id = EntityIds.New(EntityIds.OutputLink),
            ProductionId = productionId,
            Name = RequireFreeName(name, existing, exceptId: null),
            Key = Secrets.New(),
            KeyCreatedAt = now,
            CreatedAt = now,
        };
    }

    /// <summary>Renames the link; the name must not be used by another link of <paramref name="siblings"/>.</summary>
    public void Rename(string name, IReadOnlyCollection<OutputLink> siblings)
    {
        ArgumentNullException.ThrowIfNull(siblings);
        Name = RequireFreeName(name, siblings, Id);
    }

    /// <summary>Creates a new key; the old one is invalid immediately.</summary>
    public void RegenerateKey(DateTimeOffset now)
    {
        Key = Secrets.New();
        KeyCreatedAt = now;
    }

    /// <summary>Validates and normalises the IP restriction of the link.</summary>
    public void SetAllowedIps(IReadOnlyList<string>? rules)
    {
        if (rules is null)
        {
            throw StudioFlowException.Invalid("allowedIps", "The list is missing.");
        }

        if (rules.Count > IpRule.MaxRules)
        {
            throw StudioFlowException.Invalid("allowedIps", $"At most {IpRule.MaxRules} entries.");
        }

        var errors = new ValidationErrors();
        var normalized = new List<string>(rules.Count);
        for (var i = 0; i < rules.Count; i++)
        {
            if (IpRule.TryParse(rules[i], out var rule))
            {
                normalized.Add(rule.ToString());
            }
            else
            {
                errors.Add($"allowedIps[{i}]", "Enter an IP address or range (CIDR), e.g. 192.168.1.0/24.");
            }
        }

        errors.ThrowIfAny();
        AllowedIps = [.. normalized.Distinct(StringComparer.Ordinal)];
    }

    /// <summary>Records that a page of this link connected or disconnected.</summary>
    public void MarkSeen(DateTimeOffset now) => LastSeenAt = now;

    private static string RequireFreeName(string? name, IReadOnlyCollection<OutputLink> others, string? exceptId)
    {
        var valid = TextRules.RequireName(name, NameMax, "name");
        return others.Any(l => !string.Equals(l.Id, exceptId, StringComparison.Ordinal) && string.Equals(l.Name, valid, StringComparison.OrdinalIgnoreCase))
            ? throw StudioFlowException.Invalid("name", "A link with this name exists already.")
            : valid;
    }
}
