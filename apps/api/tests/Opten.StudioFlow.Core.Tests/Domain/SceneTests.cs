using Opten.StudioFlow.Core.Contracts;
using Opten.StudioFlow.Core.Domain;

namespace Opten.StudioFlow.Core.Tests.Domain;

public sealed class SceneTests
{
    private readonly Production production = Build.Production();
    private readonly Device phone;
    private readonly Device laptop;
    private readonly Asset image;
    private readonly SourceCatalog catalog;

    public SceneTests()
    {
        phone = Build.Phone(production);
        laptop = Build.Laptop(production, codes: ["K1"]);
        image = Build.Image(production);
        catalog = new SourceCatalog([phone, laptop], [image]);
    }

    private Scene Scene => production.OrderedScenes[0];

    private string Camera => phone.SourceIdOf(phone.Slots[0]);

    private string Screen => laptop.SourceIdOf(laptop.Slots[0]);

    [Fact]
    public void AddItem_WithoutGeometry_UsesServerDefaults()
    {
        var item = Scene.AddItem(Build.Add(Camera), catalog);

        Assert.Equal((1240, 680, 600, 338, 12), (item.X, item.Y, item.W, item.H, item.Radius));
        Assert.Equal(ItemFit.Cover, item.Fit);
        Assert.Equal(SceneItemRules.NoCrop, item.Crop);
        Assert.Equal(new LostBehaviorDto(3000, null), item.OnLost);
        Assert.Equal(0, item.Rotation);
        Assert.False(item.Hidden);
        Assert.True(EntityIds.IsValid(item.Id, EntityIds.Item));
    }

    [Fact]
    public void AddItem_Screen_DefaultsToContain() => Assert.Equal(ItemFit.Contain, Scene.AddItem(Build.Add(Screen), catalog).Fit);

    [Fact]
    public void AddItem_Change_IncrementsVersionAndAppendsAtFront()
    {
        var before = Scene.Version;
        Scene.AddItem(Build.Add(Camera), catalog);
        var second = Scene.AddItem(Build.Add(image.Id), catalog);

        Assert.Equal(before + 2, Scene.Version);
        Assert.Equal(second.Id, Scene.Items[^1].Id);
    }

    [Fact]
    public void AddItem_UnknownSource_IsValidationError()
    {
        var error = Assert.Throws<StudioFlowException>(() => Scene.AddItem(Build.Add("dev_unknown1/camera"), catalog));

        Assert.True(error.Errors!.ContainsKey("source"));
    }

    [Fact]
    public void AddItem_GeometryOutOfBounds_ReportsEveryField()
    {
        var error = Assert.Throws<StudioFlowException>(() => Scene.AddItem(new AddSceneItemRequest(Camera, -3841, 2161, 15, 2161, (ItemFit)9, 201), catalog));

        Assert.Equal(["fit", "h", "radius", "w", "x", "y"], error.Errors!.Keys.Order(StringComparer.Ordinal));
    }

    [Fact]
    public void AddItem_ThirtyThirdItem_IsLimitReached()
    {
        for (var i = 0; i < SceneItemRules.MaxItems; i++)
        {
            Scene.AddItem(Build.Add(Camera), catalog);
        }

        var error = Assert.Throws<StudioFlowException>(() => Scene.AddItem(Build.Add(Camera), catalog));

        Assert.Equal(ErrorCodes.LimitReached, error.Code);
        Assert.Equal(ErrorKind.Conflict, error.Kind);
    }

    [Theory]
    [InlineData(-3840, -2160, 16, 16, true)]
    [InlineData(3840, 2160, 3840, 2160, true)]
    [InlineData(-3841, 0, 100, 100, false)]
    [InlineData(0, 2161, 100, 100, false)]
    [InlineData(0, 0, 3841, 100, false)]
    [InlineData(0, 0, 100, 15, false)]
    public void ReplaceItems_GeometryBounds_AreInclusive(int x, int y, int w, int h, bool valid)
    {
        var item = Build.Item(Camera) with { X = x, Y = y, W = w, H = h };

        var replace = () => Scene.ReplaceItems([item], null, catalog);

        if (valid)
        {
            replace();
            Assert.Single(Scene.Items);
        }
        else
        {
            Assert.Throws<StudioFlowException>(replace);
        }
    }

