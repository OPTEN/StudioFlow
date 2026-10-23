using System.Collections.Concurrent;
using System.Security.Claims;
using System.Security.Cryptography;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Opten.FlowStudio.Core.Application.Ports;
using Opten.FlowStudio.Web.Hubs;

namespace Opten.FlowStudio.Web.Security;

/// <summary>
/// Server-side end of admin sessions (GAP-04b). Every login gets a random session id claim; logout puts that id on an
/// in-memory revocation list until the cookie would have expired anyway, so a copied cookie stops working at once, and
/// closes the Regie hub connections of the session. Cookies without a session id (issued before this rule) are refused.
/// The list does not survive an API restart; the cookie lifetime (<c>Admin:SessionLifetime</c>) bounds that window.
/// </summary>
public sealed class AdminSessions(HubConnectionRegistry hubs, TimeProvider clock)
{
    private const int MaxRevoked = 10_000;

    private readonly ConcurrentDictionary<string, DateTimeOffset> revoked = new(StringComparer.Ordinal);

    /// <summary>A new random session id.</summary>
    public static string NewSessionId() => Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(16));

    /// <summary>The principal of a new session.</summary>
    public static ClaimsPrincipal Principal(string username) => new(new ClaimsIdentity(
        [new Claim(ClaimTypes.Name, username), new Claim(FlowStudioClaims.SessionId, NewSessionId())],
        AuthSchemes.Admin));

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

    /// <summary>Ends a session: its cookie is refused from now on and its hub connections are closed.</summary>
    public void Revoke(string sessionId, DateTimeOffset until)
    {
        ArgumentException.ThrowIfNullOrEmpty(sessionId);
        if (revoked.Count >= MaxRevoked)
        {
            Prune();
        }

        revoked[sessionId] = until;
        hubs.AbortSession(sessionId);
    }

    /// <summary>
    /// Cookie validation: refuses sessions without id or with a revoked id, and sessions of a renamed admin user.
    /// </summary>
    public static Task ValidateAsync(CookieValidatePrincipalContext context)
    {
        ArgumentNullException.ThrowIfNull(context);
        var services = context.HttpContext.RequestServices;
        var admin = services.GetRequiredService<IAdminCredentials>();
        var sessions = services.GetRequiredService<AdminSessions>();
        var sessionId = context.Principal?.FindFirstValue(FlowStudioClaims.SessionId);
        if (!string.Equals(context.Principal?.Identity?.Name, admin.Username, StringComparison.Ordinal)
            || string.IsNullOrEmpty(sessionId)
            || sessions.IsRevoked(sessionId))
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
