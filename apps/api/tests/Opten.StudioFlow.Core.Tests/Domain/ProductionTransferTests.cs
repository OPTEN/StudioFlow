using System.Text;
using System.Text.Json.Nodes;
using Opten.StudioFlow.Core.Contracts;
using Opten.StudioFlow.Core.Domain;
using Opten.StudioFlow.Core.Domain.Transfer;

namespace Opten.StudioFlow.Core.Tests.Domain;

public sealed class ProductionExportTests
{
    private readonly Production production = Build.Production("Source");
    private readonly List<Device> devices = [];
    private readonly List<Asset> assets = [];

    private SourceCatalog Catalog => new(devices, assets, production.TextSources, production.Placeholders);

    private void AddItem(string source, int scene = 0) => production.OrderedScenes[scene].AddItem(Build.Add(source), Catalog, production.Canvas);

    private (ProductionManifest Manifest, IReadOnlyList<ExportMedia> Media) Capture() => ProductionExport.Capture(production, devices, assets, "0.1.0", Build.T0);

    [Fact]
    public void Capture_DeviceSources_BecomePlaceholdersWithCodeLabelAndSlot()
    {
        var phone = Build.Phone(production, "Stage phone");
        var laptop = Build.Laptop(production, "Laptop Lea", [phone.Slots[0].Code]);
        devices.AddRange([phone, laptop]);
        AddItem(phone.SourceIdOf(phone.Slots[0]));
        AddItem(laptop.SourceIdOf(laptop.Slots[0]), scene: 1);

        var manifest = Capture().Manifest;

        Assert.Equal([("K1", SourceKind.Camera, "camera", "Stage phone"), ("S1", SourceKind.Screen, "screen-1", "Laptop Lea · Screen 1")], manifest.Placeholders.Select(p => (p.Code, p.Kind, p.Slot, p.Label)));
        Assert.Equal(["p1", "p2"], manifest.Placeholders.Select(p => p.Key));
        Assert.Equal("placeholder:p1", manifest.Scenes[0].Items[0].Source);
        Assert.Equal("placeholder:p2", manifest.Scenes[1].Items[0].Source);
    }

    [Fact]
    public void Capture_ADeviceUsedByManyItems_IsOnePlaceholder()
    {
        var phone = Build.Phone(production);
        devices.Add(phone);
        var camera = phone.SourceIdOf(phone.Slots[0]);
        AddItem(camera);
        AddItem(camera, scene: 1);
        AddItem(camera, scene: 2);

        var manifest = Capture().Manifest;

        Assert.Single(manifest.Placeholders);
        Assert.All(manifest.Scenes.Take(3), scene => Assert.Equal("placeholder:p1", Assert.Single(scene.Items).Source));
    }

    [Fact]
    public void Capture_ADeviceNoSceneUses_IsLeftOut()
    {
        devices.Add(Build.Phone(production));
        devices.Add(Build.Laptop(production));

        Assert.Empty(Capture().Manifest.Placeholders);
    }

    [Fact]
    public void Capture_ADeviceThatIsGone_BecomesAPlaceholderWithTheNextFreeCodeAndNoName()
    {
        var phone = Build.Phone(production, "Stage phone");
        devices.Add(phone);
        AddItem(phone.SourceIdOf(phone.Slots[0]));
        var removed = Build.Phone(production, "Gone", [phone.Slots[0].Code]);
        var goneSource = removed.SourceIdOf(removed.Slots[0]);
        production.OrderedScenes[1].ReplaceItems([Build.Item(goneSource)], null, new SourceCatalog([removed], [], []));

        var placeholders = Capture().Manifest.Placeholders;

        Assert.Equal([("K1", "Stage phone"), ("K2", null)], placeholders.Select(p => (p.Code, p.Label)));
    }

    [Fact]
    public void Capture_PlaceholdersOfTheProduction_KeepTheirCodeAndLabel_AndUnusedOnesDropOut()
    {
        var (copy, copyAssets) = Copy();
        var unused = SourcePlaceholders.Create("K7", SourceKind.Camera, "camera", "Unused");
        var withUnused = Production.Restore(copy.Id, copy.Name, copy.Slug, Build.T0, copy.CanvasFormat, copy.CanvasResolution, copy.StandbySlate, copy.EndSlate, copy.TextTheme, [], [.. copy.Placeholders, unused], copy.OrderedScenes);

        var placeholders = ProductionExport.Capture(withUnused, [], copyAssets, "0.1.0", Build.T0).Manifest.Placeholders;

        Assert.Equal([("K1", "Stage phone")], placeholders.Select(p => (p.Code, p.Label)));
    }

