using Opten.StudioFlow.Core.Application;
using Opten.StudioFlow.Core.Contracts;
using Opten.StudioFlow.Core.Domain;

namespace Opten.StudioFlow.Core.Tests.Domain;

public sealed class CanvasTests
{
    private static readonly CanvasFormat[] Formats = [CanvasFormat.Widescreen, CanvasFormat.Portrait, CanvasFormat.Square, CanvasFormat.Standard];
    private static readonly CanvasResolution[] Resolutions = [CanvasResolution.P720, CanvasResolution.P1080];

    private readonly Production production = Build.Production();
    private readonly Device phone;
    private readonly SourceCatalog catalog;

    public CanvasTests()
    {
        phone = Build.Phone(production);
        catalog = new SourceCatalog([phone], []);
    }

    public static TheoryData<CanvasFormat, CanvasResolution, int, int> Sizes => new()
    {
        { CanvasFormat.Widescreen, CanvasResolution.P720, 1280, 720 },
        { CanvasFormat.Widescreen, CanvasResolution.P1080, 1920, 1080 },
        { CanvasFormat.Portrait, CanvasResolution.P720, 720, 1280 },
        { CanvasFormat.Portrait, CanvasResolution.P1080, 1080, 1920 },
        { CanvasFormat.Square, CanvasResolution.P720, 720, 720 },
        { CanvasFormat.Square, CanvasResolution.P1080, 1080, 1080 },
        { CanvasFormat.Standard, CanvasResolution.P720, 960, 720 },
        { CanvasFormat.Standard, CanvasResolution.P1080, 1440, 1080 },
    };

    private string Camera => phone.SourceIdOf(phone.Slots[0]);

    private Scene Scene => production.OrderedScenes[0];

    [Theory]
    [MemberData(nameof(Sizes))]
    public void SizeOf_FixedList_GivesTheCanvas(CanvasFormat format, CanvasResolution resolution, int width, int height) =>
        Assert.Equal(new CanvasSize(width, height), Canvases.SizeOf(format, resolution));

    [Fact]
    public void SizeOf_EveryCanvas_StaysInsideTheItemBounds()
    {
        foreach (var size in Formats.SelectMany(f => Resolutions.Select(r => Canvases.SizeOf(f, r))))
        {
            Assert.InRange(size.Width, SceneItemRules.MinSize, SceneItemRules.MaxW);
            Assert.InRange(size.Height, SceneItemRules.MinSize, SceneItemRules.MaxH);
        }
    }

    [Fact]
    public void Dto_CarriesFormatResolutionAndSize() =>
        Assert.Equal(new CanvasDto(CanvasFormat.Portrait, CanvasResolution.P720, 720, 1280), Canvases.Dto(CanvasFormat.Portrait, CanvasResolution.P720));

    [Fact]
    public void Create_Default_IsWidescreenAtFullHd()
    {
        Assert.Equal((CanvasFormat.Widescreen, CanvasResolution.P1080), (production.CanvasFormat, production.CanvasResolution));
        Assert.Equal(CanvasSize.FullHd, production.Canvas);
        Assert.Equal(new CanvasDto(CanvasFormat.Widescreen, CanvasResolution.P1080, 1920, 1080), Dtos.Production(production).Canvas);
    }

    [Fact]
    public void Create_WithFormat_UsesIt()
    {
        var portrait = Production.Create("Reel", "reel", true, Build.T0, CanvasFormat.Portrait, CanvasResolution.P720);

        Assert.Equal(new CanvasSize(720, 1280), portrait.Canvas);
    }

    [Theory]
    [InlineData(9, 1, "format")]
    [InlineData(2, 7, "resolution")]
    public void Create_UnknownValue_IsValidationFailed(int format, int resolution, string field)
    {
        var error = Assert.Throws<StudioFlowException>(() => Production.Create("Reel", "reel", true, Build.T0, (CanvasFormat)format, (CanvasResolution)resolution));

        Assert.Equal(ErrorCodes.ValidationFailed, error.Code);
        Assert.Contains(field, error.Errors!.Keys);
    }

    [Fact]
    public void ChangeCanvas_SameCanvas_ChangesNothing()
    {
        Scene.AddItem(Build.Add(Camera), catalog, production.Canvas);
        var version = Scene.Version;

        Assert.Null(production.ChangeCanvas(CanvasFormat.Widescreen, CanvasResolution.P1080));
        Assert.Equal(version, Scene.Version);
    }

