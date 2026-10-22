using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using Opten.FlowStudio.Core.Application.Ports;

namespace Opten.FlowStudio.Infrastructure.LiveKit;

/// <summary>
/// LiveKit room service over Twirp (<c>POST /twirp/livekit.RoomService/{Method}</c>, spec 7). Requests are camelCase,
/// responses snake_case with int64 values as strings; every failure surfaces as <see cref="LiveKitUnavailableException"/>.
/// </summary>
internal sealed class LiveKitRoomClient(HttpClient http, LiveKitTokenIssuer tokens) : ILiveKitRoomClient
{
    private const string ServicePath = "twirp/livekit.RoomService/";

    private static readonly JsonSerializerOptions ResponseJson = new(JsonSerializerDefaults.Web)
    {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
        NumberHandling = JsonNumberHandling.AllowReadingFromString,
    };

    public async Task<IReadOnlyList<LiveKitParticipant>> ListParticipantsAsync(string room, CancellationToken cancellationToken)
    {
        using var response = await SendAsync("ListParticipants", room, new { room }, cancellationToken);
        await EnsureSuccessAsync(response, "ListParticipants", cancellationToken);
        try
        {
            var body = await response.Content.ReadFromJsonAsync<ListParticipantsResponse>(ResponseJson, cancellationToken);
            return [.. (body?.Participants ?? []).Where(p => !string.IsNullOrEmpty(p.Sid) && !string.IsNullOrEmpty(p.Identity))
                .Select(p => new LiveKitParticipant(p.Sid!, p.Identity!, [.. (p.Tracks ?? []).Where(t => !string.IsNullOrEmpty(t.Name)).Select(t => t.Name!)]))];
        }
        catch (JsonException exception)
        {
            throw new LiveKitUnavailableException("LiveKit returned an unreadable participant list.", exception);
        }
    }

    public async Task RemoveParticipantAsync(string room, string identity, CancellationToken cancellationToken)
    {
        using var response = await SendAsync("RemoveParticipant", room, new { room, identity }, cancellationToken);
        if (response.StatusCode == HttpStatusCode.NotFound)
        {
            // The participant is not in the room (any more): nothing to remove.
            return;
        }

        await EnsureSuccessAsync(response, "RemoveParticipant", cancellationToken);
    }

    private static async Task EnsureSuccessAsync(HttpResponseMessage response, string method, CancellationToken cancellationToken)
    {
        if (!response.IsSuccessStatusCode)
        {
            var detail = await response.Content.ReadAsStringAsync(cancellationToken);
            throw new LiveKitUnavailableException($"LiveKit {method} failed with {(int)response.StatusCode}: {Shorten(detail)}");
        }
    }

    private static string Shorten(string text) => text.Length <= 200 ? text : text[..200];

    private async Task<HttpResponseMessage> SendAsync(string method, string room, object payload, CancellationToken cancellationToken)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, ServicePath + method)
        {
            Content = JsonContent.Create(payload),
        };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", tokens.CreateAdminToken(room));
        try
        {
            return await http.SendAsync(request, cancellationToken);
        }
        catch (HttpRequestException exception)
        {
            throw new LiveKitUnavailableException($"LiveKit {method} is unreachable.", exception);
        }
        catch (TaskCanceledException exception) when (!cancellationToken.IsCancellationRequested)
        {
            throw new LiveKitUnavailableException($"LiveKit {method} timed out.", exception);
        }
    }

    private sealed record ListParticipantsResponse(IReadOnlyList<ParticipantInfo>? Participants);

    private sealed record ParticipantInfo(string? Sid, string? Identity, IReadOnlyList<TrackInfo>? Tracks);

    private sealed record TrackInfo(string? Sid, string? Name);
}