    [Fact]
    public void Capture_MediaTextsAndSlates_UseKeys_AndNoIdOfTheInstallation()
    {
        var image = Build.Image(production, "Logo");
        var video = Build.Video(production, "Intro", [image.Code]);
        assets.AddRange([image, video]);
        production.AddTextSource(new CreateTextSourceRequest("Mia", "Host", TextStyle.LowerThird, null), Catalog.CodesInUse);
        var text = production.TextSources[0];
        AddItem(image.Id);
        AddItem(video.Id);
        AddItem(text.Id, scene: 1);
        production.OrderedScenes[0].Update(new UpdateSceneRequest(null, null, new SceneBackgroundDto("#112233", image.Id)), Catalog);
        production.Update(new UpdateProductionRequest(null, new SlateDto("Soon", null, image.Id), null), Catalog);

        var (manifest, media) = Capture();

        Assert.Equal(["a1", "a2"], manifest.Assets.Select(a => a.Key));
        Assert.Equal(["media/a1.png", "media/a2.mp4"], manifest.Assets.Select(a => a.File));
        Assert.Equal([image.Id, video.Id], media.Select(m => m.AssetId));
        Assert.Equal(["asset:a1", "asset:a2"], manifest.Scenes[0].Items.Select(i => i.Source));
        Assert.Equal("text:t1", manifest.Scenes[1].Items[0].Source);
        Assert.Equal("a1", manifest.Scenes[0].Background.Asset);
        Assert.Equal("a1", manifest.Production.StandbySlate.BackgroundAsset);
        var text1 = Encoding.UTF8.GetString(ManifestJson.Serialize(manifest));
        foreach (var id in new[] { production.Id, image.Id, video.Id, text.Id }.Concat(production.Scenes.Select(s => s.Id)).Concat(production.Scenes.SelectMany(s => s.Items).Select(i => i.Id)))
        {
            Assert.DoesNotContain(id, text1, StringComparison.Ordinal);
        }
    }

    [Fact]
    public void Capture_ItemsWhoseSourceIsGone_AreLeftOut()
    {
        var image = Build.Image(production);
        var deleted = Build.Image(production, "Deleted", [image.Code]);
        assets.AddRange([image, deleted]);
        AddItem(image.Id);
        AddItem(deleted.Id);
        assets.Remove(deleted);

        var item = Assert.Single(Capture().Manifest.Scenes[0].Items);
        Assert.Equal("asset:a1", item.Source);
    }

    [Fact]
    public void Capture_LeavesOutWhatBelongsToTheInstallation()
    {
        production.StartBroadcast(Build.T0);
        production.SetPreview(production.OrderedScenes[1].Id, Build.T0);
        production.SwitchProgram(production.OrderedScenes[2].Id, Build.Fade(), Build.T0);

        var text = Encoding.UTF8.GetString(ManifestJson.Serialize(Capture().Manifest));

        foreach (var left in new[] { "broadcast", "live", "preview", "program", "lastTransition", "isActive", "tenant", "slug", "key", "secret" })
        {
            Assert.DoesNotContain($"\"{left}", text, StringComparison.OrdinalIgnoreCase);
        }
    }

    [Fact]
    public void Capture_ScenesKeepTheirOrder_AndEverythingOfAnItem()
    {
        var phone = Build.Phone(production);
        devices.Add(phone);
        production.AddScene("Last", null, Build.T0);
        production.ReorderScenes([.. production.OrderedScenes.Select(s => s.Id).Reverse()]);
        var item = Build.Item(phone.SourceIdOf(phone.Slots[0])) with { X = -5, Y = 7, W = 321, H = 123, Fit = ItemFit.Contain, Crop = new CropDto(0.2, 0.1, 0.05, 0.3), Radius = 20, Mirror = true, Rotation = 270, Hidden = true, Locked = true, Border = new BorderDto(6, "#abcdef"), OnLost = new LostBehaviorDto(null, null) };
        production.OrderedScenes[0].ReplaceItems([item], SceneLayoutMode.AutoGrid, Catalog);

        var manifest = Capture().Manifest;

        Assert.Equal(["Last", "Break", "Presentation", "Welcome"], manifest.Scenes.Select(s => s.Name));
        Assert.Equal(SceneLayoutMode.AutoGrid, manifest.Scenes[0].LayoutMode);
        var exported = manifest.Scenes[0].Items[0];
        Assert.Equal((-5, 7, 321, 123, ItemFit.Contain, 20, true, 270, true, true), (exported.X, exported.Y, exported.W, exported.H, exported.Fit, exported.Radius, exported.Mirror, exported.Rotation, exported.Hidden, exported.Locked));
        Assert.Equal(new ManifestCrop(0.2, 0.1, 0.05, 0.3), exported.Crop);
        Assert.Equal(new ManifestBorder(6, "#abcdef"), exported.Border);
        Assert.Equal(new ManifestOnLost(null, null), exported.OnLost);
    }

