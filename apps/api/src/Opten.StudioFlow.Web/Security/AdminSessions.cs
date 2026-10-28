using System.Collections.Concurrent;
using System.Globalization;
using System.Security.Claims;
using System.Security.Cryptography;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.Extensions.Options;
using Opten.StudioFlow.Core.Application.Ports;
using Opten.StudioFlow.Core.Application.Services;
using Opten.StudioFlow.Infrastructure.Security;
using Opten.StudioFlow.Web.Hubs;

namespace Opten.StudioFlow.Web.Security;

/// <summary>
/// Server-side end of admin sessions (GAP-04b). Every login gets a random session id claim and the time it was issued.
/// <list type="bullet">
/// <item>Logout puts the id on a revocation list until the cookie would have expired anyway, so a copied cookie stops
/// working at once, and closes the Regie hub connections of the session. The list is kept in memory for the checks of every
/// request and also stored in the database, so it survives an API restart (it is loaded at startup).</item>
/// <item>A session ends <c>Admin:AbsoluteSessionLifetime</c> (7 days by default) after the login, however active it was: the
/// cookie slides (<c>Admin:SessionLifetime</c>), the absolute limit does not.</item>
/// </list>
/// Cookies without a session id or without the time of issue (issued before these rules) are refused: every session of an
/// older version has to sign in once.
/// </summary>
public sealed class AdminSessions(HubConnectionRegistry hubs, IRevokedSessionStore store, IOptions<AdminOptions> options, TimeProvider clock, ILogger<AdminSessions> logger)
{
    private const int MaxRevoked = 10_000;

    private readonly ConcurrentDictionary<string, DateTimeOffset> revoked = new(StringComparer.Ordinal);

    /// <summary>Revocations whose storage failed (the database was unreachable); the maintenance loop stores them later.</summary>
    private readonly ConcurrentDictionary<string, DateTimeOffset> pending = new(StringComparer.Ordinal);

    /// <summary>A new random session id.</summary>
    public static string NewSessionId() => Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(16));

    /// <summary>The principal of a new session, or of the session <paramref name="sessionId"/> (issued at <paramref name="issuedAt"/>) when its stamp is renewed.</summary>
    public static ClaimsPrincipal Principal(AdminIdentity identity, DateTimeOffset issuedAt, string? sessionId = null)
    {
        ArgumentNullException.ThrowIfNull(identity);
        return new(new ClaimsIdentity(
            [
                new Claim(ClaimTypes.Name, identity.Username),
                new Claim(StudioFlowClaims.SessionId, sessionId ?? NewSessionId()),
                new Claim(StudioFlowClaims.SecurityStamp, identity.SecurityStamp),
                new Claim(StudioFlowClaims.IssuedAt, issuedAt.ToUnixTimeSeconds().ToString(CultureInfo.InvariantCulture), ClaimValueTypes.Integer64),
            ],
            AuthSchemes.Admin));
    }

    /// <summary>
    /// Closes the Regie hub connections of every session except <paramref name="keepSessionId"/>. The cookies of those
    /// sessions are refused already (their stamp is outdated); the open connections would otherwise live on.
    /// </summary>
    public void EndAllExcept(string? keepSessionId) => hubs.AbortSessionsExcept(keepSessionId);

    /// <summary>True when the session was ended by a logout.</summary>
    public bool IsRevoked(string sessionId)
    {
        if (!revoked.TryGetValue(sessionId, out var until))
        {
            return false;
        }

        if (until > clock.GetUtcNow())
        {
            return true;
        }

        revoked.TryRemove(sessionId, out _);
        return false;
    }

    /// <summary>
    /// True when the session of the cookie is older than <c>Admin:AbsoluteSessionLifetime</c>, or when the cookie does not say when
    /// it was issued (a cookie of an older version).
    /// </summary>
    public bool IsOverAbsoluteLifetime(string? issuedAtClaim) =>
        !long.TryParse(issuedAtClaim, NumberStyles.None, CultureInfo.InvariantCulture, out var seconds)
        || clock.GetUtcNow() - DateTimeOffset.FromUnixTimeSeconds(seconds) >= options.Value.AbsoluteSessionLifetime;

    /// <summary>Ends a session: its cookie is refused from now on (also after a restart) and its hub connections are closed.</summary>
    public async Task RevokeAsync(string sessionId, DateTimeOffset until, CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrEmpty(sessionId);
        if (revoked.Count >= MaxRevoked)
        {
            Prune();
        }

        revoked[sessionId] = until;
        hubs.AbortSession(sessionId);
        try
        {
            await store.SaveAsync(sessionId, until, cancellationToken);
        }
        catch (Exception exception) when (exception is not OperationCanceledException and not OutOfMemoryException)
        {
            // The logout itself must not fail: the session is revoked in memory, and the loop stores it when the database is back.
            pending[sessionId] = until;
            logger.LogWarning(exception, "A signed-out session could not be stored; it stays revoked until the API restarts and is stored again meanwhile");
        }
    }

    /// <summary>Takes over the stored revocations (at startup, before the API accepts requests).</summary>
    public async Task LoadAsync(CancellationToken cancellationToken)
    {
        foreach (var entry in await store.ListActiveAsync(clock.GetUtcNow(), cancellationToken))
        {
            revoked.AddOrUpdate(entry.SessionId, entry.Until, (_, known) => known > entry.Until ? known : entry.Until);
        }
    }

    /// <summary>Stores the revocations that could not be stored at the logout.</summary>
    public async Task StorePendingAsync(CancellationToken cancellationToken)
    {
        foreach (var (sessionId, until) in pending.ToList())
        {
            await store.SaveAsync(sessionId, until, cancellationToken);
            pending.TryRemove(new KeyValuePair<string, DateTimeOffset>(sessionId, until));
        }
    }

    /// <summary>Forgets the revocations whose cookies are expired anyway, in memory and in the database.</summary>
    public async Task PruneAsync(CancellationToken cancellationToken)
    {
        Prune();
        await store.DeleteExpiredAsync(clock.GetUtcNow(), cancellationToken);
    }

    /// <summary>
    /// Cookie validation: refuses sessions without id or with a revoked id, sessions older than the absolute lifetime, and
    /// sessions that do not belong to the current account state (no account, another user name, or a security stamp from
    /// before a password change).
    /// </summary>
    public static Task ValidateAsync(CookieValidatePrincipalContext context)
    {
        ArgumentNullException.ThrowIfNull(context);
        var services = context.HttpContext.RequestServices;
        var account = services.GetRequiredService<AdminAccountState>();
        var sessions = services.GetRequiredService<AdminSessions>();
        var sessionId = context.Principal?.FindFirstValue(StudioFlowClaims.SessionId);
        if (!account.IsCurrent(context.Principal?.Identity?.Name, context.Principal?.FindFirstValue(StudioFlowClaims.SecurityStamp))
            || string.IsNullOrEmpty(sessionId)
            || sessions.IsRevoked(sessionId)
            || sessions.IsOverAbsoluteLifetime(context.Principal?.FindFirstValue(StudioFlowClaims.IssuedAt)))
        {
            context.RejectPrincipal();
            return context.HttpContext.SignOutAsync(AuthSchemes.Admin);
        }

        return Task.CompletedTask;
    }

    private void Prune()
    {
        var now = clock.GetUtcNow();
        foreach (var entry in revoked.Where(e => e.Value <= now).ToList())
        {
            revoked.TryRemove(entry.Key, out _);
        }
    }
}
