using Opten.StudioFlow.Core.Contracts;
using Opten.StudioFlow.Core.Domain;

namespace Opten.StudioFlow.Core.Tests.Domain;

public sealed class TextSourceTests
{
    private readonly Production production = Build.Production();

    private static CreateTextSourceRequest Create(string line1 = "Mia Meier", string? line2 = "Moderator", TextStyle style = TextStyle.LowerThird, TextAlign? align = null) =>
        new(line1, line2, style, align);

    private static string[] Fields(StudioFlowException error) => [.. error.Errors!.Keys];

    [Fact]
    public void AddTextSource_Defaults_AreAlignedByStyleAndNumberedFromT1()
    {
        var lowerThird = production.AddTextSource(Create(), []);
        var title = production.AddTextSource(Create("Welcome", null, TextStyle.Title), new[] { lowerThird.Code });

        Assert.Equal(("T1", TextAlign.Left), (lowerThird.Code, lowerThird.Align));
        Assert.Equal(("T2", TextAlign.Center), (title.Code, title.Align));
        Assert.True(EntityIds.IsValid(title.Id, EntityIds.Text));
        Assert.Equal([lowerThird, title], production.TextSources);
    }

    [Fact]
    public void AddTextSource_FreedCode_IsReused()
    {
        var first = production.AddTextSource(Create(), []);
        production.AddTextSource(Create("B"), [first.Code]);
        production.RemoveTextSource(first.Id);

        var again = production.AddTextSource(Create("C"), ["T2"]);

        Assert.Equal("T1", again.Code);
    }

    [Fact]
    public void AddTextSource_TrimsAndCleansTheLines()
    {
        var text = production.AddTextSource(Create("  Mia\u202E Meier\n\t", "  \u200EModerator  "), []);

        Assert.Equal(("Mia Meier", "Moderator"), (text.Line1, text.Line2));
    }

    [Fact]
    public void AddTextSource_EmptySecondLine_BecomesNull() =>
        Assert.Null(production.AddTextSource(Create(line2: " \t "), []).Line2);

    [Theory]
    [InlineData("<script>alert(1)</script>")]
    [InlineData("<img src=x onerror=alert(1)>")]
    [InlineData("a & b \"quoted\" 'single'")]
    [InlineData("مرحبا بالعالم")]
    [InlineData("שלום עולם")]
    [InlineData("Zoë 😀 👨‍👩‍👧‍👦 日本語")]
    public void AddTextSource_AnyUnicodeAndMarkup_IsKeptLiterally(string line)
    {
        var text = production.AddTextSource(Create(line, line), []);

        Assert.Equal((line, line), (text.Line1, text.Line2));
    }

    [Fact]
    public void AddTextSource_LoneSurrogate_BecomesReplacementCharacter() =>
        Assert.Equal("a\uFFFDb", production.AddTextSource(Create("a\uD800b"), []).Line1);

    [Fact]
    public void AddTextSource_LineSeparators_AreRemoved() =>
        Assert.Equal("ab", production.AddTextSource(Create("a\u2028b\u2029"), []).Line1);

    [Fact]
    public void AddTextSource_LengthIsCountedInTextElements()
    {
        var emojis = string.Concat(Enumerable.Repeat("😀", TextRules.TextLineMax));

        var text = production.AddTextSource(Create(emojis, emojis), []);

        Assert.Equal((emojis, emojis), (text.Line1, text.Line2));
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("\u202E\n")]
    public void AddTextSource_EmptyFirstLine_IsRejected(string line1)
    {
        var error = Assert.Throws<StudioFlowException>(() => production.AddTextSource(Create(line1), []));

        Assert.Equal(["line1"], Fields(error));
    }

    [Fact]
    public void AddTextSource_TooLongLines_AreRejectedPerField()
    {
        var tooLong = new string('x', TextRules.TextLineMax + 1);

        var error = Assert.Throws<StudioFlowException>(() => production.AddTextSource(Create(tooLong, tooLong), []));

        Assert.Equal(["line1", "line2"], Fields(error));
        Assert.Equal(ErrorCodes.ValidationFailed, error.Code);
    }

    [Fact]
    public void AddTextSource_MaximumLength_IsAccepted()
    {
        var max = new string('x', TextRules.TextLineMax);

        Assert.Equal(max, production.AddTextSource(Create(max, max), []).Line2);
    }

