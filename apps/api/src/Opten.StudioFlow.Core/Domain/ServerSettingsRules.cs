using System.Text.RegularExpressions;
using Opten.StudioFlow.Core.Contracts;

namespace Opten.StudioFlow.Core.Domain;

/// <summary>
/// The rules for every value of the server settings (issue #27). Each method adds a code of <see cref="SettingsFieldErrors"/>
/// per violated rule and returns the normalised value (null when it is invalid or empty). The accepted characters exclude
/// everything that could end a token of the generated Caddyfile or the LiveKit configuration, so the values are written
/// into them without escaping.
/// </summary>
public static partial class ServerSettingsRules
{
    /// <summary>Most origins that may embed the output.</summary>
    public const int MaxOrigins = 20;

    /// <summary>Most public age keys of the off-site copy.</summary>
    public const int MaxAgeRecipients = 10;

    /// <summary>Largest accepted certificate, private key or rclone.conf (characters).</summary>
    public const int MaxTextLength = 65_536;

    /// <summary>Largest daily and weekly retention.</summary>
    public const int MaxKeepDaily = 365;

    /// <summary>Largest weekly retention.</summary>
    public const int MaxKeepWeekly = 104;

    private static readonly string[] CronMacros = ["@yearly", "@annually", "@monthly", "@weekly", "@daily", "@midnight", "@hourly"];

    private static readonly string[] CronMonths = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

    private static readonly string[] CronDays = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

    /// <summary>The IPv4 address LiveKit announces: four decimal numbers without leading zeros, not unspecified, multicast, broadcast or reserved.</summary>
    public static string? ValidateMediaAddress(string? value, string field, ValidationErrors errors)
    {
        ArgumentNullException.ThrowIfNull(errors);
        var address = value?.Trim();
        if (address is null || !Ipv4Pattern().IsMatch(address) || !IsUsableIpv4(address))
        {
            errors.Add(field, SettingsFieldErrors.MediaAddressInvalid);
            return null;
        }

        return address;
    }

    /// <summary>True for an IPv4 address that can be the address of a server (loopback and private ranges included).</summary>
    public static bool IsUsableIpv4(string address)
    {
        ArgumentNullException.ThrowIfNull(address);
        if (!Ipv4Pattern().IsMatch(address))
        {
            return false;
        }

        var first = int.Parse(address.AsSpan(0, address.IndexOf('.', StringComparison.Ordinal)), System.Globalization.CultureInfo.InvariantCulture);
        return first is not 0 and < 224;
    }

    /// <summary>
    /// A host name (letters, digits and hyphens in labels of at most 63 characters, at most 253 in all), lower case. A
    /// name for a public certificate needs a dot (<paramref name="needsDot"/>); an empty value is valid when the domain is
    /// optional.
    /// </summary>
    public static string? ValidateDomain(string? value, bool required, bool needsDot, string field, ValidationErrors errors)
    {
        ArgumentNullException.ThrowIfNull(errors);
        var domain = value?.Trim().TrimEnd('.').ToLowerInvariant();
        if (string.IsNullOrEmpty(domain))
        {
            if (required)
            {
                errors.Add(field, SettingsFieldErrors.DomainRequired);
            }

            return null;
        }

        if (domain.Length > 253 || !DomainPattern().IsMatch(domain) || Ipv4Pattern().IsMatch(domain) || (needsDot && !domain.Contains('.', StringComparison.Ordinal)))
        {
            errors.Add(field, SettingsFieldErrors.DomainInvalid);
            return null;
        }

        return domain;
    }

    /// <summary>The target of a delegated <c>_acme-challenge</c> record: a host name whose labels may start with an underscore.</summary>
    public static string? ValidateChallengeDomain(string? value, string field, ValidationErrors errors)
    {
        ArgumentNullException.ThrowIfNull(errors);
        var domain = value?.Trim().TrimEnd('.').ToLowerInvariant();
        if (string.IsNullOrEmpty(domain))
        {
            return null;
        }

        if (domain.Length > 253 || !ChallengeDomainPattern().IsMatch(domain) || !domain.Contains('.', StringComparison.Ordinal))
        {
            errors.Add(field, SettingsFieldErrors.DomainInvalid);
            return null;
        }

        return domain;
    }

