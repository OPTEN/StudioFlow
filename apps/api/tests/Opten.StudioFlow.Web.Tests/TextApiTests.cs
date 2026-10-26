using System.Diagnostics;
using System.Net;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.SignalR.Client;
using Opten.StudioFlow.Core.Contracts;
using Opten.StudioFlow.Web.Tests.Support;

namespace Opten.StudioFlow.Web.Tests;

public sealed class TextApiTests(StudioFlowApp app) : IClassFixture<StudioFlowApp>
{
    private static CreateTextSourceRequest LowerThird(string line1 = "Mia Meier", string? line2 = "Moderator") =>
        new(line1, line2, TextStyle.LowerThird, null);

    [Fact]
    public async Task Create_Update_Delete_RoundTripThroughTheDatabase()
    {
        var (admin, production) = await SetupAsync();

        var created = await admin.Client.PostJsonAsync(Texts(production), LowerThird()).ExpectAsync<TextSourceDto>(HttpStatusCode.Created);
        var second = await admin.Client.PostJsonAsync(Texts(production), new CreateTextSourceRequest("Welcome", null, TextStyle.Title, null)).ExpectAsync<TextSourceDto>(HttpStatusCode.Created);
        var updated = await admin.Client.PutJsonAsync($"{Texts(production)}/{created.Id}", new UpdateTextSourceRequest("Leo Lang", "Gast 😀", TextStyle.Note, TextAlign.Right)).ExpectAsync<TextSourceDto>();
        var snapshot = await SnapshotAsync(admin, production);

        Assert.Equal(("T1", TextAlign.Left), (created.Code, created.Align));
        Assert.Equal(("T2", TextAlign.Center), (second.Code, second.Align));
        Assert.Equal(created with { Line1 = "Leo Lang", Line2 = "Gast 😀", Style = TextStyle.Note, Align = TextAlign.Right }, updated);
        Assert.Equal([updated, second], snapshot.Sources.Where(s => s.Kind == SourceKind.Text).Select(s => s.Text));
        Assert.Equal("Leo Lang", snapshot.Sources.Single(s => s.Id == created.Id).Label);

        await admin.Client.DeleteAsync($"{Texts(production)}/{created.Id}", TestContext.Current.CancellationToken).ExpectAsync(HttpStatusCode.NoContent);
        await admin.Client.DeleteAsync($"{Texts(production)}/{created.Id}", TestContext.Current.CancellationToken).ExpectProblemAsync(HttpStatusCode.NotFound);
        Assert.DoesNotContain((await SnapshotAsync(admin, production)).Sources, s => s.Id == created.Id);
    }

    [Fact]
    public async Task Create_MarkupAndScripts_AreStoredAsPlainText()
    {
        var (admin, production) = await SetupAsync();
        const string Markup = "<img src=x onerror=alert(1)><script>alert(2)</script>";

        var created = await admin.Client.PostJsonAsync(Texts(production), LowerThird(Markup, "مرحبا & שלום")).ExpectAsync<TextSourceDto>(HttpStatusCode.Created);

        var stored = (await SnapshotAsync(admin, production)).Sources.Single(s => s.Id == created.Id).Text!;
        Assert.Equal((Markup, "مرحبا & שלום"), (stored.Line1, stored.Line2));
    }

    [Fact]
    public async Task Create_InvalidContent_ReportsFieldPaths()
    {
        var (admin, production) = await SetupAsync();
        var tooLong = new string('x', 121);

        var fields = await ErrorFieldsAsync(admin.Client.PostJsonAsync(Texts(production), LowerThird(" ", tooLong)));

        Assert.Equal(["line1", "line2"], fields);
    }

    [Fact]
    public async Task Create_UnknownStyle_IsAValidationErrorNamingTheField()
    {
        var (admin, production) = await SetupAsync();
        using var body = new StringContent("""{"line1":"A","line2":null,"style":"marquee","align":null}""", Encoding.UTF8, "application/json");

        var fields = await ErrorFieldsAsync(admin.Client.PostAsync(Texts(production), body, TestContext.Current.CancellationToken));

        Assert.Equal(["style"], fields);
    }

