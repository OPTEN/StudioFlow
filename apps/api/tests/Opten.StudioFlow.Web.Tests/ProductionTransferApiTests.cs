using System.Net;
using System.Text;
using Opten.StudioFlow.Core.Contracts;
using Opten.StudioFlow.Core.Domain.Transfer;
using Opten.StudioFlow.Web.Tests.Support;
using static Opten.StudioFlow.Web.Tests.Support.TransferSupport;

namespace Opten.StudioFlow.Web.Tests;

public sealed class ProductionTransferApiTests(StudioFlowApp app) : IClassFixture<StudioFlowApp>
{
    [Fact]
    public async Task Duplicate_TakesOverScenesAndMedia_ButNoDevicesSecretsOrOutputKeys()
    {
        var source = await CreateRichProductionAsync(app);
        var original = await SnapshotAsync(source.Admin, source.Id);
        var originalLinks = await source.Admin.GetOutputLinksAsync();

        var copy = await source.Admin.Client.PostJsonAsync($"/api/productions/{source.Id}/duplicate", new DuplicateProductionRequest("The copy " + Guid.NewGuid().ToString("N")[..6])).ExpectAsync<ProductionDto>(HttpStatusCode.Created);
        var snapshot = await SnapshotAsync(source.Admin, copy.Id);

        // The same production, compared without ids.
        Assert.Equal(Describe(original).Replace(original.Production.Name, copy.Name, StringComparison.Ordinal), Describe(snapshot));
        Assert.NotEqual(source.Id, copy.Id);
        Assert.All(snapshot.Scenes, scene => Assert.DoesNotContain(original.Scenes, o => o.Id == scene.Id));
        Assert.Empty(snapshot.Scenes.SelectMany(s => s.Items).Select(i => i.Id).Intersect(original.Scenes.SelectMany(s => s.Items).Select(i => i.Id)));

        // Never active, in standby, at the first scene.
        Assert.False(copy.IsActive);
        Assert.Equal(BroadcastState.Standby, snapshot.Production.Broadcast);
        Assert.Null(snapshot.Production.PreviewSceneId);
        Assert.Null(snapshot.Production.LiveSince);
        Assert.Null(snapshot.Production.LastTransition);
        Assert.Equal(snapshot.Scenes[0].Id, snapshot.Production.ProgramSceneId);
        Assert.Equal(original.Production.Canvas, snapshot.Production.Canvas);
        Assert.NotEqual(original.Production.Slug, copy.Slug);

        // Devices, pairings and invites stay behind; the devices are placeholders with their code and name.
        Assert.Empty(snapshot.Devices);
        Assert.Empty(snapshot.Invites);
        Assert.Empty(snapshot.PairingRequests);
        Assert.DoesNotContain(snapshot.Sources, s => s.DeviceId is not null);
        Assert.Equal([("K1", SourceKind.Camera, "Stage phone"), ("S1", SourceKind.Screen, "Laptop Lea · Screen 1")], snapshot.Placeholders.Select(p => (p.Code, p.Kind, p.Label)));
        Assert.All(snapshot.Placeholders, p => Assert.DoesNotContain(source.Phone.DeviceId, p.SourceId, StringComparison.Ordinal));
        Assert.DoesNotContain(source.Laptop.DeviceId, JsonOf(snapshot), StringComparison.Ordinal);

        // A new default output link without the restriction of the original.
        var links = await source.Admin.Client.GetAsync($"/api/productions/{copy.Id}/output", TestContext.Current.CancellationToken).ExpectAsync<OutputSettingsDto>();
        var link = Assert.Single(links.Links);
        Assert.Equal(("Proxy", 0), (link.Name, link.AllowedIps.Count));
        Assert.DoesNotContain(originalLinks, l => l.Key() == link.Key());

        // The media are files of their own in the folder of the copy.
        Assert.Equal(2, snapshot.Assets.Count);
        foreach (var (before, after) in original.Assets.Zip(snapshot.Assets))
        {
            Assert.NotEqual(before.Id, after.Id);
            using var a = await source.Admin.Client.GetAsync(before.ContentUrl, TestContext.Current.CancellationToken);
            using var b = await source.Admin.Client.GetAsync(after.ContentUrl, TestContext.Current.CancellationToken);
            Assert.Equal(await a.Content.ReadAsByteArrayAsync(TestContext.Current.CancellationToken), await b.Content.ReadAsByteArrayAsync(TestContext.Current.CancellationToken));
            Assert.Contains(Directory.GetFiles(Path.Combine(app.MediaPath, copy.Id)), file => Path.GetFileName(file).StartsWith(after.Id, StringComparison.Ordinal));
        }

        Assert.Equal(2, Directory.GetFiles(Path.Combine(app.MediaPath, copy.Id)).Length);
    }