    [Fact]
    public void AddTextSource_UnknownStyleOrAlignment_IsRejected()
    {
        var error = Assert.Throws<StudioFlowException>(() => production.AddTextSource(Create(style: (TextStyle)99, align: (TextAlign)99), []));

        Assert.Equal(["style", "align"], Fields(error));
    }

    [Fact]
    public void AddTextSource_PastTheLimit_IsLimitReached()
    {
        var codes = new List<string>();
        for (var i = 0; i < TextSourceRules.MaxPerProduction; i++)
        {
            codes.Add(production.AddTextSource(Create($"Text {i}"), codes).Code);
        }

        var error = Assert.Throws<StudioFlowException>(() => production.AddTextSource(Create(), codes));

        Assert.Equal(ErrorCodes.LimitReached, error.Code);
        Assert.Equal(TextSourceRules.MaxPerProduction, production.TextSources.Count);
    }

    [Fact]
    public void UpdateTextSource_ReplacesTheContentAndKeepsIdAndCode()
    {
        var text = production.AddTextSource(Create(), []);

        var (updated, changed) = production.UpdateTextSource(text.Id, new UpdateTextSourceRequest("Leo Lang", null, TextStyle.Note, TextAlign.Right));

        Assert.True(changed);
        Assert.Equal(text with { Line1 = "Leo Lang", Line2 = null, Style = TextStyle.Note, Align = TextAlign.Right }, updated);
        Assert.Equal([updated], production.TextSources);
    }

    [Fact]
    public void UpdateTextSource_SameContent_IsNotAChange()
    {
        var text = production.AddTextSource(Create(), []);

        var (same, changed) = production.UpdateTextSource(text.Id, new UpdateTextSourceRequest(text.Line1, text.Line2, text.Style, text.Align));

        Assert.False(changed);
        Assert.Same(text, same);
    }

    [Fact]
    public void UpdateTextSource_Invalid_KeepsTheOldContent()
    {
        var text = production.AddTextSource(Create(), []);

        Assert.Throws<StudioFlowException>(() => production.UpdateTextSource(text.Id, new UpdateTextSourceRequest(" ", null, TextStyle.Title, TextAlign.Left)));

        Assert.Equal([text], production.TextSources);
    }

    [Fact]
    public void UpdateTextSource_Unknown_IsNotFound() =>
        Assert.Equal(ErrorCodes.NotFound, Assert.Throws<StudioFlowException>(() => production.UpdateTextSource("txt_unknown1", new UpdateTextSourceRequest("A", null, TextStyle.Title, TextAlign.Left))).Code);

    [Fact]
    public void RemoveTextSource_RemovesItsItemsFromEverySceneAndBumpsTheirVersion()
    {
        var text = production.AddTextSource(Create(), []);
        var other = production.AddTextSource(Create("Other"), [text.Code]);
        var catalog = new SourceCatalog([], [], production.TextSources);
        var scenes = production.OrderedScenes;
        scenes[0].AddItem(Build.Add(text.Id), catalog, CanvasSize.FullHd);
        scenes[0].AddItem(Build.Add(other.Id), catalog, CanvasSize.FullHd);
        scenes[2].AddItem(Build.Add(text.Id), catalog, CanvasSize.FullHd);
        var versions = scenes.Select(s => s.Version).ToList();

        var (removed, changedScenes) = production.RemoveTextSource(text.Id);

        Assert.Equal(text, removed);
        Assert.Equal([scenes[0], scenes[2]], changedScenes);
        Assert.Equal(other.Id, Assert.Single(scenes[0].Items).Source);
        Assert.Empty(scenes[2].Items);
        Assert.Equal([versions[0] + 1, versions[1], versions[2] + 1], scenes.Select(s => s.Version));
        Assert.Equal([other], production.TextSources);
    }

    [Fact]
    public void RemoveTextSource_Unused_ChangesNoScene()
    {
        var text = production.AddTextSource(Create(), []);

        var (_, changedScenes) = production.RemoveTextSource(text.Id);

        Assert.Empty(changedScenes);
        Assert.Empty(production.TextSources);
    }