    [Fact]
    public async Task UnknownProductionOrText_IsNotFound()
    {
        var (admin, production) = await SetupAsync();

        Assert.Equal(ErrorCodes.NotFound, await admin.Client.PostJsonAsync(Texts("prd_unknown1"), LowerThird()).ExpectProblemAsync(HttpStatusCode.NotFound));
        Assert.Equal(ErrorCodes.NotFound, await admin.Client.PutJsonAsync($"{Texts(production)}/txt_unknown1", new UpdateTextSourceRequest("A", null, TextStyle.Title, TextAlign.Left)).ExpectProblemAsync(HttpStatusCode.NotFound));
    }

    [Fact]
    public async Task Create_PastTheLimit_IsLimitReached()
    {
        var (admin, production) = await SetupAsync();
        for (var i = 0; i < 64; i++)
        {
            await admin.Client.PostJsonAsync(Texts(production), LowerThird($"Person {i}")).ExpectAsync(HttpStatusCode.Created);
        }

        Assert.Equal(ErrorCodes.LimitReached, await admin.Client.PostJsonAsync(Texts(production), LowerThird()).ExpectProblemAsync(HttpStatusCode.Conflict));
    }

    [Fact]
    public async Task ParallelCreates_GetDistinctCodes()
    {
        var (admin, production) = await SetupAsync();

        var created = await Task.WhenAll(Enumerable.Range(0, 10).Select(i => admin.Client.PostJsonAsync(Texts(production), LowerThird($"P{i}")).ExpectAsync<TextSourceDto>(HttpStatusCode.Created)));

        Assert.Equal(Enumerable.Range(1, 10).Select(i => $"T{i}").Order(StringComparer.Ordinal), created.Select(t => t.Code).Order(StringComparer.Ordinal));
    }

    [Fact]
    public async Task ParallelUpdates_LastWriterWinsWithoutErrors()
    {
        var (admin, production) = await SetupAsync();
        var text = await admin.Client.PostJsonAsync(Texts(production), LowerThird()).ExpectAsync<TextSourceDto>(HttpStatusCode.Created);

        var results = await Task.WhenAll(Enumerable.Range(0, 12).Select(i =>
            admin.Client.PutJsonAsync($"{Texts(production)}/{text.Id}", new UpdateTextSourceRequest($"Name {i}", null, TextStyle.LowerThird, TextAlign.Left)).ExpectAsync<TextSourceDto>()));

        var stored = (await SnapshotAsync(admin, production)).Sources.Single(s => s.Id == text.Id).Text!;
        Assert.Contains(stored.Line1, results.Select(r => r.Line1));
    }

    [Fact]
    public async Task AddItem_Text_StartsHiddenAndDeletingTheTextRemovesTheItem()
    {
        var (admin, production) = await SetupAsync();
        var text = await admin.Client.PostJsonAsync(Texts(production), LowerThird()).ExpectAsync<TextSourceDto>(HttpStatusCode.Created);
        var sceneId = (await SnapshotAsync(admin, production)).Scenes[1].Id;

        var scene = await admin.Client.PostJsonAsync($"/api/productions/{production}/scenes/{sceneId}/items", new AddSceneItemRequest(text.Id, null, null, null, null, null, null)).ExpectAsync<SceneDto>();
        await admin.Client.DeleteAsync($"{Texts(production)}/{text.Id}", TestContext.Current.CancellationToken).ExpectAsync(HttpStatusCode.NoContent);
        var after = (await SnapshotAsync(admin, production)).Scenes.Single(s => s.Id == sceneId);

        var item = Assert.Single(scene.Items);
        Assert.True(item.Hidden);
        Assert.Equal((80, 820, 960, 180), (item.X, item.Y, item.W, item.H));
        Assert.Empty(after.Items);
        Assert.Equal(scene.Version + 1, after.Version);
    }