    [Fact]
    public async Task Duplicate_DoesNotTouchTheOriginal()
    {
        var source = await CreateRichProductionAsync(app);
        var before = await SnapshotAsync(source.Admin, source.Id);

        await source.Admin.Client.PostJsonAsync($"/api/productions/{source.Id}/duplicate", new DuplicateProductionRequest("Copy " + Guid.NewGuid().ToString("N")[..6])).ExpectAsync<ProductionDto>(HttpStatusCode.Created);
        var after = await SnapshotAsync(source.Admin, source.Id);

        Assert.Equal(before.Revision, after.Revision);
        Assert.Equal(Describe(before), Describe(after));
        Assert.Equal(before.Devices.Select(d => d.Id), after.Devices.Select(d => d.Id));
        Assert.Equal(before.Scenes.Select(s => (s.Id, s.Version)), after.Scenes.Select(s => (s.Id, s.Version)));
    }

    [Fact]
    public async Task Duplicate_RunningProduction_IsReadOnlyAndTheCopyIsInStandby()
    {
        var source = await CreateRichProductionAsync(app);
        await source.Admin.Client.PostAsync($"/api/productions/{source.Id}/broadcast/start", null, TestContext.Current.CancellationToken).ExpectAsync<ProductionDto>();
        var live = await SnapshotAsync(source.Admin, source.Id);

        var copy = await source.Admin.Client.PostJsonAsync($"/api/productions/{source.Id}/duplicate", new DuplicateProductionRequest("Live copy " + Guid.NewGuid().ToString("N")[..6])).ExpectAsync<ProductionDto>(HttpStatusCode.Created);
        await ExportAsync(source.Admin, source.Id);
        var after = await SnapshotAsync(source.Admin, source.Id);

        Assert.Equal(BroadcastState.Live, after.Production.Broadcast);
        Assert.Equal(live.Production.LiveSince, after.Production.LiveSince);
        Assert.Equal(live.Revision, after.Revision);
        Assert.Equal((BroadcastState.Standby, false), (copy.Broadcast, copy.IsActive));
        Assert.Null(copy.LiveSince);
    }

    [Fact]
    public async Task Duplicate_WithoutName_IsNamedCopyAndATakenNameGetsANumber()
    {
        var admin = await app.AdminAsync();
        var name = "Gala " + Guid.NewGuid().ToString("N")[..6];
        var original = await admin.Client.PostJsonAsync("/api/productions", new CreateProductionRequest(name)).ExpectAsync<ProductionDto>(HttpStatusCode.Created);

        var first = await admin.Client.PostJsonAsync($"/api/productions/{original.Id}/duplicate", new DuplicateProductionRequest(null)).ExpectAsync<ProductionDto>(HttpStatusCode.Created);
        var second = await admin.Client.PostJsonAsync($"/api/productions/{original.Id}/duplicate", new DuplicateProductionRequest(null)).ExpectAsync<ProductionDto>(HttpStatusCode.Created);
        var same = await admin.Client.PostJsonAsync($"/api/productions/{original.Id}/duplicate", new DuplicateProductionRequest(name.ToUpperInvariant())).ExpectAsync<ProductionDto>(HttpStatusCode.Created);

        Assert.Equal($"{name} (copy)", first.Name);
        Assert.Equal($"{name} (copy) (2)", second.Name);
        Assert.Equal($"{name.ToUpperInvariant()} (2)", same.Name);
        Assert.Equal(3, new[] { first.Slug, second.Slug, same.Slug }.Distinct().Count());
    }

