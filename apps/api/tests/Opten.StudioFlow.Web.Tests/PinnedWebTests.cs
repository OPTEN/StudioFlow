using System.Net;
using System.Net.Http.Headers;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.SignalR;
using Microsoft.AspNetCore.SignalR.Client;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Opten.StudioFlow.Core.Application;
using Opten.StudioFlow.Core.Contracts;
using Opten.StudioFlow.Web.Hubs;
using Opten.StudioFlow.Web.Tests.Support;

namespace Opten.StudioFlow.Web.Tests;

/// <summary>Sessions end on the server (GAP-04), hub timings (GAP-12) and response hardening.</summary>
public sealed class SessionAndHardeningTests(StudioFlowApp app) : IClassFixture<StudioFlowApp>
{
    [Fact]
    public async Task Logout_OldCookieAndStudioHub_AreRejectedAndClosed()
    {
        var admin = await app.AdminAsync();
        await using var hub = app.Hub(HubMethods.StudioHubPath, o => o.Headers["Cookie"] = admin.Cookie);
        var closed = HubClosed.Watch(hub);
        await hub.StartAsync(TestContext.Current.CancellationToken);
        await hub.InvokeAsync<ProductionChangesDto>(HubMethods.Subscribe, admin.ProductionId, null, TestContext.Current.CancellationToken);

        await admin.Client.PostAsync("/api/auth/logout", null, TestContext.Current.CancellationToken).ExpectAsync(HttpStatusCode.NoContent);
        await closed.WaitAsync(TimeSpan.FromSeconds(10), TestContext.Current.CancellationToken);
        var reused = app.Anonymous();
        reused.DefaultRequestHeaders.Add("Cookie", admin.Cookie);

        Assert.Equal(ErrorCodes.Unauthorized, await reused.GetAsync("/api/auth/me", TestContext.Current.CancellationToken).ExpectProblemAsync(HttpStatusCode.Unauthorized));
        await using var again = app.Hub(HubMethods.StudioHubPath, o => o.Headers["Cookie"] = admin.Cookie);
        await Assert.ThrowsAnyAsync<HttpRequestException>(() => again.StartAsync(TestContext.Current.CancellationToken));
    }

    [Fact]
    public async Task Logout_OneSession_OtherSessionsStay()
    {
        var first = await app.AdminAsync();
        var second = await app.AdminAsync();

        await first.Client.PostAsync("/api/auth/logout", null, TestContext.Current.CancellationToken).ExpectAsync(HttpStatusCode.NoContent);

        await second.Client.GetAsync("/api/auth/me", TestContext.Current.CancellationToken).ExpectAsync(HttpStatusCode.OK);
    }

    [Fact]
    public async Task Logout_WithoutSession_IsUnauthorized() =>
        Assert.Equal(ErrorCodes.Unauthorized, await app.Anonymous().PostAsync("/api/auth/logout", null, TestContext.Current.CancellationToken).ExpectProblemAsync(HttpStatusCode.Unauthorized));

    [Fact]
    public void HubOptions_Defaults_AreTwoSecondKeepAliveAndFiveSecondTimeout()
    {
        var hub = app.Services.GetRequiredService<IOptions<HubOptions>>().Value;

        Assert.Equal((TimeSpan.FromSeconds(2), TimeSpan.FromSeconds(5)), (hub.KeepAliveInterval, hub.ClientTimeoutInterval));
    }

    [Fact]
    public async Task ApiResponses_CarryNoSniffAndNoStore()
    {
        var admin = await app.AdminAsync();

        using var response = await admin.Client.GetAsync($"/api/productions/{admin.ProductionId}/snapshot", TestContext.Current.CancellationToken);
        using var login = await app.Anonymous().PostJsonAsync("/api/auth/login", new LoginRequest("x", "y"));

        Assert.Equal("nosniff", response.Headers.GetValues("X-Content-Type-Options").Single());
        Assert.True(response.Headers.CacheControl!.NoStore);
        Assert.True(login.Headers.CacheControl!.NoStore);
    }