    [Fact]
    public async Task TextTheme_IsValidatedAndPersisted()
    {
        var (admin, production) = await SetupAsync();
        var url = $"/api/productions/{production}";

        var fields = await ErrorFieldsAsync(admin.Client.PatchJsonAsync(url, new UpdateProductionRequest(null, null, null, new TextThemeDto("orange", "#000000", "#fff"))));
        var updated = await admin.Client.PatchJsonAsync(url, new UpdateProductionRequest(null, null, null, new TextThemeDto("#ff8800", "#101820", "#fafafa"))).ExpectAsync<ProductionDto>();

        Assert.Equal(["textTheme.accent", "textTheme.foreground"], fields);
        Assert.Equal(new TextThemeDto("#ff8800", "#101820", "#fafafa"), updated.TextTheme);
        Assert.Equal(updated.TextTheme, (await SnapshotAsync(admin, production)).Production.TextTheme);
    }

    [Fact]
    public async Task NewProduction_HasTheDefaultTheme()
    {
        var (admin, production) = await SetupAsync();

        Assert.Equal(new TextThemeDto("#1f6feb", "#0d1117", "#ffffff"), (await SnapshotAsync(admin, production)).Production.TextTheme);
    }

    [Fact]
    public async Task TextRoutes_WithoutSessionOrCsrfHeader_AreRefused()
    {
        var admin = await app.AdminAsync();
        var anonymous = app.Anonymous();
        var noCsrf = app.Anonymous();
        noCsrf.DefaultRequestHeaders.Add("Cookie", admin.Cookie);

        Assert.Equal(ErrorCodes.Unauthorized, await anonymous.PostJsonAsync(Texts(admin.ProductionId), LowerThird()).ExpectProblemAsync(HttpStatusCode.Unauthorized));
        Assert.Equal(ErrorCodes.Forbidden, await noCsrf.PostJsonAsync(Texts(admin.ProductionId), LowerThird()).ExpectProblemAsync(HttpStatusCode.Forbidden));
    }

    [Fact]
    public async Task ShowAndContentChange_ReachTheOutputHubPromptly()
    {
        var admin = await app.AdminAsync();
        var production = admin.ProductionId;
        var key = await KeyAsync(admin);
        var text = await admin.Client.PostJsonAsync(Texts(production), LowerThird()).ExpectAsync<TextSourceDto>(HttpStatusCode.Created);
        var program = (await SnapshotAsync(admin, production)).Production.ProgramSceneId!;
        var scene = await admin.Client.PostJsonAsync($"/api/productions/{production}/scenes/{program}/items", new AddSceneItemRequest(text.Id, null, null, null, null, null, null)).ExpectAsync<SceneDto>();
        var item = scene.Items.Single(i => i.Source == text.Id);
        await using var output = app.Hub(HubMethods.OutputHubPath, o => o.AccessTokenProvider = () => Task.FromResult<string?>(key));
        var events = HubProbe.On<ProductionEvent>(output, HubMethods.Event);
        await output.StartAsync(TestContext.Current.CancellationToken);
        var changes = await output.InvokeAsync<OutputChangesDto>(HubMethods.SubscribeOutput, null, TestContext.Current.CancellationToken);

        var clock = Stopwatch.StartNew();
        await admin.Client.PutJsonAsync($"/api/productions/{production}/scenes/{program}/items/{item.Id}", item with { Hidden = false }).ExpectAsync(HttpStatusCode.OK);
        var shown = await events.NextAsync(e => e is SceneUpsertedEvent upserted && upserted.Scene.Id == program);
        var latency = clock.Elapsed;
        await admin.Client.PutJsonAsync($"{Texts(production)}/{text.Id}", new UpdateTextSourceRequest("Leo Lang", "Gast", TextStyle.LowerThird, TextAlign.Left)).ExpectAsync(HttpStatusCode.OK);
        var content = await events.NextAsync(e => e is SourceUpsertedEvent upserted && upserted.Source.Id == text.Id);

        Assert.Equal(text, changes.Snapshot!.Sources.Single(s => s.Id == text.Id).Text);
        Assert.False(((SceneUpsertedEvent)shown).Scene.Items.Single(i => i.Id == item.Id).Hidden);
        Assert.True(latency < TimeSpan.FromSeconds(2), $"The show took {latency.TotalMilliseconds} ms to reach the output.");
        Assert.Equal("Leo Lang", ((SourceUpsertedEvent)content).Source.Text!.Line1);
    }