    [Fact]
    public async Task Duplicate_UnknownOrInvalid_IsRejectedAndLeavesNothing()
    {
        var admin = await app.AdminAsync();
        var folders = MediaFolders(app);
        var ids = await ProductionIdsAsync(admin);

        await admin.Client.PostJsonAsync("/api/productions/prd_doesnotexist00/duplicate", new DuplicateProductionRequest("X")).ExpectProblemAsync(HttpStatusCode.NotFound);
        Assert.Equal(ErrorCodes.ValidationFailed, await admin.Client.PostJsonAsync($"/api/productions/{admin.ProductionId}/duplicate", new DuplicateProductionRequest(new string('x', 81))).ExpectProblemAsync(HttpStatusCode.BadRequest));
        Assert.Equal(ErrorCodes.ValidationFailed, await admin.Client.PostJsonAsync($"/api/productions/{admin.ProductionId}/duplicate", new DuplicateProductionRequest("   ")).ExpectProblemAsync(HttpStatusCode.BadRequest));

        Assert.Equal(ids, await ProductionIdsAsync(admin));
        Assert.Equal(folders, MediaFolders(app));
    }

    [Fact]
    public async Task Duplicate_Audit_ShowsOnTheCopy()
    {
        var source = await CreateRichProductionAsync(app);

        var copy = await source.Admin.Client.PostJsonAsync($"/api/productions/{source.Id}/duplicate", new DuplicateProductionRequest("Audited " + Guid.NewGuid().ToString("N")[..6])).ExpectAsync<ProductionDto>(HttpStatusCode.Created);

        var entry = Assert.Single((await AuditAsync(source.Admin, copy.Id)).Entries, e => e.Action == "production.duplicated");
        Assert.Equal((LogCode.ProductionDuplicated, AuditCategory.Production, copy.Name, source.Production.Name), (entry.Code, entry.Category, entry.Params["name"], entry.Params["from"]));
        Assert.Equal("admin", entry.Actor);
    }

    [Fact]
    public async Task Export_IsAZipWithTheManifestAndTheMedia_WithoutIdsOrSecrets()
    {
        var source = await CreateRichProductionAsync(app);
        var snapshot = await SnapshotAsync(source.Admin, source.Id);
        var links = await source.Admin.GetOutputLinksAsync();
        using var response = await source.Admin.Client.GetAsync($"/api/productions/{source.Id}/export", TestContext.Current.CancellationToken);
        await response.ExpectAsync(HttpStatusCode.OK);

        var archive = await response.Content.ReadAsByteArrayAsync(TestContext.Current.CancellationToken);
        var files = Unzip(archive);
        var manifestText = Encoding.UTF8.GetString(files["manifest.json"]);
        var manifest = ManifestJson.Read(files["manifest.json"]);

        Assert.Matches($"^attachment; filename=\"{source.Production.Slug}-\\d{{4}}-\\d{{2}}-\\d{{2}}\\.studioflow\\.zip\"$", response.Content.Headers.ContentDisposition!.ToString());
        Assert.Equal(["manifest.json", "media/a1.png", "media/a2.mp4"], files.Keys.Order(StringComparer.Ordinal));
        Assert.Equal(1, manifest.FormatVersion);
        Assert.Equal(source.Production.Name, manifest.Production.Name);
        Assert.Equal(["Welcome", "Presentation", "Break", "Interview"], manifest.Scenes.Select(s => s.Name));
        Assert.Equal(["K1", "S1"], manifest.Placeholders.Select(p => p.Code));
        Assert.Equal(TransferSupport.Sha256(files["media/a1.png"]), manifest.Assets[0].Sha256);
        Assert.Equal(files["media/a2.mp4"].Length, manifest.Assets[1].SizeBytes);

        // No id of this installation, no secret.
        var secrets = new List<string> { source.Id, source.Production.Slug, source.Phone.DeviceId, source.Phone.DeviceSecret, source.Laptop.DeviceId, source.Laptop.DeviceSecret, "203.0.113.0" };
        secrets.AddRange(links.Select(l => l.Key()));
        secrets.AddRange(snapshot.Scenes.Select(s => s.Id));
        secrets.AddRange(snapshot.Scenes.SelectMany(s => s.Items).Select(i => i.Id));
        secrets.AddRange(snapshot.Assets.Select(a => a.Id));
        secrets.AddRange(snapshot.Sources.Where(s => s.Text is not null).Select(s => s.Id));
        secrets.AddRange(snapshot.Invites.Select(i => i.Id));
        foreach (var secret in secrets)
        {
            Assert.DoesNotContain(secret, manifestText, StringComparison.Ordinal);
        }
    }