    [Theory]
    [InlineData(0.45, 0, 0, 0, true)]
    [InlineData(0.46, 0, 0, 0, false)]
    [InlineData(-0.01, 0, 0, 0, false)]
    [InlineData(0.45, 0, 0.44, 0, true)]
    [InlineData(0.45, 0, 0.45, 0, false)]
    [InlineData(0, 0.45, 0, 0.45, false)]
    [InlineData(double.NaN, 0, 0, 0, false)]
    public void ReplaceItems_Crop_FollowsSideAndAxisLimits(double top, double right, double bottom, double left, bool valid)
    {
        var item = Build.Item(Camera) with { Crop = new CropDto(top, right, bottom, left) };

        var exception = Record.Exception(() => Scene.ReplaceItems([item], null, catalog));

        Assert.Equal(valid, exception is null);
    }

    [Theory]
    [InlineData(0, true)]
    [InlineData(90, true)]
    [InlineData(270, true)]
    [InlineData(45, false)]
    [InlineData(360, false)]
    public void ReplaceItems_Rotation_OnlyQuarterTurns(int rotation, bool valid) =>
        Assert.Equal(valid, Record.Exception(() => Scene.ReplaceItems([Build.Item(Camera) with { Rotation = rotation }], null, catalog)) is null);

    [Theory]
    [InlineData(1, "#ff0000", true)]
    [InlineData(40, "#AbCdEf", true)]
    [InlineData(0, "#ff0000", false)]
    [InlineData(41, "#ff0000", false)]
    [InlineData(4, "red", false)]
    [InlineData(4, "#fff", false)]
    public void ReplaceItems_Border_ValidatesWidthAndColour(int width, string color, bool valid) =>
        Assert.Equal(valid, Record.Exception(() => Scene.ReplaceItems([Build.Item(Camera) with { Border = new BorderDto(width, color) }], null, catalog)) is null);

    [Theory]
    [InlineData(null, true)]
    [InlineData(0, true)]
    [InlineData(600_000, true)]
    [InlineData(600_001, false)]
    [InlineData(-1, false)]
    public void ReplaceItems_HoldMs_IsBounded(int? holdMs, bool valid) =>
        Assert.Equal(valid, Record.Exception(() => Scene.ReplaceItems([Build.Item(Camera) with { OnLost = new LostBehaviorDto(holdMs, null) }], null, catalog)) is null);

    [Fact]
    public void ReplaceItems_FallbackSameAsSource_IsInvalid()
    {
        var error = Assert.Throws<StudioFlowException>(() => Scene.ReplaceItems([Build.Item(Camera) with { OnLost = new LostBehaviorDto(3000, Camera) }], null, catalog));

        Assert.True(error.Errors!.ContainsKey("items[0].onLost.fallbackSource"));
    }

    [Fact]
    public void ReplaceItems_FallbackExisting_IsAccepted()
    {
        Scene.ReplaceItems([Build.Item(Camera) with { OnLost = new LostBehaviorDto(3000, image.Id) }], null, catalog);

        Assert.Equal(image.Id, Scene.Items[0].OnLost.FallbackSource);
    }

    [Fact]
    public void ReplaceItems_DuplicateIds_AreInvalid()
    {
        var item = Build.Item(Camera);

        var error = Assert.Throws<StudioFlowException>(() => Scene.ReplaceItems([item, item with { Source = Screen }], null, catalog));

        Assert.True(error.Errors!.ContainsKey("items[1].id"));
    }

    [Fact]
    public void ReplaceItems_DeletedSourceOfExistingItem_IsKept()
    {
        var item = Scene.AddItem(Build.Add(Camera), catalog);
        var withoutPhone = new SourceCatalog([laptop], [image]);

        Scene.ReplaceItems([item with { X = 10 }], SceneLayoutMode.AutoGrid, withoutPhone);

        Assert.Equal(10, Scene.Items[0].X);
        Assert.Equal(SceneLayoutMode.AutoGrid, Scene.LayoutMode);
    }