    [Fact]
    public async Task AssetContent_Polyglot_IsServedInlineSandboxedWithValidators()
    {
        var admin = await app.AdminAsync();
        using var form = new MultipartFormDataContent { { new ByteArrayContent(MediaSamples.Png(2, 2)), "file", "../‮evil<script>.png" } };
        var asset = await admin.Client.PostAsync($"/api/productions/{admin.ProductionId}/assets", form, TestContext.Current.CancellationToken).ExpectAsync<AssetDto>(HttpStatusCode.Created);

        using var response = await admin.Client.GetAsync(asset.ContentUrl, TestContext.Current.CancellationToken);
        await response.ExpectAsync(HttpStatusCode.OK);
        using var conditional = new HttpRequestMessage(HttpMethod.Get, asset.ContentUrl);
        conditional.Headers.IfNoneMatch.Add(response.Headers.ETag!);
        using var notModified = await admin.Client.SendAsync(conditional, TestContext.Current.CancellationToken);

        Assert.Equal("evil<script>", asset.Name);
        Assert.Equal("image/png", response.Content.Headers.ContentType!.MediaType);
        Assert.Equal("nosniff", response.Headers.GetValues("X-Content-Type-Options").Single());
        Assert.Equal("default-src 'none'; sandbox", response.Headers.GetValues("Content-Security-Policy").Single());
        Assert.Equal("inline", response.Content.Headers.ContentDisposition!.DispositionType);
        Assert.Equal((true, TimeSpan.FromHours(1)), (response.Headers.CacheControl!.Private, response.Headers.CacheControl.MaxAge));
        Assert.Equal(HttpStatusCode.NotModified, notModified.StatusCode);
    }
}

/// <summary>GAP-21 and GAP-07 over the real hubs.</summary>
public sealed class PinnedHubTests(StudioFlowApp app) : IClassFixture<StudioFlowApp>
{
    [Fact]
    public async Task Hello_ReplacedTabReconnects_GetsSessionReplacedAndCurrentTabStays()
    {
        var admin = await app.AdminAsync();
        var credentials = await app.PairPhoneAsync(admin);
        await using var first = Device(credentials);
        await first.StartAsync(TestContext.Current.CancellationToken);
        await first.InvokeAsync<DeviceSessionDto>(HubMethods.Hello, new DeviceHelloDto("tab-1", "x", "1"), TestContext.Current.CancellationToken);
        await using var second = Device(credentials);
        await second.StartAsync(TestContext.Current.CancellationToken);
        await second.InvokeAsync<DeviceSessionDto>(HubMethods.Hello, new DeviceHelloDto("tab-2", "x", "1"), TestContext.Current.CancellationToken);

        await using var late = Device(credentials);
        var replaced = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        late.On(HubMethods.SessionReplaced, () => replaced.TrySetResult());
        var lateClosed = HubClosed.Watch(late);
        await late.StartAsync(TestContext.Current.CancellationToken);
        var refused = await Assert.ThrowsAsync<HubException>(() => late.InvokeAsync<DeviceSessionDto>(HubMethods.Hello, new DeviceHelloDto("tab-1", "x", "1"), TestContext.Current.CancellationToken));

        await replaced.Task.WaitAsync(TimeSpan.FromSeconds(10), TestContext.Current.CancellationToken);
        await lateClosed.WaitAsync(TimeSpan.FromSeconds(15), TestContext.Current.CancellationToken);
        Assert.Contains($"{ErrorCodes.Conflict}:", refused.Message, StringComparison.Ordinal);
        Assert.Equal(HubConnectionState.Connected, second.State);
        await second.InvokeAsync(HubMethods.Report, new DeviceReportDto(RtcState.Connected, [], null, null, null, null, null), TestContext.Current.CancellationToken);
    }