    [Fact]
    public async Task ExportThenImport_GivesTheSameProduction()
    {
        var source = await CreateRichProductionAsync(app);
        var original = await SnapshotAsync(source.Admin, source.Id);
        var archive = await ExportAsync(source.Admin, source.Id);
        var folders = MediaFolders(app);

        var imported = await ImportAsync(source.Admin, archive).ExpectAsync<ProductionDto>(HttpStatusCode.Created);
        var snapshot = await SnapshotAsync(source.Admin, imported.Id);

        Assert.Equal($"{original.Production.Name} (2)", imported.Name);
        Assert.Equal(Describe(original).Replace(original.Production.Name, imported.Name, StringComparison.Ordinal), Describe(snapshot));
        Assert.Empty(snapshot.Devices);
        Assert.Equal(["K1", "S1"], snapshot.Placeholders.Select(p => p.Code));
        Assert.Equal(folders.Count + 1, MediaFolders(app).Count);
        Assert.Equal(2, Directory.GetFiles(Path.Combine(app.MediaPath, imported.Id)).Length);
        foreach (var (before, after) in original.Assets.Zip(snapshot.Assets))
        {
            using var a = await source.Admin.Client.GetAsync(before.ContentUrl, TestContext.Current.CancellationToken);
            using var b = await source.Admin.Client.GetAsync(after.ContentUrl, TestContext.Current.CancellationToken);
            Assert.Equal(await a.Content.ReadAsByteArrayAsync(TestContext.Current.CancellationToken), await b.Content.ReadAsByteArrayAsync(TestContext.Current.CancellationToken));
        }
    }

    [Fact]
    public async Task Import_NeverBecomesTheActiveProduction()
    {
        var source = await CreateRichProductionAsync(app);
        var active = (await source.Admin.Client.GetAsync("/api/productions/active", TestContext.Current.CancellationToken).ExpectAsync<ProductionSummaryDto>()).Id;

        var imported = await ImportAsync(source.Admin, await ExportAsync(source.Admin, source.Id)).ExpectAsync<ProductionDto>(HttpStatusCode.Created);
        var duplicated = await source.Admin.Client.PostJsonAsync($"/api/productions/{source.Id}/duplicate", new DuplicateProductionRequest("Not active " + Guid.NewGuid().ToString("N")[..6])).ExpectAsync<ProductionDto>(HttpStatusCode.Created);

        Assert.False(imported.IsActive);
        Assert.False(duplicated.IsActive);
        Assert.Equal(active, (await source.Admin.Client.GetAsync("/api/productions/active", TestContext.Current.CancellationToken).ExpectAsync<ProductionSummaryDto>()).Id);
    }

    [Fact]
    public async Task Import_DryRun_ReportsWhatItWouldDoAndStoresNothing()
    {
        var source = await CreateRichProductionAsync(app);
        var archive = await ExportAsync(source.Admin, source.Id);
        var ids = await ProductionIdsAsync(source.Admin);
        var folders = MediaFolders(app);

        var preview = await ImportAsync(source.Admin, archive, dryRun: true).ExpectAsync<ImportPreviewDto>();

        Assert.Equal($"{source.Production.Name} (2)", preview.Name);
        Assert.Equal((4, 1, 2), (preview.Scenes, preview.Texts, preview.Media));
        Assert.Equal(3000 + 5000, preview.MediaBytes);
        Assert.Equal([("K1", SourceKind.Camera, "Stage phone"), ("S1", SourceKind.Screen, "Laptop Lea · Screen 1")], preview.Placeholders.Select(p => (p.Code, p.Kind, p.Label)));
        Assert.Equal([ImportWarningCode.NameChanged, ImportWarningCode.Placeholders], preview.Warnings.Select(w => w.Code));
        Assert.Equal(preview.Name, preview.Warnings[0].Params["name"]);
        Assert.Equal("2", preview.Warnings[1].Params["count"]);
        Assert.NotEmpty(preview.AppVersion);
        Assert.Equal(ids, await ProductionIdsAsync(source.Admin));
        Assert.Equal(folders, MediaFolders(app));
    }

    [Fact]
    public async Task Import_UniqueName_HasNoWarningForTheName()
    {
        var admin = await app.AdminAsync();
        var manifest = MinimalManifest("Fresh " + Guid.NewGuid().ToString("N"));
        var archive = Zip(("manifest.json", ManifestJson.Serialize(manifest)));

        var preview = await ImportAsync(admin, archive, dryRun: true).ExpectAsync<ImportPreviewDto>();
        var created = await ImportAsync(admin, archive).ExpectAsync<ProductionDto>(HttpStatusCode.Created);

        Assert.Equal(manifest.Production.Name, preview.Name);
        Assert.Empty(preview.Warnings);
        Assert.Equal((manifest.Production.Name, false, BroadcastState.Standby), (created.Name, created.IsActive, created.Broadcast));
    }

