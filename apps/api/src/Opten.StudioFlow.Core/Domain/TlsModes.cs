using System.Text.RegularExpressions;

namespace Opten.StudioFlow.Core.Domain;

/// <summary>One field of the credentials a DNS provider needs for the DNS challenge.</summary>
/// <param name="Name">Field name (camelCase); the key in the request and in the stored credentials.</param>
/// <param name="Pattern">What a valid value looks like. It excludes every character that could end a token of the Caddyfile.</param>
public sealed record DnsField(string Name, Regex Pattern);

/// <summary>
/// A DNS provider for the DNS challenge (the dns-* certificate modes). <see cref="Fields"/> are in the order of the
/// arguments of <c>infra/caddy/tls/&lt;id&gt;.caddy</c> ({args[0]}, {args[1]} …).
/// </summary>
/// <param name="Id">Certificate mode and snippet name, e.g. <c>dns-cloudflare</c>.</param>
/// <param name="Fields">The credential fields in snippet order.</param>
public sealed record DnsProvider(string Id, IReadOnlyList<DnsField> Fields);

/// <summary>
/// The certificate modes of the address step (issue #27): <c>internal</c> (Caddy's local CA), <c>custom</c> (an uploaded
/// certificate and key) and one <c>dns-*</c> mode per DNS provider. Let's Encrypt over HTTP-01 is not offered: it needs
/// port 80, which the stack does not use.
/// </summary>
public static class TlsModes
{
    /// <summary>Caddy's local CA signs the certificate; devices install its root once.</summary>
    public const string Internal = "internal";

    /// <summary>An uploaded certificate and private key.</summary>
    public const string Custom = "custom";

    /// <summary>Prefix of the modes that get a certificate by the DNS challenge.</summary>
    public const string DnsPrefix = "dns-";

    private static readonly TimeSpan PatternTimeout = TimeSpan.FromSeconds(1);

    /// <summary>
    /// The providers. The patterns accept the characters real tokens use and nothing a Caddyfile token could end on, so a
    /// value can be written between double quotes without escaping.
    /// </summary>
    public static readonly IReadOnlyList<DnsProvider> DnsProviders =
    [
        new("dns-cloudflare", [Field("token", "^[A-Za-z0-9_-]{20,128}$")]),
        new("dns-infomaniak", [Field("token", "^[A-Za-z0-9_.-]{16,512}$")]),
        new("dns-hetzner", [Field("token", "^[A-Za-z0-9_-]{16,128}$")]),
        new("dns-desec", [Field("token", "^[A-Za-z0-9_-]{16,128}$")]),
        new("dns-route53", [Field("accessKeyId", "^[A-Z0-9]{16,128}$"), Field("secretAccessKey", "^[A-Za-z0-9/+=]{16,128}$"), Field("region", "^[a-z]{2}(-[a-z]+)+-[0-9]$")]),
        new("dns-gandi", [Field("token", "^[A-Za-z0-9_-]{16,128}$")]),
        new("dns-ovh", [Field("endpoint", "^[a-z]{3,16}-[a-z]{2}$"), Field("applicationKey", "^[A-Za-z0-9]{8,64}$"), Field("applicationSecret", "^[A-Za-z0-9]{16,128}$"), Field("consumerKey", "^[A-Za-z0-9]{16,128}$")]),
    ];

    /// <summary>Every certificate mode.</summary>
    public static IEnumerable<string> All => [Internal, Custom, .. DnsProviders.Select(p => p.Id)];

    /// <summary>True for a mode this version knows.</summary>
    public static bool IsKnown(string? mode) => mode is not null && All.Contains(mode, StringComparer.Ordinal);

    /// <summary>True for the modes that get a certificate by the DNS challenge.</summary>
    public static bool IsDns(string? mode) => mode is not null && mode.StartsWith(DnsPrefix, StringComparison.Ordinal);

    /// <summary>The provider of a dns-* mode, or null.</summary>
    public static DnsProvider? ProviderOf(string? mode) => DnsProviders.FirstOrDefault(p => string.Equals(p.Id, mode, StringComparison.Ordinal));

    private static DnsField Field(string name, string pattern) => new(name, new Regex(pattern, RegexOptions.CultureInvariant, PatternTimeout));
}
