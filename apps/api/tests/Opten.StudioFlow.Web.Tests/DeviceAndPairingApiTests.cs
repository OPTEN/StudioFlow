using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
using Microsoft.IdentityModel.JsonWebTokens;
using Opten.FlowStudio.Core.Contracts;
using Opten.FlowStudio.Web.Tests.Support;

namespace Opten.FlowStudio.Web.Tests;

public sealed class DeviceApiTests(FlowStudioApp app) : IClassFixture<FlowStudioApp>
{
    [Fact]
    public async Task Me_PairedPhone_ReturnsSelfWithSlot()
    {
        var admin = await app.AdminAsync();
        var credentials = await app.PairPhoneAsync(admin, "Bühnenkamera");

        var self = await app.DeviceClient(credentials).GetAsync("/api/device/me", TestContext.Current.CancellationToken).ExpectAsync<DeviceSelfDto>();
        var session = await app.DeviceClient(credentials).GetAsync("/api/device/session", TestContext.Current.CancellationToken).ExpectAsync<DeviceSessionDto>();

        Assert.Equal(("Bühnenkamera", DeviceKind.Phone, DeviceState.Active, "Webinar"), (self.Name, self.Kind, self.State, self.ProductionName));
        Assert.Equal("camera", Assert.Single(self.Slots).Slot);
        Assert.Equal(TallyState.Off, session.Tally.Overall);
        Assert.Equal(TallyState.Off, session.Tally.Slots["camera"]);
    }