    [Fact]
    public async Task OutputHub_SourceHealthChanges_ArriveOnlyAsRevisionOnly()
    {
        var admin = await app.AdminAsync();
        var credentials = await app.PairPhoneAsync(admin);
        var settings = await admin.Client.GetAsync($"/api/productions/{admin.ProductionId}/output", TestContext.Current.CancellationToken).ExpectAsync<OutputSettingsDto>();
        await using var output = app.Hub(HubMethods.OutputHubPath, o => o.AccessTokenProvider = () => Task.FromResult<string?>(settings.Url[(settings.Url.IndexOf("?k=", StringComparison.Ordinal) + 3)..]));
        var events = HubProbe.On<ProductionEvent>(output, HubMethods.Event);
        await output.StartAsync(TestContext.Current.CancellationToken);
        var start = await output.InvokeAsync<OutputChangesDto>(HubMethods.SubscribeOutput, null, TestContext.Current.CancellationToken);
        await using var studio = app.Hub(HubMethods.StudioHubPath, o => o.Headers["Cookie"] = admin.Cookie);
        var studioEvents = HubProbe.On<ProductionEvent>(studio, HubMethods.Event);
        await studio.StartAsync(TestContext.Current.CancellationToken);
        await studio.InvokeAsync<ProductionChangesDto>(HubMethods.Subscribe, admin.ProductionId, null, TestContext.Current.CancellationToken);

        await using var device = Device(credentials);
        await device.StartAsync(TestContext.Current.CancellationToken);
        await device.InvokeAsync<DeviceSessionDto>(HubMethods.Hello, new DeviceHelloDto("tab", "x", "1"), TestContext.Current.CancellationToken);
        await device.InvokeAsync(HubMethods.Report, new DeviceReportDto(RtcState.Connected, [new SlotTelemetryDto("camera", SlotState.Live, 1280, 720, 30, 2000, 0, "h264")], null, null, null, null, null), TestContext.Current.CancellationToken);
        var ok = await studioEvents.NextAsync(e => e is SourceUpsertedEvent { Source.Status: SourceStatus.Ok });
        var sameRevision = await events.NextAsync(e => e.Revision == ok.Revision);

        Assert.All(start.Snapshot!.Sources, s => Assert.Equal((SourceStatus.Ok, (DateTimeOffset?)null), (s.Status, s.StatusSince)));
        Assert.IsType<RevisionOnlyEvent>(sameRevision);
    }

    [Fact]
    public async Task DeleteDevice_WhileConnected_HubIsClosedAndCredentialsStopWorking()
    {
        var admin = await app.AdminAsync();
        var credentials = await app.PairPhoneAsync(admin);
        await using var device = Device(credentials);
        var closed = HubClosed.Watch(device);
        await device.StartAsync(TestContext.Current.CancellationToken);
        await device.InvokeAsync<DeviceSessionDto>(HubMethods.Hello, new DeviceHelloDto("tab", "x", "1"), TestContext.Current.CancellationToken);

        await admin.Client.DeleteAsync($"/api/productions/{admin.ProductionId}/devices/{credentials.DeviceId}", TestContext.Current.CancellationToken).ExpectAsync(HttpStatusCode.NoContent);
        await closed.WaitAsync(TimeSpan.FromSeconds(10), TestContext.Current.CancellationToken);
        await using var again = Device(credentials);

        Assert.Equal(HttpStatusCode.Unauthorized, (await Assert.ThrowsAsync<HttpRequestException>(() => again.StartAsync(TestContext.Current.CancellationToken))).StatusCode);
        Assert.Contains(app.Rooms.Removed, r => r.Identity == credentials.DeviceId);
    }

    private HubConnection Device(DeviceCredentialsDto credentials) =>
        app.Hub(HubMethods.DeviceHubPath, o => o.AccessTokenProvider = () => Task.FromResult<string?>($"{credentials.DeviceId}.{credentials.DeviceSecret}"));
}

