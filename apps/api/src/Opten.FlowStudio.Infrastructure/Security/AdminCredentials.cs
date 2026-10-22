using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.Options;
using Opten.FlowStudio.Core.Application.Ports;
using Opten.FlowStudio.Core.Domain;

namespace Opten.FlowStudio.Infrastructure.Security;

/// <summary>Admin login settings (configuration section <c>Admin</c>).</summary>
public sealed class AdminOptions
{
    /// <summary>Configuration section name.</summary>
    public const string Section = "Admin";

    /// <summary>Admin user name.</summary>
    public string Username { get; set; } = string.Empty;

    /// <summary>ASP.NET Core Identity v3 hash (preferred), created with <c>hash-password</c>.</summary>
    public string PasswordHash { get; set; } = string.Empty;

    /// <summary>Plain password for local setups only (a warning is logged when it is used).</summary>
    public string Password { get; set; } = string.Empty;

    /// <summary>True when the plain password is the active credential.</summary>
    public bool UsesPlainPassword => string.IsNullOrEmpty(PasswordHash) && !string.IsNullOrEmpty(Password);
}

/// <summary>
/// Verifies the admin credentials from the configuration. The user name is compared in constant time and the password
/// is always checked, so the response time does not reveal which part was wrong.
/// </summary>
public sealed class AdminCredentials(IOptions<AdminOptions> options) : IAdminCredentials
{
    private static readonly PasswordHasher<AdminUser> Hasher = new();
    private static readonly AdminUser User = new();

    /// <inheritdoc />
    public string Username => options.Value.Username;

    /// <summary>Creates an Identity v3 hash (PBKDF2 HMAC-SHA512, 100 000 iterations) of a password.</summary>
    public static string HashPassword(string password)
    {
        ArgumentException.ThrowIfNullOrEmpty(password);
        return Hasher.HashPassword(User, password);
    }

    /// <inheritdoc />
    public bool Verify(string? username, string? password)
    {
        var settings = options.Value;
        var userMatches = Secrets.FixedTimeEquals(username?.Trim() ?? string.Empty, settings.Username);
        var passwordMatches = settings.UsesPlainPassword
            ? Secrets.FixedTimeEquals(password ?? string.Empty, settings.Password)
            : VerifyHash(settings.PasswordHash, password ?? string.Empty);
        return userMatches & passwordMatches;
    }

    private static bool VerifyHash(string hash, string password)
    {
        if (string.IsNullOrEmpty(hash))
        {
            return false;
        }

        try
        {
            return Hasher.VerifyHashedPassword(User, hash, password) != PasswordVerificationResult.Failed;
        }
        catch (FormatException)
        {
            return false;
        }
    }

    /// <summary>The single admin; the hasher does not use user data, the type only satisfies its signature.</summary>
    private sealed class AdminUser;
}