    /// <summary>The e-mail address of the Let's Encrypt account; empty is valid.</summary>
    public static string? ValidateEmail(string? value, string field, ValidationErrors errors)
    {
        ArgumentNullException.ThrowIfNull(errors);
        var email = value?.Trim();
        if (string.IsNullOrEmpty(email))
        {
            return null;
        }

        if (email.Length > 254 || !EmailPattern().IsMatch(email))
        {
            errors.Add(field, SettingsFieldErrors.EmailInvalid);
            return null;
        }

        return email;
    }

    /// <summary>
    /// The credentials of a DNS provider: every field of the provider present and of the right shape, no other field. When
    /// <paramref name="keepStored"/> is true an absent dictionary is valid (the stored credentials stay); returns null then.
    /// </summary>
    public static IReadOnlyList<string>? ValidateDnsCredentials(string mode, IReadOnlyDictionary<string, string>? given, bool keepStored, string field, ValidationErrors errors)
    {
        ArgumentNullException.ThrowIfNull(errors);
        var provider = TlsModes.ProviderOf(mode) ?? throw new ArgumentException("Not a dns-* mode.", nameof(mode));
        if (given is null || given.Count == 0)
        {
            if (!keepStored)
            {
                foreach (var dnsField in provider.Fields)
                {
                    errors.Add($"{field}.{dnsField.Name}", SettingsFieldErrors.CredentialRequired);
                }
            }

            return null;
        }

        var values = new List<string>();
        foreach (var name in given.Keys.Where(name => provider.Fields.All(f => !string.Equals(f.Name, name, StringComparison.Ordinal))))
        {
            errors.Add($"{field}.{name}", SettingsFieldErrors.CredentialUnknown);
        }

        foreach (var dnsField in provider.Fields)
        {
            var value = given.TryGetValue(dnsField.Name, out var raw) ? raw?.Trim() : null;
            if (string.IsNullOrEmpty(value))
            {
                errors.Add($"{field}.{dnsField.Name}", SettingsFieldErrors.CredentialRequired);
            }
            else if (!dnsField.Pattern.IsMatch(value))
            {
                errors.Add($"{field}.{dnsField.Name}", SettingsFieldErrors.CredentialInvalid);
            }
            else
            {
                values.Add(value);
            }
        }

        return values.Count == provider.Fields.Count ? values : null;
    }

    /// <summary>
    /// The origins that may frame the output as CSP sources: <c>https://host</c> or <c>http://host</c> with an optional
    /// port, a host that may start with <c>*.</c>. <c>'self'</c> is always allowed and dropped. Lower case, without
    /// duplicates, in the given order.
    /// </summary>
    public static IReadOnlyList<string> ValidateOrigins(IReadOnlyList<string>? origins, string field, ValidationErrors errors)
    {
        ArgumentNullException.ThrowIfNull(errors);
        var result = new List<string>();
        var index = 0;
        foreach (var raw in origins ?? [])
        {
            var origin = raw?.Trim().TrimEnd('/').ToLowerInvariant() ?? string.Empty;
            if (origin.Length == 0 || string.Equals(origin, "'self'", StringComparison.Ordinal))
            {
                index++;
                continue;
            }

            if (origin.Length > 255 || !OriginPattern().IsMatch(origin))
            {
                errors.Add($"{field}[{index}]", SettingsFieldErrors.OriginInvalid);
            }
            else if (!result.Contains(origin, StringComparer.Ordinal))
            {
                result.Add(origin);
            }

            index++;
        }

        if (result.Count > MaxOrigins)
        {
            errors.Add(field, SettingsFieldErrors.TooManyOrigins);
        }

        return result;
    }

