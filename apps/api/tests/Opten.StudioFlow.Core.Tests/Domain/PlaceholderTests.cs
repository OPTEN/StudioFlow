using Opten.StudioFlow.Core.Contracts;
using Opten.StudioFlow.Core.Domain;
using Opten.StudioFlow.Core.Domain.Transfer;

namespace Opten.StudioFlow.Core.Tests.Domain;

public sealed class PlaceholderTests
{
    private readonly SourcePlaceholderDto camera = SourcePlaceholders.Create("K1", SourceKind.Camera, "camera", "Stage phone");
    private readonly SourcePlaceholderDto screen = SourcePlaceholders.Create("S1", SourceKind.Screen, "screen-1", "Laptop Lea · Screen 1");
    private readonly List<Device> devices = [];

    /// <summary>A copy with the two placeholders: the first scene shows both, the second the camera with the screen as its fallback.</summary>
    private Production Copy()
    {
        var first = SceneOf("Welcome", [Build.Item(camera.SourceId), Build.Item(screen.SourceId)]);
        var second = SceneOf("Break", [Build.Item(camera.SourceId) with { OnLost = new LostBehaviorDto(1000, screen.SourceId) }]);
        var third = SceneOf("Empty", []);
        return Production.Restore(EntityIds.New(EntityIds.Production), "Copy", "copy", Build.T0, CanvasFormat.Widescreen, CanvasResolution.P1080, new SlateDto("Soon", null, null), new SlateDto("Bye", null, null), TextSourceRules.DefaultTheme, [], [camera, screen], [first, second, third]);
    }

    private static Scene SceneOf(string name, IReadOnlyList<SceneItemDto> items) =>
        Core.Domain.Scene.Restore("prd_x", name, 0, SceneLayoutMode.Free, new SceneBackgroundDto("#000000", null), items);

    private SourceCatalog Catalog(Production production, params Asset[] assets) => new(devices, assets, production.TextSources, production.Placeholders);

    [Fact]
    public void Assign_ReplacesTheSourceInEveryItemAndFallback_AndDropsThePlaceholder()
    {
        var production = Copy();
        var phone = Build.Phone(production, "New phone", ["K1"]);
        devices.Add(phone);
        var target = phone.SourceIdOf(phone.Slots[0]);

        var change = production.AssignPlaceholder(camera.Id, target, Catalog(production));

        Assert.Equal((2, 2), (change.Scenes.Count, change.Items));
        Assert.Equal(camera, change.Placeholder);
        Assert.Equal([screen], production.Placeholders);
        Assert.Equal([target, screen.SourceId], production.OrderedScenes[0].Items.Select(i => i.Source));
        Assert.Equal(target, production.OrderedScenes[1].Items[0].Source);
        Assert.Equal(screen.SourceId, production.OrderedScenes[1].Items[0].OnLost.FallbackSource);
    }

    [Fact]
    public void Assign_ChangesTheVersionOfTheScenesThatChangedOnly()
    {
        var production = Copy();
        var phone = Build.Phone(production);
        devices.Add(phone);
        var versions = production.OrderedScenes.Select(s => s.Version).ToList();

        production.AssignPlaceholder(screen.Id, phone.SourceIdOf(phone.Slots[0]), Catalog(production));

        Assert.Equal([versions[0] + 1, versions[1] + 1, versions[2]], production.OrderedScenes.Select(s => s.Version));
    }

    [Fact]
    public void Assign_TheFallback_IsReplacedAsWell_AndNeverEqualsItsOwnItem()
    {
        var production = Copy();
        var phone = Build.Phone(production, "Phone", ["K1"]);
        devices.Add(phone);
        var target = phone.SourceIdOf(phone.Slots[0]);

        production.AssignPlaceholder(camera.Id, target, Catalog(production));
        production.AssignPlaceholder(screen.Id, target, Catalog(production));

        var item = production.OrderedScenes[1].Items[0];
        Assert.Equal(target, item.Source);
        Assert.Null(item.OnLost.FallbackSource);
        Assert.Empty(production.Placeholders);
    }

    [Fact]
    public void Assign_ToAnImage_Works()
    {
        var production = Copy();
        var image = Build.Image(production);

        production.AssignPlaceholder(camera.Id, image.Id, Catalog(production, image));

        Assert.All(production.OrderedScenes[0].Items.Take(1).Concat(production.OrderedScenes[1].Items), item => Assert.Equal(image.Id, item.Source));
    }

