using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;
using Opten.StudioFlow.Core.Contracts;

namespace Opten.StudioFlow.Web.Tests.Support;

/// <summary>HTTP helpers in the contract JSON format.</summary>
public static class Http
{
    public static Task<HttpResponseMessage> PostJsonAsync<T>(this HttpClient client, string url, T body) =>
        client.PostAsJsonAsync(url, body, ContractJson.Options);

    public static Task<HttpResponseMessage> PutJsonAsync<T>(this HttpClient client, string url, T body) =>
        client.PutAsJsonAsync(url, body, ContractJson.Options);

    public static Task<HttpResponseMessage> PatchJsonAsync<T>(this HttpClient client, string url, T body) =>
        client.PatchAsJsonAsync(url, body, ContractJson.Options);

    /// <summary>Asserts the status (showing the body on failure) and returns the parsed body.</summary>
    public static async Task<T> ExpectAsync<T>(this Task<HttpResponseMessage> request, HttpStatusCode status = HttpStatusCode.OK)
    {
        using var response = await request;
        await response.ExpectAsync(status);
        return (await response.Content.ReadFromJsonAsync<T>(ContractJson.Options))!;
    }

    /// <summary>Asserts the status of a response without a typed body.</summary>
    public static async Task ExpectAsync(this Task<HttpResponseMessage> request, HttpStatusCode status)
    {
        using var response = await request;
        await response.ExpectAsync(status);
    }

    /// <summary>Asserts a problem response and returns its code.</summary>
    public static async Task<string> ExpectProblemAsync(this Task<HttpResponseMessage> request, HttpStatusCode status)
    {
        using var response = await request;
        await response.ExpectAsync(status);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal((int)status, json.RootElement.GetProperty("status").GetInt32());
        return json.RootElement.GetProperty("code").GetString()!;
    }

    public static async Task ExpectAsync(this HttpResponseMessage response, HttpStatusCode status)
    {
        if (response.StatusCode != status)
        {
            var body = await response.Content.ReadAsStringAsync();
            Assert.Fail($"Expected {(int)status} but got {(int)response.StatusCode}: {body}");
        }
    }
}

/// <summary>Signs webhooks like LiveKit: raw JWT, iss = key, claim sha256 = base64 SHA-256 of the body.</summary>
public static class Webhooks
{
    public static string Sign(string body, string? secret = null, string issuer = StudioFlowApp.LiveKitKey, TimeSpan? lifetime = null, string? hashOverride = null)
    {
        var now = DateTime.UtcNow;
        var expires = now + (lifetime ?? TimeSpan.FromMinutes(5));
        var notBefore = expires < now ? expires.AddMinutes(-10) : now;
        return new JsonWebTokenHandler { SetDefaultTimesOnTokenCreation = false }.CreateToken(new SecurityTokenDescriptor
        {
            Issuer = issuer,
            NotBefore = notBefore,
            IssuedAt = notBefore,
            Expires = expires,
            SigningCredentials = new SigningCredentials(new SymmetricSecurityKey(Encoding.UTF8.GetBytes(secret ?? StudioFlowApp.LiveKitSecret)), SecurityAlgorithms.HmacSha256),
            Claims = new Dictionary<string, object>(StringComparer.Ordinal)
            {
                ["sha256"] = hashOverride ?? Convert.ToBase64String(SHA256.HashData(Encoding.UTF8.GetBytes(body))),
            },
        });
    }

    public static HttpRequestMessage Request(string body, string? authorization, string contentType = "application/webhook+json")
    {
        var request = new HttpRequestMessage(HttpMethod.Post, "/api/livekit/webhook")
        {
            Content = new StringContent(body, Encoding.UTF8, contentType),
        };
        if (authorization is not null)
        {
            request.Headers.TryAddWithoutValidation("Authorization", authorization);
        }

        return request;
    }