    [Fact]
    public void Capture_CanvasThemeAndSlates_AreTakenOver()
    {
        var portrait = Production.Create("Portrait", "portrait", true, Build.T0, CanvasFormat.Portrait, CanvasResolution.P720);
        portrait.Update(new UpdateProductionRequest("Portrait", new SlateDto("Soon", "At ten", null), new SlateDto("Bye", null, null), new TextThemeDto("#111111", "#222222", "#333333")), new SourceCatalog([], []));

        var manifest = ProductionExport.Capture(portrait, [], [], "1.2.3", Build.T0).Manifest;

        Assert.Equal(new ManifestCanvas(CanvasFormat.Portrait, CanvasResolution.P720), manifest.Production.Canvas);
        Assert.Equal(new ManifestTextTheme("#111111", "#222222", "#333333"), manifest.Production.TextTheme);
        Assert.Equal(new ManifestSlate("Soon", "At ten"), manifest.Production.StandbySlate);
        Assert.Equal(new ManifestApp("1.2.3", Build.T0), manifest.App);
    }

    [Fact]
    public void Roundtrip_ExportOfTheCopy_EqualsTheExportOfTheOriginal()
    {
        var (copy, copyAssets) = Copy();

        var first = Encoding.UTF8.GetString(ManifestJson.Serialize(ProductionExport.Capture(production, devices, assets, "x", Build.T0).Manifest));
        var second = Encoding.UTF8.GetString(ManifestJson.Serialize(ProductionExport.Capture(copy, [], copyAssets, "x", Build.T0).Manifest));
        Assert.Equal(first, second);
    }

    /// <summary>A production with a phone (K1 “Stage phone”), an image and items for both; and the copy a transfer makes of it.</summary>
    private (Production Copy, List<Asset> Assets) Copy()
    {
        var phone = Build.Phone(production, "Stage phone");
        var image = Build.Image(production, "Logo");
        devices.Add(phone);
        assets.Add(image);
        AddItem(phone.SourceIdOf(phone.Slots[0]));
        AddItem(image.Id, scene: 1);
        var manifest = ProductionExport.Capture(production, devices, assets, "x", Build.T0).Manifest;
        var plan = TransferPlan.Create(manifest);
        var copy = plan.Build(manifest.Production.Name, "copy", Build.T0);
        var copied = plan.Assets.Select(a => Asset.Create(a.AssetId, copy.Id, a.Code, a.Name, a.Entry.Kind, a.Entry.ContentType, a.Entry.SizeBytes, null, null, a.AssetId + Path.GetExtension(a.Entry.File), Build.T0)).ToList();
        return (copy, copied);
    }
}

public sealed class TransferPlanTests
{
    private static ProductionManifest Manifest() => Fixture.Manifest();

    [Fact]
    public void Create_AssignsNewIdsToEverything()
    {
        var plan = TransferPlan.Create(Manifest());
        var production = plan.Build("Copy", "copy", Build.T0);

        Assert.StartsWith(EntityIds.Production, production.Id, StringComparison.Ordinal);
        Assert.Equal(plan.ProductionId, production.Id);
        var scene = Assert.Single(production.Scenes);
        Assert.StartsWith(EntityIds.Scene, scene.Id, StringComparison.Ordinal);
        Assert.Equal(production.Id, scene.ProductionId);
        Assert.All(scene.Items, item => Assert.StartsWith(EntityIds.Item, item.Id, StringComparison.Ordinal));
        Assert.Equal(2, scene.Items.Select(i => i.Id).Distinct().Count());
        var asset = Assert.Single(plan.Assets);
        Assert.StartsWith(EntityIds.Asset, asset.AssetId, StringComparison.Ordinal);
        Assert.StartsWith(EntityIds.Text, production.TextSources[0].Id, StringComparison.Ordinal);
        var placeholder = Assert.Single(production.Placeholders);
        Assert.StartsWith(EntityIds.Placeholder, placeholder.Id, StringComparison.Ordinal);
        Assert.True(SourceRef.TryParse(placeholder.SourceId, out var parsed) && parsed.IsDevice);
    }

