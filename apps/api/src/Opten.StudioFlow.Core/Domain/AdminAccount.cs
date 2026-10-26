namespace Opten.StudioFlow.Core.Domain;

/// <summary>
/// The Regie account (table <c>admin_account</c>), created in the first-run setup. There is exactly one: the primary key
/// is the constant <see cref="OnlyId"/> (and a check constraint allows no other value), so the database itself refuses a
/// second account, also when two setups arrive at the same time.
/// </summary>
public sealed class AdminAccount
{
    /// <summary>Id of the only row.</summary>
    public const int OnlyId = 1;

    /// <summary>Maximum length of the user name.</summary>
    public const int UsernameMaxLength = 64;

    private AdminAccount()
    {
    }

    /// <summary>Always <see cref="OnlyId"/>.</summary>
    public int Id { get; private set; } = OnlyId;

    /// <summary>User name (letters, digits and <c>. _ @ -</c>).</summary>
    public string Username { get; private set; } = string.Empty;

    /// <summary>ASP.NET Core Identity v3 hash of the password.</summary>
    public string PasswordHash { get; private set; } = string.Empty;

    /// <summary>
    /// Random value that is renewed with every password change. Sessions carry the value they were issued with, so a
    /// password change ends every session that does not hold the new one.
    /// </summary>
    public string SecurityStamp { get; private set; } = string.Empty;

    /// <summary>When the account was set up.</summary>
    public DateTimeOffset CreatedAt { get; private set; }

    /// <summary>When the password was set or changed last.</summary>
    public DateTimeOffset PasswordChangedAt { get; private set; }

    /// <summary>Creates the account of the first-run setup.</summary>
    public static AdminAccount Create(string username, string passwordHash, DateTimeOffset now) => new()
    {
        Username = username,
        PasswordHash = passwordHash,
        SecurityStamp = Secrets.New(),
        CreatedAt = now,
        PasswordChangedAt = now,
    };

    /// <summary>Sets a new password and renews the security stamp.</summary>
    public void ChangePassword(string passwordHash, DateTimeOffset now)
    {
        PasswordHash = passwordHash;
        SecurityStamp = Secrets.New();
        PasswordChangedAt = now;
    }
}