    public static string Track(string kind, string room, string participantSid, string identity, string track) =>
        $$$"""{"event":"{{{kind}}}","id":"EV_1","createdAt":"1792660682","room":{"sid":"RM_1","name":"{{{room}}}","turnPassword":"secret-turn"},"participant":{"sid":"{{{participantSid}}}","identity":"{{{identity}}}","joinedAt":"1792660682"},"track":{"sid":"TR_1","type":"VIDEO","name":"{{{track}}}","source":"CAMERA","width":1280}}""";

    public static string Participant(string kind, string room, string participantSid, string identity) =>
        $$$"""{"event":"{{{kind}}}","id":"EV_2","createdAt":"1792660682","room":{"sid":"RM_1","name":"{{{room}}}"},"participant":{"sid":"{{{participantSid}}}","identity":"{{{identity}}}","state":"ACTIVE"}}""";
}

/// <summary>Output link shortcuts.</summary>
public static class OutputLinks
{
    /// <summary>The secret key in the URL of a link.</summary>
    public static string Key(this OutputLinkDto link)
    {
        ArgumentNullException.ThrowIfNull(link);
        return link.Url[(link.Url.IndexOf("?k=", StringComparison.Ordinal) + 3)..];
    }

    /// <summary>The links of the production of the session.</summary>
    public static async Task<IReadOnlyList<OutputLinkDto>> GetOutputLinksAsync(this AdminSession admin)
    {
        ArgumentNullException.ThrowIfNull(admin);
        var settings = await admin.Client.GetAsync($"/api/productions/{admin.ProductionId}/output").ExpectAsync<OutputSettingsDto>();
        return settings.Links;
    }
}

/// <summary>Pairing shortcuts through the public API.</summary>
public static class Pairing
{
    public static async Task<DeviceCredentialsDto> PairPhoneAsync(this StudioFlowApp app, AdminSession admin, string? name = null)
    {
        ArgumentNullException.ThrowIfNull(app);
        ArgumentNullException.ThrowIfNull(admin);
        var invite = await admin.Client.GetAsync($"/api/productions/{admin.ProductionId}/pairing/phone-invite").ExpectAsync<InviteDto>();
        return await app.RedeemAsync(invite, DeviceKind.Phone, name);
    }

    public static async Task<DeviceCredentialsDto> PairLaptopAsync(this StudioFlowApp app, AdminSession admin, string? name = null)
    {
        ArgumentNullException.ThrowIfNull(app);
        ArgumentNullException.ThrowIfNull(admin);
        var invite = await admin.Client.PostJsonAsync($"/api/productions/{admin.ProductionId}/pairing/invites", new CreateInviteRequest(InviteKind.LaptopLink)).ExpectAsync<InviteDto>(HttpStatusCode.Created);
        return await app.RedeemAsync(invite, DeviceKind.Laptop, name);
    }

    /// <summary>Pairs an audio station: a laptop link redeemed as the device kind audio station.</summary>
    public static async Task<DeviceCredentialsDto> PairAudioStationAsync(this StudioFlowApp app, AdminSession admin, string? name = null)
    {
        ArgumentNullException.ThrowIfNull(app);
        ArgumentNullException.ThrowIfNull(admin);
        var invite = await admin.Client.PostJsonAsync($"/api/productions/{admin.ProductionId}/pairing/invites", new CreateInviteRequest(InviteKind.LaptopLink)).ExpectAsync<InviteDto>(HttpStatusCode.Created);
        return await app.RedeemAsync(invite, DeviceKind.AudioStation, name);
    }

    public static string TokenOf(InviteDto invite)
    {
        ArgumentNullException.ThrowIfNull(invite);
        return invite.Url[(invite.Url.LastIndexOf('/') + 1)..];
    }

    private static Task<DeviceCredentialsDto> RedeemAsync(this StudioFlowApp app, InviteDto invite, DeviceKind kind, string? name) =>
        app.Anonymous().PostJsonAsync($"/api/pairing/invites/{TokenOf(invite)}/redeem", new RedeemInviteRequest(Guid.NewGuid().ToString(), name, kind, "Test")).ExpectAsync<DeviceCredentialsDto>();
}