/// <summary>A Regie connection is closed when its session expires (GAP-04b).</summary>
public sealed class SessionExpiryTests(ShortSessionApp app) : IClassFixture<ShortSessionApp>
{
    [Fact]
    public async Task StudioHub_SessionExpires_ConnectionIsClosed()
    {
        var admin = await app.AdminAsync();
        await using var hub = app.Hub(HubMethods.StudioHubPath, o => o.Headers["Cookie"] = admin.Cookie);
        var closed = HubClosed.Watch(hub);
        await hub.StartAsync(TestContext.Current.CancellationToken);

        await closed.WaitAsync(TimeSpan.FromSeconds(15), TestContext.Current.CancellationToken);

        Assert.Equal(HubConnectionState.Disconnected, hub.State);
    }
}

/// <summary>The app with a session lifetime of three seconds.</summary>
public sealed class ShortSessionApp(PostgresFixture postgres) : StudioFlowApp(postgres)
{
    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        base.ConfigureWebHost(builder);
        builder.UseSetting("Admin:SessionLifetime", "00:00:03");
    }
}

/// <summary>Per-connection outboxes: one stuck client never delays the others (task 2 of the backend review).</summary>
public sealed class HubConnectionRegistryTests
{
    [Fact]
    public async Task Send_OneConnectionStuck_OthersReceiveInOrderAndStuckOneIsClosedWhenFull()
    {
        var registry = new HubConnectionRegistry(new RealtimeOptions { ConnectionQueueLimit = 16 }, TimeProvider.System, NullLogger<HubConnectionRegistry>.Instance);
        var stuck = new FakeCallerContext("stuck");
        var healthy = new FakeCallerContext("healthy");
        registry.Register(stuck);
        registry.Register(healthy);
        registry.Join("g", "stuck");
        registry.Join("g", "healthy");
        var never = new TaskCompletionSource();
        var received = new List<int>();
        var all = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var watch = System.Diagnostics.Stopwatch.StartNew();

        for (var i = 0; i < 40; i++)
        {
            var number = i;
            registry.SendToGroup("g", id =>
            {
                if (id == "stuck")
                {
                    return never.Task;
                }

                lock (received)
                {
                    received.Add(number);
                    if (received.Count == 40)
                    {
                        all.TrySetResult();
                    }
                }

                return Task.CompletedTask;
            });

            // Events arrive one mutation after the other; the healthy pump keeps up, the stuck one cannot.
            await Task.Delay(2, TestContext.Current.CancellationToken);
        }

        await all.Task.WaitAsync(TimeSpan.FromSeconds(10), TestContext.Current.CancellationToken);

        Assert.True(watch.Elapsed < TimeSpan.FromSeconds(5), $"took {watch.Elapsed}");
        Assert.Equal(Enumerable.Range(0, 40), received);
        Assert.True(stuck.Aborted);
        Assert.False(healthy.Aborted);
        Assert.Equal(1, registry.Count);
        never.TrySetResult();
    }

    [Fact]
    public async Task AbortSession_Logout_ClosesOnlyThatSessionsConnections()
    {
        var registry = new HubConnectionRegistry(new RealtimeOptions(), TimeProvider.System, NullLogger<HubConnectionRegistry>.Instance);
        var mine = new FakeCallerContext("a");
        var other = new FakeCallerContext("b");
        registry.Register(mine, "sid-1");
        registry.Register(other, "sid-2");

        var closed = registry.AbortSession("sid-1");
        registry.Send("a", () => throw new InvalidOperationException("must not be sent"));
        await Task.Delay(50, TestContext.Current.CancellationToken);

        Assert.Equal(1, closed);
        Assert.True(mine.Aborted);
        Assert.False(other.Aborted);
    }

    private sealed class FakeCallerContext(string connectionId) : HubCallerContext
    {
        public bool Aborted { get; private set; }