    [Fact]
    public async Task ExportAndImport_Audit_ShowOnTheProductions()
    {
        var source = await CreateRichProductionAsync(app);
        var archive = await ExportAsync(source.Admin, source.Id);

        var imported = await ImportAsync(source.Admin, archive).ExpectAsync<ProductionDto>(HttpStatusCode.Created);

        var exported = Assert.Single((await AuditAsync(source.Admin, source.Id)).Entries, e => e.Action == "production.exported");
        var entry = Assert.Single((await AuditAsync(source.Admin, imported.Id)).Entries, e => e.Action == "production.imported");
        Assert.Equal((LogCode.ProductionExported, source.Production.Name), (exported.Code, exported.Params["name"]));
        Assert.Equal((LogCode.ProductionImported, imported.Name), (entry.Code, entry.Params["name"]));
    }

    [Fact]
    public async Task Export_UnknownProduction_IsNotFound()
    {
        var admin = await app.AdminAsync();

        await admin.Client.GetAsync("/api/productions/prd_doesnotexist00/export", TestContext.Current.CancellationToken).ExpectProblemAsync(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task Export_ProductionWithoutMediaOrDevices_IsOnlyTheManifest()
    {
        var admin = await app.AdminAsync();
        var production = await admin.Client.PostJsonAsync("/api/productions", new CreateProductionRequest("Empty " + Guid.NewGuid().ToString("N")[..6])).ExpectAsync<ProductionDto>(HttpStatusCode.Created);

        var files = Unzip(await ExportAsync(admin, production.Id));
        var manifest = ManifestJson.Read(files["manifest.json"]);

        Assert.Equal(["manifest.json"], files.Keys);
        Assert.Empty(manifest.Placeholders);
        Assert.Equal(["Welcome", "Presentation", "Break"], manifest.Scenes.Select(s => s.Name));
    }

    [Fact]
    public async Task TransferRoutes_WithoutSessionOrCsrfHeader_AreRefused()
    {
        var admin = await app.AdminAsync();
        var anonymous = app.Anonymous();
        var noCsrf = app.Anonymous();
        noCsrf.DefaultRequestHeaders.Add("Cookie", admin.Cookie);
        var archive = Zip(("manifest.json", ManifestJson.Serialize(MinimalManifest())));
        using var form = new MultipartFormDataContent { { new ByteArrayContent(archive), "file", "x.zip" } };
        using var form2 = new MultipartFormDataContent { { new ByteArrayContent(archive), "file", "x.zip" } };

        await anonymous.GetAsync($"/api/productions/{admin.ProductionId}/export", TestContext.Current.CancellationToken).ExpectProblemAsync(HttpStatusCode.Unauthorized);
        await anonymous.PostJsonAsync($"/api/productions/{admin.ProductionId}/duplicate", new DuplicateProductionRequest("X")).ExpectProblemAsync(HttpStatusCode.Unauthorized);
        await anonymous.PostAsync("/api/productions/import", form, TestContext.Current.CancellationToken).ExpectProblemAsync(HttpStatusCode.Unauthorized);
        Assert.Equal(ErrorCodes.Forbidden, await noCsrf.PostJsonAsync($"/api/productions/{admin.ProductionId}/duplicate", new DuplicateProductionRequest("X")).ExpectProblemAsync(HttpStatusCode.Forbidden));
        Assert.Equal(ErrorCodes.Forbidden, await noCsrf.PostAsync("/api/productions/import", form2, TestContext.Current.CancellationToken).ExpectProblemAsync(HttpStatusCode.Forbidden));
    }

    private static string JsonOf(ProductionSnapshot snapshot) => System.Text.Json.JsonSerializer.Serialize(snapshot, ContractJson.Options);

    private static async Task<AuditPageDto> AuditAsync(AdminSession admin, string productionId) =>
        await admin.Client.GetAsync($"/api/audit?production={productionId}&limit=200", TestContext.Current.CancellationToken).ExpectAsync<AuditPageDto>();
}
