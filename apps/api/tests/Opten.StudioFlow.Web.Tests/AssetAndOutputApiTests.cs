using System.Net;
using System.Net.Http.Headers;
using Opten.StudioFlow.Core.Contracts;
using Opten.StudioFlow.Web.Tests.Support;

namespace Opten.StudioFlow.Web.Tests;

public sealed class AssetApiTests(StudioFlowApp app) : IClassFixture<StudioFlowApp>
{
    public static TheoryData<string, string, int?> ValidUploads => new()
    {
        { "png", "image/png", 1920 },
        { "jpeg", "image/jpeg", 4032 },
        { "webp", "image/webp", 640 },
        { "mp4", "video/mp4", null },
        { "webm", "video/webm", null },
    };

    [Theory]
    [MemberData(nameof(ValidUploads))]
    public async Task Upload_AllowedType_IsStoredWithVerifiedTypeAndSize(string sample, string contentType, int? width)
    {
        var admin = await app.AdminAsync();

        var asset = await UploadAsync(admin, Sample(sample), "Pausen-Bild.final.png", "application/octet-stream").ExpectAsync<AssetDto>(HttpStatusCode.Created);

        Assert.Equal(contentType, asset.ContentType);
        Assert.Equal(width, asset.Width);
        Assert.Equal("Pausen-Bild.final", asset.Name);
        Assert.Matches("^M[0-9]+$", asset.Code);
        Assert.Equal($"/api/productions/{admin.ProductionId}/assets/{asset.Id}/content", asset.ContentUrl);
        Assert.Contains(await admin.Client.GetAsync($"/api/productions/{admin.ProductionId}/assets", TestContext.Current.CancellationToken).ExpectAsync<List<AssetDto>>(), a => a.Id == asset.Id);
    }

    [Theory]
    [InlineData("svg")]
    [InlineData("gif")]
    [InlineData("avif")]
    [InlineData("text")]
    public async Task Upload_SpoofedContentType_IsUnsupportedMedia(string sample)
    {
        var admin = await app.AdminAsync();

        Assert.Equal(ErrorCodes.UnsupportedMedia, await UploadAsync(admin, Sample(sample), "harmlos.png", "image/png").ExpectProblemAsync(HttpStatusCode.UnsupportedMediaType));
        Assert.Empty(Directory.Exists(Path.Combine(app.MediaPath, admin.ProductionId)) ? Directory.GetFiles(Path.Combine(app.MediaPath, admin.ProductionId), "*.part") : []);
    }

    [Fact]
    public async Task Upload_TooLargeImageOrVideo_Is413()
    {
        var admin = await app.AdminAsync();

        Assert.Equal(ErrorCodes.UnsupportedMedia, await UploadAsync(admin, MediaSamples.Png(10, 10, (int)StudioFlowApp.MaxImageBytes + 1), "x.png", "image/png").ExpectProblemAsync(HttpStatusCode.RequestEntityTooLarge));
        await UploadAsync(admin, MediaSamples.Mp4(totalBytes: (int)StudioFlowApp.MaxVideoBytes + 1), "x.mp4", "video/mp4").ExpectProblemAsync(HttpStatusCode.RequestEntityTooLarge);
        await UploadAsync(admin, MediaSamples.Mp4(totalBytes: (int)StudioFlowApp.MaxImageBytes + 1), "big-but-video.mp4", "video/mp4").ExpectAsync(HttpStatusCode.Created);
    }

