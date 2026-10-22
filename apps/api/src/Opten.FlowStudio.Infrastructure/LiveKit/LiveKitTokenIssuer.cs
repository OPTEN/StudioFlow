using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;
using Opten.FlowStudio.Core.Application;
using Opten.FlowStudio.Core.Application.Ports;
using Opten.FlowStudio.Core.Contracts;

namespace Opten.FlowStudio.Infrastructure.LiveKit;

/// <summary>
/// Creates LiveKit access tokens (spec 7): HS256 JWT with <c>iss</c> = API key, <c>sub</c> = identity, <c>nbf</c>,
/// <c>exp</c> (10 minutes), <c>name</c>, <c>metadata</c> and the nested <c>video</c> grant. LiveKit refreshes the token of
/// connected participants itself; clients fetch a new one for every rejoin.
/// </summary>
internal sealed class LiveKitTokenIssuer(IOptions<LiveKitOptions> options, IOptions<FlowStudioOptions> studio, TimeProvider clock) : ILiveKitTokenIssuer
{
    /// <summary>Validity of participant tokens.</summary>
    public static readonly TimeSpan Lifetime = TimeSpan.FromMinutes(10);

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
        var expires = now + Lifetime;
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

    private string ClientUrl()
    {
        var configured = options.Value.PublicUrl;
        if (!string.IsNullOrWhiteSpace(configured))
        {
            return configured;
        }

        var origin = new Uri(studio.Value.BaseUrl);
        var scheme = origin.Scheme == Uri.UriSchemeHttps ? "wss" : "ws";
        return $"{scheme}://{origin.Authority}";
    }
}
