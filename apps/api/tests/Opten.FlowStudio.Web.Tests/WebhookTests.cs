using System.Net;
using Opten.FlowStudio.Core.Application.Services;
using Opten.FlowStudio.Core.Contracts;
using Opten.FlowStudio.Web.Tests.Support;

namespace Opten.FlowStudio.Web.Tests;

public sealed class WebhookTests(FlowStudioApp app) : IClassFixture<FlowStudioApp>
{
    [Fact]
    public async Task Webhook_ValidSignature_IsAccepted()
    {
        var admin = await app.AdminAsync();
        var body = Webhooks.Participant("participant_joined", admin.ProductionId, "PA_ok", "studio_abc");

        await app.Anonymous().SendAsync(Webhooks.Request(body, Webhooks.Sign(body)), TestContext.Current.CancellationToken).ExpectAsync(HttpStatusCode.OK);
    }

    public static TheoryData<string> InvalidSignatures => new() { "tampered", "bearer", "expired", "secret", "issuer", "missing", "hash" };

    [Theory]
    [MemberData(nameof(InvalidSignatures))]
    public async Task Webhook_InvalidSignature_IsUnauthorized(string variant)
    {
        var admin = await app.AdminAsync();
        var body = Webhooks.Participant("participant_joined", admin.ProductionId, "PA_1", "dev_aaaaaaaaaaaaaaaa");
        var (sent, authorization) = variant switch
        {
            "tampered" => (body.Replace("PA_1", "PA_2", StringComparison.Ordinal), Webhooks.Sign(body)),
            "bearer" => (body, "Bearer " + Webhooks.Sign(body)),
            "expired" => (body, Webhooks.Sign(body, lifetime: TimeSpan.FromMinutes(-2))),
            "secret" => (body, Webhooks.Sign(body, secret: "sk-another-secret-that-is-long-enough-123")),
            "issuer" => (body, Webhooks.Sign(body, issuer: "otherkey")),
            "hash" => (body, Webhooks.Sign(body, hashOverride: "AAAA")),
            _ => (body, (string?)null),
        };

        Assert.Equal(ErrorCodes.Unauthorized, await app.Anonymous().SendAsync(Webhooks.Request(sent, authorization), TestContext.Current.CancellationToken).ExpectProblemAsync(HttpStatusCode.Unauthorized));
        Assert.DoesNotContain(app.Rooms.Removed, r => r.Identity == "dev_aaaaaaaaaaaaaaaa");
    }

    [Fact]
    public async Task Webhook_SignedButUnparseable_IsBadRequest()
    {
        const string body = """{"hello":"world"}""";

        await app.Anonymous().SendAsync(Webhooks.Request(body, Webhooks.Sign(body)), TestContext.Current.CancellationToken).ExpectProblemAsync(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task Webhook_UnknownRoomOrEvent_IsIgnored()
    {
        var unknownRoom = Webhooks.Track("track_published", "prd_unknown000000", "PA_1", "dev_x", "camera");
        var otherEvent = """{"event":"egress_started","room":{"name":"prd_x"}}""";

        await app.Anonymous().SendAsync(Webhooks.Request(unknownRoom, Webhooks.Sign(unknownRoom)), TestContext.Current.CancellationToken).ExpectAsync(HttpStatusCode.OK);
        await app.Anonymous().SendAsync(Webhooks.Request(otherEvent, Webhooks.Sign(otherEvent)), TestContext.Current.CancellationToken).ExpectAsync(HttpStatusCode.OK);
    }

    [Fact]
    public async Task Webhook_BlockedDeviceRejoins_IsRemovedAgain()
    {
        var admin = await app.AdminAsync();
        var credentials = await app.PairPhoneAsync(admin);
        await admin.Client.PostAsync($"/api/productions/{admin.ProductionId}/devices/{credentials.DeviceId}/block", null, TestContext.Current.CancellationToken).ExpectAsync(HttpStatusCode.OK);
        var before = app.Rooms.Removed.Count(r => r.Identity == credentials.DeviceId);
        var body = Webhooks.Participant("participant_joined", admin.ProductionId, "PA_again", credentials.DeviceId);

        await app.Anonymous().SendAsync(Webhooks.Request(body, Webhooks.Sign(body)), TestContext.Current.CancellationToken).ExpectAsync(HttpStatusCode.OK);

        Assert.Equal(before + 1, app.Rooms.Removed.Count(r => r.Identity == credentials.DeviceId));
    }

    [Fact]
    public async Task Webhook_TooLarge_Is413()
    {
        var body = new string(' ', 70 * 1024);

        await app.Anonymous().SendAsync(Webhooks.Request(body, Webhooks.Sign(body)), TestContext.Current.CancellationToken).ExpectProblemAsync(HttpStatusCode.RequestEntityTooLarge);
    }

    [Fact]
    public async Task Reconcile_ListedParticipant_IsAppliedAndDeletedDeviceIsKicked()
    {
        var admin = await app.AdminAsync();
        app.Rooms.Available = true;
        app.Rooms.Participants[admin.ProductionId] = [new("PA_ghost", "dev_deleteddevice00", ["camera"])];
        try
        {
            await app.Service<LiveKitSyncService>().ReconcileAsync(CancellationToken.None);
        }
        finally
        {
            app.Rooms.Available = false;
        }

        Assert.Contains(app.Rooms.Removed, r => r.Identity == "dev_deleteddevice00" && r.Room == admin.ProductionId);
    }
}
