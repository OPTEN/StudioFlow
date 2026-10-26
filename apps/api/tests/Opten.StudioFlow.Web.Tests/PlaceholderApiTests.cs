using System.Net;
using Opten.StudioFlow.Core.Contracts;
using Opten.StudioFlow.Web.Tests.Support;
using static Opten.StudioFlow.Web.Tests.Support.TransferSupport;

namespace Opten.StudioFlow.Web.Tests;

public sealed class PlaceholderApiTests(StudioFlowApp app) : IClassFixture<StudioFlowApp>
{
    [Fact]
    public async Task Assign_NewPhone_TakesTheCodeAndShowsInEverySceneWithItsPlace()
    {
        var (admin, copy, _) = await CopyAsync();
        var before = await SnapshotAsync(admin, copy.Id);
        var placeholder = before.Placeholders.Single(p => p.Code == "K1");
        var usedBy = before.Scenes.Where(s => s.Items.Any(i => i.Source == placeholder.SourceId || i.OnLost.FallbackSource == placeholder.SourceId)).Select(s => s.Name).ToList();
        var phone = await app.PairPhoneAsync(admin, "New phone");
        var paired = await SnapshotAsync(admin, copy.Id);
        var camera = paired.Sources.Single(s => s.DeviceId == phone.DeviceId);

        // The code K1 is reserved for the placeholder, so the new phone got the next one.
        Assert.Equal("K2", camera.Code);
        var change = await AssignAsync(admin, copy.Id, placeholder.Id, camera.Id).ExpectAsync<PlaceholderChangeDto>();
        var after = await SnapshotAsync(admin, copy.Id);

        Assert.Equal(("Welcome", "Presentation", "Interview"), (usedBy[0], usedBy[1], usedBy[2]));
        Assert.Equal(new PlaceholderChangeDto(3, 3), change);
        Assert.DoesNotContain(after.Placeholders, p => p.Id == placeholder.Id);
        Assert.Equal(["S1"], after.Placeholders.Select(p => p.Code));
        Assert.DoesNotContain(after.Scenes.SelectMany(s => s.Items), i => i.Source == placeholder.SourceId || i.OnLost.FallbackSource == placeholder.SourceId);
        Assert.Equal(usedBy, after.Scenes.Where(s => s.Items.Any(i => i.Source == camera.Id)).Select(s => s.Name));

        // The phone is K1 now, as the original was; the geometry and the version of the scenes follow the change.
        var assigned = after.Sources.Single(s => s.Id == camera.Id);
        Assert.Equal(("K1", SourceKind.Camera), (assigned.Code, assigned.Kind));
        foreach (var scene in before.Scenes.Where(s => usedBy.Contains(s.Name)))
        {
            var changed = after.Scenes.Single(s => s.Id == scene.Id);
            Assert.Equal(scene.Version + 1, changed.Version);
            Assert.Equal(scene.Items.Select(i => (i.X, i.Y, i.W, i.H, i.Hidden)), changed.Items.Select(i => (i.X, i.Y, i.W, i.H, i.Hidden)));
        }

        var self = await app.DeviceClient(phone).GetAsync("/api/device/me", TestContext.Current.CancellationToken).ExpectAsync<DeviceSelfDto>();
        Assert.Equal("K1", Assert.Single(self.Slots).Code);
    }

    [Fact]
    public async Task Assign_ReachesTheClientsAsEvents()
    {
        var (admin, copy, _) = await CopyAsync();
        var snapshot = await SnapshotAsync(admin, copy.Id);
        var placeholder = snapshot.Placeholders.Single(p => p.Code == "K1");
        var phone = await app.PairPhoneAsync(admin);
        var camera = (await SnapshotAsync(admin, copy.Id)).Sources.Single(s => s.DeviceId == phone.DeviceId);
        var since = (await SnapshotAsync(admin, copy.Id)).Revision;

        await AssignAsync(admin, copy.Id, placeholder.Id, camera.Id).ExpectAsync<PlaceholderChangeDto>();
        var changes = await admin.Client.GetAsync($"/api/productions/{copy.Id}/changes?since={since}", TestContext.Current.CancellationToken).ExpectAsync<ProductionChangesDto>();

        Assert.NotNull(changes.Events);
        Assert.Equal(3, changes.Events.OfType<SceneUpsertedEvent>().Count());
        Assert.Equal(placeholder.Id, Assert.Single(changes.Events.OfType<PlaceholderRemovedEvent>()).PlaceholderId);
        Assert.Contains(changes.Events.OfType<SourceUpsertedEvent>(), e => e.Source.Id == camera.Id && e.Source.Code == "K1");
    }