    [Fact]
    public void Assign_Invalid_ThrowsAndChangesNothing()
    {
        var production = Copy();
        var versions = production.OrderedScenes.Select(s => s.Version).ToList();
        production.AddTextSource(new CreateTextSourceRequest("Text", null, TextStyle.Note, null), []);
        var catalog = Catalog(production);

        Assert.Equal(ErrorCodes.ValidationFailed, Assert.Throws<StudioFlowException>(() => production.AssignPlaceholder(camera.Id, production.TextSources[0].Id, catalog)).Code);
        Assert.Equal(ErrorCodes.ValidationFailed, Assert.Throws<StudioFlowException>(() => production.AssignPlaceholder(camera.Id, "dev_unknown000000/camera", catalog)).Code);
        Assert.Equal(ErrorCodes.ValidationFailed, Assert.Throws<StudioFlowException>(() => production.AssignPlaceholder(camera.Id, screen.SourceId, catalog)).Code);
        Assert.Equal(ErrorCodes.ValidationFailed, Assert.Throws<StudioFlowException>(() => production.AssignPlaceholder(camera.Id, null, catalog)).Code);
        Assert.Equal(ErrorCodes.NotFound, Assert.Throws<StudioFlowException>(() => production.AssignPlaceholder("plh_unknown", EntityIds.New(EntityIds.Asset), catalog)).Code);
        Assert.Equal(versions, production.OrderedScenes.Select(s => s.Version));
        Assert.Equal([camera, screen], production.Placeholders);
    }

    [Fact]
    public void Remove_TakesTheItemsOutAndClearsTheFallbacks()
    {
        var production = Copy();

        var change = production.RemovePlaceholder(screen.Id);

        Assert.Equal((2, 1), (change.Scenes.Count, change.Items));
        Assert.Equal([camera.SourceId], production.OrderedScenes[0].Items.Select(i => i.Source));
        Assert.Null(production.OrderedScenes[1].Items[0].OnLost.FallbackSource);
        Assert.Equal([camera], production.Placeholders);
        Assert.Equal(ErrorCodes.NotFound, Assert.Throws<StudioFlowException>(() => production.RemovePlaceholder(screen.Id)).Code);
    }

    [Fact]
    public void UsesSource_FindsItemsAndFallbacks()
    {
        var production = Copy();

        Assert.True(production.UsesSource(camera.SourceId));
        Assert.True(production.UsesSource(screen.SourceId));
        Assert.False(production.UsesSource("dev_nobody0000000/camera"));
        Assert.False(production.OrderedScenes[2].UsesSource(camera.SourceId));
        Assert.True(production.OrderedScenes[1].UsesSource(screen.SourceId));
    }

    [Fact]
    public void Catalog_ReservesTheCodesOfThePlaceholders()
    {
        var production = Copy();
        var catalog = Catalog(production);

        var (phone, _) = Device.Pair(production.Id, "New phone", DeviceKind.Phone, null, PairingMethod.Qr, Build.T0, catalog.CodesInUse);
        var (laptop, _) = Device.Pair(production.Id, "New laptop", DeviceKind.Laptop, null, PairingMethod.Code, Build.T0, catalog.CodesInUse);

        Assert.Equal("K2", phone.Slots[0].Code);
        Assert.Equal("S2", laptop.Slots[0].Code);
        Assert.DoesNotContain(catalog.All, source => source.Code is "K1" or "S1");
        Assert.False(catalog.Contains(camera.SourceId));
    }

    [Fact]
    public void Catalog_AfterAssigning_TheCodeIsFreeAgain()
    {
        var production = Copy();
        production.RemovePlaceholder(camera.Id);

        var (phone, _) = Device.Pair(production.Id, "New phone", DeviceKind.Phone, null, PairingMethod.Qr, Build.T0, Catalog(production).CodesInUse);

        Assert.Equal("K1", phone.Slots[0].Code);
    }

    [Fact]
    public void RecodeSlot_ChangesOnlyTheCodeOfTheSlot()
    {
        var production = Copy();
        var laptop = Build.Laptop(production, "Laptop", ["S1"]);
        laptop.AllocateSlot(SourceKind.Screen, ["S1", "S2"]);

        var recoded = laptop.RecodeSlot("screen-1", "S1");

        Assert.Equal(new DeviceSlot("screen-1", "S1", SourceKind.Screen), recoded);
        Assert.Equal(["S1", "S3"], laptop.Slots.Select(s => s.Code));
        Assert.Equal(["screen-1", "screen-2"], laptop.Slots.Select(s => s.Slot));
        Assert.Equal(ErrorCodes.NotFound, Assert.Throws<StudioFlowException>(() => laptop.RecodeSlot("screen-9", "S9")).Code);
    }

    [Fact]
    public void SourceHealth_Recode_KeepsTheStateAndRenamesTheIncident()
    {
        var health = new SourceHealth("dev_a/camera", "K2", SourceStatus.Ok);
        health.Apply(SourceStatus.Reconnecting, Build.T0);
        var incident = health.Incident!;

        var recoded = health.Recode("K1");

        Assert.Equal(("K1", SourceStatus.Reconnecting), (health.Code, health.Status));
        Assert.Equal(incident with { Code = "K1" }, recoded);
        Assert.Null(new SourceHealth("dev_a/screen-1", "S1", SourceStatus.Ok).Recode("S2"));
    }