    [Fact]
    public void Update_TextTheme_IsValidatedAndStored()
    {
        var theme = new TextThemeDto("#ff8800", "#001122", "#ffffff");

        Assert.True(production.Update(new UpdateProductionRequest(null, null, null, theme), new SourceCatalog([], [])));
        Assert.False(production.Update(new UpdateProductionRequest(null, null, null, theme), new SourceCatalog([], [])));

        Assert.Equal(theme, production.TextTheme);
    }

    [Theory]
    [InlineData("red")]
    [InlineData("#fff")]
    [InlineData("#ggg000")]
    [InlineData("ff0000")]
    [InlineData("#ff000000")]
    [InlineData("")]
    public void Update_TextThemeWithBadColour_IsRejectedPerField(string colour)
    {
        var theme = new TextThemeDto("#ff8800", colour, colour);

        var error = Assert.Throws<StudioFlowException>(() => production.Update(new UpdateProductionRequest(null, null, null, theme), new SourceCatalog([], [])));

        Assert.Equal(["textTheme.background", "textTheme.foreground"], Fields(error));
        Assert.Equal(TextSourceRules.DefaultTheme, production.TextTheme);
    }

    [Fact]
    public void NewProduction_StartsWithTheDefaultTheme()
    {
        Assert.Equal(new TextThemeDto("#1f6feb", "#0d1117", "#ffffff"), production.TextTheme);
        Assert.Empty(production.TextSources);
    }

    [Fact]
    public void AddItem_Text_StartsHiddenWithTheGeometryOfItsStyle()
    {
        var lowerThird = production.AddTextSource(Create(), []);
        var title = production.AddTextSource(Create("Title", null, TextStyle.Title), [lowerThird.Code]);
        var note = production.AddTextSource(Create("Note", null, TextStyle.Note), [lowerThird.Code, title.Code]);
        var catalog = new SourceCatalog([], [], production.TextSources);
        var scene = production.OrderedScenes[0];

        var items = new[] { lowerThird, title, note }.Select(t => scene.AddItem(Build.Add(t.Id), catalog, CanvasSize.FullHd)).ToList();

        Assert.All(items, item => Assert.True(item.Hidden));
        Assert.All(items, item => Assert.Equal(0, item.Radius));
        Assert.Equal([(80, 820, 960, 180), (160, 390, 1600, 300), (1320, 60, 540, 96)], items.Select(i => (i.X, i.Y, i.W, i.H)));
    }

    [Fact]
    public void AddItem_Text_RespectsExplicitGeometry()
    {
        var text = production.AddTextSource(Create(), []);
        var catalog = new SourceCatalog([], [], production.TextSources);

        var item = production.OrderedScenes[0].AddItem(new AddSceneItemRequest(text.Id, 10, 20, 300, 100, null, null), catalog, CanvasSize.FullHd);

        Assert.Equal((10, 20, 300, 100), (item.X, item.Y, item.W, item.H));
    }

    [Fact]
    public void UpdateItem_TextAsFallbackOfACamera_IsRejected()
    {
        var phone = Build.Phone(production);
        var text = production.AddTextSource(Create(), []);
        var catalog = new SourceCatalog([phone], [], production.TextSources);
        var scene = production.OrderedScenes[0];
        var camera = scene.AddItem(Build.Add(phone.SourceIdOf(phone.Slots[0])), catalog, CanvasSize.FullHd);

        var error = Assert.Throws<StudioFlowException>(() => scene.UpdateItem(camera.Id, camera with { OnLost = new LostBehaviorDto(3000, text.Id) }, catalog));

        Assert.Equal(["item.onLost.fallbackSource"], Fields(error));
    }

    [Fact]
    public void Catalog_ListsTextsAfterMediaAndLabelsThemWithTheFirstLine()
    {
        var phone = Build.Phone(production);
        var image = Build.Image(production);
        var text = production.AddTextSource(Create("Mia Meier"), []);
        var catalog = new SourceCatalog([phone], [image], production.TextSources);

        Assert.Equal([phone.SourceIdOf(phone.Slots[0]), image.Id, text.Id], catalog.All.Select(e => e.Id));
        Assert.Equal("Mia Meier", catalog.Find(text.Id)!.Label);
        Assert.True(catalog.IsText(text.Id));
        Assert.False(catalog.IsText(image.Id));
        Assert.False(catalog.IsText(null));
    }
}