    [Fact]
    public async Task Assign_SourceThatIsInUse_KeepsItsCode()
    {
        var (admin, copy, _) = await CopyAsync();
        var snapshot = await SnapshotAsync(admin, copy.Id);
        var phone = await app.PairPhoneAsync(admin, "Phone in use");
        var camera = (await SnapshotAsync(admin, copy.Id)).Sources.Single(s => s.DeviceId == phone.DeviceId);
        var sceneId = snapshot.Scenes[3].Id;
        await admin.Client.PostJsonAsync($"/api/productions/{copy.Id}/scenes/{sceneId}/items", new AddSceneItemRequest(camera.Id, null, null, null, null, null, null)).ExpectAsync<SceneDto>();

        await AssignAsync(admin, copy.Id, snapshot.Placeholders.Single(p => p.Code == "K1").Id, camera.Id).ExpectAsync<PlaceholderChangeDto>();

        Assert.Equal(camera.Code, (await SnapshotAsync(admin, copy.Id)).Sources.Single(s => s.Id == camera.Id).Code);
    }

    [Fact]
    public async Task Assign_Image_ReplacesTheCameraInTheScenes()
    {
        var (admin, copy, _) = await CopyAsync();
        var snapshot = await SnapshotAsync(admin, copy.Id);
        var placeholder = snapshot.Placeholders.Single(p => p.Code == "K1");
        var image = snapshot.Assets.First(a => a.Kind == AssetKind.Image);

        await AssignAsync(admin, copy.Id, placeholder.Id, image.Id).ExpectAsync<PlaceholderChangeDto>();
        var after = await SnapshotAsync(admin, copy.Id);

        Assert.All(after.Scenes[0].Items.Where(i => i.Source != snapshot.Sources.Single(s => s.Text is not null).Id), item => Assert.Equal(image.Id, item.Source));
        Assert.DoesNotContain(after.Placeholders, p => p.Id == placeholder.Id);
        Assert.Equal(snapshot.Assets.Select(a => a.Code), after.Assets.Select(a => a.Code));
    }

    [Fact]
    public async Task Assign_TheFallbackToTheSourceOfItsItem_ClearsTheFallback()
    {
        var (admin, copy, _) = await CopyAsync();
        var snapshot = await SnapshotAsync(admin, copy.Id);
        var placeholder = snapshot.Placeholders.Single(p => p.Code == "K1");
        var screenItem = snapshot.Scenes[1].Items.Single(i => i.Source == snapshot.Placeholders.Single(p => p.Code == "S1").SourceId);
        var laptop = await app.PairLaptopAsync(admin);
        var screen = (await SnapshotAsync(admin, copy.Id)).Sources.Single(s => s.DeviceId == laptop.DeviceId);

        // The screen is the item, the camera its fallback; both end up on the same source, which cannot be its own fallback.
        Assert.Equal(placeholder.SourceId, screenItem.OnLost.FallbackSource);
        await AssignAsync(admin, copy.Id, placeholder.Id, screen.Id).ExpectAsync<PlaceholderChangeDto>();
        await AssignAsync(admin, copy.Id, snapshot.Placeholders.Single(p => p.Code == "S1").Id, screen.Id).ExpectAsync<PlaceholderChangeDto>();
        var item = (await SnapshotAsync(admin, copy.Id)).Scenes[1].Items.Single(i => i.Id == screenItem.Id);

        Assert.Equal(screen.Id, item.Source);
        Assert.Null(item.OnLost.FallbackSource);
    }

