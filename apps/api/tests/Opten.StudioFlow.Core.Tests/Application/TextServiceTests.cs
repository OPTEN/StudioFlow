using Opten.StudioFlow.Core.Application;
using Opten.StudioFlow.Core.Contracts;
using Opten.StudioFlow.Core.Domain;

namespace Opten.StudioFlow.Core.Tests.Application;

public sealed class TextServiceTests : IDisposable
{
    private readonly ServiceHarness harness = new();

    private string ProductionId => harness.Production.Id;

    private IReadOnlyList<Scene> Scenes => harness.Production.OrderedScenes;

    private Task<TextSourceDto> CreateAsync(string line1 = "Mia Meier", TextStyle style = TextStyle.LowerThird) =>
        harness.Texts.CreateAsync(ProductionId, new CreateTextSourceRequest(line1, "Moderator", style, null), CancellationToken.None);

    private async Task<SceneItemDto> AddItemAsync(Scene scene, TextSourceDto text) =>
        (await harness.Scenes.AddItemAsync(ProductionId, scene.Id, Build.Add(text.Id), CancellationToken.None)).Items[^1];

    private Task<SceneDto> SetHiddenAsync(Scene scene, SceneItemDto item, bool hidden) =>
        harness.Scenes.UpdateItemAsync(ProductionId, scene.Id, item.Id, item with { Hidden = hidden }, CancellationToken.None);

    private IEnumerable<string> LogTexts() => harness.Events.OfType<LogAppendedEvent>().Select(l => l.Entry.Text);

    [Fact]
    public async Task Create_EmitsTheTextAsASourceAndLogsIt()
    {
        var text = await CreateAsync();

        var source = Assert.Single(harness.Events.OfType<SourceUpsertedEvent>()).Source;
        Assert.Equal((text.Id, "T1", SourceKind.Text, "Mia Meier", SourceStatus.Ok), (source.Id, source.Code, source.Kind, source.Label, source.Status));
        Assert.Equal(text, source.Text);
        Assert.Null(source.DeviceId);
        Assert.Equal(["T1 “Mia Meier” created"], LogTexts());
    }

    [Fact]
    public async Task Create_Invalid_PublishesNothing()
    {
        await Assert.ThrowsAsync<StudioFlowException>(() => harness.Texts.CreateAsync(ProductionId, new CreateTextSourceRequest(" ", null, TextStyle.Title, null), CancellationToken.None));

        Assert.Empty(harness.Events);
        Assert.Empty(harness.Production.TextSources);
    }

    [Fact]
    public async Task Create_UnknownProduction_IsNotFound()
    {
        var error = await Assert.ThrowsAsync<StudioFlowException>(() => harness.Texts.CreateAsync("prd_unknown1", new CreateTextSourceRequest("A", null, TextStyle.Title, null), CancellationToken.None));

        Assert.Equal(ErrorCodes.NotFound, error.Code);
    }

    [Fact]
    public async Task Update_EmitsTheNewContentWithoutALogEntryOrASceneChange()
    {
        var text = await CreateAsync();
        var scene = Scenes[0];
        await AddItemAsync(scene, text);
        var versionBefore = scene.Version;
        harness.Publisher.StudioEvents.Clear();

        var updated = await harness.Texts.UpdateAsync(ProductionId, text.Id, new UpdateTextSourceRequest("Leo Lang", "Gast", TextStyle.Note, TextAlign.Right), CancellationToken.None);

        var source = Assert.IsType<SourceUpsertedEvent>(Assert.Single(harness.Events)).Source;
        Assert.Equal(updated, source.Text);
        Assert.Equal("Leo Lang", source.Label);
        Assert.Equal(versionBefore, scene.Version);
    }

    [Fact]
    public async Task Update_SameContent_EmitsNothing()
    {
        var text = await CreateAsync();
        harness.Publisher.StudioEvents.Clear();

        await harness.Texts.UpdateAsync(ProductionId, text.Id, new UpdateTextSourceRequest(text.Line1, text.Line2, text.Style, text.Align), CancellationToken.None);

        Assert.Empty(harness.Events);
    }

    [Fact]
    public async Task Delete_RemovesTheItemsEmitsTheScenesThenTheSourceAndLogsIt()
    {
        var text = await CreateAsync();
        await AddItemAsync(Scenes[0], text);
        await AddItemAsync(Scenes[1], text);
        harness.Publisher.StudioEvents.Clear();

        await harness.Texts.DeleteAsync(ProductionId, text.Id, CancellationToken.None);

        var events = harness.Events.Where(e => e is not LogAppendedEvent).ToList();
        Assert.Equal([Scenes[0].Id, Scenes[1].Id], events.OfType<SceneUpsertedEvent>().Select(e => e.Scene.Id));
        Assert.All(events.OfType<SceneUpsertedEvent>(), e => Assert.Empty(e.Scene.Items));
        Assert.Equal(text.Id, Assert.IsType<SourceRemovedEvent>(events[^1]).SourceId);
        Assert.Equal(["T1 “Mia Meier” deleted"], LogTexts());
        Assert.Empty(harness.Production.TextSources);
    }

