using System.Net;
using System.Text.Json;
using Microsoft.AspNetCore.Http.Connections;
using Microsoft.AspNetCore.SignalR;
using Microsoft.AspNetCore.SignalR.Client;
using Opten.StudioFlow.Core.Contracts;
using Opten.StudioFlow.Web.Tests.Support;

namespace Opten.StudioFlow.Web.Tests;

public sealed class StudioHubTests(StudioFlowApp app) : IClassFixture<StudioFlowApp>
{
    [Fact]
    public async Task Subscribe_WithoutRevision_ReturnsSnapshotThenOrderedEvents()
    {
        var admin = await app.AdminAsync();
        await using var hub = Studio(admin);
        var events = HubProbe.On<ProductionEvent>(hub, HubMethods.Event);
        await hub.StartAsync(TestContext.Current.CancellationToken);

        var changes = await hub.InvokeAsync<ProductionChangesDto>(HubMethods.Subscribe, admin.ProductionId, null, TestContext.Current.CancellationToken);
        await admin.Client.PostAsync($"/api/productions/{admin.ProductionId}/broadcast/start", null, TestContext.Current.CancellationToken).ExpectAsync(HttpStatusCode.OK);
        var first = await events.NextAsync();
        var second = await events.NextAsync();
        await admin.Client.PostAsync($"/api/productions/{admin.ProductionId}/broadcast/reset", null, TestContext.Current.CancellationToken).ExpectAsync(HttpStatusCode.OK);

        Assert.Null(changes.Events);
        Assert.NotNull(changes.Snapshot);
        Assert.Equal(changes.Revision + 1, first.Revision);
        Assert.Equal(changes.Revision + 2, second.Revision);
        Assert.IsType<ProductionChangedEvent>(first);
        Assert.Equal("Broadcast started", Assert.IsType<LogAppendedEvent>(second).Entry.Text);
    }

    [Fact]
    public async Task Event_OnTheWire_CarriesTypeDiscriminatorAndCamelCaseEnums()
    {
        var admin = await app.AdminAsync();
        await using var hub = Studio(admin);
        var raw = HubProbe.On<JsonElement>(hub, HubMethods.Event);
        await hub.StartAsync(TestContext.Current.CancellationToken);
        await hub.InvokeAsync<ProductionChangesDto>(HubMethods.Subscribe, admin.ProductionId, null, TestContext.Current.CancellationToken);

        await admin.Client.PostAsync($"/api/productions/{admin.ProductionId}/broadcast/start", null, TestContext.Current.CancellationToken).ExpectAsync(HttpStatusCode.OK);
        var message = await raw.NextAsync(m => m.GetProperty("type").GetString() == "productionChanged");
        await admin.Client.PostAsync($"/api/productions/{admin.ProductionId}/broadcast/reset", null, TestContext.Current.CancellationToken).ExpectAsync(HttpStatusCode.OK);

        Assert.Equal("live", message.GetProperty("production").GetProperty("broadcast").GetString());
        Assert.True(message.GetProperty("revision").ValueKind == JsonValueKind.Number);
    }

    [Fact]
    public async Task Subscribe_KnownRevision_ReturnsDeltaAndUnknownRevisionSnapshot()
    {
        var admin = await app.AdminAsync();
        await using var hub = Studio(admin);
        await hub.StartAsync(TestContext.Current.CancellationToken);
        var start = await hub.InvokeAsync<ProductionChangesDto>(HubMethods.Subscribe, admin.ProductionId, null, TestContext.Current.CancellationToken);
        await admin.Client.PostJsonAsync($"/api/productions/{admin.ProductionId}/scenes", new CreateSceneRequest("Delta", null)).ExpectAsync(HttpStatusCode.Created);

        var delta = await hub.InvokeAsync<ProductionChangesDto>(HubMethods.Subscribe, admin.ProductionId, start.Revision, TestContext.Current.CancellationToken);
        var gap = await hub.InvokeAsync<ProductionChangesDto>(HubMethods.Subscribe, admin.ProductionId, 42L, TestContext.Current.CancellationToken);

        Assert.Null(delta.Snapshot);
        Assert.Contains(delta.Events!, e => e is SceneUpsertedEvent { Scene.Name: "Delta" });
        Assert.NotNull(gap.Snapshot);
        Assert.Equal(delta.Revision, gap.Revision);
    }