    [Fact]
    public async Task Assign_Invalid_IsRejectedAndChangesNothing()
    {
        var (admin, copy, _) = await CopyAsync();
        var snapshot = await SnapshotAsync(admin, copy.Id);
        var placeholder = snapshot.Placeholders[0];
        var text = snapshot.Sources.Single(s => s.Text is not null);

        Assert.Equal(ErrorCodes.ValidationFailed, await AssignAsync(admin, copy.Id, placeholder.Id, text.Id).ExpectProblemAsync(HttpStatusCode.BadRequest));
        Assert.Equal(ErrorCodes.ValidationFailed, await AssignAsync(admin, copy.Id, placeholder.Id, "dev_unknown000000/camera").ExpectProblemAsync(HttpStatusCode.BadRequest));
        Assert.Equal(ErrorCodes.ValidationFailed, await AssignAsync(admin, copy.Id, placeholder.Id, placeholder.SourceId).ExpectProblemAsync(HttpStatusCode.BadRequest));
        Assert.Equal(ErrorCodes.NotFound, await AssignAsync(admin, copy.Id, "plh_doesnotexist000", snapshot.Assets[0].Id).ExpectProblemAsync(HttpStatusCode.NotFound));
        await AssignAsync(admin, "prd_doesnotexist00", placeholder.Id, snapshot.Assets[0].Id).ExpectProblemAsync(HttpStatusCode.NotFound);

        var after = await SnapshotAsync(admin, copy.Id);
        Assert.Equal(snapshot.Revision, after.Revision);
        Assert.Equal(snapshot.Placeholders, after.Placeholders);
    }

    [Fact]
    public async Task Assign_PlaceholderOfAnotherProduction_IsNotFound()
    {
        var (admin, copy, source) = await CopyAsync();
        var other = await SnapshotAsync(admin, copy.Id);

        var code = await AssignAsync(admin, source.Id, other.Placeholders[0].Id, (await SnapshotAsync(admin, source.Id)).Assets[0].Id).ExpectProblemAsync(HttpStatusCode.NotFound);

        Assert.Equal(ErrorCodes.NotFound, code);
    }

    [Fact]
    public async Task Remove_TakesThePlaceholderAndItsItemsOutOfTheScenes()
    {
        var (admin, copy, _) = await CopyAsync();
        var snapshot = await SnapshotAsync(admin, copy.Id);
        var placeholder = snapshot.Placeholders.Single(p => p.Code == "K1");

        var change = await admin.Client.DeleteAsync($"/api/productions/{copy.Id}/placeholders/{placeholder.Id}", TestContext.Current.CancellationToken).ExpectAsync<PlaceholderChangeDto>();
        var after = await SnapshotAsync(admin, copy.Id);

        Assert.Equal(new PlaceholderChangeDto(3, 3), change);
        Assert.Equal(["S1"], after.Placeholders.Select(p => p.Code));
        Assert.DoesNotContain(after.Scenes.SelectMany(s => s.Items), i => i.Source == placeholder.SourceId || i.OnLost.FallbackSource == placeholder.SourceId);
        Assert.Equal(snapshot.Scenes.Sum(s => s.Items.Count) - 3, after.Scenes.Sum(s => s.Items.Count));
        await admin.Client.DeleteAsync($"/api/productions/{copy.Id}/placeholders/{placeholder.Id}", TestContext.Current.CancellationToken).ExpectProblemAsync(HttpStatusCode.NotFound);

        // The code is free again.
        var phone = await app.PairPhoneAsync(admin);
        Assert.Equal("K1", (await SnapshotAsync(admin, copy.Id)).Sources.Single(s => s.DeviceId == phone.DeviceId).Code);
    }