    [Fact]
    public void Create_TwiceFromTheSameManifest_GivesDifferentIds()
    {
        var first = TransferPlan.Create(Manifest());
        var second = TransferPlan.Create(Manifest());

        Assert.NotEqual(first.ProductionId, second.ProductionId);
        Assert.NotEqual(first.Assets[0].AssetId, second.Assets[0].AssetId);
        Assert.NotEqual(first.Placeholders[0].SourceId, second.Placeholders[0].SourceId);
        Assert.NotEqual(first.Placeholders[0].Id, second.Placeholders[0].Id);
    }

    [Fact]
    public void Create_ResolvesEveryReferenceToTheNewId()
    {
        var plan = TransferPlan.Create(Manifest());
        var production = plan.Build("Copy", "copy", Build.T0);
        var scene = production.OrderedScenes[0];

        Assert.Equal(production.Placeholders[0].SourceId, scene.Items[0].Source);
        Assert.Equal(plan.Assets[0].AssetId, scene.Items[0].OnLost.FallbackSource);
        Assert.Equal(production.TextSources[0].Id, scene.Items[1].Source);
        Assert.Equal(plan.Assets[0].AssetId, scene.Background.AssetId);
        Assert.Equal(plan.Assets[0].AssetId, production.StandbySlate.BackgroundAssetId);
        Assert.Null(production.EndSlate.BackgroundAssetId);
    }

    [Fact]
    public void Build_StartsInStandbyNotActiveAtTheFirstScene()
    {
        var production = TransferPlan.Create(Manifest()).Build("Copy", "copy", Build.T0);

        Assert.Equal((false, BroadcastState.Standby, "opten", "Copy", "copy"), (production.IsActive, production.Broadcast, production.TenantId, production.Name, production.Slug));
        Assert.Equal(production.OrderedScenes[0].Id, production.ProgramSceneId);
        Assert.Null(production.PreviewSceneId);
        Assert.Null(production.LastTransition);
        Assert.Equal(Build.T0, production.CreatedAt);
        Assert.Equal(1, production.OrderedScenes[0].Version);
    }

    [Fact]
    public void Create_KeepsCodesLabelsAndOrder()
    {
        var manifest = Manifest() with
        {
            Texts = [.. Manifest().Texts, new ManifestText("t2", "T5", "Second", TextStyle.Note, TextAlign.Right)],
            Scenes = [.. Manifest().Scenes, Manifest().Scenes[0] with { Name = "Second scene" }],
        };

        var plan = TransferPlan.Create(manifest);
        var production = plan.Build("Copy", "copy", Build.T0);

        Assert.Equal(["T1", "T5"], production.TextSources.Select(t => t.Code));
        Assert.Equal(["M1"], plan.Assets.Select(a => a.Code));
        Assert.Equal(["Intro", "Second scene"], production.OrderedScenes.Select(s => s.Name));
        Assert.Equal([0, 1], production.OrderedScenes.Select(s => s.SortOrder));
        Assert.Equal(("K1", "Stage phone", SourceKind.Camera), (production.Placeholders[0].Code, production.Placeholders[0].Label, production.Placeholders[0].Kind));
    }

    [Fact]
    public void Create_Summary_CountsWhatTheFileHolds()
    {
        var plan = TransferPlan.Create(Manifest());

        Assert.Equal((1, 1, 1, 2000L, "0.1.0+abc1234"), (plan.SceneCount, plan.TextCount, plan.Assets.Count, plan.MediaBytes, plan.AppVersion));
        Assert.Equal("Webinar “Zürich” 😀", plan.Name);
    }

    [Fact]
    public void Create_CleansNamesAndTexts()
    {
        var manifest = Manifest() with
        {
            Production = Manifest().Production with { Name = "  Gala‮  " },
            Scenes = [Manifest().Scenes[0] with { Name = "\u0007Intro\n" }],
        };

        var plan = TransferPlan.Create(manifest);

        Assert.Equal("Gala", plan.Name);
        Assert.Equal("Intro", plan.Build("Gala", "gala", Build.T0).OrderedScenes[0].Name);
    }

