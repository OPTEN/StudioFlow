using System.Net;
using System.Text.Json;
using Microsoft.AspNetCore.SignalR.Client;
using Microsoft.EntityFrameworkCore;
using Opten.StudioFlow.Core.Contracts;
using Opten.StudioFlow.Core.Domain;
using Opten.StudioFlow.Infrastructure.Persistence;
using Opten.StudioFlow.Web.Tests.Support;

namespace Opten.StudioFlow.Web.Tests;

/// <summary>Format and resolution of the output canvas (issue #8): create, change, sync, lock while live, audit.</summary>
public sealed class CanvasApiTests(StudioFlowApp app) : IClassFixture<StudioFlowApp>
{
    private static readonly CanvasDto FullHd = new(CanvasFormat.Widescreen, CanvasResolution.P1080, 1920, 1080);

    [Fact]
    public async Task Seed_FirstStart_IsWidescreenAtFullHd()
    {
        var admin = await app.AdminAsync();

        var snapshot = await admin.Client.GetAsync($"/api/productions/{admin.ProductionId}/snapshot", TestContext.Current.CancellationToken).ExpectAsync<ProductionSnapshot>();

        Assert.Equal(FullHd, snapshot.Production.Canvas);
    }

    [Fact]
    public async Task Create_WithoutFormat_IsWidescreenAtFullHd()
    {
        var admin = await app.AdminAsync();

        var created = await CreateAsync(admin);

        Assert.Equal(FullHd, created.Canvas);
    }

    [Theory]
    [InlineData(CanvasFormat.Portrait, CanvasResolution.P1080, 1080, 1920)]
    [InlineData(CanvasFormat.Square, CanvasResolution.P720, 720, 720)]
    [InlineData(CanvasFormat.Standard, CanvasResolution.P1080, 1440, 1080)]
    public async Task Create_WithFormat_StoresFormatResolutionAndSize(CanvasFormat format, CanvasResolution resolution, int width, int height)
    {
        var admin = await app.AdminAsync();

        var created = await admin.Client.PostJsonAsync("/api/productions", new CreateProductionRequest("Reel " + Guid.NewGuid().ToString("N")[..6], format, resolution)).ExpectAsync<ProductionDto>(HttpStatusCode.Created);
        var snapshot = await admin.Client.GetAsync($"/api/productions/{created.Id}/snapshot", TestContext.Current.CancellationToken).ExpectAsync<ProductionSnapshot>();

        Assert.Equal(new CanvasDto(format, resolution, width, height), created.Canvas);
        Assert.Equal(created.Canvas, snapshot.Production.Canvas);
    }

    [Fact]
    public async Task Create_WithOnlyTheFormat_KeepsFullHdAsResolution()
    {
        var admin = await app.AdminAsync();

        var created = await admin.Client.PostJsonAsync("/api/productions", new CreateProductionRequest("Square " + Guid.NewGuid().ToString("N")[..6], CanvasFormat.Square)).ExpectAsync<ProductionDto>(HttpStatusCode.Created);

        Assert.Equal(new CanvasDto(CanvasFormat.Square, CanvasResolution.P1080, 1080, 1080), created.Canvas);
    }