    [Fact]
    public async Task AssignAndRemove_AreInTheAuditLog()
    {
        var (admin, copy, _) = await CopyAsync();
        var snapshot = await SnapshotAsync(admin, copy.Id);
        var phone = await app.PairPhoneAsync(admin, "Audit phone");
        var camera = (await SnapshotAsync(admin, copy.Id)).Sources.Single(s => s.DeviceId == phone.DeviceId);

        await AssignAsync(admin, copy.Id, snapshot.Placeholders.Single(p => p.Code == "K1").Id, camera.Id).ExpectAsync<PlaceholderChangeDto>();
        await admin.Client.DeleteAsync($"/api/productions/{copy.Id}/placeholders/{snapshot.Placeholders.Single(p => p.Code == "S1").Id}", TestContext.Current.CancellationToken).ExpectAsync<PlaceholderChangeDto>();
        var entries = (await admin.Client.GetAsync($"/api/audit?production={copy.Id}&limit=200", TestContext.Current.CancellationToken).ExpectAsync<AuditPageDto>()).Entries;

        var assigned = Assert.Single(entries, e => e.Action == "placeholder.assigned");
        var removed = Assert.Single(entries, e => e.Action == "placeholder.removed");
        Assert.Equal((LogCode.PlaceholderAssigned, "K1", "K1 Audit phone"), (assigned.Code, assigned.Params["code"], assigned.Params["target"]));
        Assert.Equal((LogCode.PlaceholderRemoved, "S1"), (removed.Code, removed.Params["code"]));
    }

    [Fact]
    public async Task Items_CannotBeAddedForAPlaceholder()
    {
        var (admin, copy, _) = await CopyAsync();
        var snapshot = await SnapshotAsync(admin, copy.Id);

        var code = await admin.Client.PostJsonAsync($"/api/productions/{copy.Id}/scenes/{snapshot.Scenes[3].Id}/items", new AddSceneItemRequest(snapshot.Placeholders[0].SourceId, null, null, null, null, null, null)).ExpectProblemAsync(HttpStatusCode.BadRequest);

        Assert.Equal(ErrorCodes.ValidationFailed, code);
    }

    [Fact]
    public async Task Item_OfAPlaceholder_CanStillBeEditedAndTheSceneCopied()
    {
        var (admin, copy, _) = await CopyAsync();
        var snapshot = await SnapshotAsync(admin, copy.Id);
        var scene = snapshot.Scenes[0];
        var item = scene.Items.Single(i => i.Source == snapshot.Placeholders.Single(p => p.Code == "K1").SourceId);

        var moved = await admin.Client.PutJsonAsync($"/api/productions/{copy.Id}/scenes/{scene.Id}/items/{item.Id}", item with { X = 100 }).ExpectAsync<SceneDto>();
        var cloned = await admin.Client.PostJsonAsync($"/api/productions/{copy.Id}/scenes", new CreateSceneRequest("Cloned", scene.Id)).ExpectAsync<SceneDto>(HttpStatusCode.Created);

        Assert.Equal(100, moved.Items.Single(i => i.Id == item.Id).X);
        Assert.Contains(cloned.Items, i => i.Source == item.Source);
    }

    [Fact]
    public async Task Placeholders_AreInTheSnapshotOfTheRegieOnly()
    {
        var (admin, copy, _) = await CopyAsync();
        var key = (await admin.GetOutputLinksAsync()).Single().Key();
        var output = app.Anonymous();
        output.DefaultRequestHeaders.Add("X-Output-Key", key);

        var snapshot = await output.GetAsync($"/api/output/{copy.Slug}/snapshot", TestContext.Current.CancellationToken).ExpectAsync<OutputSnapshot>();

        Assert.NotNull(snapshot);
        Assert.DoesNotContain("\"placeholders\"", System.Text.Json.JsonSerializer.Serialize(snapshot, ContractJson.Options), StringComparison.OrdinalIgnoreCase);
    }

    private static Task<HttpResponseMessage> AssignAsync(AdminSession admin, string productionId, string placeholderId, string sourceId) =>
        admin.Client.PutJsonAsync($"/api/productions/{productionId}/placeholders/{placeholderId}/assignment", new AssignPlaceholderRequest(sourceId));

    /// <summary>A copy of a rich production, with an admin session scoped to the copy.</summary>
    private async Task<(AdminSession Admin, ProductionDto Copy, ProductionDto Source)> CopyAsync()
    {
        var source = await CreateRichProductionAsync(app);
        var copy = await source.Admin.Client.PostJsonAsync($"/api/productions/{source.Id}/duplicate", new DuplicateProductionRequest("Placeholders " + Guid.NewGuid().ToString("N")[..8])).ExpectAsync<ProductionDto>(HttpStatusCode.Created);
        return (source.Admin with { ProductionId = copy.Id }, copy, source.Production);
    }
}
