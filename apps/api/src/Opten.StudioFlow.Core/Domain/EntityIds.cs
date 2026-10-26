using System.Security.Cryptography;

namespace Opten.StudioFlow.Core.Domain;

/// <summary>
/// Random, URL-safe identifiers: a type prefix plus 16 lowercase base32 characters (80 bits of entropy, spec 4.1).
/// </summary>
public static class EntityIds
{
    /// <summary>Prefix of production ids.</summary>
    public const string Production = "prd_";

    /// <summary>Prefix of scene ids.</summary>
    public const string Scene = "scn_";

    /// <summary>Prefix of scene item ids.</summary>
    public const string Item = "itm_";

    /// <summary>Prefix of device ids (also the LiveKit identity of a sender).</summary>
    public const string Device = "dev_";

    /// <summary>Prefix of asset ids.</summary>
    public const string Asset = "ast_";

    /// <summary>Prefix of text source ids.</summary>
    public const string Text = "txt_";

    /// <summary>Prefix of invite ids.</summary>
    public const string Invite = "inv_";

    /// <summary>Prefix of pairing request ids.</summary>
    public const string PairingRequest = "prq_";

    /// <summary>Prefix of incident ids.</summary>
    public const string Incident = "inc_";

    /// <summary>Prefix of device command ids.</summary>
    public const string Command = "cmd_";

    /// <summary>Number of random characters after the prefix.</summary>
    public const int RandomLength = 16;

    internal const string Alphabet = "abcdefghijklmnopqrstuvwxyz234567";

    /// <summary>Creates a new id with the given prefix.</summary>
    public static string New(string prefix)
    {
        ArgumentException.ThrowIfNullOrEmpty(prefix);
        return prefix + RandomBase32(RandomLength);
    }

    /// <summary>
    /// Checks the loose id format shared with the TypeScript clients: the prefix followed by 4–40 lowercase letters or
    /// digits. Clients may create item ids themselves (templates, undo), so the length is not fixed to 16.
    /// </summary>
    public static bool IsValid(string? id, string prefix)
    {
        if (id is null || !id.StartsWith(prefix, StringComparison.Ordinal))
        {
            return false;
        }

        var rest = id.AsSpan(prefix.Length);
        if (rest.Length is < 4 or > 40)
        {
            return false;
        }

        foreach (var c in rest)
        {
            if (c is not ((>= 'a' and <= 'z') or (>= '0' and <= '9')))
            {
                return false;
            }
        }

        return true;
    }

    /// <summary>Creates <paramref name="length"/> random lowercase base32 characters.</summary>
    internal static string RandomBase32(int length)
    {
        Span<char> chars = stackalloc char[length];
        for (var i = 0; i < length; i++)
        {
            chars[i] = Alphabet[RandomNumberGenerator.GetInt32(Alphabet.Length)];
        }

        return new string(chars);
    }
}
