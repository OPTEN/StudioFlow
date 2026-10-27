using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;
using Opten.StudioFlow.Core.Application;
using Opten.StudioFlow.Core.Application.Ports;
using Opten.StudioFlow.Core.Contracts;

namespace Opten.StudioFlow.Infrastructure.LiveKit;

/// <summary>
/// Creates LiveKit access tokens (spec 7): HS256 JWT with <c>iss</c> = API key, <c>sub</c> = identity, <c>nbf</c>,
/// <c>exp</c> (<c>LiveKit:TokenTtl</c>, 10 minutes), <c>name</c>, <c>metadata</c> and the nested <c>video</c> grant.
/// LiveKit refreshes the token of connected participants itself; clients fetch a new one for every rejoin. The WebSocket
/// URL in the answer is the address the caller used (<see cref="ClientUrl"/>).
/// </summary>
internal sealed class LiveKitTokenIssuer(IOptions<LiveKitOptions> options, IOptions<StudioFlowOptions> studio, TimeProvider clock, IHttpContextAccessor? requests = null) : ILiveKitTokenIssuer
{
    private static readonly TimeSpan AdminLifetime = TimeSpan.FromMinutes(1);
    private static readonly string[] SenderSources = ["camera", "screen_share"];

    private readonly JsonWebTokenHandler handler = new() { SetDefaultTimesOnTokenCreation = false };

    public LiveKitTokenDto IssueSenderToken(string room, string identity, string name) => Issue(
        room,
        identity,
        name,
        "sender",
        new Dictionary<string, object>(StringComparer.Ordinal)
        {
            ["roomJoin"] = true,
            ["room"] = room,
            ["canPublish"] = true,
            ["canPublishSources"] = SenderSources,
            ["canSubscribe"] = false,
            ["canPublishData"] = false,
        });

    public LiveKitTokenDto IssueViewerToken(string room, string identity, string name) => Issue(
        room,
        identity,
        name,
        "viewer",
        new Dictionary<string, object>(StringComparer.Ordinal)
        {
            ["roomJoin"] = true,
            ["room"] = room,
            ["canPublish"] = false,
            ["canSubscribe"] = true,
            ["canPublishData"] = false,
            ["hidden"] = true,
        });

    public LiveKitTokenDto IssueMediaTestToken(string room, string identity) => Issue(
        room,
        identity,
        "Media test",
        "mediatest",
        new Dictionary<string, object>(StringComparer.Ordinal)
        {
            ["roomJoin"] = true,
            ["room"] = room,
            ["canPublish"] = false,
            ["canSubscribe"] = true,
            ["canPublishData"] = true,
        });

    /// <summary>Short-lived room admin token for the room service.</summary>
    public string CreateAdminToken(string room)
    {
        var now = clock.GetUtcNow().UtcDateTime;
        return Create(now, now + AdminLifetime, new Dictionary<string, object>(StringComparer.Ordinal)
        {
            ["video"] = new Dictionary<string, object>(StringComparer.Ordinal) { ["roomAdmin"] = true, ["room"] = room },
        });
    }

    private LiveKitTokenDto Issue(string room, string identity, string name, string role, Dictionary<string, object> video)
    {
        var now = clock.GetUtcNow();
        var expires = now + options.Value.TokenTtl;
        var token = Create(now.UtcDateTime, expires.UtcDateTime, new Dictionary<string, object>(StringComparer.Ordinal)
        {
            ["sub"] = identity,
            ["name"] = name,
            ["metadata"] = JsonSerializer.Serialize(new Dictionary<string, string>(StringComparer.Ordinal) { ["role"] = role }),
            ["video"] = video,
        });
        return new LiveKitTokenDto(ClientUrl(), token, identity, room, expires);
    }

    private string Create(DateTime notBefore, DateTime expires, Dictionary<string, object> claims)
    {
        var settings = options.Value;
        return handler.CreateToken(new SecurityTokenDescriptor
        {
            Issuer = settings.ApiKey,
            NotBefore = notBefore,
            Expires = expires,
            SigningCredentials = new SigningCredentials(new SymmetricSecurityKey(Encoding.UTF8.GetBytes(settings.ApiSecret)), SecurityAlgorithms.HmacSha256),
            Claims = claims,
        });
    }

    /// <summary>
    /// The WebSocket URL a client connects to. In this order: <c>LiveKit:PublicUrl</c> when an operator set one; else the
    /// origin the caller used for this very request (<c>wss://</c> and the <c>Host</c> that Caddy passes on, so a page opened
    /// by the IP address or a second name connects to the same name, which is also the one its Content-Security-Policy
    /// <c>connect-src</c> allows: Caddy writes <c>wss://{hostport}</c> from the same header); else, outside a request, the
    /// public base URL of the server settings.
    /// </summary>
    private string ClientUrl()
    {
        var configured = options.Value.PublicUrl;
        if (!string.IsNullOrWhiteSpace(configured))
        {
            return configured;
        }

        if (requests?.HttpContext?.Request is { } request && request.Host.HasValue && IsHostAndPort(request.Host.Value))
        {
            return $"{(request.IsHttps ? "wss" : "ws")}://{request.Host.Value}";
        }

        var origin = new Uri(studio.Value.BaseUrl);
        var scheme = origin.Scheme == Uri.UriSchemeHttps ? "wss" : "ws";
        return $"{scheme}://{origin.Authority}";
    }

    /// <summary>True when <paramref name="authority"/> is a plain host name or address with an optional port (no user info, path or query).</summary>
    private static bool IsHostAndPort(string authority) =>
        Uri.TryCreate($"https://{authority}", UriKind.Absolute, out var uri)
        && uri.PathAndQuery == "/"
        && string.IsNullOrEmpty(uri.UserInfo)
        && !authority.Contains('@', StringComparison.Ordinal);
}