    /// <summary>A cron expression of five fields (or a macro such as <c>@daily</c>); empty means no schedule.</summary>
    public static string? ValidateSchedule(string? value, string field, ValidationErrors errors)
    {
        ArgumentNullException.ThrowIfNull(errors);
        var schedule = value is null ? null : string.Join(' ', value.Split(' ', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries));
        if (string.IsNullOrEmpty(schedule))
        {
            return null;
        }

        if (schedule.Length > 100 || !IsCron(schedule))
        {
            errors.Add(field, SettingsFieldErrors.ScheduleInvalid);
            return null;
        }

        return schedule;
    }

    /// <summary>An IANA time zone name such as <c>Europe/Zurich</c>; empty means UTC.</summary>
    public static string? ValidateTimezone(string? value, string field, ValidationErrors errors)
    {
        ArgumentNullException.ThrowIfNull(errors);
        var zone = value?.Trim();
        if (string.IsNullOrEmpty(zone))
        {
            return null;
        }

        if (zone.Length > 64 || !TimezonePattern().IsMatch(zone))
        {
            errors.Add(field, SettingsFieldErrors.TimezoneInvalid);
            return null;
        }

        return zone;
    }

    /// <summary>How many daily and weekly backups are kept.</summary>
    public static void ValidateRetention(int keepDaily, int keepWeekly, ValidationErrors errors)
    {
        ArgumentNullException.ThrowIfNull(errors);
        if (keepDaily is < 1 or > MaxKeepDaily)
        {
            errors.Add("keepDaily", SettingsFieldErrors.KeepInvalid);
        }

        if (keepWeekly is < 1 or > MaxKeepWeekly)
        {
            errors.Add("keepWeekly", SettingsFieldErrors.KeepInvalid);
        }
    }

    /// <summary>The rclone remote <c>name:path</c>; empty means no off-site copy.</summary>
    public static string? ValidateRemote(string? value, string field, ValidationErrors errors)
    {
        ArgumentNullException.ThrowIfNull(errors);
        var remote = value?.Trim();
        if (string.IsNullOrEmpty(remote))
        {
            return null;
        }

        if (remote.Length > 240 || !RemotePattern().IsMatch(remote))
        {
            errors.Add(field, SettingsFieldErrors.RemoteInvalid);
            return null;
        }

        return remote;
    }

    /// <summary>The text of an rclone.conf: some sections, no control characters other than line breaks and tabs.</summary>
    public static string? ValidateRcloneConfig(string? value, string field, ValidationErrors errors)
    {
        ArgumentNullException.ThrowIfNull(errors);
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }

        var text = value.Replace("\r\n", "\n", StringComparison.Ordinal).Trim() + "\n";
        if (text.Length > MaxTextLength || !SectionHeaderPattern().IsMatch(text) || text.Any(c => char.IsControl(c) && c is not ('\n' or '\t')))
        {
            errors.Add(field, SettingsFieldErrors.RcloneConfigInvalid);
            return null;
        }

