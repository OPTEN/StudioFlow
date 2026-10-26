using System.Net;
using System.Text.Json;
using Microsoft.AspNetCore.SignalR.Client;
using Opten.StudioFlow.Core.Contracts;
using Opten.StudioFlow.Web.Tests.Support;

namespace Opten.StudioFlow.Web.Tests;

public sealed class SceneApiTests(StudioFlowApp app) : IClassFixture<StudioFlowApp>
{
    [Fact]
    public async Task Create_AndClone_CopiesItems()
    {
        var (admin, production, camera) = await SetupAsync();
        var original = await admin.Client.PostJsonAsync(Scenes(production), new CreateSceneRequest("Original", null)).ExpectAsync<SceneDto>(HttpStatusCode.Created);
        await admin.Client.PostJsonAsync($"{Scenes(production)}/{original.Id}/items", new AddSceneItemRequest(camera, null, null, null, null, null, null)).ExpectAsync<SceneDto>();

        var clone = await admin.Client.PostJsonAsync(Scenes(production), new CreateSceneRequest("Copy", original.Id)).ExpectAsync<SceneDto>(HttpStatusCode.Created);

        Assert.Equal(4, clone.SortOrder);
        Assert.Equal(camera, Assert.Single(clone.Items).Source);
        await admin.Client.PostJsonAsync(Scenes(production), new CreateSceneRequest("X", "scn_none")).ExpectProblemAsync(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task Create_HundredthScene_IsLimitReached()
    {
        var (admin, production, _) = await SetupAsync();
        for (var i = 3; i < 99; i++)
        {
            await admin.Client.PostJsonAsync(Scenes(production), new CreateSceneRequest($"S{i}", null)).ExpectAsync(HttpStatusCode.Created);
        }

        Assert.Equal(ErrorCodes.LimitReached, await admin.Client.PostJsonAsync(Scenes(production), new CreateSceneRequest("Too many", null)).ExpectProblemAsync(HttpStatusCode.Conflict));
    }

    [Fact]
    public async Task AddItem_Defaults_AreAppliedAndUnknownSourceRejected()
    {
        var (admin, production, camera) = await SetupAsync();
        var sceneId = await FirstSceneAsync(admin, production);

        var scene = await admin.Client.PostJsonAsync($"{Scenes(production)}/{sceneId}/items", new AddSceneItemRequest(camera, null, null, null, null, null, null)).ExpectAsync<SceneDto>();
        var code = await admin.Client.PostJsonAsync($"{Scenes(production)}/{sceneId}/items", new AddSceneItemRequest("dev_unknown000/camera", null, null, null, null, null, null)).ExpectProblemAsync(HttpStatusCode.BadRequest);

        var item = Assert.Single(scene.Items);
        Assert.Equal((1240, 680, 600, 338, 12, ItemFit.Cover), (item.X, item.Y, item.W, item.H, item.Radius, item.Fit));
        Assert.Equal(ErrorCodes.ValidationFailed, code);
        Assert.Equal(2, scene.Version);
    }

    [Fact]
    public async Task UpdateItem_InvalidGeometry_ReportsFieldPaths()
    {
        var (admin, production, camera) = await SetupAsync();
        var sceneId = await FirstSceneAsync(admin, production);
        var item = (await admin.Client.PostJsonAsync($"{Scenes(production)}/{sceneId}/items", new AddSceneItemRequest(camera, 0, 0, 640, 360, ItemFit.Contain, 0)).ExpectAsync<SceneDto>()).Items[0];

        using var response = await admin.Client.PutJsonAsync($"{Scenes(production)}/{sceneId}/items/{item.Id}", item with { W = 5, Crop = new CropDto(0.5, 0, 0, 0), Rotation = 45 });

        await response.ExpectAsync(HttpStatusCode.BadRequest);
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync(TestContext.Current.CancellationToken));
        var errors = json.RootElement.GetProperty("errors").EnumerateObject().Select(p => p.Name).ToList();
        Assert.Contains("item.w", errors);
        Assert.Contains("item.crop.top", errors);
        Assert.Contains("item.rotation", errors);
    }

    [Fact]
    public async Task UpdateItem_Valid_ReplacesItemAndIncrementsVersion()
    {
        var (admin, production, camera) = await SetupAsync();
        var sceneId = await FirstSceneAsync(admin, production);
        var added = await admin.Client.PostJsonAsync($"{Scenes(production)}/{sceneId}/items", new AddSceneItemRequest(camera, null, null, null, null, null, null)).ExpectAsync<SceneDto>();
        var item = added.Items[0] with { X = -100, Border = new BorderDto(4, "#ff0000"), OnLost = new LostBehaviorDto(null, null), Mirror = true };

        var updated = await admin.Client.PutJsonAsync($"{Scenes(production)}/{sceneId}/items/{item.Id}", item).ExpectAsync<SceneDto>();

        Assert.Equal(item, updated.Items[0]);
        Assert.Equal(added.Version + 1, updated.Version);
        await admin.Client.PutJsonAsync($"{Scenes(production)}/{sceneId}/items/itm_unknown", item).ExpectProblemAsync(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task ReplaceItems_TemplateWithAutoGrid_PersistsOrderAndMode()
    {
        var (admin, production, camera) = await SetupAsync();
        var sceneId = await FirstSceneAsync(admin, production);
        var items = new[]
        {
            Item(camera, "itm_template01") with { X = 0, Y = 0, W = 1920, H = 1080, Radius = 0 },
            Item(camera, "itm_template02") with { X = 40, Y = 40, W = 480, H = 270, Hidden = true },
        };

        var scene = await admin.Client.PutJsonAsync($"{Scenes(production)}/{sceneId}/items", new ReplaceSceneItemsRequest(items, SceneLayoutMode.AutoGrid)).ExpectAsync<SceneDto>();
        var reloaded = (await admin.Client.GetAsync($"/api/productions/{production}/snapshot", TestContext.Current.CancellationToken).ExpectAsync<ProductionSnapshot>()).Scenes.Single(s => s.Id == sceneId);

        Assert.Equal(SceneLayoutMode.AutoGrid, scene.LayoutMode);
        Assert.Equal(items, reloaded.Items);
        Assert.Equal(scene.Version, reloaded.Version);
    }

    [Fact]
    public async Task ReplaceItems_DuplicatesOrTooMany_AreRejected()
    {
        var (admin, production, camera) = await SetupAsync();
        var sceneId = await FirstSceneAsync(admin, production);
        var url = $"{Scenes(production)}/{sceneId}/items";

        await admin.Client.PutJsonAsync(url, new ReplaceSceneItemsRequest([Item(camera, "itm_dupl"), Item(camera, "itm_dupl")], null)).ExpectProblemAsync(HttpStatusCode.BadRequest);
        Assert.Equal(ErrorCodes.LimitReached, await admin.Client.PutJsonAsync(url, new ReplaceSceneItemsRequest([.. Enumerable.Range(0, 33).Select(i => Item(camera, $"itm_many{i:D4}"))], null)).ExpectProblemAsync(HttpStatusCode.Conflict));
        await admin.Client.PutJsonAsync(url, new ReplaceSceneItemsRequest([Item(camera, "BAD-ID")], null)).ExpectProblemAsync(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task RemoveItem_ExistingAndUnknown()
    {
        var (admin, production, camera) = await SetupAsync();
        var sceneId = await FirstSceneAsync(admin, production);
        var item = (await admin.Client.PostJsonAsync($"{Scenes(production)}/{sceneId}/items", new AddSceneItemRequest(camera, null, null, null, null, null, null)).ExpectAsync<SceneDto>()).Items[0];

        var scene = await admin.Client.DeleteAsync($"{Scenes(production)}/{sceneId}/items/{item.Id}", TestContext.Current.CancellationToken).ExpectAsync<SceneDto>();

        Assert.Empty(scene.Items);
        await admin.Client.DeleteAsync($"{Scenes(production)}/{sceneId}/items/{item.Id}", TestContext.Current.CancellationToken).ExpectProblemAsync(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task Delete_ProgramIsLiveAndPreviewIsCleared()
    {
        var (admin, production, _) = await SetupAsync();
        var scenes = (await admin.Client.GetAsync($"/api/productions/{production}/snapshot", TestContext.Current.CancellationToken).ExpectAsync<ProductionSnapshot>()).Scenes;
        await admin.Client.PutJsonAsync($"/api/productions/{production}/preview", new SetPreviewRequest(scenes[1].Id)).ExpectAsync(HttpStatusCode.OK);

        Assert.Equal(ErrorCodes.SceneIsLive, await admin.Client.DeleteAsync($"{Scenes(production)}/{scenes[0].Id}", TestContext.Current.CancellationToken).ExpectProblemAsync(HttpStatusCode.Conflict));
        await admin.Client.DeleteAsync($"{Scenes(production)}/{scenes[1].Id}", TestContext.Current.CancellationToken).ExpectAsync(HttpStatusCode.NoContent);
        await admin.Client.DeleteAsync($"{Scenes(production)}/{scenes[1].Id}", TestContext.Current.CancellationToken).ExpectProblemAsync(HttpStatusCode.NotFound);
        var snapshot = await admin.Client.GetAsync($"/api/productions/{production}/snapshot", TestContext.Current.CancellationToken).ExpectAsync<ProductionSnapshot>();

        Assert.Null(snapshot.Production.PreviewSceneId);
        Assert.Equal([0, 1], snapshot.Scenes.Select(s => s.SortOrder));
        Assert.Contains(snapshot.RecentLog, l => l is { Code: LogCode.SceneDeleted } && l.Params["scene"] == "Presentation");
    }

    [Fact]
    public async Task Reorder_Permutation_AppliesAndInvalidIsRejected()
    {
        var (admin, production, _) = await SetupAsync();
        var ids = (await admin.Client.GetAsync($"/api/productions/{production}/snapshot", TestContext.Current.CancellationToken).ExpectAsync<ProductionSnapshot>()).Scenes.Select(s => s.Id).ToList();

        await admin.Client.PutJsonAsync($"{Scenes(production)}/order", new ReorderScenesRequest([ids[2], ids[0], ids[1]])).ExpectAsync(HttpStatusCode.NoContent);
        await admin.Client.PutJsonAsync($"{Scenes(production)}/order", new ReorderScenesRequest([ids[0]])).ExpectProblemAsync(HttpStatusCode.BadRequest);
        var order = (await admin.Client.GetAsync($"/api/productions/{production}/snapshot", TestContext.Current.CancellationToken).ExpectAsync<ProductionSnapshot>()).Scenes.Select(s => s.Id);

        Assert.Equal([ids[2], ids[0], ids[1]], order);
    }

    [Fact]
    public async Task ReorderItems_Permutation_ReordersAndKeepsEveryItemUntouched()
    {
        var (admin, production, camera) = await SetupAsync();
        var sceneId = await FirstSceneAsync(admin, production);
        var before = await AddItemsAsync(admin, production, sceneId, camera, 3);
        var ids = before.Items.Select(i => i.Id).ToList();

        var after = await admin.Client.PutJsonAsync(OrderUrl(production, sceneId), new ReorderSceneItemsRequest([ids[2], ids[0], ids[1]])).ExpectAsync<SceneDto>();
        var unchanged = await admin.Client.PutJsonAsync(OrderUrl(production, sceneId), new ReorderSceneItemsRequest([ids[2], ids[0], ids[1]])).ExpectAsync<SceneDto>();
        var stored = (await admin.Client.GetAsync($"/api/productions/{production}/snapshot", TestContext.Current.CancellationToken).ExpectAsync<ProductionSnapshot>()).Scenes.Single(s => s.Id == sceneId);

        Assert.Equal([ids[2], ids[0], ids[1]], after.Items.Select(i => i.Id));
        Assert.Equal(before.Version + 1, after.Version);
        Assert.Equal(after.Version, unchanged.Version);
        Assert.Equal(after.Items, stored.Items);
        Assert.Equal(before.Items.OrderBy(i => i.Id), after.Items.OrderBy(i => i.Id));
    }

    [Theory]
    [InlineData("missing")]
    [InlineData("extra")]
    [InlineData("unknown")]
    [InlineData("duplicate")]
    public async Task ReorderItems_ListDoesNotMatchTheItems_IsConflictAndNothingChanges(string kind)
    {
        var (admin, production, camera) = await SetupAsync();
        var sceneId = await FirstSceneAsync(admin, production);
        var before = await AddItemsAsync(admin, production, sceneId, camera, 3);
        var ids = before.Items.Select(i => i.Id).ToList();
        IReadOnlyList<string> request = kind switch
        {
            "missing" => [ids[1], ids[0]],
            "extra" => [ids[2], ids[1], ids[0], "itm_extra0001"],
            "unknown" => [ids[2], ids[1], "itm_unknown001"],
            _ => [ids[2], ids[2], ids[0]],
        };

        var code = await admin.Client.PutJsonAsync(OrderUrl(production, sceneId), new ReorderSceneItemsRequest(request)).ExpectProblemAsync(HttpStatusCode.Conflict);
        var stored = (await admin.Client.GetAsync($"/api/productions/{production}/snapshot", TestContext.Current.CancellationToken).ExpectAsync<ProductionSnapshot>()).Scenes.Single(s => s.Id == sceneId);

        Assert.Equal(ErrorCodes.Conflict, code);
        Assert.Equal(before.Items, stored.Items);
        Assert.Equal(before.Version, stored.Version);
    }

    [Fact]
    public async Task ReorderItems_MissingBodyListOrUnknownScene_IsRejected()
    {
        var (admin, production, camera) = await SetupAsync();
        var sceneId = await FirstSceneAsync(admin, production);
        await AddItemsAsync(admin, production, sceneId, camera, 1);

        Assert.Equal(ErrorCodes.ValidationFailed, await admin.Client.PutJsonAsync(OrderUrl(production, sceneId), new ReorderSceneItemsRequest(null!)).ExpectProblemAsync(HttpStatusCode.BadRequest));
        Assert.Equal(ErrorCodes.NotFound, await admin.Client.PutJsonAsync(OrderUrl(production, "scn_unknown"), new ReorderSceneItemsRequest([])).ExpectProblemAsync(HttpStatusCode.NotFound));
    }

    [Fact]
    public async Task ReorderItems_SingleItemAndEmptyScene_AreAcceptedWithoutAChange()
    {
        var (admin, production, camera) = await SetupAsync();
        var sceneId = await FirstSceneAsync(admin, production);
        var empty = await admin.Client.PutJsonAsync(OrderUrl(production, sceneId), new ReorderSceneItemsRequest([])).ExpectAsync<SceneDto>();
        var single = await AddItemsAsync(admin, production, sceneId, camera, 1);

        var again = await admin.Client.PutJsonAsync(OrderUrl(production, sceneId), new ReorderSceneItemsRequest([single.Items[0].Id])).ExpectAsync<SceneDto>();

        Assert.Empty(empty.Items);
        Assert.Equal(single.Version, again.Version);
    }

    [Fact]
    public async Task ReorderItems_ConcurrentGeometryEditOfAnotherSession_IsNotOverwritten()
    {
        var (admin, production, camera) = await SetupAsync();
        var sceneId = await FirstSceneAsync(admin, production);
        var before = await AddItemsAsync(admin, production, sceneId, camera, 2);
        var ids = before.Items.Select(i => i.Id).ToList();

        // Another Regie session moves the first item after this session read the scene, then this session reorders.
        await admin.Client.PutJsonAsync($"{Scenes(production)}/{sceneId}/items/{ids[0]}", before.Items[0] with { X = 777, Hidden = true }).ExpectAsync<SceneDto>();
        var after = await admin.Client.PutJsonAsync(OrderUrl(production, sceneId), new ReorderSceneItemsRequest([ids[1], ids[0]])).ExpectAsync<SceneDto>();

        Assert.Equal([ids[1], ids[0]], after.Items.Select(i => i.Id));
        Assert.Equal((777, true), (after.Items[1].X, after.Items[1].Hidden));
    }

    [Fact]
    public async Task ReorderItems_ParallelRequests_AreSerializedAndTheLastOneWins()
    {
        var (admin, production, camera) = await SetupAsync();
        var sceneId = await FirstSceneAsync(admin, production);
        var ids = (await AddItemsAsync(admin, production, sceneId, camera, 3)).Items.Select(i => i.Id).ToList();
        List<string>[] orders = [[ids[2], ids[1], ids[0]], [ids[1], ids[2], ids[0]], [ids[0], ids[2], ids[1]]];

        var results = await Task.WhenAll(orders.Select(order => admin.Client.PutJsonAsync(OrderUrl(production, sceneId), new ReorderSceneItemsRequest(order)).ExpectAsync<SceneDto>()));
        var stored = (await admin.Client.GetAsync($"/api/productions/{production}/snapshot", TestContext.Current.CancellationToken).ExpectAsync<ProductionSnapshot>()).Scenes.Single(s => s.Id == sceneId);

        Assert.Equal(3, results.Select(r => r.Version).Distinct().Count());
        Assert.Equal(results.Max(r => r.Version), stored.Version);
        Assert.Equal(results.Single(r => r.Version == stored.Version).Items.Select(i => i.Id), stored.Items.Select(i => i.Id));
    }

    [Fact]
    public async Task ReorderItems_ProgramScene_IsLiveAtOnceOnTheOutputAndForOtherRegieTabs()
    {
        var (admin, production, camera) = await SetupAsync();
        var snapshot = await admin.Client.GetAsync($"/api/productions/{production}/snapshot", TestContext.Current.CancellationToken).ExpectAsync<ProductionSnapshot>();
        var programId = snapshot.Production.ProgramSceneId!;
        var ids = (await AddItemsAsync(admin, production, programId, camera, 3)).Items.Select(i => i.Id).ToList();
        var settings = await admin.Client.GetAsync($"/api/productions/{production}/output", TestContext.Current.CancellationToken).ExpectAsync<OutputSettingsDto>();
        await using var otherTab = app.Hub(HubMethods.StudioHubPath, o => o.Headers["Cookie"] = admin.Cookie);
        await using var output = app.Hub(HubMethods.OutputHubPath, o => o.AccessTokenProvider = () => Task.FromResult<string?>(settings.Links[0].Key()));
        var tabEvents = HubProbe.On<ProductionEvent>(otherTab, HubMethods.Event);
        var outputEvents = HubProbe.On<ProductionEvent>(output, HubMethods.Event);
        await otherTab.StartAsync(TestContext.Current.CancellationToken);
        await otherTab.InvokeAsync<ProductionChangesDto>(HubMethods.Subscribe, production, null, TestContext.Current.CancellationToken);
        await output.StartAsync(TestContext.Current.CancellationToken);
        await output.InvokeAsync<OutputChangesDto>(HubMethods.SubscribeOutput, null, TestContext.Current.CancellationToken);
        string[] reordered = [ids[2], ids[0], ids[1]];

        await admin.Client.PutJsonAsync(OrderUrl(production, programId), new ReorderSceneItemsRequest(reordered)).ExpectAsync(HttpStatusCode.OK);
        var seenByTab = await tabEvents.NextAsync(e => e is SceneUpsertedEvent s && s.Scene.Id == programId);
        var seenByOutput = await outputEvents.NextAsync(e => e is SceneUpsertedEvent s && s.Scene.Id == programId);

        Assert.Equal(reordered, ((SceneUpsertedEvent)seenByTab).Scene.Items.Select(i => i.Id));
        Assert.Equal(reordered, ((SceneUpsertedEvent)seenByOutput).Scene.Items.Select(i => i.Id));
    }

    [Fact]
    public async Task Update_NameLayoutAndBackground_AreValidated()
    {
        var (admin, production, _) = await SetupAsync();
        var sceneId = await FirstSceneAsync(admin, production);
        var url = $"{Scenes(production)}/{sceneId}";

        var updated = await admin.Client.PatchJsonAsync(url, new UpdateSceneRequest("New", SceneLayoutMode.AutoGrid, new SceneBackgroundDto("#101010", null))).ExpectAsync<SceneDto>();
        await admin.Client.PatchJsonAsync(url, new UpdateSceneRequest(new string('x', 81), null, null)).ExpectProblemAsync(HttpStatusCode.BadRequest);
        await admin.Client.PatchJsonAsync(url, new UpdateSceneRequest(null, null, new SceneBackgroundDto("blue", null))).ExpectProblemAsync(HttpStatusCode.BadRequest);
        await admin.Client.PatchJsonAsync($"{Scenes(production)}/scn_unknown", new UpdateSceneRequest("X", null, null)).ExpectProblemAsync(HttpStatusCode.NotFound);

        Assert.Equal(("New", SceneLayoutMode.AutoGrid, "#101010"), (updated.Name, updated.LayoutMode, updated.Background.Color));
    }

    [Fact]
    public async Task ParallelItemEdits_AreSerializedWithoutLostVersions()
    {
        var (admin, production, camera) = await SetupAsync();
        var sceneId = await FirstSceneAsync(admin, production);
        var item = (await admin.Client.PostJsonAsync($"{Scenes(production)}/{sceneId}/items", new AddSceneItemRequest(camera, null, null, null, null, null, null)).ExpectAsync<SceneDto>()).Items[0];

        var results = await Task.WhenAll(Enumerable.Range(0, 20).Select(i =>
            admin.Client.PutJsonAsync($"{Scenes(production)}/{sceneId}/items/{item.Id}", item with { X = i }).ExpectAsync<SceneDto>()));

        Assert.Equal(20, results.Select(r => r.Version).Distinct().Count());
        var final = (await admin.Client.GetAsync($"/api/productions/{production}/snapshot", TestContext.Current.CancellationToken).ExpectAsync<ProductionSnapshot>()).Scenes.Single(s => s.Id == sceneId);
        Assert.Equal(results.Max(r => r.Version), final.Version);
    }

    private static string Scenes(string productionId) => $"/api/productions/{productionId}/scenes";

    private static string OrderUrl(string productionId, string sceneId) => $"{Scenes(productionId)}/{sceneId}/items/order";

    private static async Task<SceneDto> AddItemsAsync(AdminSession admin, string productionId, string sceneId, string source, int count)
    {
        SceneDto scene = null!;
        for (var i = 0; i < count; i++)
        {
            scene = await admin.Client.PostJsonAsync($"{Scenes(productionId)}/{sceneId}/items", new AddSceneItemRequest(source, i * 10, i * 10, 640, 360, ItemFit.Cover, 0)).ExpectAsync<SceneDto>();
        }

        return scene;
    }

    private static SceneItemDto Item(string source, string id) => new(id, source, 100, 100, 640, 360, ItemFit.Cover, new CropDto(0, 0, 0, 0), 12, false, 0, false, false, null, new LostBehaviorDto(3000, null));

    private static async Task<string> FirstSceneAsync(AdminSession admin, string productionId) =>
        (await admin.Client.GetAsync($"/api/productions/{productionId}/snapshot").ExpectAsync<ProductionSnapshot>()).Scenes[0].Id;

    private async Task<(AdminSession Admin, string ProductionId, string Camera)> SetupAsync()
    {
        var admin = await app.AdminAsync();
        var production = await admin.Client.PostJsonAsync("/api/productions", new CreateProductionRequest("Scenes " + Guid.NewGuid().ToString("N")[..6])).ExpectAsync<ProductionDto>(HttpStatusCode.Created);
        var invite = await admin.Client.GetAsync($"/api/productions/{production.Id}/pairing/phone-invite").ExpectAsync<InviteDto>();
        var credentials = await app.Anonymous().PostJsonAsync($"/api/pairing/invites/{Pairing.TokenOf(invite)}/redeem", new RedeemInviteRequest("client-" + Guid.NewGuid(), null, DeviceKind.Phone, "Test")).ExpectAsync<DeviceCredentialsDto>();
        return (admin, production.Id, $"{credentials.DeviceId}/camera");
    }
}
