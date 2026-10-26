using Microsoft.AspNetCore.Identity;
using Opten.StudioFlow.Core.Application.Ports;

namespace Opten.StudioFlow.Infrastructure.Security;

/// <summary>Password hashes of the Regie account: ASP.NET Core Identity v3 (PBKDF2 HMAC-SHA512, 100 000 iterations, random salt).</summary>
public sealed class AdminPasswordHasher : IAdminPasswordHasher
{
    private static readonly PasswordHasher<AdminUser> Hasher = new();
    private static readonly AdminUser User = new();

    /// <inheritdoc />
    public string Hash(string password)
    {
        ArgumentException.ThrowIfNullOrEmpty(password);
        return Hasher.HashPassword(User, password);
    }

    /// <inheritdoc />
    public bool Verify(string hash, string password)
    {
        ArgumentNullException.ThrowIfNull(hash);
        ArgumentNullException.ThrowIfNull(password);
        try
        {
            return Hasher.VerifyHashedPassword(User, hash, password) != PasswordVerificationResult.Failed;
        }
        catch (FormatException)
        {
            return false;
        }
    }

    /// <summary>The hasher does not use user data; the type only satisfies its signature.</summary>
    private sealed class AdminUser;
}
