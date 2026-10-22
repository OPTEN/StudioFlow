using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Authorization.Policy;
using Opten.FlowStudio.Core.Contracts;
using Opten.FlowStudio.Web.Errors;

namespace Opten.FlowStudio.Web.Security;

/// <summary>
/// Writes <c>device_blocked</c> problem details when a blocked device is refused (the sender stops reconnecting and
/// shows «Gesperrt»); every other result goes to the default handler (empty 401/403, turned into problem details by
/// the status code pages).
/// </summary>
internal sealed class ProblemAuthorizationResultHandler : IAuthorizationMiddlewareResultHandler
{
    private readonly AuthorizationMiddlewareResultHandler fallback = new();

    public async Task HandleAsync(RequestDelegate next, HttpContext context, AuthorizationPolicy policy, PolicyAuthorizationResult authorizeResult)
    {
        if (authorizeResult.Forbidden && authorizeResult.AuthorizationFailure?.FailureReasons.Any(r => r.Handler is DeviceNotBlockedRequirement) == true)
        {
            await Problems.WriteAsync(context, StatusCodes.Status403Forbidden, ErrorCodes.DeviceBlocked, "Das Gerät ist gesperrt.");
            return;
        }

        await fallback.HandleAsync(next, context, policy, authorizeResult);
    }
}

/// <summary>
/// CSRF protection (spec 5): unsafe requests that carry the admin cookie must send <c>X-FlowStudio: 1</c>. A foreign
/// site can make the browser send the cookie (SameSite=Strict already blocks most cases) but cannot set the header
/// without CORS, which is not enabled.
/// </summary>
internal sealed class CsrfHeaderFilter : IEndpointFilter
{
    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        var request = context.HttpContext.Request;
        if (!HttpMethods.IsGet(request.Method) && !HttpMethods.IsHead(request.Method) && !HttpMethods.IsOptions(request.Method)
            && request.Cookies.ContainsKey(SecurityNames.SessionCookie)
            && !string.Equals(request.Headers[SecurityNames.CsrfHeader].ToString(), "1", StringComparison.Ordinal))
        {
            return Problems.Result(StatusCodes.Status403Forbidden, ErrorCodes.Forbidden, "Der Header X-FlowStudio fehlt.");
        }

        return await next(context);
    }
}

/// <summary>Rejects hub requests (negotiate, WebSocket, long polling) whose <c>Origin</c> host differs from the request host.</summary>
internal sealed class HubOriginMiddleware(RequestDelegate next)
{
    public async Task InvokeAsync(HttpContext context)
    {
        if (context.Request.Path.StartsWithSegments(SecurityNames.HubsPrefix, StringComparison.OrdinalIgnoreCase)
            && context.Request.Headers.Origin.ToString() is { Length: > 0 } origin
            && !IsSameHost(origin, context.Request.Host))
        {
            await Problems.WriteAsync(context, StatusCodes.Status403Forbidden, ErrorCodes.Forbidden, "Fremder Ursprung.");
            return;
        }

        await next(context);
    }

    private static bool IsSameHost(string origin, HostString host) =>
        Uri.TryCreate(origin, UriKind.Absolute, out var uri) && host.HasValue
        && string.Equals(uri.Host, host.Host, StringComparison.OrdinalIgnoreCase)
        && (host.Port is { } port ? uri.Port == port : uri.IsDefaultPort);
}

/// <summary>
/// Hardening headers of every API response (INT-AUTH-21), also when Caddy is not in front (tests, local runs):
/// <c>X-Content-Type-Options: nosniff</c> everywhere and <c>Cache-Control: no-store</c> for <c>/api</c> answers that do
/// not set their own caching (state, credentials and tokens must never be cached).
/// </summary>
internal sealed class ResponseHardeningMiddleware(RequestDelegate next)
{
    private const string ApiPrefix = "/api";

    public Task InvokeAsync(HttpContext context)
    {
        context.Response.OnStarting(() =>
        {
            var headers = context.Response.Headers;
            headers.XContentTypeOptions = "nosniff";
            if (context.Request.Path.StartsWithSegments(ApiPrefix, StringComparison.OrdinalIgnoreCase) && string.IsNullOrEmpty(headers.CacheControl))
            {
                headers.CacheControl = "no-store";
            }

            return Task.CompletedTask;
        });
        return next(context);
    }
}

/// <summary>Client address helpers (after the forwarded headers of the trusted proxy were applied).</summary>
internal static class ClientAddress
{
    /// <summary>The client IP as text (IPv4-mapped addresses as IPv4), or <c>unknown</c>.</summary>
    public static string Of(HttpContext context)
    {
        ArgumentNullException.ThrowIfNull(context);
        var address = context.Connection.RemoteIpAddress;
        if (address is null)
        {
            return "unknown";
        }

        return (address.IsIPv4MappedToIPv6 ? address.MapToIPv4() : address).ToString();
    }
}
