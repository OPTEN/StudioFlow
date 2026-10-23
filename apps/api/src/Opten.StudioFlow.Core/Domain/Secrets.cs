using System.Buffers.Text;
using System.Security.Cryptography;
using System.Text;

namespace Opten.FlowStudio.Core.Domain;

/// <summary>
/// Secrets (device secret, output key, invite token, poll token): 32 random bytes, base64url without padding (spec 4.1).
/// Secrets that never have to be shown again are stored as SHA-256 hashes and compared in constant time.
/// </summary>
public static class Secrets
{
    private const int SecretBytes = 32;

    /// <summary>Creates a new random secret.</summary>
    public static string New() => Base64Url.EncodeToString(RandomNumberGenerator.GetBytes(SecretBytes));

    /// <summary>Lowercase hex SHA-256 of the UTF-8 bytes of <paramref name="secret"/>.</summary>
    public static string Hash(string secret)
    {
        ArgumentNullException.ThrowIfNull(secret);
        return Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(secret)));
    }

    /// <summary>Checks <paramref name="candidate"/> against a stored hash in constant time.</summary>
    public static bool MatchesHash(string? candidate, string storedHash)
    {
        ArgumentNullException.ThrowIfNull(storedHash);
        return candidate is not null && FixedTimeEquals(Hash(candidate), storedHash);
    }

    /// <summary>Compares two strings in constant time (for equal lengths).</summary>
    public static bool FixedTimeEquals(string? left, string? right)
    {
        if (left is null || right is null)
        {
            return false;
        }

        return CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(left), Encoding.UTF8.GetBytes(right));
    }
}
