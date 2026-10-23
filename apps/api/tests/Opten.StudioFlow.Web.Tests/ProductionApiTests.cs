using System.Net;
using System.Text.Json;
using Microsoft.IdentityModel.JsonWebTokens;
using Opten.FlowStudio.Core.Contracts;
using Opten.FlowStudio.Web.Tests.Support;

namespace Opten.FlowStudio.Web.Tests;

public sealed class ProductionApiTests(FlowStudioApp app) : IClassFixture<FlowStudioApp>
{
    [Fact]
    public async Task Seed_FirstStart_CreatesActiveWebinarWithThreeScenes()
    {
        var admin = await app.AdminAsync();

        var snapshot = await admin.Client.GetAsync($"/api/productions/{admin.ProductionId}/snapshot", TestContext.Current.CancellationToken).ExpectAsync<ProductionSnapshot>();

        Assert.Equal(("Webinar", "webinar", true, "opten"), (snapshot.Production.Name, snapshot.Production.Slug, snapshot.Production.IsActive, snapshot.Production.TenantId));
        Assert.Equal(["Begrüssung", "Präsentation", "Pause"], snapshot.Scenes.Select(s => s.Name));
        Assert.Equal(snapshot.Scenes[0].Id, snapshot.Production.ProgramSceneId);
        Assert.Equal(BroadcastState.Standby, snapshot.Production.Broadcast);
        Assert.Equal(OutputState.None, snapshot.OutputStatus.State);
        Assert.True(snapshot.Revision > 1_700_000_000_000_000);
    }

    [Fact]
    public async Task Create_NameWithUmlauts_GetsUniqueSlugAndStaysInactive()
    {
        var admin = await app.AdminAsync();

        var first = await admin.Client.PostJsonAsync("/api/productions", new CreateProductionRequest("Kundenanlass Zürich")).ExpectAsync<ProductionDto>(HttpStatusCode.Created);
        var second = await admin.Client.PostJsonAsync("/api/productions", new CreateProductionRequest("Kundenanlass Zürich")).ExpectAsync<ProductionDto>(HttpStatusCode.Created);

        Assert.Equal("kundenanlass-zuerich", first.Slug);
        Assert.Equal("kundenanlass-zuerich-2", second.Slug);
        Assert.False(first.IsActive);
        Assert.Contains(await admin.Client.GetAsync("/api/productions", TestContext.Current.CancellationToken).ExpectAsync<List<ProductionSummaryDto>>(), p => p.Id == second.Id);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public async Task Create_EmptyName_IsValidationFailedWithFieldError(string name)
    {
        var admin = await app.AdminAsync();
        using var response = await admin.Client.PostJsonAsync("/api/productions", new CreateProductionRequest(name));

        await response.ExpectAsync(HttpStatusCode.BadRequest);
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync(TestContext.Current.CancellationToken));
        Assert.Equal(ErrorCodes.ValidationFailed, json.RootElement.GetProperty("code").GetString());
        Assert.True(json.RootElement.GetProperty("errors").TryGetProperty("name", out _));
    }