        public override string ConnectionId { get; } = connectionId;

        public override string? UserIdentifier => null;

        public override System.Security.Claims.ClaimsPrincipal? User => null;

        public override IDictionary<object, object?> Items { get; } = new Dictionary<object, object?>();

        public override Microsoft.AspNetCore.Http.Features.IFeatureCollection Features { get; } = new Microsoft.AspNetCore.Http.Features.FeatureCollection();

        public override CancellationToken ConnectionAborted => CancellationToken.None;

        public override void Abort() => Aborted = true;
    }
}

/// <summary>GAP-05: limits answer 409 <c>limit_reached</c>, floods 429, invalid values 400.</summary>
public sealed class LimitTests(StudioFlowApp app) : IClassFixture<StudioFlowApp>
{
    [Fact]
    public async Task Items_ThirtyThirdByAddOrReplace_IsLimitReached()
    {
        var admin = await app.AdminAsync();
        var asset = await UploadAsync(admin);
        var scene = await admin.Client.PostJsonAsync($"/api/productions/{admin.ProductionId}/scenes", new CreateSceneRequest("Voll", null)).ExpectAsync<SceneDto>(HttpStatusCode.Created);
        var items = Enumerable.Range(0, 32).Select(i => new SceneItemDto($"itm_full{i:D4}", asset.Id, 0, 0, 100, 100, ItemFit.Cover, new CropDto(0, 0, 0, 0), 0, false, 0, false, false, null, new LostBehaviorDto(3000, null))).ToList();
        await admin.Client.PutJsonAsync($"/api/productions/{admin.ProductionId}/scenes/{scene.Id}/items", new ReplaceSceneItemsRequest(items, null)).ExpectAsync(HttpStatusCode.OK);

        var add = await admin.Client.PostJsonAsync($"/api/productions/{admin.ProductionId}/scenes/{scene.Id}/items", new AddSceneItemRequest(asset.Id, null, null, null, null, null, null)).ExpectProblemAsync(HttpStatusCode.Conflict);
        var replace = await admin.Client.PutJsonAsync($"/api/productions/{admin.ProductionId}/scenes/{scene.Id}/items", new ReplaceSceneItemsRequest([.. items, items[0] with { Id = "itm_full9999" }], null)).ExpectProblemAsync(HttpStatusCode.Conflict);

        Assert.Equal((ErrorCodes.LimitReached, ErrorCodes.LimitReached), (add, replace));
    }

    [Fact]
    public async Task Slots_PhoneScreenIsInvalidAndPhoneCameraCannotBeReleased()
    {
        var admin = await app.AdminAsync();
        var phone = app.DeviceClient(await app.PairPhoneAsync(admin));

        Assert.Equal(ErrorCodes.ValidationFailed, await phone.PostJsonAsync("/api/device/slots", new AllocateSlotRequest(SourceKind.Screen)).ExpectProblemAsync(HttpStatusCode.BadRequest));
        Assert.Equal(ErrorCodes.LimitReached, await phone.PostJsonAsync("/api/device/slots", new AllocateSlotRequest(SourceKind.Camera)).ExpectProblemAsync(HttpStatusCode.Conflict));
        Assert.Equal(ErrorCodes.Conflict, await phone.DeleteAsync("/api/device/slots/camera", TestContext.Current.CancellationToken).ExpectProblemAsync(HttpStatusCode.Conflict));
    }

    private static async Task<AssetDto> UploadAsync(AdminSession admin)
    {
        using var form = new MultipartFormDataContent();
        var file = new ByteArrayContent(MediaSamples.Png(4, 4));
        file.Headers.ContentType = new MediaTypeHeaderValue("image/png");
        form.Add(file, "file", "bild.png");
        return await admin.Client.PostAsync($"/api/productions/{admin.ProductionId}/assets", form, TestContext.Current.CancellationToken).ExpectAsync<AssetDto>(HttpStatusCode.Created);
    }
}
