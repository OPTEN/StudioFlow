using System.Net;
using System.Text.Json;
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

        var clone = await admin.Client.PostJsonAsync(Scenes(production), new CreateSceneRequest("Kopie", original.Id)).ExpectAsync<SceneDto>(HttpStatusCode.Created);

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

        Assert.Equal(ErrorCodes.LimitReached, await admin.Client.PostJsonAsync(Scenes(production), new CreateSceneRequest("Zu viel", null)).ExpectProblemAsync(HttpStatusCode.Conflict));
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
        Assert.Contains(snapshot.RecentLog, l => l.Text == "Szene «Präsentation» gelöscht");
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
    public async Task Update_NameLayoutAndBackground_AreValidated()
    {
        var (admin, production, _) = await SetupAsync();
        var sceneId = await FirstSceneAsync(admin, production);
        var url = $"{Scenes(production)}/{sceneId}";

        var updated = await admin.Client.PatchJsonAsync(url, new UpdateSceneRequest("Neu", SceneLayoutMode.AutoGrid, new SceneBackgroundDto("#101010", null))).ExpectAsync<SceneDto>();
        await admin.Client.PatchJsonAsync(url, new UpdateSceneRequest(new string('x', 81), null, null)).ExpectProblemAsync(HttpStatusCode.BadRequest);
        await admin.Client.PatchJsonAsync(url, new UpdateSceneRequest(null, null, new SceneBackgroundDto("blue", null))).ExpectProblemAsync(HttpStatusCode.BadRequest);
        await admin.Client.PatchJsonAsync($"{Scenes(production)}/scn_unknown", new UpdateSceneRequest("X", null, null)).ExpectProblemAsync(HttpStatusCode.NotFound);

        Assert.Equal(("Neu", SceneLayoutMode.AutoGrid, "#101010"), (updated.Name, updated.LayoutMode, updated.Background.Color));
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

    private static SceneItemDto Item(string source, string id) => new(id, source, 100, 100, 640, 360, ItemFit.Cover, new CropDto(0, 0, 0, 0), 12, false, 0, false, false, null, new LostBehaviorDto(3000, null));

    private static async Task<string> FirstSceneAsync(AdminSession admin, string productionId) =>
        (await admin.Client.GetAsync($"/api/productions/{productionId}/snapshot").ExpectAsync<ProductionSnapshot>()).Scenes[0].Id;

    private async Task<(AdminSession Admin, string ProductionId, string Camera)> SetupAsync()
    {
        var admin = await app.AdminAsync();
        var production = await admin.Client.PostJsonAsync("/api/productions", new CreateProductionRequest("Szenen " + Guid.NewGuid().ToString("N")[..6])).ExpectAsync<ProductionDto>(HttpStatusCode.Created);
        var invite = await admin.Client.GetAsync($"/api/productions/{production.Id}/pairing/phone-invite").ExpectAsync<InviteDto>();
        var credentials = await app.Anonymous().PostJsonAsync($"/api/pairing/invites/{Pairing.TokenOf(invite)}/redeem", new RedeemInviteRequest("client-" + Guid.NewGuid(), null, DeviceKind.Phone, "Test")).ExpectAsync<DeviceCredentialsDto>();
        return (admin, production.Id, $"{credentials.DeviceId}/camera");
    }
}