    [Fact]
    public void Create_AnEmptyProduction_IsFine()
    {
        var manifest = Manifest() with { Texts = [], Assets = [], Placeholders = [], Scenes = [] };
        manifest = manifest with { Production = manifest.Production with { StandbySlate = new ManifestSlate("Soon") } };

        var production = TransferPlan.Create(manifest).Build("Empty", "empty", Build.T0);

        Assert.Empty(production.Scenes);
        Assert.Null(production.ProgramSceneId);
    }

    [Fact]
    public void Create_LimitsOfTheDomain_AreEnforced()
    {
        var scene = Manifest().Scenes[0];
        var item = scene.Items[1];
        var text = Manifest().Texts[0];
        var placeholder = Manifest().Placeholders[0];

        Assert.Equal(ErrorCodes.LimitReached, Assert.Throws<StudioFlowException>(() => TransferPlan.Create(Manifest() with { Scenes = [.. Enumerable.Repeat(scene, 100)] })).Code);
        Assert.Equal(ErrorCodes.LimitReached, Assert.Throws<StudioFlowException>(() => TransferPlan.Create(Manifest() with { Scenes = [scene with { Items = [.. Enumerable.Repeat(item, 33)] }] })).Code);
        Assert.Equal(ErrorCodes.LimitReached, Assert.Throws<StudioFlowException>(() => TransferPlan.Create(Manifest() with { Texts = [.. Enumerable.Range(1, 65).Select(i => text with { Key = $"t{i}", Code = $"T{i}" })] })).Code);
        Assert.Equal(ErrorCodes.LimitReached, Assert.Throws<StudioFlowException>(() => TransferPlan.Create(Manifest() with { Placeholders = [.. Enumerable.Range(1, 101).Select(i => placeholder with { Key = $"p{i}", Code = $"K{i}" })] })).Code);
        Assert.NotNull(TransferPlan.Create(Manifest() with { Scenes = [.. Enumerable.Repeat(scene, 99)] }));
        Assert.NotNull(TransferPlan.Create(Manifest() with { Scenes = [scene with { Items = [.. Enumerable.Repeat(item, 32)] }] }));
    }

    [Fact]
    public void Create_EveryProblem_IsReportedWithItsPath()
    {
        var manifest = Manifest();
        var item = manifest.Scenes[0].Items[0];
        var broken = manifest with
        {
            Production = manifest.Production with
            {
                Name = " ",
                TextTheme = new ManifestTextTheme("red", "#000000", "#ffffff"),
                StandbySlate = new ManifestSlate("", null, "nope"),
            },
            Texts = [manifest.Texts[0] with { Code = "X1", Line1 = new string('x', 121) }],
            Assets = [manifest.Assets[0] with { File = "media/../x.png", Code = "M0" }, manifest.Assets[0] with { Key = "A B", SizeBytes = -1 }],
            Placeholders = [manifest.Placeholders[0] with { Code = "S1" }, manifest.Placeholders[0] with { Key = "p2", Slot = "screen-1" }],
            Scenes = [manifest.Scenes[0] with { Items = [item with { X = 5000, Source = "asset:zz", Rotation = 10 }, item with { OnLost = new ManifestOnLost(null, "text:t1") }, item with { Source = "text:t1", OnLost = new ManifestOnLost(null, "text:t1") }] }],
        };

        var error = Assert.Throws<StudioFlowException>(() => TransferPlan.Create(broken));

        Assert.Equal(ErrorCodes.InvalidArchive, error.Code);
        var paths = error.Errors!.Keys.ToList();
        foreach (var path in new[]
        {
            "production.name",
            "production.textTheme.accent",
            "production.standbySlate.title",
            "production.standbySlate.backgroundAsset",
            "texts[0].code",
            "texts[0].line1",
            "assets[0].file",
            "assets[0].code",
            "assets[1].key",
            "assets[1].sizeBytes",
            "placeholders[0].code",
            "placeholders[1].slot",
            "scenes[0].items[0].x",
            "scenes[0].items[0].source",
            "scenes[0].items[0].rotation",
            "scenes[0].items[1].onLost.fallbackSource",
            "scenes[0].items[2].onLost.fallbackSource",
        })
        {
            Assert.Contains(path, paths);
        }
    }