    [Fact]
    public async Task Me_WrongSecretOrUnknownDevice_IsUnauthorized()
    {
        var admin = await app.AdminAsync();
        var credentials = await app.PairPhoneAsync(admin);

        await app.DeviceClient(credentials with { DeviceSecret = credentials.DeviceSecret + "x" }).GetAsync("/api/device/me", TestContext.Current.CancellationToken).ExpectProblemAsync(HttpStatusCode.Unauthorized);
        await app.DeviceClient(credentials with { DeviceId = "dev_unknown00000000" }).GetAsync("/api/device/me", TestContext.Current.CancellationToken).ExpectProblemAsync(HttpStatusCode.Unauthorized);
        var client = app.Anonymous();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", "garbage");
        await client.GetAsync("/api/device/me", TestContext.Current.CancellationToken).ExpectProblemAsync(HttpStatusCode.Unauthorized);
        await app.Anonymous().GetAsync("/api/device/me", TestContext.Current.CancellationToken).ExpectProblemAsync(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task LiveKitToken_Sender_PublishesCameraAndScreenOnly()
    {
        var admin = await app.AdminAsync();
        var credentials = await app.PairPhoneAsync(admin);

        var token = await app.DeviceClient(credentials).PostAsync("/api/device/livekit-token", null, TestContext.Current.CancellationToken).ExpectAsync<LiveKitTokenDto>();
        var video = new JsonWebToken(token.Token).GetPayloadValue<JsonElement>("video");

        Assert.Equal((credentials.DeviceId, admin.ProductionId), (token.Identity, token.Room));
        Assert.True(video.GetProperty("canPublish").GetBoolean());
        Assert.False(video.GetProperty("canSubscribe").GetBoolean());
        Assert.Equal(["camera", "screen_share"], video.GetProperty("canPublishSources").EnumerateArray().Select(e => e.GetString()));
    }

    [Fact]
    public async Task Block_Device_Gets403DeviceBlockedEverywhereAndUnblockRestores()
    {
        var admin = await app.AdminAsync();
        var credentials = await app.PairPhoneAsync(admin);
        var device = app.DeviceClient(credentials);

        var blocked = await admin.Client.PostAsync($"/api/productions/{admin.ProductionId}/devices/{credentials.DeviceId}/block", null, TestContext.Current.CancellationToken).ExpectAsync<DeviceDto>();

        Assert.Equal(DeviceState.Blocked, blocked.State);
        Assert.Equal(ErrorCodes.DeviceBlocked, await device.GetAsync("/api/device/me", TestContext.Current.CancellationToken).ExpectProblemAsync(HttpStatusCode.Forbidden));
        Assert.Equal(ErrorCodes.DeviceBlocked, await device.PostAsync("/api/device/livekit-token", null, TestContext.Current.CancellationToken).ExpectProblemAsync(HttpStatusCode.Forbidden));
        Assert.Equal(ErrorCodes.DeviceBlocked, await device.PostAsync("/hubs/device/negotiate?negotiateVersion=1", null, TestContext.Current.CancellationToken).ExpectProblemAsync(HttpStatusCode.Forbidden));
        Assert.Contains(app.Rooms.Removed, r => r.Identity == credentials.DeviceId);
        var snapshot = await admin.Client.GetAsync($"/api/productions/{admin.ProductionId}/snapshot", TestContext.Current.CancellationToken).ExpectAsync<ProductionSnapshot>();
        Assert.Equal(SourceStatus.Blocked, snapshot.Sources.Single(s => s.DeviceId == credentials.DeviceId).Status);

        await admin.Client.PostAsync($"/api/productions/{admin.ProductionId}/devices/{credentials.DeviceId}/unblock", null, TestContext.Current.CancellationToken).ExpectAsync(HttpStatusCode.OK);
        await device.GetAsync("/api/device/me", TestContext.Current.CancellationToken).ExpectAsync(HttpStatusCode.OK);
    }

    [Fact]
    public async Task Rename_Device_ChangesSourceLabels()
    {
        var admin = await app.AdminAsync();
        var credentials = await app.PairLaptopAsync(admin, "Laptop Mia");
        var url = $"/api/productions/{admin.ProductionId}/devices/{credentials.DeviceId}";

        var renamed = await admin.Client.PatchJsonAsync(url, new RenameDeviceRequest("Laptop Lea")).ExpectAsync<DeviceDto>();
        await admin.Client.PatchJsonAsync(url, new RenameDeviceRequest("")).ExpectProblemAsync(HttpStatusCode.BadRequest);
        await admin.Client.PatchJsonAsync($"/api/productions/{admin.ProductionId}/devices/dev_unknown0000", new RenameDeviceRequest("X")).ExpectProblemAsync(HttpStatusCode.NotFound);
        var snapshot = await admin.Client.GetAsync($"/api/productions/{admin.ProductionId}/snapshot", TestContext.Current.CancellationToken).ExpectAsync<ProductionSnapshot>();

        Assert.Equal("Laptop Lea", renamed.Name);
        Assert.Equal("Laptop Lea · Screen 1", snapshot.Sources.Single(s => s.DeviceId == credentials.DeviceId).Label);
    }

    [Fact]
    public async Task Slots_AllocateUpToLimitAndRelease()
    {
        var admin = await app.AdminAsync();
        var credentials = await app.PairLaptopAsync(admin);
        var device = app.DeviceClient(credentials);

        var camera = await device.PostJsonAsync("/api/device/slots", new AllocateSlotRequest(SourceKind.Camera)).ExpectAsync<DeviceSlotDto>();
        Assert.Equal(ErrorCodes.LimitReached, await device.PostJsonAsync("/api/device/slots", new AllocateSlotRequest(SourceKind.Camera)).ExpectProblemAsync(HttpStatusCode.Conflict));
        for (var i = 2; i <= 9; i++)
        {
            Assert.Equal($"screen-{i}", (await device.PostJsonAsync("/api/device/slots", new AllocateSlotRequest(SourceKind.Screen)).ExpectAsync<DeviceSlotDto>()).Slot);
        }

        Assert.Equal(ErrorCodes.LimitReached, await device.PostJsonAsync("/api/device/slots", new AllocateSlotRequest(SourceKind.Screen)).ExpectProblemAsync(HttpStatusCode.Conflict));
        await device.PostJsonAsync("/api/device/slots", new AllocateSlotRequest(SourceKind.Image)).ExpectProblemAsync(HttpStatusCode.BadRequest);
        await device.DeleteAsync("/api/device/slots/screen-4", TestContext.Current.CancellationToken).ExpectAsync(HttpStatusCode.NoContent);
        Assert.Equal(ErrorCodes.NotFound, await device.DeleteAsync("/api/device/slots/screen-4", TestContext.Current.CancellationToken).ExpectProblemAsync(HttpStatusCode.NotFound));
        var self = await device.GetAsync("/api/device/me", TestContext.Current.CancellationToken).ExpectAsync<DeviceSelfDto>();

        Assert.Equal("camera", camera.Slot);
        Assert.Equal(SourceKind.Camera, camera.Kind);
        Assert.Equal(9, self.Slots.Count);
        Assert.DoesNotContain(self.Slots, s => s.Slot == "screen-4");
    }

    [Fact]
    public async Task Slots_AfterRelease_LowestFreeScreenIsHandedOutEvenInParallel()
    {
        var admin = await app.AdminAsync();
        var credentials = await app.PairLaptopAsync(admin);
        var device = app.DeviceClient(credentials);
        var first = new List<string>();
        for (var i = 0; i < 3; i++)
        {
            first.Add((await device.PostJsonAsync("/api/device/slots", new AllocateSlotRequest(SourceKind.Screen)).ExpectAsync<DeviceSlotDto>()).Slot);
        }

        await device.DeleteAsync("/api/device/slots/screen-3", TestContext.Current.CancellationToken).ExpectAsync(HttpStatusCode.NoContent);
        await device.DeleteAsync("/api/device/slots/screen-2", TestContext.Current.CancellationToken).ExpectAsync(HttpStatusCode.NoContent);
        var next = await device.PostJsonAsync("/api/device/slots", new AllocateSlotRequest(SourceKind.Screen)).ExpectAsync<DeviceSlotDto>();
        var parallel = await Task.WhenAll(Enumerable.Range(0, 3).Select(_ => device.PostJsonAsync("/api/device/slots", new AllocateSlotRequest(SourceKind.Screen)).ExpectAsync<DeviceSlotDto>()));
        var self = await device.GetAsync("/api/device/me", TestContext.Current.CancellationToken).ExpectAsync<DeviceSelfDto>();

        Assert.Equal(["screen-2", "screen-3", "screen-4"], first);
        Assert.Equal("screen-2", next.Slot);
        Assert.Equal(["screen-3", "screen-5", "screen-6"], parallel.Select(s => s.Slot).Order(StringComparer.Ordinal));
        Assert.Equal(["screen-1", "screen-2", "screen-3", "screen-4", "screen-5", "screen-6"], self.Slots.Select(s => s.Slot).Order(StringComparer.Ordinal));
        Assert.Equal(6, self.Slots.Select(s => s.Code).Distinct(StringComparer.Ordinal).Count());
    }

    [Fact]
    public async Task BandwidthTest_UploadOfOneMegabyte_ReportsBytes()
    {
        var admin = await app.AdminAsync();
        var device = app.DeviceClient(await app.PairPhoneAsync(admin));
        using var content = new ByteArrayContent(new byte[1024 * 1024]);
        content.Headers.ContentType = new MediaTypeHeaderValue("application/octet-stream");

        var result = await device.PostAsync("/api/device/bandwidth-test", content, TestContext.Current.CancellationToken).ExpectAsync<BandwidthTestResultDto>();

        Assert.Equal(1024 * 1024, result.Bytes);
        Assert.True(result.ServerMs >= 0);
    }

    [Fact]
    public async Task BandwidthTest_MoreThanFourMegabytes_Is413()
    {
        var admin = await app.AdminAsync();
        var device = app.DeviceClient(await app.PairPhoneAsync(admin));
        using var content = new ByteArrayContent(new byte[(4 * 1024 * 1024) + 1]);

        await device.PostAsync("/api/device/bandwidth-test", content, TestContext.Current.CancellationToken).ExpectProblemAsync(HttpStatusCode.RequestEntityTooLarge);
    }

    [Fact]
    public async Task Command_OfflineDevice_IsAcceptedAndInvalidRejected()
    {
        var admin = await app.AdminAsync();
        var credentials = await app.PairLaptopAsync(admin);
        var url = $"/api/productions/{admin.ProductionId}/devices/{credentials.DeviceId}/commands";

        var command = await admin.Client.PostJsonAsync(url, new DeviceCommandRequest(DeviceCommandKind.Reshare, "screen-1", null)).ExpectAsync<DeviceCommandDto>(HttpStatusCode.Accepted);
        await admin.Client.PostJsonAsync(url, new DeviceCommandRequest(DeviceCommandKind.Message, null, "")).ExpectProblemAsync(HttpStatusCode.BadRequest);
        await admin.Client.PostJsonAsync(url, new DeviceCommandRequest(DeviceCommandKind.SwitchCamera, null, null)).ExpectProblemAsync(HttpStatusCode.BadRequest);

        Assert.Equal(("screen-1", DeviceCommandKind.Reshare), (command.Slot, command.Kind));
    }

    [Fact]
    public async Task Unpair_And_AdminDelete_RemoveTheDevice()
    {
        var admin = await app.AdminAsync();
        var phone = await app.PairPhoneAsync(admin);
        var laptop = await app.PairLaptopAsync(admin);

        await app.DeviceClient(phone).PostAsync("/api/device/unpair", null, TestContext.Current.CancellationToken).ExpectAsync(HttpStatusCode.NoContent);
        await admin.Client.DeleteAsync($"/api/productions/{admin.ProductionId}/devices/{laptop.DeviceId}", TestContext.Current.CancellationToken).ExpectAsync(HttpStatusCode.NoContent);
        await admin.Client.DeleteAsync($"/api/productions/{admin.ProductionId}/devices/{laptop.DeviceId}", TestContext.Current.CancellationToken).ExpectProblemAsync(HttpStatusCode.NotFound);

        await app.DeviceClient(phone).GetAsync("/api/device/me", TestContext.Current.CancellationToken).ExpectProblemAsync(HttpStatusCode.Unauthorized);
        await app.DeviceClient(laptop).GetAsync("/api/device/me", TestContext.Current.CancellationToken).ExpectProblemAsync(HttpStatusCode.Unauthorized);
        var snapshot = await admin.Client.GetAsync($"/api/productions/{admin.ProductionId}/snapshot", TestContext.Current.CancellationToken).ExpectAsync<ProductionSnapshot>();
        Assert.DoesNotContain(snapshot.Devices, d => d.Id == phone.DeviceId || d.Id == laptop.DeviceId);
        Assert.DoesNotContain(snapshot.Sources, s => s.DeviceId == phone.DeviceId);
        Assert.Contains(snapshot.RecentLog, l => l.Text.EndsWith("entfernt", StringComparison.Ordinal));
    }

    [Fact]
    public async Task Report_InvalidBody_IsRejected()
    {
        var admin = await app.AdminAsync();
        var device = app.DeviceClient(await app.PairPhoneAsync(admin));

        await device.PostAsync("/api/device/report", new StringContent("""{"rtc":"warp"}""", System.Text.Encoding.UTF8, "application/json"), TestContext.Current.CancellationToken).ExpectProblemAsync(HttpStatusCode.BadRequest);
    }
}

public sealed class PairingApiTests(FlowStudioApp app) : IClassFixture<FlowStudioApp>
{
    [Fact]
    public async Task PhoneInvite_RedeemedOnce_NextIsCreatedAndTokenIsGone()
    {
        var admin = await app.AdminAsync();
        var invite = await admin.Client.GetAsync($"/api/productions/{admin.ProductionId}/pairing/phone-invite", TestContext.Current.CancellationToken).ExpectAsync<InviteDto>();
        var request = new RedeemInviteRequest("client-a", null, DeviceKind.Phone, "Android");

        var credentials = await app.Anonymous().PostJsonAsync($"/api/pairing/invites/{Pairing.TokenOf(invite)}/redeem", request).ExpectAsync<DeviceCredentialsDto>();
        var replay = await app.Anonymous().PostJsonAsync($"/api/pairing/invites/{Pairing.TokenOf(invite)}/redeem", request).ExpectAsync<DeviceCredentialsDto>();
        var code = await app.Anonymous().PostJsonAsync($"/api/pairing/invites/{Pairing.TokenOf(invite)}/redeem", request with { ClientId = "client-b" }).ExpectProblemAsync(HttpStatusCode.Gone);
        var next = await admin.Client.GetAsync($"/api/productions/{admin.ProductionId}/pairing/phone-invite", TestContext.Current.CancellationToken).ExpectAsync<InviteDto>();

        Assert.StartsWith("https://fs.test/join/i/", invite.Url, StringComparison.Ordinal);
        Assert.Equal(credentials.DeviceId, replay.DeviceId);
        Assert.NotEqual(credentials.DeviceSecret, replay.DeviceSecret);
        Assert.Equal(ErrorCodes.PairingExpired, code);
        Assert.NotEqual(invite.Id, next.Id);
        await app.DeviceClient(replay).GetAsync("/api/device/me", TestContext.Current.CancellationToken).ExpectAsync(HttpStatusCode.OK);
        await app.DeviceClient(credentials).GetAsync("/api/device/me", TestContext.Current.CancellationToken).ExpectProblemAsync(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task LaptopLink_RevokedOrUnknown_IsGone()
    {
        var admin = await app.AdminAsync();
        var link = await admin.Client.PostJsonAsync($"/api/productions/{admin.ProductionId}/pairing/invites", new CreateInviteRequest(InviteKind.LaptopLink)).ExpectAsync<InviteDto>(HttpStatusCode.Created);

        await admin.Client.DeleteAsync($"/api/productions/{admin.ProductionId}/pairing/invites/{link.Id}", TestContext.Current.CancellationToken).ExpectAsync(HttpStatusCode.NoContent);
        await admin.Client.DeleteAsync($"/api/productions/{admin.ProductionId}/pairing/invites/inv_unknown", TestContext.Current.CancellationToken).ExpectProblemAsync(HttpStatusCode.NotFound);

        Assert.StartsWith("https://fs.test/j/", link.Url, StringComparison.Ordinal);
        await app.Anonymous().PostJsonAsync($"/api/pairing/invites/{Pairing.TokenOf(link)}/redeem", new RedeemInviteRequest("c", "Lea", DeviceKind.Laptop, "Mac")).ExpectProblemAsync(HttpStatusCode.Gone);
        await app.Anonymous().PostJsonAsync("/api/pairing/invites/not-a-token/redeem", new RedeemInviteRequest("c", "Lea", DeviceKind.Laptop, "Mac")).ExpectProblemAsync(HttpStatusCode.Gone);
    }

    [Fact]
    public async Task PhoneInvite_Renew_ReplacesTheCode()
    {
        var admin = await app.AdminAsync();
        var first = await admin.Client.GetAsync($"/api/productions/{admin.ProductionId}/pairing/phone-invite", TestContext.Current.CancellationToken).ExpectAsync<InviteDto>();

        var renewed = await admin.Client.PostAsync($"/api/productions/{admin.ProductionId}/pairing/phone-invite/renew", null, TestContext.Current.CancellationToken).ExpectAsync<InviteDto>();

        Assert.NotEqual(first.Url, renewed.Url);
        await app.Anonymous().PostJsonAsync($"/api/pairing/invites/{Pairing.TokenOf(first)}/redeem", new RedeemInviteRequest("c", null, DeviceKind.Phone, "x")).ExpectProblemAsync(HttpStatusCode.Gone);
    }

    [Fact]
    public async Task Knock_ApproveThenPoll_ReturnsCredentialsRepeatedly()
    {
        var admin = await app.AdminAsync();
        var anonymous = app.Anonymous();
        var knock = await anonymous.PostJsonAsync("/api/pairing/requests", new CreatePairingRequest("Laptop Lea", DeviceKind.Laptop, "Windows · Edge")).ExpectAsync<PairingRequestCreatedDto>(HttpStatusCode.Created);
        var snapshot = await admin.Client.GetAsync($"/api/productions/{admin.ProductionId}/snapshot", TestContext.Current.CancellationToken).ExpectAsync<ProductionSnapshot>();

        var device = await admin.Client.PostAsync($"/api/productions/{admin.ProductionId}/pairing/requests/{knock.RequestId}/approve", null, TestContext.Current.CancellationToken).ExpectAsync<DeviceDto>();
        var polls = await Task.WhenAll(Enumerable.Range(0, 3).Select(_ => Poll(anonymous, knock.RequestId, knock.PollToken)));

        Assert.Matches("^[0-9]{4}$", knock.CheckCode);
        Assert.Contains(snapshot.PairingRequests, r => r.Id == knock.RequestId && r.CheckCode == knock.CheckCode);
        Assert.Equal(PairingMethod.Code, device.PairingMethod);
        Assert.All(polls, p => Assert.Equal(PairingRequestStatus.Approved, p.Status));
        Assert.Single(polls.Select(p => p.Credentials).Distinct());
        await app.DeviceClient(polls[0].Credentials!).GetAsync("/api/device/me", TestContext.Current.CancellationToken).ExpectAsync(HttpStatusCode.OK);
        Assert.Equal(PairingRequestStatus.Expired, (await Poll(anonymous, knock.RequestId, "wrong-token")).Status);
        Assert.Equal(ErrorCodes.NotFound, await admin.Client.PostAsync($"/api/productions/{admin.ProductionId}/pairing/requests/{knock.RequestId}/approve", null, TestContext.Current.CancellationToken).ExpectProblemAsync(HttpStatusCode.NotFound));
    }

    [Fact]
    public async Task Knock_DenyAndCancel_AreReflectedInPoll()
    {
        var admin = await app.AdminAsync();
        var anonymous = app.Anonymous();
        var denied = await anonymous.PostJsonAsync("/api/pairing/requests", new CreatePairingRequest("Eins", DeviceKind.Laptop, "x")).ExpectAsync<PairingRequestCreatedDto>(HttpStatusCode.Created);
        var cancelled = await anonymous.PostJsonAsync("/api/pairing/requests", new CreatePairingRequest("Zwei", DeviceKind.Phone, "x")).ExpectAsync<PairingRequestCreatedDto>(HttpStatusCode.Created);

        await admin.Client.PostAsync($"/api/productions/{admin.ProductionId}/pairing/requests/{denied.RequestId}/deny", null, TestContext.Current.CancellationToken).ExpectAsync(HttpStatusCode.NoContent);
        await admin.Client.PostAsync($"/api/productions/{admin.ProductionId}/pairing/requests/prq_unknown/deny", null, TestContext.Current.CancellationToken).ExpectProblemAsync(HttpStatusCode.NotFound);
        using var cancel = new HttpRequestMessage(HttpMethod.Delete, $"/api/pairing/requests/{cancelled.RequestId}");
        cancel.Headers.Add("X-Pairing-Token", cancelled.PollToken);
        await anonymous.SendAsync(cancel, TestContext.Current.CancellationToken).ExpectAsync(HttpStatusCode.NoContent);

        Assert.Equal(PairingRequestStatus.Denied, (await Poll(anonymous, denied.RequestId, denied.PollToken)).Status);
        Assert.Equal(PairingRequestStatus.Expired, (await Poll(anonymous, cancelled.RequestId, cancelled.PollToken)).Status);
        Assert.Equal(ErrorCodes.NotFound, await admin.Client.PostAsync($"/api/productions/{admin.ProductionId}/pairing/requests/{denied.RequestId}/approve", null, TestContext.Current.CancellationToken).ExpectProblemAsync(HttpStatusCode.NotFound));
    }

    [Fact]
    public async Task Knock_InvalidInputOrMissingToken_IsRejected()
    {
        var anonymous = app.Anonymous();

        await anonymous.PostJsonAsync("/api/pairing/requests", new CreatePairingRequest("", DeviceKind.Laptop, "x")).ExpectProblemAsync(HttpStatusCode.BadRequest);
        await anonymous.PostJsonAsync("/api/pairing/requests", new CreatePairingRequest(new string('n', 61), DeviceKind.Laptop, "x")).ExpectProblemAsync(HttpStatusCode.BadRequest);
        await anonymous.GetAsync("/api/pairing/requests/prq_x", TestContext.Current.CancellationToken).ExpectAsync(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task Knock_ElevenPerAddress_IsRateLimited()
    {
        var anonymous = app.Anonymous();
        for (var i = 0; i < 10; i++)
        {
            await anonymous.PostJsonAsync("/api/pairing/requests", new CreatePairingRequest($"L{i}", DeviceKind.Laptop, "x")).ExpectAsync(HttpStatusCode.Created);
        }

        using var limited = await anonymous.PostJsonAsync("/api/pairing/requests", new CreatePairingRequest("L11", DeviceKind.Laptop, "x"));

        await limited.ExpectAsync(HttpStatusCode.TooManyRequests);
        Assert.True(limited.Headers.Contains("Retry-After"));
        await app.Anonymous().PostJsonAsync("/api/pairing/requests", new CreatePairingRequest("Andere Adresse", DeviceKind.Laptop, "x")).ExpectAsync(HttpStatusCode.Created);
        foreach (var request in app.Service<Core.Application.Runtime.PairingRequestStore>().Pending(await ActiveAsync(), DateTimeOffset.UtcNow))
        {
            app.Service<Core.Application.Runtime.PairingRequestStore>().Remove(request.Id);
        }
    }

    [Fact]
    public async Task Redeem_TwentyOneAttemptsPerAddress_IsRateLimited()
    {
        var anonymous = app.Anonymous();
        for (var i = 0; i < 20; i++)
        {
            await anonymous.PostJsonAsync($"/api/pairing/invites/token{i}/redeem", new RedeemInviteRequest("c", null, DeviceKind.Phone, "x")).ExpectAsync(HttpStatusCode.Gone);
        }

        Assert.Equal(ErrorCodes.RateLimited, await anonymous.PostJsonAsync("/api/pairing/invites/token/redeem", new RedeemInviteRequest("c", null, DeviceKind.Phone, "x")).ExpectProblemAsync(HttpStatusCode.TooManyRequests));
    }

    private static async Task<PairingRequestStatusDto> Poll(HttpClient client, string requestId, string token)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, $"/api/pairing/requests/{requestId}");
        request.Headers.Add("X-Pairing-Token", token);
        return await client.SendAsync(request).ExpectAsync<PairingRequestStatusDto>();
    }

    private async Task<string> ActiveAsync() => (await app.AdminAsync()).ProductionId;
}
