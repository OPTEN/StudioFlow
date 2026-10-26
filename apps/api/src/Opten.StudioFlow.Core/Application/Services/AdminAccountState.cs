using Microsoft.Extensions.Logging;
using Opten.StudioFlow.Core.Application.Ports;
using Opten.StudioFlow.Core.Domain;

namespace Opten.StudioFlow.Core.Application.Services;

/// <summary>Who is signed in as the Regie account, and the stamp that makes their session valid.</summary>
/// <param name="Username">User name of the account.</param>
/// <param name="SecurityStamp">Stamp that changes with every password change.</param>
public sealed record AdminIdentity(string Username, string SecurityStamp);

/// <summary>
/// The Regie account in memory, so login and the validation of every session cookie need no database round trip and
/// keep working while the database is down. The state is set by the use cases that change the account and re-read from
/// the database by <see cref="RefreshAsync"/>, which also notices a <c>reset-admin</c> run in another process. While no
/// account exists, the first-run setup is open and a <see cref="SetupCode"/> is issued and logged.
/// </summary>
public sealed class AdminAccountState(IAdminAccountStore store, IAdminPasswordHasher hasher, SetupCode setupCode, ILogger<AdminAccountState> logger)
{
    private readonly Lock gate = new();
    private readonly Lazy<string> unknownUserHash = new(() => hasher.Hash(Secrets.New()));
    private volatile Credentials? current;
    private long version;

    /// <summary>True while no account exists and the first-run setup is open.</summary>
    public bool SetupRequired => current is null;

    /// <summary>
    /// Checks a login. The user name is compared in constant time and the password is always checked (against a
    /// throw-away hash when the user name is wrong or there is no account), so the response time does not reveal which
    /// part was wrong. Returns the identity on success, else null.
    /// </summary>
    public AdminIdentity? Verify(string? username, string? password)
    {
        var account = current;
        var userMatches = account is not null && Secrets.FixedTimeEquals(username?.Trim() ?? string.Empty, account.Username);
        var passwordMatches = hasher.Verify(userMatches ? account!.PasswordHash : unknownUserHash.Value, password ?? string.Empty);
        return userMatches && passwordMatches ? account!.Identity : null;
    }

    /// <summary>True when a session issued to <paramref name="username"/> with <paramref name="securityStamp"/> is still valid.</summary>
    public bool IsCurrent(string? username, string? securityStamp)
    {
        var account = current;
        return account is not null
            && string.Equals(username, account.Username, StringComparison.Ordinal)
            && Secrets.FixedTimeEquals(securityStamp, account.SecurityStamp);
    }

    /// <summary>Takes over the account after a use case stored it (null after a reset).</summary>
    public void Replace(AdminAccount? account)
    {
        lock (gate)
        {
            Apply(account);
        }
    }

    /// <summary>
    /// Reads the account from the database. Returns true when it differs from what was known (a password change,
    /// a reset or a new account made in another process), so the caller can end the sessions that are no longer valid.
    /// A use case that finishes while the database is read wins: its newer state is kept.
    /// </summary>
    public async Task<bool> RefreshAsync(CancellationToken cancellationToken)
    {
        var versionBefore = Volatile.Read(ref version);
        var account = await store.GetAsync(cancellationToken);
        lock (gate)
        {
            return version == versionBefore && Apply(account);
        }
    }

    private bool Apply(AdminAccount? account)
    {
        var previous = current;
        var next = account is null ? null : new Credentials(account.Username, account.PasswordHash, account.SecurityStamp);
        current = next;
        version++;
        if (next is null)
        {
            if (setupCode.Current is null)
            {
                logger.LogWarning("No Regie account exists: the first-run setup is open. Setup code: {SetupCode}", setupCode.Issue());
            }
        }
        else if (previous is null)
        {
            // The setup scripts read the log: the newest of this line and the setup code line tells the state.
            setupCode.Clear();
            logger.LogInformation("The Regie account exists: the first-run setup is closed");
        }

        return previous != next;
    }

    private sealed record Credentials(string Username, string PasswordHash, string SecurityStamp)
    {
        public AdminIdentity Identity => new(Username, SecurityStamp);
    }
}
