using System.Diagnostics.CodeAnalysis;
using System.Globalization;
using System.Net;
using System.Net.Sockets;

namespace Opten.FlowStudio.Core.Domain;

/// <summary>
/// An entry of the output IP restriction: a single IPv4/IPv6 address or a CIDR range (spec 4.8). Host bits of a range
/// are ignored, so <c>192.168.1.7/24</c> means <c>192.168.1.0/24</c>. IPv4-mapped IPv6 client addresses match IPv4 rules.
/// </summary>
public readonly record struct IpRule
{
    private IpRule(IPNetwork network) => Network = network;

    /// <summary>The network of the rule (a single address has the full prefix length).</summary>
    public IPNetwork Network { get; }

    /// <summary>Maximum number of rules per production.</summary>
    public const int MaxRules = 50;

    /// <summary>Parses an address or CIDR range.</summary>
    public static bool TryParse([NotNullWhen(true)] string? value, out IpRule rule)
    {
        rule = default;
        if (string.IsNullOrWhiteSpace(value))
        {
            return false;
        }

        var text = value.Trim();
        var slash = text.IndexOf('/', StringComparison.Ordinal);
        var addressText = slash < 0 ? text : text[..slash];
        if (!IPAddress.TryParse(addressText, out var address) || addressText.Contains('%', StringComparison.Ordinal))
        {
            return false;
        }

        address = Normalize(address);
        var maxPrefix = address.AddressFamily == AddressFamily.InterNetwork ? 32 : 128;
        var prefix = maxPrefix;
        if (slash >= 0 && (!int.TryParse(text.AsSpan(slash + 1), NumberStyles.None, CultureInfo.InvariantCulture, out prefix) || prefix > maxPrefix))
        {
            return false;
        }

        rule = new IpRule(new IPNetwork(Mask(address, prefix), prefix));
        return true;
    }

    /// <summary>True when <paramref name="address"/> lies in the rule's network.</summary>
    public bool Matches(IPAddress address)
    {
        ArgumentNullException.ThrowIfNull(address);
        return Network.Contains(Normalize(address));
    }

    /// <summary>Canonical text: the address alone for single addresses, CIDR notation for ranges.</summary>
    public override string ToString()
    {
        var full = Network.BaseAddress.AddressFamily == AddressFamily.InterNetwork ? 32 : 128;
        return Network.PrefixLength == full ? Network.BaseAddress.ToString() : Network.ToString();
    }

    /// <summary>
    /// True when the client may open the output: every address is allowed for an empty rule list, otherwise the
    /// address must match one rule. An unknown client address never matches a non-empty list.
    /// </summary>
    public static bool IsAllowed(IReadOnlyList<string> rules, IPAddress? client)
    {
        ArgumentNullException.ThrowIfNull(rules);
        if (rules.Count == 0)
        {
            return true;
        }

        if (client is null)
        {
            return false;
        }

        foreach (var text in rules)
        {
            if (TryParse(text, out var rule) && rule.Matches(client))
            {
                return true;
            }
        }

        return false;
    }

    private static IPAddress Normalize(IPAddress address) => address.IsIPv4MappedToIPv6 ? address.MapToIPv4() : address;

    private static IPAddress Mask(IPAddress address, int prefix)
    {
        var bytes = address.GetAddressBytes();
        for (var i = 0; i < bytes.Length; i++)
        {
            var bits = Math.Clamp(prefix - (i * 8), 0, 8);
            bytes[i] &= (byte)(0xFF << (8 - bits));
        }

        return new IPAddress(bytes);
    }
}