    [Fact]
    public async Task UnknownProduction_EveryScopedRoute_IsNotFound()
    {
        var admin = await app.AdminAsync();
        var client = admin.Client;
        const string id = "prd_doesnotexist00";

        await client.GetAsync($"/api/productions/{id}/snapshot", TestContext.Current.CancellationToken).ExpectProblemAsync(HttpStatusCode.NotFound);
        await client.GetAsync($"/api/productions/{id}/changes?since=1", TestContext.Current.CancellationToken).ExpectProblemAsync(HttpStatusCode.NotFound);
        await client.PostAsync($"/api/productions/{id}/broadcast/start", null, TestContext.Current.CancellationToken).ExpectProblemAsync(HttpStatusCode.NotFound);
        await client.PostAsync($"/api/productions/{id}/activate", null, TestContext.Current.CancellationToken).ExpectProblemAsync(HttpStatusCode.NotFound);
        await client.PostAsync($"/api/productions/{id}/livekit-token", null, TestContext.Current.CancellationToken).ExpectProblemAsync(HttpStatusCode.NotFound);
        await client.GetAsync($"/api/productions/{id}/telemetry", TestContext.Current.CancellationToken).ExpectProblemAsync(HttpStatusCode.NotFound);
        await client.GetAsync($"/api/productions/{id}/assets", TestContext.Current.CancellationToken).ExpectProblemAsync(HttpStatusCode.NotFound);
        await client.GetAsync($"/api/productions/{id}/output", TestContext.Current.CancellationToken).ExpectProblemAsync(HttpStatusCode.NotFound);
        await client.GetAsync($"/api/productions/{id}/pairing/phone-invite", TestContext.Current.CancellationToken).ExpectProblemAsync(HttpStatusCode.NotFound);
        await client.PostJsonAsync($"/api/productions/{id}/scenes", new CreateSceneRequest("X", null)).ExpectProblemAsync(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task Broadcast_StartEndReset_FollowsTheStateMachine()
    {
        var admin = await app.AdminAsync();
        var production = await CreateAsync(admin);
        var url = $"/api/productions/{production.Id}/broadcast";

        Assert.Equal(ErrorCodes.Conflict, await admin.Client.PostAsync($"{url}/end", null, TestContext.Current.CancellationToken).ExpectProblemAsync(HttpStatusCode.Conflict));
        var live = await admin.Client.PostAsync($"{url}/start", null, TestContext.Current.CancellationToken).ExpectAsync<ProductionDto>();
        var again = await admin.Client.PostAsync($"{url}/start", null, TestContext.Current.CancellationToken).ExpectAsync<ProductionDto>();
        var ended = await admin.Client.PostAsync($"{url}/end", null, TestContext.Current.CancellationToken).ExpectAsync<ProductionDto>();
        var reset = await admin.Client.PostAsync($"{url}/reset", null, TestContext.Current.CancellationToken).ExpectAsync<ProductionDto>();

        Assert.Equal(BroadcastState.Live, live.Broadcast);
        Assert.NotNull(live.LiveSince);
        Assert.Equal(live.LiveSince, again.LiveSince);
        Assert.Equal(BroadcastState.Ended, ended.Broadcast);
        Assert.NotNull(ended.EndedAt);
        Assert.Equal((BroadcastState.Standby, (DateTimeOffset?)null), (reset.Broadcast, reset.LiveSince));
    }

    [Fact]
    public async Task Program_FadeRunning_IsTransitionRunningAndCutAfterwardsWorks()
    {
        var admin = await app.AdminAsync();
        var production = await CreateAsync(admin);
        var scenes = await ScenesAsync(admin, production.Id);
        var url = $"/api/productions/{production.Id}/program";

        var switched = await admin.Client.PostJsonAsync(url, new SwitchProgramRequest(scenes[1].Id, new TransitionDto(TransitionKind.Fade, 2000))).ExpectAsync<ProductionDto>();
        var code = await admin.Client.PostJsonAsync(url, new SwitchProgramRequest(scenes[2].Id, new TransitionDto(TransitionKind.Cut, 0))).ExpectProblemAsync(HttpStatusCode.Conflict);
        var same = await admin.Client.PostJsonAsync(url, new SwitchProgramRequest(scenes[1].Id, new TransitionDto(TransitionKind.Cut, 0))).ExpectAsync<ProductionDto>();

        Assert.Equal(scenes[1].Id, switched.ProgramSceneId);
        Assert.Equal(new TransitionDto(TransitionKind.Fade, 2000), switched.LastTransition);
        Assert.Equal(ErrorCodes.TransitionRunning, code);
        Assert.Equal(switched.LastSwitchAt, same.LastSwitchAt);
    }

    [Fact]
    public async Task Program_InvalidTransitionOrScene_IsRejected()
    {
        var admin = await app.AdminAsync();
        var production = await CreateAsync(admin);
        var scenes = await ScenesAsync(admin, production.Id);
        var url = $"/api/productions/{production.Id}/program";

        await admin.Client.PostJsonAsync(url, new SwitchProgramRequest(scenes[1].Id, new TransitionDto(TransitionKind.Fade, 123))).ExpectProblemAsync(HttpStatusCode.BadRequest);
        await admin.Client.PostJsonAsync(url, new SwitchProgramRequest("scn_none", new TransitionDto(TransitionKind.Cut, 0))).ExpectProblemAsync(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task PreviewAndTake_StudioMode_SwapsScenes()
    {
        var admin = await app.AdminAsync();
        var production = await CreateAsync(admin);
        var scenes = await ScenesAsync(admin, production.Id);
        var baseUrl = $"/api/productions/{production.Id}";

        Assert.Equal(ErrorCodes.Conflict, await admin.Client.PostJsonAsync($"{baseUrl}/take", new TakeRequest(new TransitionDto(TransitionKind.Cut, 0))).ExpectProblemAsync(HttpStatusCode.Conflict));
        await admin.Client.PutJsonAsync($"{baseUrl}/preview", new SetPreviewRequest("scn_none")).ExpectProblemAsync(HttpStatusCode.NotFound);
        await admin.Client.PutJsonAsync($"{baseUrl}/preview", new SetPreviewRequest(scenes[2].Id)).ExpectAsync<ProductionDto>();
        var taken = await admin.Client.PostJsonAsync($"{baseUrl}/take", new TakeRequest(new TransitionDto(TransitionKind.Fade, 200))).ExpectAsync<ProductionDto>();
        var cleared = await admin.Client.PutJsonAsync($"{baseUrl}/preview", new SetPreviewRequest(null)).ExpectAsync<ProductionDto>();

        Assert.Equal((scenes[2].Id, scenes[0].Id), (taken.ProgramSceneId, taken.PreviewSceneId));
        Assert.Null(cleared.PreviewSceneId);
    }

    [Fact]
    public async Task Changes_SinceRevision_ReturnsDeltaThenSnapshotForUnknownRevision()
    {
        var admin = await app.AdminAsync();
        var production = await CreateAsync(admin);
        var snapshot = await admin.Client.GetAsync($"/api/productions/{production.Id}/snapshot", TestContext.Current.CancellationToken).ExpectAsync<ProductionSnapshot>();
        await admin.Client.PostAsync($"/api/productions/{production.Id}/broadcast/start", null, TestContext.Current.CancellationToken).ExpectAsync(HttpStatusCode.OK);

        var delta = await admin.Client.GetAsync($"/api/productions/{production.Id}/changes?since={snapshot.Revision}", TestContext.Current.CancellationToken).ExpectAsync<ProductionChangesDto>();
        var none = await admin.Client.GetAsync($"/api/productions/{production.Id}/changes?since={delta.Revision}", TestContext.Current.CancellationToken).ExpectAsync<ProductionChangesDto>();
        var full = await admin.Client.GetAsync($"/api/productions/{production.Id}/changes?since=5", TestContext.Current.CancellationToken).ExpectAsync<ProductionChangesDto>();

        Assert.Null(delta.Snapshot);
        Assert.Contains(delta.Events!, e => e is ProductionChangedEvent { Production.Broadcast: BroadcastState.Live });
        Assert.Contains(delta.Events!, e => e is LogAppendedEvent { Entry.Text: "Sendung gestartet" });
        Assert.Equal(Enumerable.Range(1, delta.Events!.Count).Select(i => snapshot.Revision + i), delta.Events.Select(e => e.Revision));
        Assert.Empty(none.Events!);
        Assert.NotNull(full.Snapshot);
        Assert.Contains(full.Snapshot.RecentLog, l => l.Text == "Sendung gestartet");
        await admin.Client.GetAsync($"/api/productions/{production.Id}/changes", TestContext.Current.CancellationToken).ExpectAsync(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task Update_NameAndSlates_ValidatesAndPersists()
    {
        var admin = await app.AdminAsync();
        var production = await CreateAsync(admin);
        var url = $"/api/productions/{production.Id}";

        var updated = await admin.Client.PatchJsonAsync(url, new UpdateProductionRequest("Neuer Name", new SlateDto("Gleich", "Untertitel", null), null)).ExpectAsync<ProductionDto>();
        await admin.Client.PatchJsonAsync(url, new UpdateProductionRequest(null, new SlateDto("", null, null), null)).ExpectProblemAsync(HttpStatusCode.BadRequest);
        await admin.Client.PatchJsonAsync(url, new UpdateProductionRequest(null, null, new SlateDto("Ende", null, "ast_missing00"))).ExpectProblemAsync(HttpStatusCode.BadRequest);
        var snapshot = await admin.Client.GetAsync($"{url}/snapshot", TestContext.Current.CancellationToken).ExpectAsync<ProductionSnapshot>();

        Assert.Equal("Neuer Name", updated.Name);
        Assert.Equal(new SlateDto("Gleich", "Untertitel", null), snapshot.Production.StandbySlate);
        Assert.Equal(production.Slug, snapshot.Production.Slug);
    }

    [Fact]
    public async Task Activate_OtherProduction_MovesTheActiveFlag()
    {
        var admin = await app.AdminAsync();
        var production = await CreateAsync(admin);

        var activated = await admin.Client.PostAsync($"/api/productions/{production.Id}/activate", null, TestContext.Current.CancellationToken).ExpectAsync<ProductionDto>();
        var active = await admin.Client.GetAsync("/api/productions/active", TestContext.Current.CancellationToken).ExpectAsync<ProductionSummaryDto>();
        var list = await admin.Client.GetAsync("/api/productions", TestContext.Current.CancellationToken).ExpectAsync<List<ProductionSummaryDto>>();
        await admin.Client.PostAsync($"/api/productions/{admin.ProductionId}/activate", null, TestContext.Current.CancellationToken).ExpectAsync(HttpStatusCode.OK);
        var again = await admin.Client.PostAsync($"/api/productions/{admin.ProductionId}/activate", null, TestContext.Current.CancellationToken).ExpectAsync<ProductionDto>();

        Assert.True(activated.IsActive);
        Assert.Equal(production.Id, active.Id);
        Assert.Single(list, p => p.IsActive);
        Assert.True(again.IsActive);
    }

    [Fact]
    public async Task StudioToken_ForProduction_IsHiddenViewer()
    {
        var admin = await app.AdminAsync();

        var token = await admin.Client.PostAsync($"/api/productions/{admin.ProductionId}/livekit-token", null, TestContext.Current.CancellationToken).ExpectAsync<LiveKitTokenDto>();
        var jwt = new JsonWebToken(token.Token);

        Assert.StartsWith("studio_", token.Identity, StringComparison.Ordinal);
        Assert.Equal(admin.ProductionId, token.Room);
        Assert.Equal("wss://fs.test", token.Url);
        Assert.Equal(FlowStudioApp.LiveKitKey, jwt.Issuer);
        Assert.Contains("\"hidden\":true", jwt.GetPayloadValue<JsonElement>("video").GetRawText(), StringComparison.Ordinal);
        Assert.True(token.ExpiresAt > DateTimeOffset.UtcNow.AddMinutes(9));
    }

    [Fact]
    public async Task AcknowledgeIncident_Unknown_IsNotFound()
    {
        var admin = await app.AdminAsync();

        await admin.Client.PostAsync($"/api/productions/{admin.ProductionId}/incidents/inc_nothing/ack", null, TestContext.Current.CancellationToken).ExpectProblemAsync(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task Telemetry_AfterDeviceReport_ListsLatestValues()
    {
        var admin = await app.AdminAsync();
        var credentials = await app.PairPhoneAsync(admin);
        await app.DeviceClient(credentials).PostJsonAsync("/api/device/report", new DeviceReportDto(RtcState.Connected, [new SlotTelemetryDto("camera", SlotState.Live, 1280, 720, 30, 2400, 0.1, "h264")], 77, true, "wifi", 25, null)).ExpectAsync(HttpStatusCode.NoContent);

        var telemetry = await admin.Client.GetAsync($"/api/productions/{admin.ProductionId}/telemetry", TestContext.Current.CancellationToken).ExpectAsync<List<DeviceTelemetryMessage>>();

        var message = Assert.Single(telemetry, t => t.DeviceId == credentials.DeviceId);
        Assert.Equal((77, true, "wifi"), (message.Telemetry.BatteryPct!.Value, message.Telemetry.Charging!.Value, message.Telemetry.Network));
    }

    private static Task<ProductionDto> CreateAsync(AdminSession admin) =>
        admin.Client.PostJsonAsync("/api/productions", new CreateProductionRequest("Test " + Guid.NewGuid().ToString("N")[..8])).ExpectAsync<ProductionDto>(HttpStatusCode.Created);

    private static async Task<IReadOnlyList<SceneDto>> ScenesAsync(AdminSession admin, string productionId) =>
        (await admin.Client.GetAsync($"/api/productions/{productionId}/snapshot").ExpectAsync<ProductionSnapshot>()).Scenes;
}