    [Theory]
    [InlineData("""{"name":"Bad","format":"cinemascope"}""", "format")]
    [InlineData("""{"name":"Bad","resolution":"p4320"}""", "resolution")]
    [InlineData("""{"name":"Bad","format":9}""", "format")]
    [InlineData("""{"name":"Bad","resolution":7}""", "resolution")]
    public async Task Create_UnknownFormatOrResolution_IsValidationFailed(string body, string field)
    {
        var admin = await app.AdminAsync();
        using var content = new StringContent(body, System.Text.Encoding.UTF8, "application/json");

        using var response = await admin.Client.PostAsync("/api/productions", content, TestContext.Current.CancellationToken);

        await response.ExpectAsync(HttpStatusCode.BadRequest);
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync(TestContext.Current.CancellationToken));
        Assert.Equal(ErrorCodes.ValidationFailed, json.RootElement.GetProperty("code").GetString());
        Assert.Contains(json.RootElement.GetProperty("errors").EnumerateObject(), e => e.Name.Equals(field, StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public async Task Create_PortraitProduction_AddsItemsInsideItsCanvasWithoutGeometry()
    {
        var admin = await app.AdminAsync();
        var production = await admin.Client.PostJsonAsync("/api/productions", new CreateProductionRequest("Reel " + Guid.NewGuid().ToString("N")[..6], CanvasFormat.Portrait)).ExpectAsync<ProductionDto>(HttpStatusCode.Created);
        var phone = await PairInAsync(admin, production.Id);
        var scene = (await SnapshotAsync(admin, production.Id)).Scenes[1];

        var updated = await admin.Client.PostJsonAsync($"/api/productions/{production.Id}/scenes/{scene.Id}/items", new AddSceneItemRequest($"{phone}/camera", null, null, null, null, null, null)).ExpectAsync<SceneDto>();

        var item = Assert.Single(updated.Items);
        Assert.Equal((698, 1695, 338, 190), (item.X, item.Y, item.W, item.H));
    }

    [Fact]
    public async Task ChangeCanvas_OtherResolution_ScalesTheItemsOfEveryScene()
    {
        var admin = await app.AdminAsync();
        var production = await CreateAsync(admin);
        var phone = await PairInAsync(admin, production.Id);
        var before = await SnapshotAsync(admin, production.Id);
        await PutItemAsync(admin, production.Id, before.Scenes[0].Id, phone, new SceneItemGeometry(300, 150, 900, 450));
        await PutItemAsync(admin, production.Id, before.Scenes[1].Id, phone, new SceneItemGeometry(0, 0, 1920, 1080));
        var withItems = await SnapshotAsync(admin, production.Id);

        var changed = await admin.Client.PutJsonAsync($"/api/productions/{production.Id}/canvas", new ChangeCanvasRequest(CanvasFormat.Widescreen, CanvasResolution.P720)).ExpectAsync<ProductionDto>();
        var after = await SnapshotAsync(admin, production.Id);

        Assert.Equal(new CanvasDto(CanvasFormat.Widescreen, CanvasResolution.P720, 1280, 720), changed.Canvas);
        Assert.Equal(changed.Canvas, after.Production.Canvas);
        Assert.Equal((200, 100, 600, 300), Geometry(after.Scenes[0].Items[0]));
        Assert.Equal((0, 0, 1280, 720), Geometry(after.Scenes[1].Items[0]));
        Assert.Empty(after.Scenes[2].Items);
        Assert.Equal(withItems.Scenes[0].Version + 1, after.Scenes[0].Version);
        Assert.Equal(withItems.Scenes[2].Version, after.Scenes[2].Version);
    }

    [Fact]
    public async Task ChangeCanvas_OtherFormat_FitsTheItemsIntoTheMiddleAndAutoGridStaysAutoGrid()
    {
        var admin = await app.AdminAsync();
        var production = await CreateAsync(admin);
        var phone = await PairInAsync(admin, production.Id);
        var scenes = (await SnapshotAsync(admin, production.Id)).Scenes;
        await PutItemAsync(admin, production.Id, scenes[0].Id, phone, new SceneItemGeometry(0, 0, 1920, 1080));
        await PutItemAsync(admin, production.Id, scenes[1].Id, phone, new SceneItemGeometry(0, 0, 1920, 1080), SceneLayoutMode.AutoGrid);

        await admin.Client.PutJsonAsync($"/api/productions/{production.Id}/canvas", new ChangeCanvasRequest(CanvasFormat.Portrait, CanvasResolution.P1080)).ExpectAsync<ProductionDto>();
        var after = await SnapshotAsync(admin, production.Id);

        Assert.Equal((0, 656, 1080, 608), Geometry(after.Scenes[0].Items[0]));
        Assert.Equal(SceneLayoutMode.AutoGrid, after.Scenes[1].LayoutMode);
    }

    [Fact]
    public async Task ChangeCanvas_SameCanvas_IsANoOpWithoutAnEvent()
    {
        var admin = await app.AdminAsync();
        var production = await CreateAsync(admin);
        var revision = (await SnapshotAsync(admin, production.Id)).Revision;

        var same = await admin.Client.PutJsonAsync($"/api/productions/{production.Id}/canvas", new ChangeCanvasRequest(CanvasFormat.Widescreen, CanvasResolution.P1080)).ExpectAsync<ProductionDto>();

        Assert.Equal(FullHd, same.Canvas);
        Assert.Equal(revision, (await SnapshotAsync(admin, production.Id)).Revision);
    }

    [Fact]
    public async Task ChangeCanvas_WhileLive_IsBroadcastLiveAndChangesNothing()
    {
        var admin = await app.AdminAsync();
        var production = await CreateAsync(admin);
        var phone = await PairInAsync(admin, production.Id);
        var scene = (await SnapshotAsync(admin, production.Id)).Scenes[0];
        await PutItemAsync(admin, production.Id, scene.Id, phone, new SceneItemGeometry(100, 100, 600, 338));
        await admin.Client.PostAsync($"/api/productions/{production.Id}/broadcast/start", null, TestContext.Current.CancellationToken).ExpectAsync(HttpStatusCode.OK);

        var code = await admin.Client.PutJsonAsync($"/api/productions/{production.Id}/canvas", new ChangeCanvasRequest(CanvasFormat.Portrait, CanvasResolution.P1080)).ExpectProblemAsync(HttpStatusCode.Conflict);
        var after = await SnapshotAsync(admin, production.Id);

        Assert.Equal(ErrorCodes.BroadcastLive, code);
        Assert.Equal(FullHd, after.Production.Canvas);
        Assert.Equal((100, 100, 600, 338), Geometry(after.Scenes[0].Items[0]));
    }

    [Fact]
    public async Task ChangeCanvas_AfterTheBroadcastEnded_IsAllowed()
    {
        var admin = await app.AdminAsync();
        var production = await CreateAsync(admin);
        await admin.Client.PostAsync($"/api/productions/{production.Id}/broadcast/start", null, TestContext.Current.CancellationToken).ExpectAsync(HttpStatusCode.OK);
        await admin.Client.PostAsync($"/api/productions/{production.Id}/broadcast/end", null, TestContext.Current.CancellationToken).ExpectAsync(HttpStatusCode.OK);

        var changed = await admin.Client.PutJsonAsync($"/api/productions/{production.Id}/canvas", new ChangeCanvasRequest(CanvasFormat.Square, CanvasResolution.P1080)).ExpectAsync<ProductionDto>();

        Assert.Equal(new CanvasDto(CanvasFormat.Square, CanvasResolution.P1080, 1080, 1080), changed.Canvas);
    }

    [Theory]
    [InlineData("""{"format":"cinemascope","resolution":"p1080"}""")]
    [InlineData("""{"format":"widescreen","resolution":"p4320"}""")]
    [InlineData("""{"format":42,"resolution":"p1080"}""")]
    [InlineData("""{"format":"widescreen"}""")]
    [InlineData("""{}""")]
    public async Task ChangeCanvas_InvalidBody_IsValidationFailedAndChangesNothing(string body)
    {
        var admin = await app.AdminAsync();
        var production = await CreateAsync(admin);
        using var content = new StringContent(body, System.Text.Encoding.UTF8, "application/json");

        using var response = await admin.Client.PutAsync($"/api/productions/{production.Id}/canvas", content, TestContext.Current.CancellationToken);

        await response.ExpectAsync(HttpStatusCode.BadRequest);
        Assert.Equal(FullHd, (await SnapshotAsync(admin, production.Id)).Production.Canvas);
    }

    [Fact]
    public async Task ChangeCanvas_UnknownProduction_IsNotFound()
    {
        var admin = await app.AdminAsync();

        await admin.Client.PutJsonAsync("/api/productions/prd_doesnotexist00/canvas", new ChangeCanvasRequest(CanvasFormat.Square, CanvasResolution.P720)).ExpectProblemAsync(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task ChangeCanvas_WithoutSessionOrCsrfHeader_IsRefused()
    {
        var admin = await app.AdminAsync();
        var production = await CreateAsync(admin);
        var noCsrf = app.Anonymous();
        noCsrf.DefaultRequestHeaders.Add("Cookie", admin.Cookie);

        await app.Anonymous().PutJsonAsync($"/api/productions/{production.Id}/canvas", new ChangeCanvasRequest(CanvasFormat.Square, CanvasResolution.P720)).ExpectProblemAsync(HttpStatusCode.Unauthorized);
        await noCsrf.PutJsonAsync($"/api/productions/{production.Id}/canvas", new ChangeCanvasRequest(CanvasFormat.Square, CanvasResolution.P720)).ExpectProblemAsync(HttpStatusCode.Forbidden);

        Assert.Equal(FullHd, (await SnapshotAsync(admin, production.Id)).Production.Canvas);
    }

    [Fact]
    public async Task ChangeCanvas_WritesOneAuditEntryAndNoRecentEvent()
    {
        var admin = await app.AdminAsync();
        var production = await CreateAsync(admin);

        await admin.Client.PutJsonAsync($"/api/productions/{production.Id}/canvas", new ChangeCanvasRequest(CanvasFormat.Portrait, CanvasResolution.P720)).ExpectAsync<ProductionDto>();
        await using var db = await app.Service<IDbContextFactory<StudioFlowDbContext>>().CreateDbContextAsync(TestContext.Current.CancellationToken);
        var audit = await db.AuditEntries.AsNoTracking().SingleAsync(a => a.ProductionId == production.Id && a.Action == AuditActions.CanvasChanged, TestContext.Current.CancellationToken);

        Assert.Equal("production.canvas.changed", audit.Action);
        Assert.Equal(AuditActors.Admin, audit.Actor);
        Assert.Equal(("1920 × 1080 (16:9)", "720 × 1280 (9:16)"), (audit.Detail(AuditDetails.From), audit.Detail(AuditDetails.To)));
    }

    [Fact]
    public async Task ChangeCanvas_SameCanvas_WritesNoAuditEntry()
    {
        var admin = await app.AdminAsync();
        var production = await CreateAsync(admin);

        await admin.Client.PutJsonAsync($"/api/productions/{production.Id}/canvas", new ChangeCanvasRequest(CanvasFormat.Widescreen, CanvasResolution.P1080)).ExpectAsync<ProductionDto>();
        await using var db = await app.Service<IDbContextFactory<StudioFlowDbContext>>().CreateDbContextAsync(TestContext.Current.CancellationToken);

        Assert.False(await db.AuditEntries.AsNoTracking().AnyAsync(a => a.ProductionId == production.Id && a.Action == AuditActions.CanvasChanged, TestContext.Current.CancellationToken));
    }

    [Fact]
    public async Task ChangeCanvas_StudioHub_ReceivesOneEventWithTheProductionAndTheRescaledScenes()
    {
        var admin = await app.AdminAsync();
        var production = await CreateAsync(admin);
        var phone = await PairInAsync(admin, production.Id);
        var scenes = (await SnapshotAsync(admin, production.Id)).Scenes;
        await PutItemAsync(admin, production.Id, scenes[0].Id, phone, new SceneItemGeometry(0, 0, 1920, 1080));
        await PutItemAsync(admin, production.Id, scenes[2].Id, phone, new SceneItemGeometry(960, 540, 960, 540));
        await using var hub = app.Hub(HubMethods.StudioHubPath, o => o.Headers["Cookie"] = admin.Cookie);
        var events = HubProbe.On<ProductionEvent>(hub, HubMethods.Event);
        await hub.StartAsync(TestContext.Current.CancellationToken);
        var start = await hub.InvokeAsync<ProductionChangesDto>(HubMethods.Subscribe, production.Id, null, TestContext.Current.CancellationToken);

        await admin.Client.PutJsonAsync($"/api/productions/{production.Id}/canvas", new ChangeCanvasRequest(CanvasFormat.Square, CanvasResolution.P1080)).ExpectAsync<ProductionDto>();
        var changed = Assert.IsType<ProductionCanvasChangedEvent>(await events.NextAsync(e => e is ProductionCanvasChangedEvent));

        Assert.Equal(start.Revision + 1, changed.Revision);
        Assert.Equal(new CanvasDto(CanvasFormat.Square, CanvasResolution.P1080, 1080, 1080), changed.Production.Canvas);
        Assert.Equal([scenes[0].Id, scenes[2].Id], changed.Scenes.Select(s => s.Id));
        Assert.Equal((0, 236, 1080, 608), Geometry(changed.Scenes[0].Items[0]));
    }

    [Fact]
    public async Task ChangeCanvas_OnTheWire_CarriesTheDiscriminatorAndCamelCaseEnums()
    {
        var admin = await app.AdminAsync();
        var production = await CreateAsync(admin);
        await using var hub = app.Hub(HubMethods.StudioHubPath, o => o.Headers["Cookie"] = admin.Cookie);
        var raw = HubProbe.On<JsonElement>(hub, HubMethods.Event);
        await hub.StartAsync(TestContext.Current.CancellationToken);
        await hub.InvokeAsync<ProductionChangesDto>(HubMethods.Subscribe, production.Id, null, TestContext.Current.CancellationToken);

        await admin.Client.PutJsonAsync($"/api/productions/{production.Id}/canvas", new ChangeCanvasRequest(CanvasFormat.Standard, CanvasResolution.P720)).ExpectAsync<ProductionDto>();
        var message = await raw.NextAsync(m => m.GetProperty("type").GetString() == "productionCanvasChanged");

        var canvas = message.GetProperty("production").GetProperty("canvas");
        Assert.Equal(("standard", "p720", 960, 720), (canvas.GetProperty("format").GetString(), canvas.GetProperty("resolution").GetString(), canvas.GetProperty("width").GetInt32(), canvas.GetProperty("height").GetInt32()));
        Assert.Equal(JsonValueKind.Array, message.GetProperty("scenes").ValueKind);
    }

    [Fact]
    public async Task ChangeCanvas_OutputHub_ReceivesTheChangeAndTheSnapshotCarriesTheCanvas()
    {
        var admin = await app.AdminAsync();
        var production = await CreateAsync(admin);
        var settings = await admin.Client.GetAsync($"/api/productions/{production.Id}/output", TestContext.Current.CancellationToken).ExpectAsync<OutputSettingsDto>();
        var url = settings.Links[0].Url;
        var key = url[(url.IndexOf("?k=", StringComparison.Ordinal) + 3)..];
        await using var hub = app.Hub(HubMethods.OutputHubPath, o => o.AccessTokenProvider = () => Task.FromResult<string?>(key));
        var events = HubProbe.On<ProductionEvent>(hub, HubMethods.Event);
        await hub.StartAsync(TestContext.Current.CancellationToken);
        var initial = await hub.InvokeAsync<OutputChangesDto>(HubMethods.SubscribeOutput, null, TestContext.Current.CancellationToken);
        var client = app.Anonymous();
        client.DefaultRequestHeaders.Add("X-Output-Key", key);

        await admin.Client.PutJsonAsync($"/api/productions/{production.Id}/canvas", new ChangeCanvasRequest(CanvasFormat.Portrait, CanvasResolution.P1080)).ExpectAsync<ProductionDto>();
        var changed = Assert.IsType<ProductionCanvasChangedEvent>(await events.NextAsync(e => e is ProductionCanvasChangedEvent));
        var snapshot = await client.GetAsync($"/api/output/{production.Slug}/snapshot", TestContext.Current.CancellationToken).ExpectAsync<OutputSnapshot>();

        Assert.NotNull(initial.Snapshot);
        Assert.Equal(FullHd, initial.Snapshot!.Production.Canvas);
        Assert.Equal(new CanvasDto(CanvasFormat.Portrait, CanvasResolution.P1080, 1080, 1920), changed.Production.Canvas);
        Assert.Equal(changed.Production.Canvas, snapshot.Production.Canvas);
    }

    [Fact]
    public async Task ChangeCanvas_ReconnectedClient_GetsTheChangeInTheDelta()
    {
        var admin = await app.AdminAsync();
        var production = await CreateAsync(admin);
        var start = await SnapshotAsync(admin, production.Id);

        await admin.Client.PutJsonAsync($"/api/productions/{production.Id}/canvas", new ChangeCanvasRequest(CanvasFormat.Square, CanvasResolution.P720)).ExpectAsync<ProductionDto>();
        var delta = await admin.Client.GetAsync($"/api/productions/{production.Id}/changes?since={start.Revision}", TestContext.Current.CancellationToken).ExpectAsync<ProductionChangesDto>();

        Assert.Null(delta.Snapshot);
        Assert.Contains(delta.Events!, e => e is ProductionCanvasChangedEvent { Production.Canvas.Width: 720 });
    }

    [Fact]
    public async Task Create_StoresFormatAndResolutionAsColumns()
    {
        var admin = await app.AdminAsync();
        var production = await admin.Client.PostJsonAsync("/api/productions", new CreateProductionRequest("Kept " + Guid.NewGuid().ToString("N")[..6], CanvasFormat.Standard, CanvasResolution.P720)).ExpectAsync<ProductionDto>(HttpStatusCode.Created);
        await using var db = await app.Service<IDbContextFactory<StudioFlowDbContext>>().CreateDbContextAsync(TestContext.Current.CancellationToken);

        var stored = await db.Productions.AsNoTracking().SingleAsync(p => p.Id == production.Id, TestContext.Current.CancellationToken);
        var columns = await db.Database.SqlQueryRaw<string>("SELECT canvas_format || '/' || canvas_resolution AS \"Value\" FROM productions WHERE id = {0}", production.Id).SingleAsync(TestContext.Current.CancellationToken);

        Assert.Equal(new CanvasSize(960, 720), stored.Canvas);
        Assert.Equal("Standard/P720", columns);
    }

    private static Task<ProductionDto> CreateAsync(AdminSession admin) =>
        admin.Client.PostJsonAsync("/api/productions", new CreateProductionRequest("Test " + Guid.NewGuid().ToString("N")[..8])).ExpectAsync<ProductionDto>(HttpStatusCode.Created);

    private static Task<ProductionSnapshot> SnapshotAsync(AdminSession admin, string productionId) =>
        admin.Client.GetAsync($"/api/productions/{productionId}/snapshot").ExpectAsync<ProductionSnapshot>();

    private static (int X, int Y, int W, int H) Geometry(SceneItemDto item) => (item.X, item.Y, item.W, item.H);

    private async Task<string> PairInAsync(AdminSession admin, string productionId)
    {
        var credentials = await app.PairPhoneAsync(admin with { ProductionId = productionId });
        return credentials.DeviceId;
    }

    private static async Task PutItemAsync(AdminSession admin, string productionId, string sceneId, string deviceId, SceneItemGeometry geometry, SceneLayoutMode? layoutMode = null)
    {
        var item = new SceneItemDto(
            "itm_" + Guid.NewGuid().ToString("N")[..16],
            $"{deviceId}/camera",
            geometry.X,
            geometry.Y,
            geometry.W,
            geometry.H,
            ItemFit.Cover,
            new CropDto(0, 0, 0, 0),
            0,
            false,
            0,
            false,
            false,
            null,
            new LostBehaviorDto(3000, null));
        await admin.Client.PutJsonAsync($"/api/productions/{productionId}/scenes/{sceneId}/items", new ReplaceSceneItemsRequest([item], layoutMode)).ExpectAsync(HttpStatusCode.OK);
    }

    private sealed record SceneItemGeometry(int X, int Y, int W, int H);
}