    [Fact]
    public async Task Upload_NotMultipartOrWithoutFile_IsRejected()
    {
        var admin = await app.AdminAsync();
        using var json = new StringContent("{}", System.Text.Encoding.UTF8, "application/json");
        using var empty = new MultipartFormDataContent();
        empty.Add(new StringContent("x"), "other");

        await admin.Client.PostAsync($"/api/productions/{admin.ProductionId}/assets", json, TestContext.Current.CancellationToken).ExpectAsync(HttpStatusCode.UnsupportedMediaType);
        await admin.Client.PostAsync($"/api/productions/{admin.ProductionId}/assets", empty, TestContext.Current.CancellationToken).ExpectAsync(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task Content_AdminCookieAndOutputKey_SupportRangeRequests()
    {
        var admin = await app.AdminAsync();
        var bytes = MediaSamples.Png(64, 32, 5000);
        var asset = await UploadAsync(admin, bytes, "range.png", "image/png").ExpectAsync<AssetDto>(HttpStatusCode.Created);
        var settings = await admin.Client.GetAsync($"/api/productions/{admin.ProductionId}/output", TestContext.Current.CancellationToken).ExpectAsync<OutputSettingsDto>();
        var key = settings.Url[(settings.Url.IndexOf("?k=", StringComparison.Ordinal) + 3)..];

        using var full = await admin.Client.GetAsync(asset.ContentUrl, TestContext.Current.CancellationToken);
        using var range = new HttpRequestMessage(HttpMethod.Get, $"{asset.ContentUrl}?k={key}");
        range.Headers.Range = new RangeHeaderValue(100, 199);
        using var partial = await app.Anonymous().SendAsync(range, TestContext.Current.CancellationToken);

        await full.ExpectAsync(HttpStatusCode.OK);
        Assert.Equal(bytes, await full.Content.ReadAsByteArrayAsync(TestContext.Current.CancellationToken));
        Assert.Equal("image/png", full.Content.Headers.ContentType!.MediaType);
        Assert.True(full.Headers.CacheControl!.Private);
        Assert.Equal(TimeSpan.FromHours(1), full.Headers.CacheControl.MaxAge);
        Assert.Equal("bytes", full.Headers.AcceptRanges.Single());
        await partial.ExpectAsync(HttpStatusCode.PartialContent);
        Assert.Equal(bytes[100..200], await partial.Content.ReadAsByteArrayAsync(TestContext.Current.CancellationToken));
        Assert.Equal(5000, partial.Content.Headers.ContentRange!.Length);
    }

    [Fact]
    public async Task Content_WrongKeyOrUnknown_IsForbiddenOrNotFound()
    {
        var admin = await app.AdminAsync();
        var asset = await UploadAsync(admin, MediaSamples.Png(1, 1), "x.png", "image/png").ExpectAsync<AssetDto>(HttpStatusCode.Created);

        Assert.Equal(ErrorCodes.Unauthorized, await app.Anonymous().GetAsync(asset.ContentUrl, TestContext.Current.CancellationToken).ExpectProblemAsync(HttpStatusCode.Unauthorized));
        await app.Anonymous().GetAsync($"{asset.ContentUrl}?k=wrong", TestContext.Current.CancellationToken).ExpectProblemAsync(HttpStatusCode.Forbidden);
        await admin.Client.GetAsync($"/api/productions/{admin.ProductionId}/assets/ast_unknown0000/content", TestContext.Current.CancellationToken).ExpectProblemAsync(HttpStatusCode.NotFound);
        await admin.Client.GetAsync("/api/productions/prd_unknown00000/assets/ast_unknown0000/content", TestContext.Current.CancellationToken).ExpectProblemAsync(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task Delete_UsedByItemFallbackBackgroundOrSlate_IsAssetInUse()
    {
        var admin = await app.AdminAsync();
        var image = await UploadAsync(admin, MediaSamples.Png(1, 1), "slate.png", "image/png").ExpectAsync<AssetDto>(HttpStatusCode.Created);
        var spare = await UploadAsync(admin, MediaSamples.Png(1, 1), "spare.png", "image/png").ExpectAsync<AssetDto>(HttpStatusCode.Created);
        var sceneId = (await admin.Client.GetAsync($"/api/productions/{admin.ProductionId}/snapshot", TestContext.Current.CancellationToken).ExpectAsync<ProductionSnapshot>()).Scenes[2].Id;
        var deleteUrl = $"/api/productions/{admin.ProductionId}/assets/{image.Id}";

        await admin.Client.PatchJsonAsync($"/api/productions/{admin.ProductionId}", new UpdateProductionRequest(null, null, new SlateDto("Ende", null, image.Id))).ExpectAsync(HttpStatusCode.OK);
        Assert.Equal(ErrorCodes.AssetInUse, await admin.Client.DeleteAsync(deleteUrl, TestContext.Current.CancellationToken).ExpectProblemAsync(HttpStatusCode.Conflict));
        await admin.Client.PatchJsonAsync($"/api/productions/{admin.ProductionId}", new UpdateProductionRequest(null, null, new SlateDto("Ende", null, null))).ExpectAsync(HttpStatusCode.OK);

        await admin.Client.PatchJsonAsync($"/api/productions/{admin.ProductionId}/scenes/{sceneId}", new UpdateSceneRequest(null, null, new SceneBackgroundDto("#000000", image.Id))).ExpectAsync(HttpStatusCode.OK);
        await admin.Client.DeleteAsync(deleteUrl, TestContext.Current.CancellationToken).ExpectProblemAsync(HttpStatusCode.Conflict);
        await admin.Client.PatchJsonAsync($"/api/productions/{admin.ProductionId}/scenes/{sceneId}", new UpdateSceneRequest(null, null, new SceneBackgroundDto("#000000", null))).ExpectAsync(HttpStatusCode.OK);

        var scene = await admin.Client.PostJsonAsync($"/api/productions/{admin.ProductionId}/scenes/{sceneId}/items", new AddSceneItemRequest(spare.Id, null, null, null, null, null, null)).ExpectAsync<SceneDto>();
        var item = scene.Items[^1];
        await admin.Client.PutJsonAsync($"/api/productions/{admin.ProductionId}/scenes/{sceneId}/items/{item.Id}", item with { OnLost = new LostBehaviorDto(3000, image.Id) }).ExpectAsync(HttpStatusCode.OK);
        await admin.Client.DeleteAsync(deleteUrl, TestContext.Current.CancellationToken).ExpectProblemAsync(HttpStatusCode.Conflict);
        await admin.Client.DeleteAsync($"/api/productions/{admin.ProductionId}/assets/{spare.Id}", TestContext.Current.CancellationToken).ExpectProblemAsync(HttpStatusCode.Conflict);
        await admin.Client.DeleteAsync($"/api/productions/{admin.ProductionId}/scenes/{sceneId}/items/{item.Id}", TestContext.Current.CancellationToken).ExpectAsync(HttpStatusCode.OK);

        await admin.Client.DeleteAsync(deleteUrl, TestContext.Current.CancellationToken).ExpectAsync(HttpStatusCode.NoContent);
        await admin.Client.DeleteAsync(deleteUrl, TestContext.Current.CancellationToken).ExpectProblemAsync(HttpStatusCode.NotFound);
        await admin.Client.GetAsync(image.ContentUrl, TestContext.Current.CancellationToken).ExpectProblemAsync(HttpStatusCode.NotFound);
        Assert.False(File.Exists(Path.Combine(app.MediaPath, admin.ProductionId, image.Id + ".png")));
    }

    [Fact]
    public async Task Rename_Asset_ValidatesAndChangesLabel()
    {
        var admin = await app.AdminAsync();
        var asset = await UploadAsync(admin, MediaSamples.Png(1, 1), "a.png", "image/png").ExpectAsync<AssetDto>(HttpStatusCode.Created);
        var url = $"/api/productions/{admin.ProductionId}/assets/{asset.Id}";

        var renamed = await admin.Client.PatchJsonAsync(url, new RenameAssetRequest("Logo")).ExpectAsync<AssetDto>();
        await admin.Client.PatchJsonAsync(url, new RenameAssetRequest(" ")).ExpectProblemAsync(HttpStatusCode.BadRequest);
        await admin.Client.PatchJsonAsync($"/api/productions/{admin.ProductionId}/assets/ast_unknown", new RenameAssetRequest("X")).ExpectProblemAsync(HttpStatusCode.NotFound);
        var snapshot = await admin.Client.GetAsync($"/api/productions/{admin.ProductionId}/snapshot", TestContext.Current.CancellationToken).ExpectAsync<ProductionSnapshot>();

        Assert.Equal("Logo", renamed.Name);
        Assert.Equal("Logo", snapshot.Sources.Single(s => s.AssetId == asset.Id).Label);
        Assert.Equal(SourceStatus.Ok, snapshot.Sources.Single(s => s.AssetId == asset.Id).Status);
    }

    private static byte[] Sample(string name) => name switch
    {
        "png" => MediaSamples.Png(1920, 1080),
        "jpeg" => MediaSamples.Jpeg(4032, 3024),
        "webp" => MediaSamples.WebPLossy(640, 360),
        "mp4" => MediaSamples.Mp4(),
        "webm" => MediaSamples.WebM(),
        "svg" => MediaSamples.Svg(),
        "gif" => MediaSamples.Gif(),
        "avif" => MediaSamples.Mp4("avif"),
        _ => "hello world, I am text"u8.ToArray(),
    };

    private static Task<HttpResponseMessage> UploadAsync(AdminSession admin, byte[] bytes, string fileName, string contentType)
    {
        var content = new MultipartFormDataContent();
        var file = new ByteArrayContent(bytes);
        file.Headers.ContentType = new MediaTypeHeaderValue(contentType);
        content.Add(file, "file", fileName);
        return admin.Client.PostAsync($"/api/productions/{admin.ProductionId}/assets", content);
    }
}

public sealed class OutputApiTests(StudioFlowApp app) : IClassFixture<StudioFlowApp>
{
    [Fact]
    public async Task Settings_Default_ContainUrlWithKeyAndFrameAncestors()
    {
        var admin = await app.AdminAsync();

        var settings = await admin.Client.GetAsync($"/api/productions/{admin.ProductionId}/output", TestContext.Current.CancellationToken).ExpectAsync<OutputSettingsDto>();

        Assert.StartsWith("https://sf.test/o/webinar?k=", settings.Url, StringComparison.Ordinal);
        Assert.Equal(["'self'", "https://stream.example"], settings.FrameAncestors);
        Assert.Empty(settings.AllowedIps);
    }

    [Fact]
    public async Task Snapshot_RightKey_HasNoPrivateDataAndWrongKeyLooksLikeUnknownSlug()
    {
        var (admin, key, slug) = await ProductionAsync();
        await app.PairPhoneAsync(admin);

        var snapshot = await OutputClient(key).GetAsync($"/api/output/{slug}/snapshot", TestContext.Current.CancellationToken).ExpectAsync<OutputSnapshot>();
        var wrongKey = await OutputClient(key + "x").GetAsync($"/api/output/{slug}/snapshot", TestContext.Current.CancellationToken).ExpectProblemAsync(HttpStatusCode.Forbidden);
        var unknownSlug = await OutputClient(key).GetAsync("/api/output/does-not-exist/snapshot", TestContext.Current.CancellationToken).ExpectProblemAsync(HttpStatusCode.Forbidden);

        Assert.Equal(3, snapshot.Scenes.Count);
        Assert.All(snapshot.Sources, s => Assert.Equal(SourceStatus.Ok, s.Status));
        Assert.Single(snapshot.Sources);
        Assert.Equal(wrongKey, unknownSlug);
        Assert.Equal(wrongKey, await app.Anonymous().GetAsync($"/api/output/{slug}/snapshot", TestContext.Current.CancellationToken).ExpectProblemAsync(HttpStatusCode.Forbidden));
    }

    [Fact]
    public async Task OutputRoutes_UnknownSlugWrongOrMissingKey_GiveTheSameForbiddenBody()
    {
        var (_, key, slug) = await ProductionAsync();
        string[] paths = ["snapshot", "changes?since=1", "livekit-token", "report"];

        foreach (var path in paths)
        {
            var post = path is "livekit-token" or "report";
            var bodies = new List<string>();
            foreach (var (client, route) in new[] { (OutputClient(key + "x"), slug), (OutputClient(key), "does-not-exist"), (app.Anonymous(), slug) })
            {
                using var response = post
                    ? await client.PostJsonAsync($"/api/output/{route}/{path}", new OutputReport(true, 1, 1, null))
                    : await client.GetAsync($"/api/output/{route}/{path}", TestContext.Current.CancellationToken);
                await response.ExpectAsync(HttpStatusCode.Forbidden);
                bodies.Add(WithoutTraceId(await response.Content.ReadAsStringAsync(TestContext.Current.CancellationToken)));
            }

            Assert.Single(bodies.Distinct(StringComparer.Ordinal));
        }
    }

    [Fact]
    public async Task OutputChanges_Rest_ReturnsDeltaOrSnapshotWithoutPrivateData()
    {
        var (admin, key, slug) = await ProductionAsync();
        var output = OutputClient(key);
        var start = await output.GetAsync($"/api/output/{slug}/changes?since=0", TestContext.Current.CancellationToken).ExpectAsync<OutputChangesDto>();
        await app.PairPhoneAsync(admin);
        await admin.Client.PatchJsonAsync($"/api/productions/{admin.ProductionId}", new UpdateProductionRequest("Umbenannt", null, null)).ExpectAsync(HttpStatusCode.OK);

        var delta = await output.GetAsync($"/api/output/{slug}/changes?since={start.Revision}", TestContext.Current.CancellationToken).ExpectAsync<OutputChangesDto>();
        await output.GetAsync($"/api/output/{slug}/changes?since=-1", TestContext.Current.CancellationToken).ExpectProblemAsync(HttpStatusCode.BadRequest);
        await output.GetAsync($"/api/output/{slug}/changes", TestContext.Current.CancellationToken).ExpectAsync(HttpStatusCode.BadRequest);

        Assert.NotNull(start.Snapshot);
        Assert.Null(start.Events);
        Assert.Null(delta.Snapshot);
        Assert.Contains(delta.Events!, e => e is ProductionChangedEvent { Production.Name: "Umbenannt" });
        Assert.Contains(delta.Events!, e => e is SourceUpsertedEvent { Source.Status: SourceStatus.Ok, Source.StatusSince: null });
        Assert.DoesNotContain(delta.Events!, e => e is DeviceUpsertedEvent or InviteUpsertedEvent or InviteRemovedEvent or LogAppendedEvent);
        Assert.Contains(delta.Events!, e => e is RevisionOnlyEvent);
        Assert.Equal(delta.Revision, delta.Events![^1].Revision);
    }

    private static string WithoutTraceId(string json)
    {
        var node = System.Text.Json.Nodes.JsonNode.Parse(json)!.AsObject();
        node.Remove("traceId");
        return node.ToJsonString();
    }

    [Fact]
    public async Task Token_Output_IsHiddenViewerWithSlugIdentity()
    {
        var (_, key, slug) = await ProductionAsync();

        var token = await OutputClient(key).PostAsync($"/api/output/{slug}/livekit-token", null, TestContext.Current.CancellationToken).ExpectAsync<LiveKitTokenDto>();

        Assert.StartsWith($"output_{slug}_", token.Identity, StringComparison.Ordinal);
    }

    [Fact]
    public async Task AllowedIps_ClientFromTrustedProxy_UsesForwardedAddress()
    {
        var (admin, key, slug) = await ProductionAsync();
        await admin.Client.PutJsonAsync($"/api/productions/{admin.ProductionId}/output/access", new UpdateOutputAccessRequest(["192.168.50.0/24"])).ExpectAsync<OutputSettingsDto>();

        var viaProxy = OutputClient(key, "10.99.0.2");
        viaProxy.DefaultRequestHeaders.Add("X-Forwarded-For", "192.168.50.7");
        var spoofed = OutputClient(key, "203.0.113.9");
        spoofed.DefaultRequestHeaders.Add("X-Forwarded-For", "192.168.50.7");

        await viaProxy.GetAsync($"/api/output/{slug}/snapshot", TestContext.Current.CancellationToken).ExpectAsync(HttpStatusCode.OK);
        await spoofed.GetAsync($"/api/output/{slug}/snapshot", TestContext.Current.CancellationToken).ExpectProblemAsync(HttpStatusCode.Forbidden);
        await OutputClient(key, "192.168.50.9").GetAsync($"/api/output/{slug}/snapshot", TestContext.Current.CancellationToken).ExpectAsync(HttpStatusCode.OK);
        await OutputClient(key, "192.168.51.9").GetAsync($"/api/output/{slug}/snapshot", TestContext.Current.CancellationToken).ExpectProblemAsync(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task Access_InvalidEntries_AreRejectedAndValidOnesNormalized()
    {
        var (admin, _, _) = await ProductionAsync();
        var url = $"/api/productions/{admin.ProductionId}/output/access";

        await admin.Client.PutJsonAsync(url, new UpdateOutputAccessRequest(["10.0.0.0/33"])).ExpectProblemAsync(HttpStatusCode.BadRequest);
        var settings = await admin.Client.PutJsonAsync(url, new UpdateOutputAccessRequest(["10.1.2.3/8", "2001:db8::1"])).ExpectAsync<OutputSettingsDto>();
        var cleared = await admin.Client.PutJsonAsync(url, new UpdateOutputAccessRequest([])).ExpectAsync<OutputSettingsDto>();

        Assert.Equal(["10.0.0.0/8", "2001:db8::1"], settings.AllowedIps);
        Assert.Empty(cleared.AllowedIps);
    }

    [Fact]
    public async Task RegenerateKey_OldKeyStopsWorkingAndOutputsAreKicked()
    {
        var (admin, key, slug) = await ProductionAsync();
        app.Rooms.Available = true;
        app.Rooms.Participants[admin.ProductionId] = [new("PA_1", $"output_{slug}_abc", []), new("PA_2", "studio_x", [])];
        try
        {
            var settings = await admin.Client.PostAsync($"/api/productions/{admin.ProductionId}/output/regenerate-key", null, TestContext.Current.CancellationToken).ExpectAsync<OutputSettingsDto>();
            var newKey = settings.Url[(settings.Url.IndexOf("?k=", StringComparison.Ordinal) + 3)..];

            await OutputClient(key).GetAsync($"/api/output/{slug}/snapshot", TestContext.Current.CancellationToken).ExpectProblemAsync(HttpStatusCode.Forbidden);
            await OutputClient(newKey).GetAsync($"/api/output/{slug}/snapshot", TestContext.Current.CancellationToken).ExpectAsync(HttpStatusCode.OK);
            Assert.Contains(app.Rooms.Removed, r => r.Identity == $"output_{slug}_abc");
            Assert.DoesNotContain(app.Rooms.Removed, r => r.Identity == "studio_x");
        }
        finally
        {
            app.Rooms.Available = false;
        }
    }

    [Fact]
    public async Task Report_Rest_UpdatesLastReport()
    {
        var (admin, key, slug) = await ProductionAsync();

        await OutputClient(key).PostJsonAsync($"/api/output/{slug}/report", new OutputReport(true, 140, 50, null)).ExpectAsync(HttpStatusCode.NoContent);
        await OutputClient(key + "x").PostJsonAsync($"/api/output/{slug}/report", new OutputReport(true, 140, 50, null)).ExpectProblemAsync(HttpStatusCode.Forbidden);
        var snapshot = await admin.Client.GetAsync($"/api/productions/{admin.ProductionId}/snapshot", TestContext.Current.CancellationToken).ExpectAsync<ProductionSnapshot>();

        Assert.Equal(140, snapshot.OutputStatus.LatencyMs);
        Assert.Equal(OutputState.None, snapshot.OutputStatus.State);
    }

    private HttpClient OutputClient(string key, string? address = null)
    {
        var client = app.Anonymous(address);
        client.DefaultRequestHeaders.Add("X-Output-Key", key);
        return client;
    }

    private async Task<(AdminSession Admin, string Key, string Slug)> ProductionAsync()
    {
        var admin = await app.AdminAsync();
        var production = await admin.Client.PostJsonAsync("/api/productions", new CreateProductionRequest("Out " + Guid.NewGuid().ToString("N")[..6])).ExpectAsync<ProductionDto>(HttpStatusCode.Created);
        var settings = await admin.Client.GetAsync($"/api/productions/{production.Id}/output").ExpectAsync<OutputSettingsDto>();
        return (admin with { ProductionId = production.Id }, settings.Url[(settings.Url.IndexOf("?k=", StringComparison.Ordinal) + 3)..], production.Slug);
    }
}
