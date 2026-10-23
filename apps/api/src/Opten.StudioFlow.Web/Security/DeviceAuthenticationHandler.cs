using System.Security.Claims;
using System.Text.Encodings.Web;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authorization;
using Microsoft.Extensions.Options;
using Opten.FlowStudio.Core.Application.Services;

namespace Opten.FlowStudio.Web.Security;

/// <summary>
/// Authenticates senders by <c>Authorization: Bearer {deviceId}.{secret}</c>; on the device hub also by
/// <c>?access_token=</c> (browsers cannot set headers on WebSockets). Unknown devices and wrong secrets are 401;
/// blocked devices authenticate but fail the <see cref="Policies.Device"/> policy with 403 <c>device_blocked</c>.
/// </summary>
internal sealed class DeviceAuthenticationHandler(
    IOptionsMonitor<AuthenticationSchemeOptions> options,
    ILoggerFactory logger,
    UrlEncoder encoder,
    DeviceSessionService devices) : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
{
    protected override async Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        var credential = BearerToken.From(Request, Core.Contracts.HubMethods.DeviceHubPath);
        if (credential is null)
        {
            return AuthenticateResult.NoResult();
        }

        var identity = await devices.AuthenticateAsync(credential, Context.RequestAborted);
        if (identity is null)
        {
            return AuthenticateResult.Fail("Unknown device or wrong secret.");
        }

        var claims = new List<Claim>
        {
            new(ClaimTypes.NameIdentifier, identity.DeviceId),
            new(FlowStudioClaims.ProductionId, identity.ProductionId),
        };
        if (identity.Blocked)
        {
            claims.Add(new Claim(FlowStudioClaims.Blocked, "true"));
        }

        return AuthenticateResult.Success(new AuthenticationTicket(new ClaimsPrincipal(new ClaimsIdentity(claims, Scheme.Name)), Scheme.Name));
    }
}

/// <summary>Requires a device that is not blocked.</summary>
internal sealed class DeviceNotBlockedRequirement : AuthorizationHandler<DeviceNotBlockedRequirement>, IAuthorizationRequirement
{
    protected override Task HandleRequirementAsync(AuthorizationHandlerContext context, DeviceNotBlockedRequirement requirement)
    {
        if (context.User.HasClaim(c => c.Type == FlowStudioClaims.Blocked))
        {
            context.Fail(new AuthorizationFailureReason(this, "The device is blocked."));
        }
        else if (context.User.FindFirst(ClaimTypes.NameIdentifier) is not null)
        {
            context.Succeed(requirement);
        }

        return Task.CompletedTask;
    }
}

/// <summary>Reads bearer tokens from the header, or from <c>access_token</c> on one hub path only.</summary>
internal static class BearerToken
{
    private const string Prefix = "Bearer ";

    /// <summary>The token, or null when the request carries none.</summary>
    public static string? From(HttpRequest request, string hubPath)
    {
        var header = request.Headers.Authorization.ToString();
        if (header.StartsWith(Prefix, StringComparison.OrdinalIgnoreCase))
        {
            var token = header[Prefix.Length..].Trim();
            return token.Length == 0 ? null : token;
        }

        if (request.Path.StartsWithSegments(hubPath, StringComparison.OrdinalIgnoreCase) && request.Query[SecurityNames.AccessTokenQuery].ToString() is { Length: > 0 } query)
        {
            return query;
        }

        return null;
    }
}