    [Fact]
    public async Task ShowOnTheProgramScene_AppearsInRecentEventsOfTheRegie()
    {
        var admin = await app.AdminAsync();
        var production = admin.ProductionId;
        await using var studio = app.Hub(HubMethods.StudioHubPath, o => o.Headers["Cookie"] = admin.Cookie);
        var events = HubProbe.On<ProductionEvent>(studio, HubMethods.Event);
        await studio.StartAsync(TestContext.Current.CancellationToken);
        await studio.InvokeAsync<ProductionChangesDto>(HubMethods.Subscribe, production, null, TestContext.Current.CancellationToken);
        var text = await admin.Client.PostJsonAsync(Texts(production), LowerThird()).ExpectAsync<TextSourceDto>(HttpStatusCode.Created);
        var program = (await SnapshotAsync(admin, production)).Production.ProgramSceneId!;
        var item = (await admin.Client.PostJsonAsync($"/api/productions/{production}/scenes/{program}/items", new AddSceneItemRequest(text.Id, null, null, null, null, null, null)).ExpectAsync<SceneDto>()).Items.Single(i => i.Source == text.Id);

        await admin.Client.PutJsonAsync($"/api/productions/{production}/scenes/{program}/items/{item.Id}", item with { Hidden = false }).ExpectAsync(HttpStatusCode.OK);

        var created = await events.NextAsync(e => e is LogAppendedEvent { Entry.Code: LogCode.TextCreated });
        var shown = await events.NextAsync(e => e is LogAppendedEvent { Entry.Code: LogCode.TextShown });
        Assert.Equal(text.Code, ((LogAppendedEvent)shown).Entry.Params["code"]);
        Assert.Equal("Mia Meier", ((LogAppendedEvent)created).Entry.Params["name"]);
    }

    private static string Texts(string productionId) => $"/api/productions/{productionId}/texts";

    private static async Task<ProductionSnapshot> SnapshotAsync(AdminSession admin, string productionId) =>
        await admin.Client.GetAsync($"/api/productions/{productionId}/snapshot").ExpectAsync<ProductionSnapshot>();

    private static async Task<string> KeyAsync(AdminSession admin)
    {
        var settings = await admin.Client.GetAsync($"/api/productions/{admin.ProductionId}/output").ExpectAsync<OutputSettingsDto>();
        return settings.Url[(settings.Url.IndexOf("?k=", StringComparison.Ordinal) + 3)..];
    }

    private static async Task<List<string>> ErrorFieldsAsync(Task<HttpResponseMessage> request)
    {
        using var response = await request;
        await response.ExpectAsync(HttpStatusCode.BadRequest);
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal(ErrorCodes.ValidationFailed, json.RootElement.GetProperty("code").GetString());
        return [.. json.RootElement.GetProperty("errors").EnumerateObject().Select(p => p.Name)];
    }

    private async Task<(AdminSession Admin, string ProductionId)> SetupAsync()
    {
        var admin = await app.AdminAsync();
        var production = await admin.Client.PostJsonAsync("/api/productions", new CreateProductionRequest("Texts " + Guid.NewGuid().ToString("N")[..6])).ExpectAsync<ProductionDto>(HttpStatusCode.Created);
        return (admin, production.Id);
    }
}