    [Fact]
    public async Task Subscribe_UnknownProduction_IsHubErrorWithCode()
    {
        var admin = await app.AdminAsync();
        await using var hub = Studio(admin);
        await hub.StartAsync(TestContext.Current.CancellationToken);

        var error = await Assert.ThrowsAsync<HubException>(() => hub.InvokeAsync<ProductionChangesDto>(HubMethods.Subscribe, "prd_unknown00000", null, TestContext.Current.CancellationToken));

        Assert.Contains($"{ErrorCodes.NotFound}: ", error.Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Presence_SecondSession_IsCountedAndLeavingIsAnnounced()
    {
        var admin = await app.AdminAsync();
        var production = await admin.Client.PostJsonAsync("/api/productions", new CreateProductionRequest("Presence")).ExpectAsync<ProductionDto>(HttpStatusCode.Created);
        await using var first = Studio(admin);
        var presence = HubProbe.On<int>(first, HubMethods.Presence);
        await first.StartAsync(TestContext.Current.CancellationToken);
        await first.InvokeAsync<ProductionChangesDto>(HubMethods.Subscribe, production.Id, null, TestContext.Current.CancellationToken);
        Assert.Equal(1, await presence.NextAsync());

        var second = Studio(admin);
        await second.StartAsync(TestContext.Current.CancellationToken);
        var snapshot = await second.InvokeAsync<ProductionChangesDto>(HubMethods.Subscribe, production.Id, null, TestContext.Current.CancellationToken);
        Assert.Equal(2, await presence.NextAsync());
        await second.DisposeAsync();

        Assert.Equal(2, snapshot.Snapshot!.OperatorsOnline);
        Assert.Equal(1, await presence.NextAsync());
    }

    [Fact]
    public async Task Activate_OtherProduction_SendsResyncToEveryRegie()
    {
        var admin = await app.AdminAsync();
        var production = await admin.Client.PostJsonAsync("/api/productions", new CreateProductionRequest("Resync")).ExpectAsync<ProductionDto>(HttpStatusCode.Created);
        await using var hub = Studio(admin);
        var resync = HubProbe.On<string>(hub, HubMethods.Resync);
        await hub.StartAsync(TestContext.Current.CancellationToken);

        await admin.Client.PostAsync($"/api/productions/{production.Id}/activate", null, TestContext.Current.CancellationToken).ExpectAsync(HttpStatusCode.OK);
        var target = await resync.NextAsync();
        await admin.Client.PostAsync($"/api/productions/{admin.ProductionId}/activate", null, TestContext.Current.CancellationToken).ExpectAsync(HttpStatusCode.OK);

        Assert.Equal(production.Id, target);
    }

    [Fact]
    public async Task Telemetry_DeviceReport_IsRelayedToTheRegie()
    {
        var admin = await app.AdminAsync();
        var credentials = await app.PairPhoneAsync(admin);
        await using var hub = Studio(admin);
        var telemetry = HubProbe.On<DeviceTelemetryMessage>(hub, HubMethods.Telemetry);
        await hub.StartAsync(TestContext.Current.CancellationToken);
        await hub.InvokeAsync<ProductionChangesDto>(HubMethods.Subscribe, admin.ProductionId, null, TestContext.Current.CancellationToken);

        await app.DeviceClient(credentials).PostJsonAsync("/api/device/report", new DeviceReportDto(RtcState.Connected, [new SlotTelemetryDto("camera", SlotState.Live, 1920, 1080, 30, 4000, 0, "h264")], 50, null, "4g", 40, null)).ExpectAsync(HttpStatusCode.NoContent);
        var message = await telemetry.NextAsync(m => m.DeviceId == credentials.DeviceId);

        Assert.Equal((RtcState.Connected, 50, "4g"), (message.Telemetry.Rtc, message.Telemetry.BatteryPct!.Value, message.Telemetry.Network));
        Assert.Equal(1920, message.Telemetry.Slots[0].Width);
    }

    [Fact]
    public async Task StudioHub_WithoutSession_IsRejected()
    {
        await using var hub = app.Hub(HubMethods.StudioHubPath);

        var error = await Assert.ThrowsAsync<HttpRequestException>(() => hub.StartAsync(TestContext.Current.CancellationToken));

        Assert.Equal(HttpStatusCode.Unauthorized, error.StatusCode);
    }

    private HubConnection Studio(AdminSession admin) => app.Hub(HubMethods.StudioHubPath, o => o.Headers["Cookie"] = admin.Cookie);
}

public sealed class DeviceHubTests(StudioFlowApp app) : IClassFixture<StudioFlowApp>
{
    [Fact]
    public async Task Hello_ThenTake_PushesPreviewAndProgramTally()
    {
        var admin = await app.AdminAsync();
        var credentials = await app.PairPhoneAsync(admin);
        var scenes = (await admin.Client.GetAsync($"/api/productions/{admin.ProductionId}/snapshot", TestContext.Current.CancellationToken).ExpectAsync<ProductionSnapshot>()).Scenes;
        await admin.Client.PostJsonAsync($"/api/productions/{admin.ProductionId}/scenes/{scenes[1].Id}/items", new AddSceneItemRequest($"{credentials.DeviceId}/camera", null, null, null, null, null, null)).ExpectAsync(HttpStatusCode.OK);
        await using var hub = Device(credentials);
        var tally = HubProbe.On<TallyDto>(hub, HubMethods.Tally);
        await hub.StartAsync(TestContext.Current.CancellationToken);

        var session = await hub.InvokeAsync<DeviceSessionDto>(HubMethods.Hello, new DeviceHelloDto("tab-1", "Android · Chrome", "1.0.0"), TestContext.Current.CancellationToken);
        await admin.Client.PostAsync($"/api/productions/{admin.ProductionId}/broadcast/start", null, TestContext.Current.CancellationToken).ExpectAsync(HttpStatusCode.OK);
        await admin.Client.PutJsonAsync($"/api/productions/{admin.ProductionId}/preview", new SetPreviewRequest(scenes[1].Id)).ExpectAsync(HttpStatusCode.OK);
        var preview = await tally.NextAsync();
        await admin.Client.PostJsonAsync($"/api/productions/{admin.ProductionId}/take", new TakeRequest(new TransitionDto(TransitionKind.Cut, 0))).ExpectAsync(HttpStatusCode.OK);
        var program = await tally.NextAsync();
        await admin.Client.PostAsync($"/api/productions/{admin.ProductionId}/broadcast/end", null, TestContext.Current.CancellationToken).ExpectAsync(HttpStatusCode.OK);
        var off = await tally.NextAsync();
        await admin.Client.PostJsonAsync($"/api/productions/{admin.ProductionId}/take", new TakeRequest(new TransitionDto(TransitionKind.Cut, 0))).ExpectAsync(HttpStatusCode.OK);
        await admin.Client.PostAsync($"/api/productions/{admin.ProductionId}/broadcast/reset", null, TestContext.Current.CancellationToken).ExpectAsync(HttpStatusCode.OK);

        Assert.Equal(TallyState.Off, session.Tally.Overall);
        Assert.Equal(credentials.DeviceId, session.Device.Id);
        Assert.Equal(TallyState.Preview, preview.Overall);
        Assert.Equal(TallyState.Program, program.Slots["camera"]);
        Assert.Equal(TallyState.Off, off.Overall);
    }

    [Fact]
    public async Task Hello_FromSecondTab_OldTabGetsSessionReplacedAndIsClosed()
    {
        var admin = await app.AdminAsync();
        var credentials = await app.PairPhoneAsync(admin);
        await using var oldTab = Device(credentials);
        var replaced = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        oldTab.On(HubMethods.SessionReplaced, () => replaced.TrySetResult());
        var oldClosed = HubClosed.Watch(oldTab);
        await oldTab.StartAsync(TestContext.Current.CancellationToken);
        await oldTab.InvokeAsync<DeviceSessionDto>(HubMethods.Hello, new DeviceHelloDto("tab-old", "x", "1"), TestContext.Current.CancellationToken);

        await using var newTab = Device(credentials);
        await newTab.StartAsync(TestContext.Current.CancellationToken);
        await newTab.InvokeAsync<DeviceSessionDto>(HubMethods.Hello, new DeviceHelloDto("tab-new", "x", "1"), TestContext.Current.CancellationToken);

        await replaced.Task.WaitAsync(TimeSpan.FromSeconds(10), TestContext.Current.CancellationToken);
        await oldClosed.WaitAsync(TimeSpan.FromSeconds(15), TestContext.Current.CancellationToken);
        Assert.Equal(HubConnectionState.Connected, newTab.State);
        await newTab.InvokeAsync(HubMethods.Report, new DeviceReportDto(RtcState.Connected, [], null, null, null, null, null), TestContext.Current.CancellationToken);
    }

    [Fact]
    public async Task Command_And_Rename_AreDeliveredToTheConnectedDevice()
    {
        var admin = await app.AdminAsync();
        var credentials = await app.PairLaptopAsync(admin, "Laptop Mia");
        await using var hub = Device(credentials);
        var commands = HubProbe.On<DeviceCommandDto>(hub, HubMethods.Command);
        var selves = HubProbe.On<DeviceSelfDto>(hub, HubMethods.Self);
        await hub.StartAsync(TestContext.Current.CancellationToken);
        await hub.InvokeAsync<DeviceSessionDto>(HubMethods.Hello, new DeviceHelloDto("tab", "Windows", "1"), TestContext.Current.CancellationToken);

        var sent = await admin.Client.PostJsonAsync($"/api/productions/{admin.ProductionId}/devices/{credentials.DeviceId}/commands", new DeviceCommandRequest(DeviceCommandKind.Reshare, "screen-1", null)).ExpectAsync<DeviceCommandDto>(HttpStatusCode.Accepted);
        var received = await commands.NextAsync();
        await admin.Client.PatchJsonAsync($"/api/productions/{admin.ProductionId}/devices/{credentials.DeviceId}", new RenameDeviceRequest("Laptop Lea")).ExpectAsync(HttpStatusCode.OK);
        var self = await selves.NextAsync();

        Assert.Equal(sent, received);
        Assert.Equal("Laptop Lea", self.Name);
    }

    [Fact]
    public async Task Block_ConnectedDevice_GetsFinalSelfAndCannotReconnect()
    {
        var admin = await app.AdminAsync();
        var credentials = await app.PairPhoneAsync(admin);
        await using var hub = Device(credentials);
        var selves = HubProbe.On<DeviceSelfDto>(hub, HubMethods.Self);
        var closed = HubClosed.Watch(hub);
        await hub.StartAsync(TestContext.Current.CancellationToken);
        await hub.InvokeAsync<DeviceSessionDto>(HubMethods.Hello, new DeviceHelloDto("tab", "x", "1"), TestContext.Current.CancellationToken);

        await admin.Client.PostAsync($"/api/productions/{admin.ProductionId}/devices/{credentials.DeviceId}/block", null, TestContext.Current.CancellationToken).ExpectAsync(HttpStatusCode.OK);
        var self = await selves.NextAsync();
        await closed.WaitAsync(TimeSpan.FromSeconds(15), TestContext.Current.CancellationToken);
        await using var retry = Device(credentials);
        var error = await Assert.ThrowsAsync<HttpRequestException>(() => retry.StartAsync(TestContext.Current.CancellationToken));

        Assert.Equal(DeviceState.Blocked, self.State);
        Assert.Equal(HttpStatusCode.Forbidden, error.StatusCode);
    }

    [Fact]
    public async Task Report_LiveThenDisconnect_OpensIncidentAndReconnectRecovers()
    {
        var admin = await app.AdminAsync();
        var credentials = await app.PairPhoneAsync(admin);
        await using var studio = app.Hub(HubMethods.StudioHubPath, o => o.Headers["Cookie"] = admin.Cookie);
        var events = HubProbe.On<ProductionEvent>(studio, HubMethods.Event);
        await studio.StartAsync(TestContext.Current.CancellationToken);
        await studio.InvokeAsync<ProductionChangesDto>(HubMethods.Subscribe, admin.ProductionId, null, TestContext.Current.CancellationToken);
        var sourceId = $"{credentials.DeviceId}/camera";

        var first = Device(credentials);
        await first.StartAsync(TestContext.Current.CancellationToken);
        await first.InvokeAsync<DeviceSessionDto>(HubMethods.Hello, new DeviceHelloDto("tab", "x", "1"), TestContext.Current.CancellationToken);
        await first.InvokeAsync(HubMethods.Report, ServiceReport(SlotState.Live), TestContext.Current.CancellationToken);
        var live = (SourceUpsertedEvent)await events.NextAsync(e => e is SourceUpsertedEvent { Source.Status: SourceStatus.Ok } s && s.Source.Id == sourceId);
        await first.DisposeAsync();
        var incident = (IncidentUpsertedEvent)await events.NextAsync(e => e is IncidentUpsertedEvent i && i.Incident.SourceId == sourceId);
        // The code depends on the phones that other tests of this class paired in the same production (K1, K2, ...).
        await events.NextAsync(e => e is LogAppendedEvent l && l.Entry.Text == $"{live.Source.Code} reconnecting");

        await using var second = Device(credentials);
        await second.StartAsync(TestContext.Current.CancellationToken);
        await second.InvokeAsync<DeviceSessionDto>(HubMethods.Hello, new DeviceHelloDto("tab", "x", "1"), TestContext.Current.CancellationToken);
        await second.InvokeAsync(HubMethods.Report, ServiceReport(SlotState.Live), TestContext.Current.CancellationToken);
        var recovered = (IncidentUpsertedEvent)await events.NextAsync(e => e is IncidentUpsertedEvent i && i.Incident.EndedAt is not null);
        await admin.Client.PostAsync($"/api/productions/{admin.ProductionId}/incidents/{incident.Incident.Id}/ack", null, TestContext.Current.CancellationToken).ExpectAsync(HttpStatusCode.NoContent);
        await events.NextAsync(e => e is IncidentRemovedEvent r && r.IncidentId == incident.Incident.Id);

        Assert.Equal(IncidentKind.Reconnecting, incident.Incident.Kind);
        Assert.Equal(incident.Incident.Id, recovered.Incident.Id);
    }

    [Fact]
    public async Task Webhook_TrackPublished_TurnsConnectedSourceOk()
    {
        var admin = await app.AdminAsync();
        var credentials = await app.PairPhoneAsync(admin);
        await using var hub = Device(credentials);
        await hub.StartAsync(TestContext.Current.CancellationToken);
        await hub.InvokeAsync<DeviceSessionDto>(HubMethods.Hello, new DeviceHelloDto("tab", "x", "1"), TestContext.Current.CancellationToken);
        var body = Webhooks.Track("track_published", admin.ProductionId, "PA_x", credentials.DeviceId, "camera");

        await app.Anonymous().SendAsync(Webhooks.Request(body, Webhooks.Sign(body)), TestContext.Current.CancellationToken).ExpectAsync(HttpStatusCode.OK);
        var snapshot = await admin.Client.GetAsync($"/api/productions/{admin.ProductionId}/snapshot", TestContext.Current.CancellationToken).ExpectAsync<ProductionSnapshot>();

        Assert.Equal(SourceStatus.Ok, snapshot.Sources.Single(s => s.DeviceId == credentials.DeviceId).Status);
        Assert.Equal(DeviceConnection.Online, snapshot.Devices.Single(d => d.Id == credentials.DeviceId).Connection);
    }

    [Fact]
    public async Task DeviceHub_WebSocketWithQueryToken_Connects()
    {
        var admin = await app.AdminAsync();
        var credentials = await app.PairPhoneAsync(admin);
        var token = $"{credentials.DeviceId}.{credentials.DeviceSecret}";
        await using var hub = app.Hub(HubMethods.DeviceHubPath, o =>
        {
            o.Transports = HttpTransportType.WebSockets;
            o.SkipNegotiation = true;
            o.WebSocketFactory = async (context, cancellationToken) =>
            {
                var uri = new UriBuilder(context.Uri) { Query = $"{context.Uri.Query.TrimStart('?')}&access_token={Uri.EscapeDataString(token)}" }.Uri;
                return await app.Server.CreateWebSocketClient().ConnectAsync(uri, cancellationToken);
            };
        });

        await hub.StartAsync(TestContext.Current.CancellationToken);
        var session = await hub.InvokeAsync<DeviceSessionDto>(HubMethods.Hello, new DeviceHelloDto("ws-tab", "x", "1"), TestContext.Current.CancellationToken);

        Assert.Equal(credentials.DeviceId, session.Device.Id);
    }

    [Fact]
    public async Task DeviceHub_UnknownCredential_IsUnauthorized()
    {
        await using var hub = app.Hub(HubMethods.DeviceHubPath, o => o.AccessTokenProvider = () => Task.FromResult<string?>("dev_nobody000000.secret"));

        Assert.Equal(HttpStatusCode.Unauthorized, (await Assert.ThrowsAsync<HttpRequestException>(() => hub.StartAsync(TestContext.Current.CancellationToken))).StatusCode);
    }

    [Fact]
    public async Task Report_BeforeHello_IsIgnored()
    {
        var admin = await app.AdminAsync();
        var credentials = await app.PairPhoneAsync(admin);
        await using var hub = Device(credentials);
        await hub.StartAsync(TestContext.Current.CancellationToken);

        await hub.InvokeAsync(HubMethods.Report, ServiceReport(SlotState.Live), TestContext.Current.CancellationToken);
        var snapshot = await admin.Client.GetAsync($"/api/productions/{admin.ProductionId}/snapshot", TestContext.Current.CancellationToken).ExpectAsync<ProductionSnapshot>();

        Assert.Equal(SourceStatus.Offline, snapshot.Sources.Single(s => s.DeviceId == credentials.DeviceId).Status);
    }

    private static DeviceReportDto ServiceReport(SlotState state) =>
        new(RtcState.Connected, [new SlotTelemetryDto("camera", state, 1280, 720, 30, 2000, 0, "h264")], null, null, null, null, null);

    private HubConnection Device(DeviceCredentialsDto credentials) =>
        app.Hub(HubMethods.DeviceHubPath, o => o.AccessTokenProvider = () => Task.FromResult<string?>($"{credentials.DeviceId}.{credentials.DeviceSecret}"));
}

public sealed class OutputHubTests(StudioFlowApp app) : IClassFixture<StudioFlowApp>
{
    [Fact]
    public async Task SubscribeOutput_PrivateChanges_ArriveAsRevisionOnly()
    {
        var admin = await app.AdminAsync();
        await using var hub = Output(await KeyAsync(admin));
        var events = HubProbe.On<ProductionEvent>(hub, HubMethods.Event);
        await hub.StartAsync(TestContext.Current.CancellationToken);
        var changes = await hub.InvokeAsync<OutputChangesDto>(HubMethods.SubscribeOutput, null, TestContext.Current.CancellationToken);
        events.Clear();

        var invite = await admin.Client.PostJsonAsync($"/api/productions/{admin.ProductionId}/pairing/invites", new CreateInviteRequest(InviteKind.LaptopLink)).ExpectAsync<InviteDto>(HttpStatusCode.Created);
        var hidden = await events.NextAsync();
        await admin.Client.PatchJsonAsync($"/api/productions/{admin.ProductionId}", new UpdateProductionRequest("Sichtbar", null, null)).ExpectAsync(HttpStatusCode.OK);
        var visible = await events.NextAsync(e => e is not RevisionOnlyEvent);

        Assert.NotNull(changes.Snapshot);
        Assert.IsType<RevisionOnlyEvent>(hidden);
        Assert.Equal("Sichtbar", Assert.IsType<ProductionChangedEvent>(visible).Production.Name);
        Assert.True(visible.Revision > hidden.Revision);
        Assert.NotNull(invite);
    }

    [Fact]
    public async Task OutputHub_WrongKey_IsForbidden()
    {
        await using var hub = Output("wrong-key");

        Assert.Equal(HttpStatusCode.Forbidden, (await Assert.ThrowsAsync<HttpRequestException>(() => hub.StartAsync(TestContext.Current.CancellationToken))).StatusCode);
    }

    [Fact]
    public async Task Connect_AndReport_ShowConsumerInOutputStatus()
    {
        var admin = await app.AdminAsync();
        await using var studio = app.Hub(HubMethods.StudioHubPath, o => o.Headers["Cookie"] = admin.Cookie);
        var events = HubProbe.On<ProductionEvent>(studio, HubMethods.Event);
        await studio.StartAsync(TestContext.Current.CancellationToken);
        await studio.InvokeAsync<ProductionChangesDto>(HubMethods.Subscribe, admin.ProductionId, null, TestContext.Current.CancellationToken);

        await using var output = Output(await KeyAsync(admin), "10.99.0.7", "192.168.77.5");
        await output.StartAsync(TestContext.Current.CancellationToken);
        var stale = await events.NextAsync(e => e is OutputStatusChangedEvent { Status.State: OutputState.Stale });
        await output.InvokeAsync(HubMethods.Report, new OutputReport(true, 120, 50, null), TestContext.Current.CancellationToken);
        var connected = await events.NextAsync(e => e is OutputStatusChangedEvent { Status.State: OutputState.Connected });
        await output.StopAsync(TestContext.Current.CancellationToken);
        var gone = await events.NextAsync(e => e is OutputStatusChangedEvent { Status.State: OutputState.None });

        Assert.Equal(["192.168.77.5"], ((OutputStatusChangedEvent)stale).Status.Addresses);
        Assert.Equal(120, ((OutputStatusChangedEvent)connected).Status.LatencyMs);
        Assert.Equal(0, ((OutputStatusChangedEvent)gone).Status.Consumers);
    }

    [Fact]
    public async Task RegenerateKey_ConnectedOutput_IsDisconnectedAndCannotReconnect()
    {
        var admin = await app.AdminAsync();
        var key = await KeyAsync(admin);
        await using var output = Output(key);
        var closed = HubClosed.Watch(output);
        await output.StartAsync(TestContext.Current.CancellationToken);
        await output.InvokeAsync<OutputChangesDto>(HubMethods.SubscribeOutput, null, TestContext.Current.CancellationToken);

        await admin.Client.PostAsync($"/api/productions/{admin.ProductionId}/output/regenerate-key", null, TestContext.Current.CancellationToken).ExpectAsync(HttpStatusCode.OK);
        await closed.WaitAsync(TimeSpan.FromSeconds(15), TestContext.Current.CancellationToken);
        await using var retry = Output(key);

        Assert.Equal(HttpStatusCode.Forbidden, (await Assert.ThrowsAsync<HttpRequestException>(() => retry.StartAsync(TestContext.Current.CancellationToken))).StatusCode);
    }

    private static async Task<string> KeyAsync(AdminSession admin)
    {
        var settings = await admin.Client.GetAsync($"/api/productions/{admin.ProductionId}/output").ExpectAsync<OutputSettingsDto>();
        return settings.Url[(settings.Url.IndexOf("?k=", StringComparison.Ordinal) + 3)..];
    }

    private HubConnection Output(string key, string? proxy = null, string? forwardedFor = null) => app.Hub(HubMethods.OutputHubPath, o =>
    {
        o.AccessTokenProvider = () => Task.FromResult<string?>(key);
        if (proxy is not null)
        {
            o.Headers[TestClientAddress.Header] = proxy;
            o.Headers["X-Forwarded-For"] = forwardedFor!;
        }
    });
}
