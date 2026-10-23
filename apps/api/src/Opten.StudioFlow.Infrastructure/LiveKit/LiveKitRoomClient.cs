using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Options;
using Opten.StudioFlow.Core.Application.Ports;

namespace Opten.StudioFlow.Infrastructure.LiveKit;

/// <summary>
/// LiveKit room service over Twirp (<c>POST /twirp/livekit.RoomService/{Method}</c>, spec 7). Requests are camelCase,
/// responses snake_case with int64 values as strings; every failure – including a call that exceeds
/// <c>LiveKit:RequestTimeout</c> while sending or reading – surfaces as <see cref="LiveKitUnavailableException"/>.
/// </summary>
internal sealed class LiveKitRoomClient(HttpClient http, LiveKitTokenIssuer tokens, IOptions<LiveKitOptions> options) : ILiveKitRoomClient
{
    private const string ServicePath = "twirp/livekit.RoomService/";

    private static readonly JsonSerializerOptions ResponseJson = new(JsonSerializerDefaults.Web)
    {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
        NumberHandling = JsonNumberHandling.AllowReadingFromString,
    };

    public Task<IReadOnlyList<LiveKitParticipant>> ListParticipantsAsync(string room, CancellationToken cancellationToken) =>
        CallAsync<IReadOnlyList<LiveKitParticipant>>("ListParticipants", async token =>
        {
            using var response = await SendAsync("ListParticipants", room, new { room }, token);
            await EnsureSuccessAsync(response, "ListParticipants", token);
            try
            {
                var body = await response.Content.ReadFromJsonAsync<ListParticipantsResponse>(ResponseJson, token);
                return [.. (body?.Participants ?? []).Where(p => !string.IsNullOrEmpty(p.Sid) && !string.IsNullOrEmpty(p.Identity))
                    .Select(p => new LiveKitParticipant(p.Sid!, p.Identity!, [.. (p.Tracks ?? []).Where(t => !string.IsNullOrEmpty(t.Name)).Select(t => t.Name!)]))];
            }
            catch (JsonException exception)
            {
                throw new LiveKitUnavailableException("LiveKit returned an unreadable participant list.", exception);
            }
        }, cancellationToken);

    public Task RemoveParticipantAsync(string room, string identity, CancellationToken cancellationToken) =>
        CallAsync("RemoveParticipant", async token =>
        {
            using var response = await SendAsync("RemoveParticipant", room, new { room, identity }, token);
            if (response.StatusCode == HttpStatusCode.NotFound)
            {
                // The participant is not in the room (any more): nothing to remove.
                return true;
            }

            await EnsureSuccessAsync(response, "RemoveParticipant", token);
            return true;
        }, cancellationToken);

    /// <summary>Runs one call with an overall time limit; network, timeout and protocol errors become <see cref="LiveKitUnavailableException"/>.</summary>
    private async Task<T> CallAsync<T>(string method, Func<CancellationToken, Task<T>> call, CancellationToken cancellationToken)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(options.Value.RequestTimeout);
        try
        {
            return await call(timeout.Token);
        }
        catch (OperationCanceledException exception) when (!cancellationToken.IsCancellationRequested)
        {
            throw new LiveKitUnavailableException($"LiveKit {method} timed out.", exception);
        }
        catch (HttpRequestException exception)
        {
            throw new LiveKitUnavailableException($"LiveKit {method} is unreachable.", exception);
        }
        catch (IOException exception)
        {
            throw new LiveKitUnavailableException($"LiveKit {method} failed while reading the response.", exception);
        }
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
        return await http.SendAsync(request, cancellationToken);
    }

    private sealed record ListParticipantsResponse(IReadOnlyList<ParticipantInfo>? Participants);

    private sealed record ParticipantInfo(string? Sid, string? Identity, IReadOnlyList<TrackInfo>? Tracks);

    private sealed record TrackInfo(string? Sid, string? Name);
}
