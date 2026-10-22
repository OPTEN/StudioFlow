using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;
using Opten.FlowStudio.Core.Application.Ports;

namespace Opten.FlowStudio.Infrastructure.LiveKit;

/// <summary>
/// Verifies and parses LiveKit webhooks (spec 7). <c>Authorization</c> carries the raw JWT (no <c>Bearer</c>), signed
/// HS256 with the API secret, <c>iss</c> = API key, and claim <c>sha256</c> = standard base64 of SHA-256 over the raw
/// body. Bodies are camelCase with int64 as strings; they contain the TURN password, so they are never logged.
/// </summary>
public sealed class LiveKitWebhookReceiver(IOptions<LiveKitOptions> options)
{
    /// <summary>Largest accepted webhook body (1 MiB, GAP-22); larger bodies are 413.</summary>
    public const int MaxBodyBytes = 1024 * 1024;

    private static readonly JsonSerializerOptions BodyJson = new(JsonSerializerDefaults.Web)
    {
        NumberHandling = JsonNumberHandling.AllowReadingFromString,
    };

    private readonly JsonWebTokenHandler handler = new();

    /// <summary>True when the header is a valid webhook token for exactly this body.</summary>
    public async Task<bool> VerifyAsync(string? authorization, ReadOnlyMemory<byte> body)
    {
        if (string.IsNullOrWhiteSpace(authorization))
        {
            return false;
        }

        var settings = options.Value;
        var result = await handler.ValidateTokenAsync(authorization.Trim(), new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidIssuer = settings.ApiKey,
            ValidateAudience = false,
            ValidateLifetime = true,
            RequireExpirationTime = true,
            ValidAlgorithms = [SecurityAlgorithms.HmacSha256],
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(settings.ApiSecret)),
            ClockSkew = TimeSpan.FromMinutes(1),
        });
        if (!result.IsValid || !result.Claims.TryGetValue("sha256", out var claim) || claim is not string expected)
        {
            return false;
        }

        var actual = Convert.ToBase64String(SHA256.HashData(body.Span));
        return CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(expected), Encoding.ASCII.GetBytes(actual));
    }

    /// <summary>Parses a verified body; null when it is not a webhook event.</summary>
    public static LiveKitEvent? Parse(ReadOnlySpan<byte> body)
    {
        WebhookBody? parsed;
        try
        {
            parsed = JsonSerializer.Deserialize<WebhookBody>(body, BodyJson);
        }
        catch (JsonException)
        {
            return null;
        }

        if (parsed?.Event is null || parsed.Room?.Name is not { Length: > 0 } room)
        {
            return null;
        }

        var kind = parsed.Event switch
        {
            "participant_joined" => LiveKitEventKind.ParticipantJoined,
            "participant_left" or "participant_connection_aborted" => LiveKitEventKind.ParticipantLeft,
            "track_published" => LiveKitEventKind.TrackPublished,
            "track_unpublished" => LiveKitEventKind.TrackUnpublished,
            "room_finished" => LiveKitEventKind.RoomFinished,
            _ => LiveKitEventKind.Other,
        };
        return new LiveKitEvent(kind, room, parsed.Room.Sid, parsed.Participant?.Sid, parsed.Participant?.Identity, parsed.Track?.Name, parsed.Track?.Sid);
    }

    private sealed record WebhookBody(string? Event, RoomInfo? Room, ParticipantInfo? Participant, TrackInfo? Track);

    private sealed record RoomInfo(string? Sid, string? Name);

    private sealed record ParticipantInfo(string? Sid, string? Identity);

    private sealed record TrackInfo(string? Sid, string? Name);
}