    [Fact]
    public void ChangeCanvas_OtherResolution_ScalesEveryItemProportionally()
    {
        var item = Scene.AddItem(new AddSceneItemRequest(Camera, 300, 150, 900, 450, null, 30), catalog, production.Canvas);
        Scene.UpdateItem(item.Id, item with { Border = new BorderDto(6, "#ffffff"), Crop = new CropDto(0.1, 0.2, 0.05, 0.15), Rotation = 90, Mirror = true }, catalog);

        var changed = production.ChangeCanvas(CanvasFormat.Widescreen, CanvasResolution.P720);

        var scaled = Assert.Single(Scene.Items);
        Assert.Equal([Scene], changed);
        Assert.Equal((200, 100, 600, 300, 20), (scaled.X, scaled.Y, scaled.W, scaled.H, scaled.Radius));
        Assert.Equal(new BorderDto(4, "#ffffff"), scaled.Border);
        Assert.Equal(new CropDto(0.1, 0.2, 0.05, 0.15), scaled.Crop);
        Assert.Equal((90, true), (scaled.Rotation, scaled.Mirror));
        Assert.Equal(new CanvasSize(1280, 720), production.Canvas);
    }

    [Fact]
    public void ChangeCanvas_OtherFormat_FitsTheOldCanvasIntoTheMiddleOfTheNewOne()
    {
        Scene.AddItem(new AddSceneItemRequest(Camera, 0, 0, 1920, 1080, null, 0), catalog, production.Canvas);

        production.ChangeCanvas(CanvasFormat.Portrait, CanvasResolution.P1080);

        var fitted = Assert.Single(Scene.Items);
        Assert.Equal((0, 656, 1080, 608), (fitted.X, fitted.Y, fitted.W, fitted.H));
    }

    [Fact]
    public void ChangeCanvas_ToSquareAndBack_KeepsTheFittedPictureInTheMiddleInsteadOfRestoringIt()
    {
        Scene.AddItem(new AddSceneItemRequest(Camera, 0, 0, 1920, 1080, null, 0), catalog, production.Canvas);

        production.ChangeCanvas(CanvasFormat.Square, CanvasResolution.P1080);
        var square = Assert.Single(Scene.Items);
        production.ChangeCanvas(CanvasFormat.Widescreen, CanvasResolution.P1080);
        var back = Assert.Single(Scene.Items);

        Assert.Equal((0, 236, 1080, 608), (square.X, square.Y, square.W, square.H));
        Assert.Equal((420, 236, 1080, 608), (back.X, back.Y, back.W, back.H));
    }

    [Fact]
    public void ChangeCanvas_ScenesWithoutItems_AreNotReturnedAndKeepTheirVersion()
    {
        Scene.AddItem(Build.Add(Camera), catalog, production.Canvas);
        var empty = production.OrderedScenes[1];
        var version = empty.Version;

        var changed = production.ChangeCanvas(CanvasFormat.Standard, CanvasResolution.P1080);

        Assert.Equal([Scene], changed);
        Assert.Equal(version, empty.Version);
    }

    [Fact]
    public void ChangeCanvas_ChangedScene_IncrementsTheVersionAndKeepsTheBackground()
    {
        Scene.AddItem(Build.Add(Camera), catalog, production.Canvas);
        var version = Scene.Version;
        var background = Scene.Background;

        production.ChangeCanvas(CanvasFormat.Square, CanvasResolution.P720);

        Assert.Equal(version + 1, Scene.Version);
        Assert.Equal(background, Scene.Background);
    }

    [Fact]
    public void ChangeCanvas_Live_IsBroadcastLiveAndChangesNothing()
    {
        Scene.AddItem(Build.Add(Camera), catalog, production.Canvas);
        production.StartBroadcast(Build.T0);
        var before = Scene.Items;

        var error = Assert.Throws<StudioFlowException>(() => production.ChangeCanvas(CanvasFormat.Portrait, CanvasResolution.P1080));

        Assert.Equal(ErrorCodes.BroadcastLive, error.Code);
        Assert.Equal(CanvasSize.FullHd, production.Canvas);
        Assert.Same(before, Scene.Items);
    }

    [Fact]
    public void ChangeCanvas_LiveWithTheSameCanvas_IsAllowedAsNoOp()
    {
        production.StartBroadcast(Build.T0);

        Assert.Null(production.ChangeCanvas(CanvasFormat.Widescreen, CanvasResolution.P1080));
    }

    [Theory]
    [InlineData(BroadcastState.Standby)]
    [InlineData(BroadcastState.Ended)]
    public void ChangeCanvas_NotLive_IsAllowed(BroadcastState state)
    {
        production.StartBroadcast(Build.T0);
        if (state == BroadcastState.Standby)
        {
            production.ResetBroadcast();
        }
        else
        {
            production.EndBroadcast(Build.T0.AddMinutes(1));
        }

        production.ChangeCanvas(CanvasFormat.Square, CanvasResolution.P720);

        Assert.Equal(new CanvasSize(720, 720), production.Canvas);
    }