    [Fact]
    public async Task Delete_Unknown_IsNotFound()
    {
        var error = await Assert.ThrowsAsync<StudioFlowException>(() => harness.Texts.DeleteAsync(ProductionId, "txt_unknown1", CancellationToken.None));

        Assert.Equal(ErrorCodes.NotFound, error.Code);
    }

    [Fact]
    public async Task Snapshot_ListsTheTextsAsSourcesAndCarriesTheTheme()
    {
        var text = await CreateAsync();
        var theme = new TextThemeDto("#ff8800", "#001122", "#fefefe");
        await harness.Productions.UpdateAsync(ProductionId, new UpdateProductionRequest(null, null, null, theme), CancellationToken.None);

        var snapshot = await harness.Productions.GetSnapshotAsync(ProductionId, CancellationToken.None);

        Assert.Equal(text, snapshot.Sources.Single(s => s.Kind == SourceKind.Text).Text);
        Assert.Equal(theme, snapshot.Production.TextTheme);
        Assert.Equal(theme, Assert.Single(harness.Events.OfType<ProductionChangedEvent>()).Production.TextTheme);
    }

    [Fact]
    public async Task OutputSnapshot_CarriesTheTextsToo()
    {
        var text = await CreateAsync();

        var snapshot = await harness.Coordinator.ExecuteAsync(ProductionId, context => SnapshotBuilder.BuildOutputAsync(context, CancellationToken.None), CancellationToken.None);

        Assert.Equal(text, snapshot.Sources.Single(s => s.Kind == SourceKind.Text).Text);
        Assert.Equal(SourceStatus.Ok, snapshot.Sources.Single(s => s.Kind == SourceKind.Text).Status);
    }

    [Fact]
    public void OutputView_TextSourceEvents_ReachTheOutput()
    {
        var source = Dtos.Source(SourceCatalog.TextEntry(new TextSourceDto("txt_abcd1234", "T1", "A", null, TextStyle.Title, TextAlign.Center)), null);

        Assert.Equal(source, Assert.IsType<SourceUpsertedEvent>(OutputView.ForOutput(new SourceUpsertedEvent(1, source))).Source);
        Assert.IsType<SourceRemovedEvent>(OutputView.ForOutput(new SourceRemovedEvent(2, source.Id)));
    }

    [Fact]
    public async Task ShowingAndHidingOnTheProgramScene_IsLogged()
    {
        var text = await CreateAsync();
        var scene = Scenes[0];
        var item = await AddItemAsync(scene, text);
        harness.Publisher.StudioEvents.Clear();

        await SetHiddenAsync(scene, item, hidden: false);
        await SetHiddenAsync(scene, item, hidden: true);

        Assert.Equal(["T1 shown", "T1 hidden"], LogTexts());
    }

    [Fact]
    public async Task ShowingAgain_IsNotLogged()
    {
        var text = await CreateAsync();
        var scene = Scenes[0];
        var item = await AddItemAsync(scene, text);
        await SetHiddenAsync(scene, item, hidden: false);
        harness.Publisher.StudioEvents.Clear();

        await harness.Scenes.UpdateItemAsync(ProductionId, scene.Id, item.Id, item with { Hidden = false, X = 200 }, CancellationToken.None);

        Assert.Empty(LogTexts());
    }

    [Fact]
    public async Task ShowingOnAScene_ThatIsNotOnAir_IsNotLogged()
    {
        var text = await CreateAsync();
        var scene = Scenes[1];
        var item = await AddItemAsync(scene, text);
        harness.Publisher.StudioEvents.Clear();

        await SetHiddenAsync(scene, item, hidden: false);

        Assert.Empty(LogTexts());
        Assert.Single(harness.Events.OfType<SceneUpsertedEvent>());
    }

    [Fact]
    public async Task ShowingATextThroughReplaceItems_IsLoggedLikeAnyOtherChange()
    {
        var text = await CreateAsync();
        var scene = Scenes[0];
        var item = await AddItemAsync(scene, text);
        harness.Publisher.StudioEvents.Clear();

        await harness.Scenes.ReplaceItemsAsync(ProductionId, scene.Id, new ReplaceSceneItemsRequest([item with { Hidden = false }], null), CancellationToken.None);

        Assert.Equal(["T1 shown"], LogTexts());
    }

    [Fact]
    public async Task ShowingACamera_IsNotLoggedAsText()
    {
        var (device, _) = await harness.PairPhoneAsync();
        var scene = Scenes[0];
        var camera = (await harness.Scenes.AddItemAsync(ProductionId, scene.Id, Build.Add($"{device.Id}/camera"), CancellationToken.None)).Items[^1];
        harness.Publisher.StudioEvents.Clear();

        await SetHiddenAsync(scene, camera, hidden: true);

        Assert.Empty(LogTexts());
    }

    public void Dispose() => harness.Dispose();
}
