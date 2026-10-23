using System.Security.Claims;
using System.Text.Encodings.Web;
using Microsoft.AspNetCore.Authentication;
using Microsoft.Extensions.Options;
using Opten.FlowStudio.Core.Application.Services;
using Opten.FlowStudio.Core.Contracts;

namespace Opten.FlowStudio.Web.Security;

/// <summary>
/// Authenticates output pages on the output hub by their output key (<c>?access_token=</c> or bearer header) and the
/// IP restriction of the production. A wrong key, an unknown key and a forbidden address all answer 403 without a hint.
/// REST calls check the key in the endpoint (the slug is part of the route).
/// </summary>
internal sealed class OutputAuthenticationHandler(
    IOptionsMonitor<AuthenticationSchemeOptions> options,
    ILoggerFactory logger,
    UrlEncoder encoder,
    OutputService outputs) : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
{
    protected override async Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        if (!Request.Path.StartsWithSegments(HubMethods.OutputHubPath, StringComparison.OrdinalIgnoreCase))
        {
            return AuthenticateResult.NoResult();
        }

        var access = await outputs.FindByKeyAsync(BearerToken.From(Request, HubMethods.OutputHubPath), Context.Connection.RemoteIpAddress, Context.RequestAborted);
        if (access is null)
        {
            return AuthenticateResult.Fail("Unknown output key or address not allowed.");
        }

        var identity = new ClaimsIdentity(
            [
                new Claim(ClaimTypes.NameIdentifier, access.Slug),
                new Claim(FlowStudioClaims.ProductionId, access.ProductionId),
            ],
            Scheme.Name);
        return AuthenticateResult.Success(new AuthenticationTicket(new ClaimsPrincipal(identity), Scheme.Name));
    }

    protected override Task HandleChallengeAsync(AuthenticationProperties properties)
    {
        // No difference between «no key», «wrong key» and «unknown slug» (spec 4.8).
        Response.StatusCode = StatusCodes.Status403Forbidden;
        return Task.CompletedTask;
    }
}