    [Theory]
    [InlineData(9, 1, "format")]
    [InlineData(2, 7, "resolution")]
    public void ChangeCanvas_UnknownValue_IsValidationFailedAndChangesNothing(int format, int resolution, string field)
    {
        var error = Assert.Throws<StudioFlowException>(() => production.ChangeCanvas((CanvasFormat)format, (CanvasResolution)resolution));

        Assert.Equal(ErrorCodes.ValidationFailed, error.Code);
        Assert.Contains(field, error.Errors!.Keys);
        Assert.Equal(CanvasSize.FullHd, production.Canvas);
    }

    [Fact]
    public void ChangeCanvas_EveryCanvasToEveryCanvas_KeepsItemsInsideTheNewCanvasAndTheBounds()
    {
        foreach (var fromFormat in Formats)
        {
            foreach (var fromResolution in Resolutions)
            {
                foreach (var toFormat in Formats)
                {
                    foreach (var toResolution in Resolutions)
                    {
                        AssertItemsStayInside(fromFormat, fromResolution, toFormat, toResolution);
                    }
                }
            }
        }
    }

    [Theory]
    [MemberData(nameof(Sizes))]
    public void Place_DefaultItem_LandsInsideEveryCanvasInTheShapeOfTheReference(CanvasFormat format, CanvasResolution resolution, int width, int height)
    {
        var canvas = Canvases.SizeOf(format, resolution);
        var item = Scene.AddItem(Build.Add(Camera), catalog, canvas);

        Assert.Equal((width, height), (canvas.Width, canvas.Height));
        Assert.InRange(item.X, 0, width - item.W);
        Assert.InRange(item.Y, 0, height - item.H);
        Assert.InRange(Math.Abs(((double)item.W / item.H) - (600d / 338)), 0, 0.02);
        Assert.Empty(Validate(item));
    }

    [Fact]
    public void Place_DefaultItem_OnFullHdIsTheServerDefault()
    {
        var item = Scene.AddItem(Build.Add(Camera), catalog, CanvasSize.FullHd);

        Assert.Equal((1240, 680, 600, 338), (item.X, item.Y, item.W, item.H));
    }

    [Theory]
    [InlineData(CanvasFormat.Portrait, 698, 1695, 338, 190)]
    [InlineData(CanvasFormat.Standard, 930, 780, 450, 254)]
    [InlineData(CanvasFormat.Square, 698, 855, 338, 190)]
    public void Place_DefaultItem_StaysAtTheBottomRightWithScaledDistances(CanvasFormat format, int x, int y, int w, int h)
    {
        var item = Scene.AddItem(Build.Add(Camera), catalog, Canvases.SizeOf(format, CanvasResolution.P1080));

        Assert.Equal((x, y, w, h), (item.X, item.Y, item.W, item.H));
    }

    [Fact]
    public void Place_Texts_KeepTheirCornersAndCentreOnAPortraitCanvas()
    {
        var canvas = Canvases.SizeOf(CanvasFormat.Portrait, CanvasResolution.P1080);

        Assert.Equal((45, 1774, 540, 101), Canvases.Place(canvas, 80, 820, 960, 180));
        Assert.Equal((90, 876, 900, 169), Canvases.Place(canvas, 160, 390, 1600, 300));
        Assert.Equal((743, 34, 304, 54), Canvases.Place(canvas, 1320, 60, 540, 96));
    }

    private static void AssertItemsStayInside(CanvasFormat fromFormat, CanvasResolution fromResolution, CanvasFormat toFormat, CanvasResolution toResolution)
    {
        var from = Canvases.SizeOf(fromFormat, fromResolution);
        var to = Canvases.SizeOf(toFormat, toResolution);
        var item = Build.Item("dev_aaaaaaaaaaaaaaaa/camera") with { X = 0, Y = 0, W = from.Width, H = from.Height, Radius = 200, Border = new BorderDto(40, "#ffffff") };

        var fitted = CanvasFit.Item(item, from, to);

        var label = $"{fromFormat} {fromResolution} -> {toFormat} {toResolution}";
        Assert.True(fitted.X >= 0 && fitted.Y >= 0, label);
        Assert.True(fitted.X + fitted.W <= to.Width, label);
        Assert.True(fitted.Y + fitted.H <= to.Height, label);
        Assert.True(fitted.W == to.Width || fitted.H == to.Height, label);
        Assert.Empty(Validate(fitted));
    }

    private static List<string> Validate(SceneItemDto item)
    {
        var errors = new ValidationErrors();
        SceneItemRules.Validate(item, "item", errors, _ => true, _ => true);
        return [.. errors.ToDictionary().Keys];
    }
}