    [Fact]
    public void ReplaceItems_DeletedSourceOnNewItem_IsInvalid()
    {
        var withoutPhone = new SourceCatalog([laptop], [image]);

        Assert.Throws<StudioFlowException>(() => Scene.ReplaceItems([Build.Item(Camera)], null, withoutPhone));
    }

    [Fact]
    public void ReplaceItems_TooMany_IsLimitReached()
    {
        var items = Enumerable.Range(0, 33).Select(_ => Build.Item(Camera)).ToList();

        Assert.Equal(ErrorCodes.LimitReached, Assert.Throws<StudioFlowException>(() => Scene.ReplaceItems(items, null, catalog)).Code);
    }

    [Fact]
    public void ReplaceItems_NullItemsOrNullEntry_AreInvalid()
    {
        Assert.Throws<StudioFlowException>(() => Scene.ReplaceItems(null, null, catalog));
        Assert.Throws<StudioFlowException>(() => Scene.ReplaceItems([null!], null, catalog));
    }

    [Fact]
    public void UpdateItem_KeepsRouteIdAndReplacesItem()
    {
        var item = Scene.AddItem(Build.Add(Camera), catalog);

        Scene.UpdateItem(item.Id, item with { Id = "itm_other1", W = 800, Mirror = true }, catalog);

        Assert.Equal(item.Id, Scene.Items[0].Id);
        Assert.Equal(800, Scene.Items[0].W);
        Assert.True(Scene.Items[0].Mirror);
    }

    [Fact]
    public void UpdateItem_SourceDeletedLater_IsKept()
    {
        var item = Scene.AddItem(Build.Add(Camera), catalog);

        Scene.UpdateItem(item.Id, item with { Hidden = true }, new SourceCatalog([], []));

        Assert.True(Scene.Items[0].Hidden);
    }

    [Fact]
    public void UpdateItem_ChangedToUnknownSource_IsInvalid()
    {
        var item = Scene.AddItem(Build.Add(Camera), catalog);

        Assert.Throws<StudioFlowException>(() => Scene.UpdateItem(item.Id, item with { Source = "dev_gone1234/camera" }, catalog));
    }

    [Fact]
    public void UpdateItem_UnknownItem_IsNotFound() =>
        Assert.Equal(ErrorKind.NotFound, Assert.Throws<StudioFlowException>(() => Scene.UpdateItem("itm_none", Build.Item(Camera), catalog)).Kind);

    [Fact]
    public void RemoveItem_Existing_RemovesAndUnknownIsNotFound()
    {
        var item = Scene.AddItem(Build.Add(Camera), catalog);

        Scene.RemoveItem(item.Id);

        Assert.Empty(Scene.Items);
        Assert.Throws<StudioFlowException>(() => Scene.RemoveItem(item.Id));
    }

    [Fact]
    public void Update_NoChange_DoesNotIncrementVersion()
    {
        var version = Scene.Version;

        Assert.False(Scene.Update(new UpdateSceneRequest(Scene.Name, Scene.LayoutMode, Scene.Background), catalog));
        Assert.Equal(version, Scene.Version);
    }

    [Fact]
    public void Update_Background_RequiresHexAndImageAsset()
    {
        var video = Build.Video(production, codes: ["M1"]);
        var withVideo = new SourceCatalog([phone], [image, video]);

        Assert.Throws<StudioFlowException>(() => Scene.Update(new UpdateSceneRequest(null, null, new SceneBackgroundDto("#12345", null)), withVideo));
        Assert.Throws<StudioFlowException>(() => Scene.Update(new UpdateSceneRequest(null, null, new SceneBackgroundDto("#123456", video.Id)), withVideo));
        Assert.True(Scene.Update(new UpdateSceneRequest("New", null, new SceneBackgroundDto("#123456", image.Id)), withVideo));
        Assert.Equal("New", Scene.Name);
    }

    [Fact]
    public void UsesAsset_ItemFallbackOrBackground_IsDetected()
    {
        Assert.False(Scene.UsesAsset(image.Id));
        Scene.ReplaceItems([Build.Item(Camera) with { OnLost = new LostBehaviorDto(null, image.Id) }], null, catalog);

        Assert.True(Scene.UsesAsset(image.Id));
    }
}
