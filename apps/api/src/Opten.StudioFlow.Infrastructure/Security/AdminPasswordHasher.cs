using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.Options;
using Opten.StudioFlow.Core.Application.Ports;

namespace Opten.StudioFlow.Infrastructure.Security;

/// <summary>
/// Password hashes of the Regie account: ASP.NET Core Identity v3 (PBKDF2 HMAC-SHA512, random salt). The format stores
/// the algorithm, the iteration count and the salt in the hash itself, so a hash made with fewer iterations (versions up to
/// 0.x used 100 000) still verifies and <see cref="Check"/> reports that it should be made again with the current count,
/// which a successful login does.
/// </summary>
public sealed class AdminPasswordHasher : IAdminPasswordHasher
{
    /// <summary>PBKDF2-HMAC-SHA512 iterations of new hashes: the OWASP guidance (2023 and later) for SHA-512 is 210 000.</summary>
    public const int IterationCount = 210_000;

    private static readonly PasswordHasher<AdminUser> Hasher = new(Options.Create(new PasswordHasherOptions { IterationCount = IterationCount }));
    private static readonly AdminUser User = new();

    /// <inheritdoc />
    public string Hash(string password)
    {
        ArgumentException.ThrowIfNullOrEmpty(password);
        return Hasher.HashPassword(User, password);
    }

    /// <inheritdoc />
    public PasswordCheck Check(string hash, string password)
    {
        ArgumentNullException.ThrowIfNull(hash);
        ArgumentNullException.ThrowIfNull(password);
        try
        {
            return Hasher.VerifyHashedPassword(User, hash, password) switch
            {
                PasswordVerificationResult.Success => PasswordCheck.Succeeded,
                PasswordVerificationResult.SuccessRehashNeeded => PasswordCheck.SucceededRehashNeeded,
                _ => PasswordCheck.Failed,
            };
        }
        catch (FormatException)
        {
            return PasswordCheck.Failed;
        }
    }

    /// <summary>The hasher does not use user data; the type only satisfies its signature.</summary>
    private sealed class AdminUser;
}