    [Fact]
    public void Create_DuplicateKeysAndCodes_AreErrorsNotCrashes()
    {
        var manifest = Manifest();
        var twice = manifest with
        {
            Texts = [manifest.Texts[0], manifest.Texts[0]],
            Assets = [manifest.Assets[0], manifest.Assets[0]],
            Placeholders = [manifest.Placeholders[0], manifest.Placeholders[0]],
        };

        var error = Assert.Throws<StudioFlowException>(() => TransferPlan.Create(twice));

        Assert.Contains("texts[1].key", error.Errors!.Keys);
        Assert.Contains("texts[1].code", error.Errors.Keys);
        Assert.Contains("assets[1].key", error.Errors.Keys);
        Assert.Contains("assets[1].file", error.Errors.Keys);
        Assert.Contains("placeholders[1].code", error.Errors.Keys);
    }

    [Fact]
    public void Create_AnItemThatIsItsOwnFallback_IsInvalid()
    {
        var manifest = Manifest();
        var item = manifest.Scenes[0].Items[0] with { OnLost = new ManifestOnLost(null, "placeholder:p1") };

        var error = Assert.Throws<StudioFlowException>(() => TransferPlan.Create(manifest with { Scenes = [manifest.Scenes[0] with { Items = [item] }] }));

        Assert.Contains("scenes[0].items[0].onLost.fallbackSource", error.Errors!.Keys);
    }

    [Fact]
    public void Create_ABackgroundThatIsAVideo_IsInvalid()
    {
        var manifest = Manifest();
        var video = manifest.Assets[0] with { Key = "a2", Code = "M2", Kind = AssetKind.Video, File = "media/a2.mp4" };
        var broken = manifest with { Assets = [manifest.Assets[0], video], Scenes = [manifest.Scenes[0] with { Background = new ManifestBackground("#000000", "a2") }] };

        Assert.Contains("scenes[0].background.asset", Assert.Throws<StudioFlowException>(() => TransferPlan.Create(broken)).Errors!.Keys);
    }

    [Fact]
    public void Create_ProductionName_IsNotMadeUniqueByThePlan()
    {
        var plan = TransferPlan.Create(Manifest());

        Assert.Equal(Manifest().Production.Name, plan.Name);
    }

    [Fact]
    public void ManifestFromJson_PlansLikeTheTypedManifest()
    {
        var json = JsonNode.Parse(ManifestJson.Serialize(Manifest()))!.AsObject();

        var plan = TransferPlan.Create(ManifestJson.Read(Encoding.UTF8.GetBytes(json.ToJsonString())));

        Assert.Equal(1, plan.SceneCount);
    }
}

public sealed class ProductionNamesTests
{
    [Fact]
    public void Unique_FreeName_IsKept() => Assert.Equal("Gala", ProductionNames.Unique("Gala", ["Other"]));

    [Fact]
    public void Unique_TakenName_GetsTheNextNumber()
    {
        Assert.Equal("Gala (2)", ProductionNames.Unique("Gala", ["Gala"]));
        Assert.Equal("Gala (3)", ProductionNames.Unique("Gala", ["Gala", "Gala (2)"]));
        Assert.Equal("Gala (2)", ProductionNames.Unique("Gala", ["Gala", "Gala (3)"]));
    }

    [Fact]
    public void Unique_IgnoresCaseAndSurroundingSpaces() =>
        Assert.Equal("gala (2)", ProductionNames.Unique("gala", [" GALA "]));

    [Fact]
    public void Unique_LongName_IsCutToMakeRoomForTheNumber()
    {
        var name = new string('x', TextRules.NameMax);

        var unique = ProductionNames.Unique(name, [name]);

        Assert.Equal(TextRules.NameMax, unique.Length);
        Assert.EndsWith(" (2)", unique, StringComparison.Ordinal);
    }

    [Fact]
    public void Unique_LongNameWithEmoji_IsCutBetweenCharacters()
    {
        var name = string.Concat(Enumerable.Repeat("😀", TextRules.NameMax));

        var unique = ProductionNames.Unique(name, [name]);

        Assert.True(new System.Globalization.StringInfo(unique).LengthInTextElements <= TextRules.NameMax);
        Assert.EndsWith("😀 (2)", unique, StringComparison.Ordinal);
    }

    [Fact]
    public void CopyOf_AppendsCopy_WithinTheLimit()
    {
        Assert.Equal("Gala (copy)", ProductionNames.CopyOf("Gala"));
        Assert.Equal(TextRules.NameMax, ProductionNames.CopyOf(new string('y', TextRules.NameMax)).Length);
    }
}
