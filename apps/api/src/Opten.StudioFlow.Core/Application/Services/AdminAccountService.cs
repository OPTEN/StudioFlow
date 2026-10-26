using Opten.StudioFlow.Core.Application.Ports;
using Opten.StudioFlow.Core.Contracts;
using Opten.StudioFlow.Core.Domain;

namespace Opten.StudioFlow.Core.Application.Services;

/// <summary>
/// Creating the Regie account in the first-run setup and changing its password (issue #4). Wrong setup codes and wrong
/// current passwords count towards the same lockout as failed logins (<see cref="LoginThrottle"/>).
/// </summary>
public sealed class AdminAccountService(
    AdminAccountState state,
    SetupCode setupCode,
    IAdminAccountStore store,
    IAdminPasswordHasher hasher,
    LoginThrottle throttle,
    TimeProvider clock)
{
    /// <summary>
    /// Key under which setup code attempts are counted as a "user name": all attempts together, from any address.
    /// It starts with a character no user name can contain, so it never collides with a login.
    /// </summary>
    private const string SetupThrottleKey = "#setup";

    /// <summary>
    /// Creates the account when <paramref name="request"/> carries the current setup code. Throws 429 while the address is
    /// locked, 409 <c>setup_closed</c> when an account exists (also when a concurrent setup won), 403
    /// <c>setup_code_invalid</c> for a wrong or missing code and 400 for a user name or password that breaks the rules.
    /// </summary>
    public async Task<AdminIdentity> SetUpAsync(SetupRequest request, string ip, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        ArgumentNullException.ThrowIfNull(ip);
        ThrowIfLocked(throttle.LockedFor(ip, SetupThrottleKey));
        if (!state.SetupRequired)
        {
            throw SetupClosed();
        }

        if (!setupCode.Matches(request.SetupCode))
        {
            ThrowIfLocked(throttle.RegisterFailure(ip, SetupThrottleKey));
            throw new StudioFlowException(ErrorKind.Forbidden, ErrorCodes.SetupCodeInvalid, "The setup code is wrong.");
        }

        var errors = new ValidationErrors();
        var username = AdminAccountRules.ValidateUsername(request.Username, errors);
        AdminAccountRules.ValidatePassword(request.Password, username, "password", errors);
        errors.ThrowIfAny();

        var now = clock.StorageNow();
        var account = AdminAccount.Create(username!, hasher.Hash(request.Password), now);
        if (!await store.TryCreateAsync(account, Audit(AuditActions.AccountSetUp, now, username!, ip), cancellationToken))
        {
            throw SetupClosed();
        }

        state.Replace(account);
        throttle.RegisterSuccess(ip);
        return new AdminIdentity(account.Username, account.SecurityStamp);
    }

    /// <summary>
    /// Sets a new password for the signed-in <paramref name="username"/> and returns the identity with the new security
    /// stamp. Throws 429 while locked, 400 <c>password_incorrect</c> for a wrong current password and 400 for a new
    /// password that breaks the rules.
    /// </summary>
    public async Task<AdminIdentity> ChangePasswordAsync(string username, ChangePasswordRequest request, string ip, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(username);
        ArgumentNullException.ThrowIfNull(request);
        ArgumentNullException.ThrowIfNull(ip);
        ThrowIfLocked(throttle.LockedFor(ip, username));
        if (state.Verify(username, request.CurrentPassword) is null)
        {
            ThrowIfLocked(throttle.RegisterFailure(ip, username));
            throw new StudioFlowException(
                ErrorKind.Validation,
                ErrorCodes.PasswordIncorrect,
                "The current password is wrong.",
                new Dictionary<string, string[]>(StringComparer.Ordinal) { ["currentPassword"] = [ErrorCodes.PasswordIncorrect] });
        }

        var errors = new ValidationErrors();
        AdminAccountRules.ValidatePassword(request.NewPassword, username, "newPassword", errors);
        errors.ThrowIfAny();

        var account = await store.GetAsync(cancellationToken) ?? throw StudioFlowException.NotFound("Account");
        var now = clock.StorageNow();
        account.ChangePassword(hasher.Hash(request.NewPassword), now);
        if (!await store.TryUpdateAsync(account, Audit(AuditActions.PasswordChanged, now, username, ip), cancellationToken))
        {
            throw StudioFlowException.NotFound("Account");
        }

        state.Replace(account);
        throttle.RegisterSuccess(ip);
        return new AdminIdentity(account.Username, account.SecurityStamp);
    }

    private static StudioFlowException SetupClosed() =>
        StudioFlowException.Conflict(ErrorCodes.SetupClosed, "The first-run setup is closed: the Regie account exists.");

    private static void ThrowIfLocked(TimeSpan? lockout)
    {
        if (lockout is { } wait)
        {
            throw StudioFlowException.RateLimited(wait);
        }
    }

    private static AuditEntry Audit(string action, DateTimeOffset now, string username, string ip) => AuditEntry.Create(
        null,
        now,
        AuditActors.Admin,
        action,
        new Dictionary<string, string>(StringComparer.Ordinal) { [AuditDetails.Username] = username, [AuditDetails.Ip] = ip });
}
