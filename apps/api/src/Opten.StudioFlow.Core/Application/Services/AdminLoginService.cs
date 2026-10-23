using Opten.StudioFlow.Core.Application.Ports;
using Opten.StudioFlow.Core.Domain;

namespace Opten.StudioFlow.Core.Application.Services;

/// <summary>Outcome of a login attempt.</summary>
public enum LoginOutcome
{
    /// <summary>Signed in.</summary>
    Succeeded,

    /// <summary>Wrong user name or password.</summary>
    Failed,

    /// <summary>Too many failures; try again after <see cref="LoginResult.RetryAfter"/>.</summary>
    Locked,
}

/// <summary>Result of a login attempt.</summary>
/// <param name="Outcome">What happened.</param>
/// <param name="Username">The signed-in user name.</param>
/// <param name="RetryAfter">Remaining lockout.</param>
public sealed record LoginResult(LoginOutcome Outcome, string? Username, TimeSpan? RetryAfter);

/// <summary>Admin login with lockout and audit (spec 4.9, 5).</summary>
public sealed class AdminLoginService(IAdminCredentials credentials, LoginThrottle throttle, IUnitOfWorkFactory data, TimeProvider clock)
{
    /// <summary>Checks the credentials of a login attempt from <paramref name="ip"/>.</summary>
    public async Task<LoginResult> LoginAsync(string? username, string? password, string ip)
    {
        ArgumentNullException.ThrowIfNull(ip);
        if (throttle.LockedFor(ip, username) is { } locked)
        {
            return new LoginResult(LoginOutcome.Locked, null, locked);
        }

        var details = new Dictionary<string, string>(StringComparer.Ordinal)
        {
            [AuditDetails.Username] = TextRules.Truncate(username, 100) ?? string.Empty,
            [AuditDetails.Ip] = ip,
        };
        if (credentials.Verify(username, password))
        {
            throttle.RegisterSuccess(ip);
            await AuditAsync(AuditActions.LoginSucceeded, details);
            return new LoginResult(LoginOutcome.Succeeded, credentials.Username, null);
        }

        var lockout = throttle.RegisterFailure(ip, username);
        await AuditAsync(AuditActions.LoginFailed, details);
        if (lockout is { } started)
        {
            await AuditAsync(AuditActions.LoginLocked, details);
            return new LoginResult(LoginOutcome.Locked, null, started);
        }

        return new LoginResult(LoginOutcome.Failed, null, null);
    }

    private async Task AuditAsync(string action, IReadOnlyDictionary<string, string> details)
    {
        // Login auditing must not depend on the caller staying connected.
        await using var unit = data.Create();
        unit.Audit.Add(AuditEntry.Create(null, clock.StorageNow(), AuditActors.Admin, action, details));
        await unit.SaveChangesAsync(CancellationToken.None);
    }
}