        return text;
    }

    /// <summary>True when the remote <c>name:path</c> names a section of the rclone configuration (a remote without a name needs none).</summary>
    public static bool RemoteIsDefined(string remote, string rcloneConfig)
    {
        ArgumentNullException.ThrowIfNull(remote);
        ArgumentNullException.ThrowIfNull(rcloneConfig);
        var name = remote[..remote.IndexOf(':', StringComparison.Ordinal)];
        return rcloneConfig.Split('\n').Any(line => string.Equals(line.Trim(), $"[{name}]", StringComparison.Ordinal));
    }

    /// <summary>Public age keys (<c>age1…</c>), at most <see cref="MaxAgeRecipients"/>, without duplicates.</summary>
    public static IReadOnlyList<string> ValidateAgeRecipients(IReadOnlyList<string>? values, string field, ValidationErrors errors)
    {
        ArgumentNullException.ThrowIfNull(errors);
        var result = new List<string>();
        var index = 0;
        foreach (var raw in values ?? [])
        {
            var key = raw?.Trim() ?? string.Empty;
            if (key.Length > 0)
            {
                if (!AgePattern().IsMatch(key))
                {
                    errors.Add($"{field}[{index}]", SettingsFieldErrors.AgeRecipientInvalid);
                }
                else if (!result.Contains(key, StringComparer.Ordinal))
                {
                    result.Add(key);
                }
            }

            index++;
        }

        if (result.Count > MaxAgeRecipients)
        {
            errors.Add(field, SettingsFieldErrors.AgeRecipientInvalid);
        }

        return result;
    }

    private static bool IsCron(string schedule)
    {
        if (schedule.StartsWith('@'))
        {
            return CronMacros.Contains(schedule, StringComparer.Ordinal);
        }

        var fields = schedule.Split(' ');
        return fields.Length == 5
            && IsCronField(fields[0], 0, 59, [])
            && IsCronField(fields[1], 0, 23, [])
            && IsCronField(fields[2], 1, 31, [])
            && IsCronField(fields[3], 1, 12, CronMonths)
            && IsCronField(fields[4], 0, 7, CronDays);
    }

    /// <summary>One field: a list of <c>*</c>, a value or a range, each with an optional <c>/step</c>.</summary>
    private static bool IsCronField(string field, int min, int max, string[] names)
    {
        foreach (var item in field.Split(','))
        {
            var parts = item.Split('/');
            if (parts.Length > 2 || (parts.Length == 2 && (!int.TryParse(parts[1], System.Globalization.NumberStyles.None, System.Globalization.CultureInfo.InvariantCulture, out var step) || step < 1)))
            {
                return false;
            }

            var range = parts[0];
            if (string.Equals(range, "*", StringComparison.Ordinal))
            {
                continue;
            }

            var bounds = range.Split('-');
            if (bounds.Length > 2 || !bounds.All(bound => CronValue(bound, min, max, names)))
            {
                return false;
            }
        }

        return true;
    }

    private static bool CronValue(string value, int min, int max, string[] names)
    {
        var index = Array.IndexOf(names, value.ToLowerInvariant());
        if (index >= 0)
        {
            return true;
        }

        return int.TryParse(value, System.Globalization.NumberStyles.None, System.Globalization.CultureInfo.InvariantCulture, out var number) && number >= min && number <= max;
    }

    [GeneratedRegex(@"^(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])(\.(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])){3}$", RegexOptions.CultureInvariant, 1000)]
    private static partial Regex Ipv4Pattern();

    [GeneratedRegex(@"^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$", RegexOptions.CultureInvariant, 1000)]
    private static partial Regex DomainPattern();

    [GeneratedRegex(@"^[a-z0-9_]([a-z0-9_-]{0,61}[a-z0-9_])?(\.[a-z0-9_]([a-z0-9_-]{0,61}[a-z0-9_])?)*$", RegexOptions.CultureInvariant, 1000)]
    private static partial Regex ChallengeDomainPattern();

    [GeneratedRegex(@"^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$", RegexOptions.CultureInvariant, 1000)]
    private static partial Regex EmailPattern();

    [GeneratedRegex(@"^https?://(\*\.)?[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*(:[0-9]{1,5})?$", RegexOptions.CultureInvariant, 1000)]
    private static partial Regex OriginPattern();

    [GeneratedRegex(@"^[A-Za-z_]+(/[A-Za-z0-9_+-]+){0,2}$", RegexOptions.CultureInvariant, 1000)]
    private static partial Regex TimezonePattern();

    [GeneratedRegex(@"^[A-Za-z0-9_.-]{1,40}:[A-Za-z0-9_./ -]{0,200}$", RegexOptions.CultureInvariant, 1000)]
    private static partial Regex RemotePattern();

    [GeneratedRegex(@"^\[[^\]\n]+\]\s*$", RegexOptions.CultureInvariant | RegexOptions.Multiline, 1000)]
    private static partial Regex SectionHeaderPattern();

    [GeneratedRegex(@"^age1[02-9ac-hj-np-z]{58}$", RegexOptions.CultureInvariant, 1000)]
    private static partial Regex AgePattern();
}