    [Theory]
    [InlineData("K1", SourceKind.Camera, true)]
    [InlineData("K12", SourceKind.Camera, true)]
    [InlineData("S3", SourceKind.Screen, true)]
    [InlineData("S1", SourceKind.Camera, false)]
    [InlineData("K1", SourceKind.Screen, false)]
    [InlineData("M1", SourceKind.Camera, false)]
    [InlineData("K0", SourceKind.Camera, false)]
    [InlineData("K", SourceKind.Camera, false)]
    [InlineData("k1", SourceKind.Camera, false)]
    [InlineData("K1 ", SourceKind.Camera, false)]
    [InlineData("K10000", SourceKind.Camera, false)]
    [InlineData("K1", SourceKind.Image, false)]
    [InlineData(null, SourceKind.Camera, false)]
    public void IsValidCode_MatchesTheCodeOfTheKind(string? code, SourceKind kind, bool valid) =>
        Assert.Equal(valid, SourcePlaceholders.IsValidCode(code, kind));

    [Fact]
    public void Create_GivesAUnusedDeviceIdAndTheGivenSlot()
    {
        var placeholder = SourcePlaceholders.Create("K1", SourceKind.Camera, "camera", "  Stage\u0007 phone ");

        Assert.True(SourceRef.TryParse(placeholder.SourceId, out var parsed));
        Assert.Equal(("camera", true), (parsed.Slot, parsed.IsDevice));
        Assert.StartsWith(EntityIds.Placeholder, placeholder.Id, StringComparison.Ordinal);
        Assert.Equal("Stage phone", placeholder.Label);
        Assert.NotEqual(SourcePlaceholders.Create("K1", SourceKind.Camera, "camera", null).SourceId, placeholder.SourceId);
        Assert.Throws<ArgumentException>(() => SourcePlaceholders.Create("X1", SourceKind.Camera, "camera", null));
        Assert.Throws<ArgumentException>(() => SourcePlaceholders.Create("K1", SourceKind.Camera, "screen-10", null));
    }

    [Theory]
    [InlineData("camera", SourceKind.Camera)]
    [InlineData("screen-1", SourceKind.Screen)]
    [InlineData("screen-9", SourceKind.Screen)]
    [InlineData("screen-0", null)]
    [InlineData("other", null)]
    public void KindOfSlot_KnowsCameraAndScreens(string slot, SourceKind? kind) => Assert.Equal(kind, SourcePlaceholders.KindOfSlot(slot));
}

public sealed class TransferLogTextTests
{
    [Fact]
    public void NewActions_HaveACategoryAndALogText()
    {
        var duplicated = AuditEntry.Create("prd_x", Build.T0, "admin", AuditActions.ProductionDuplicated, new Dictionary<string, string> { ["name"] = "Copy", ["from"] = "Original" });
        var exported = AuditEntry.Create("prd_x", Build.T0, "admin", AuditActions.ProductionExported, new Dictionary<string, string> { ["name"] = "Original" });
        var imported = AuditEntry.Create("prd_x", Build.T0, "admin", AuditActions.ProductionImported, new Dictionary<string, string> { ["name"] = "Imported" });
        var assigned = AuditEntry.Create("prd_x", Build.T0, "admin", AuditActions.PlaceholderAssigned, new Dictionary<string, string> { ["code"] = "K1", ["target"] = "K3 Phone" });
        var removed = AuditEntry.Create("prd_x", Build.T0, "admin", AuditActions.PlaceholderRemoved, new Dictionary<string, string> { ["code"] = "S1" });

        Assert.Equal("Production “Original” duplicated as “Copy”", LogTexts.For(duplicated));
        Assert.Equal("Production “Original” exported", LogTexts.For(exported));
        Assert.Equal("Production “Imported” imported", LogTexts.For(imported));
        Assert.Equal("K1 assigned to K3 Phone", LogTexts.For(assigned));
        Assert.Equal("S1 removed from the scenes", LogTexts.For(removed));
        Assert.Equal(LogCode.PlaceholderAssigned, LogTexts.Describe(assigned)!.Value.Code);
        Assert.All(new[] { duplicated, exported, imported, assigned, removed }, entry => Assert.Equal(AuditCategory.Production, AuditCategories.Of(entry.Action)));
        Assert.All(new[] { duplicated, exported, imported, assigned, removed }, entry => Assert.True(AuditCategories.IsKnown(entry.Action)));
    }

    [Fact]
    public void NewActions_AreNotInRecentEvents_OfALiveProduction()
    {
        foreach (var action in new[] { AuditActions.ProductionDuplicated, AuditActions.ProductionExported, AuditActions.ProductionImported, AuditActions.PlaceholderAssigned, AuditActions.PlaceholderRemoved })
        {
            Assert.Null(LogTexts.DescribeRecent(AuditEntry.Create("prd_x", Build.T0, "admin", action)));
        }
    }
}
