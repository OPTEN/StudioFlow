using System.IO.Compression;
using System.Net;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text.Json;
using Opten.StudioFlow.Core.Contracts;
using Opten.StudioFlow.Core.Domain.Transfer;

namespace Opten.StudioFlow.Web.Tests.Support;

/// <summary>A production with everything a production holds, for the tests of duplicate, export and import.</summary>
/// <param name="Admin">The session, scoped to <see cref="Production"/>.</param>
/// <param name="Production">The production (not the active one).</param>
/// <param name="Phone">A paired phone: its camera is K1.</param>
/// <param name="Laptop">A paired laptop: its screen is S1.</param>
/// <param name="Image">An uploaded image (M1).</param>
/// <param name="Video">An uploaded video (M2).</param>
/// <param name="Text">A lower third (T1).</param>
public sealed record RichProduction(AdminSession Admin, ProductionDto Production, DeviceCredentialsDto Phone, DeviceCredentialsDto Laptop, AssetDto Image, AssetDto Video, TextSourceDto Text)
{
    public string Id => Production.Id;
}

public static class TransferSupport
{
    /// <summary>
    /// Builds a production with a portrait 720p canvas, slates with a picture, text colours, a text, an image, a video, a paired
    /// phone and laptop, four scenes that use all of them (a camera with a fallback picture, a screen with the camera as
    /// fallback, the text, the media, a scene background), a second output link with an IP restriction and an open laptop invite.
    /// </summary>
    public static async Task<RichProduction> CreateRichProductionAsync(StudioFlowApp app, string? name = null)
    {
        var admin = await app.AdminAsync();
        var production = await admin.Client.PostJsonAsync("/api/productions", new CreateProductionRequest(name ?? "Rich " + Guid.NewGuid().ToString("N")[..8], CanvasFormat.Portrait, CanvasResolution.P720)).ExpectAsync<ProductionDto>(HttpStatusCode.Created);
        var own = admin with { ProductionId = production.Id };
        var url = $"/api/productions/{production.Id}";

        var image = await UploadAsync(own, MediaSamples.Png(640, 360, 3000), "Logo.png").ExpectAsync<AssetDto>(HttpStatusCode.Created);
        var video = await UploadAsync(own, MediaSamples.Mp4(totalBytes: 5000), "Intro.mp4").ExpectAsync<AssetDto>(HttpStatusCode.Created);
        var text = await admin.Client.PostJsonAsync($"{url}/texts", new CreateTextSourceRequest("Mia Meier", "Moderator", TextStyle.LowerThird, null)).ExpectAsync<TextSourceDto>(HttpStatusCode.Created);
        var phone = await app.PairPhoneAsync(own, "Stage phone");
        var laptop = await app.PairLaptopAsync(own, "Laptop Lea");
        var camera = $"{phone.DeviceId}/camera";
        var screen = $"{laptop.DeviceId}/screen-1";
        await admin.Client.PatchJsonAsync(url, new UpdateProductionRequest(null, new SlateDto("Soon", "Back at 10", image.Id), new SlateDto("Bye", null, null), new TextThemeDto("#ff8800", "#101010", "#fafafa"))).ExpectAsync<ProductionDto>();

        var scenes = (await admin.Client.GetAsync($"{url}/snapshot", TestContext.Current.CancellationToken).ExpectAsync<ProductionSnapshot>()).Scenes;
        var welcome = await AddItemAsync(admin, url, scenes[0].Id, camera);
        welcome = await ReplaceItemAsync(admin, url, welcome, welcome.Items[0] with { X = 10, Y = 20, W = 400, H = 300, Mirror = true, Rotation = 90, Border = new BorderDto(4, "#00ff00"), Crop = new CropDto(0.1, 0, 0.1, 0), OnLost = new LostBehaviorDto(2500, image.Id) });
        await AddItemAsync(admin, url, scenes[0].Id, text.Id);
        var presentation = await AddItemAsync(admin, url, scenes[1].Id, screen);
        await ReplaceItemAsync(admin, url, presentation, presentation.Items[0] with { OnLost = new LostBehaviorDto(1500, camera) });
        await AddItemAsync(admin, url, scenes[1].Id, camera);
        await AddItemAsync(admin, url, scenes[2].Id, image.Id);
        var video2 = await AddItemAsync(admin, url, scenes[2].Id, video.Id);
        await ReplaceItemAsync(admin, url, video2, video2.Items[0] with { Hidden = true, Locked = true });
        await admin.Client.PatchJsonAsync($"{url}/scenes/{scenes[2].Id}", new UpdateSceneRequest(null, SceneLayoutMode.AutoGrid, new SceneBackgroundDto("#223344", image.Id))).ExpectAsync<SceneDto>();
        var interview = await admin.Client.PostJsonAsync($"{url}/scenes", new CreateSceneRequest("Interview", scenes[1].Id)).ExpectAsync<SceneDto>(HttpStatusCode.Created);
        Assert.Equal(2, interview.Items.Count);

        var link = await admin.Client.PostJsonAsync($"{url}/output/links", new CreateOutputLinkRequest("Teams camera")).ExpectAsync<OutputLinkDto>(HttpStatusCode.Created);
        await admin.Client.PutJsonAsync($"{url}/output/links/{link.Id}/access", new UpdateOutputAccessRequest(["203.0.113.0/24"])).ExpectAsync<OutputLinkDto>();
        await admin.Client.PostJsonAsync($"{url}/pairing/invites", new CreateInviteRequest(InviteKind.LaptopLink)).ExpectAsync<InviteDto>(HttpStatusCode.Created);
        return new RichProduction(own, production, phone, laptop, image, video, text);
    }

    public static Task<HttpResponseMessage> UploadAsync(AdminSession admin, byte[] bytes, string fileName)
    {
        var content = new MultipartFormDataContent();
        var file = new ByteArrayContent(bytes);
        file.Headers.ContentType = new MediaTypeHeaderValue("application/octet-stream");
        content.Add(file, "file", fileName);
        return admin.Client.PostAsync($"/api/productions/{admin.ProductionId}/assets", content);
    }

    public static Task<ProductionSnapshot> SnapshotAsync(AdminSession admin, string productionId) =>
        admin.Client.GetAsync($"/api/productions/{productionId}/snapshot", TestContext.Current.CancellationToken).ExpectAsync<ProductionSnapshot>();

    /// <summary>The export of a production as a ZIP file.</summary>
    public static async Task<byte[]> ExportAsync(AdminSession admin, string productionId)
    {
        using var response = await admin.Client.GetAsync($"/api/productions/{productionId}/export", TestContext.Current.CancellationToken);
        await response.ExpectAsync(HttpStatusCode.OK);
        Assert.Equal("application/zip", response.Content.Headers.ContentType?.MediaType);
        return await response.Content.ReadAsByteArrayAsync(TestContext.Current.CancellationToken);
    }

    /// <summary>Posts a file to the import route.</summary>
    public static Task<HttpResponseMessage> ImportAsync(AdminSession admin, byte[] archive, bool dryRun = false)
    {
        var content = new MultipartFormDataContent();
        var file = new ByteArrayContent(archive);
        file.Headers.ContentType = new MediaTypeHeaderValue("application/zip");
        content.Add(file, "file", "export.studioflow.zip");
        return admin.Client.PostAsync(dryRun ? "/api/productions/import?dryRun=true" : "/api/productions/import", content);
    }

    /// <summary>Every production id of the installation.</summary>
    public static async Task<HashSet<string>> ProductionIdsAsync(AdminSession admin) =>
        (await admin.Client.GetAsync("/api/productions", TestContext.Current.CancellationToken).ExpectAsync<List<ProductionSummaryDto>>()).Select(p => p.Id).ToHashSet(StringComparer.Ordinal);

    /// <summary>The folders in the media folder: one per production that has media.</summary>
    public static HashSet<string> MediaFolders(StudioFlowApp app) =>
        Directory.Exists(app.MediaPath) ? Directory.GetDirectories(app.MediaPath).Select(d => Path.GetFileName(d)).ToHashSet(StringComparer.Ordinal) : [];

    /// <summary>
    /// The production without ids, so the original and its copy can be compared: sources by code and kind (media with their
    /// name, texts with their first line), everything else as it is.
    /// </summary>
    public static string Describe(ProductionSnapshot snapshot)
    {
        string Source(string? id)
        {
            if (id is null)
            {
                return "-";
            }

            if (snapshot.Sources.FirstOrDefault(s => s.Id == id) is { } source)
            {
                return source.Kind is SourceKind.Image or SourceKind.Video or SourceKind.Text ? $"{source.Code}:{source.Kind}:{source.Label}" : $"{source.Code}:{source.Kind}";
            }

            return snapshot.Placeholders.FirstOrDefault(p => p.SourceId == id) is { } placeholder ? $"{placeholder.Code}:{placeholder.Kind}" : "?" + id;
        }

        var production = snapshot.Production;
        return JsonSerializer.Serialize(
            new
            {
                production.Name,
                production.Canvas,
                production.TextTheme,
                Standby = new { production.StandbySlate.Title, production.StandbySlate.Subtitle, Background = Source(production.StandbySlate.BackgroundAssetId) },
                End = new { production.EndSlate.Title, production.EndSlate.Subtitle, Background = Source(production.EndSlate.BackgroundAssetId) },
                Texts = snapshot.Sources.Where(s => s.Text is not null).Select(s => s.Text! with { Id = string.Empty }),
                Assets = snapshot.Assets.Select(a => new { a.Code, a.Kind, a.Name, a.ContentType, a.SizeBytes, a.Width, a.Height }),
                Scenes = snapshot.Scenes.Select(scene => new
                {
                    scene.Name,
                    scene.SortOrder,
                    scene.LayoutMode,
                    Background = new { scene.Background.Color, Asset = Source(scene.Background.AssetId) },
                    Items = scene.Items.Select(i => new
                    {
                        Source = Source(i.Source),
                        i.X,
                        i.Y,
                        i.W,
                        i.H,
                        i.Fit,
                        i.Crop,
                        i.Radius,
                        i.Mirror,
                        i.Rotation,
                        i.Hidden,
                        i.Locked,
                        i.Border,
                        OnLost = new { i.OnLost.HoldMs, Fallback = Source(i.OnLost.FallbackSource) },
                    }),
                }),
            },
            ContractJson.Options);
    }

    /// <summary>A ZIP file with the given files.</summary>
    public static byte[] Zip(params (string Name, byte[] Content)[] files)
    {
        using var stream = new MemoryStream();
        using (var zip = new ZipArchive(stream, ZipArchiveMode.Create, leaveOpen: true))
        {
            foreach (var (name, content) in files)
            {
                var entry = zip.CreateEntry(name, CompressionLevel.Optimal);
                using var target = entry.Open();
                target.Write(content);
            }
        }

        return stream.ToArray();
    }

    /// <summary>The files of a ZIP file by name.</summary>
    public static Dictionary<string, byte[]> Unzip(byte[] archive)
    {
        using var zip = new ZipArchive(new MemoryStream(archive), ZipArchiveMode.Read);
        return zip.Entries.ToDictionary(
            e => e.FullName,
            e =>
            {
                using var content = new MemoryStream();
                using var source = e.Open();
                source.CopyTo(content);
                return content.ToArray();
            },
            StringComparer.Ordinal);
    }

    public static string Sha256(byte[] bytes) => Convert.ToHexStringLower(SHA256.HashData(bytes));

    /// <summary>The smallest valid manifest: one empty scene.</summary>
    public static ProductionManifest MinimalManifest(string name = "Imported") => new(
        ManifestFormat.Name,
        ManifestFormat.CurrentVersion,
        new ManifestApp("0.1.0", DateTimeOffset.Parse("2026-10-26T10:00:00Z", System.Globalization.CultureInfo.InvariantCulture)),
        new ManifestProduction(name, new ManifestCanvas(CanvasFormat.Widescreen, CanvasResolution.P1080), new ManifestSlate("Soon"), new ManifestSlate("Bye"), new ManifestTextTheme("#1f6feb", "#0d1117", "#ffffff")),
        [],
        [],
        [],
        [new ManifestScene("Scene", SceneLayoutMode.Free, new ManifestBackground("#0d1117"), [])],
        []);

    /// <summary>A manifest with one image, named like the file in the ZIP.</summary>
    public static (ProductionManifest Manifest, byte[] Content) ManifestWithImage(byte[] content, string name = "Picture")
    {
        var manifest = MinimalManifest() with
        {
            Assets = [new ManifestAsset("a1", "M1", AssetKind.Image, name, "image/png", content.Length, "media/a1.png", Sha256(content))],
        };
        return (manifest, content);
    }

    /// <summary>The manifest as JSON text, changed by <paramref name="change"/> (for a file that breaks one rule).</summary>
    public static byte[] ManifestJsonWith(ProductionManifest manifest, Action<System.Text.Json.Nodes.JsonObject> change)
    {
        var node = System.Text.Json.Nodes.JsonNode.Parse(ManifestJson.Serialize(manifest))!.AsObject();
        change(node);
        return System.Text.Encoding.UTF8.GetBytes(node.ToJsonString());
    }

    /// <summary>The same ZIP file with <c>manifest.json</c> changed by <paramref name="change"/> (a file as an older version wrote it).</summary>
    public static byte[] WithManifest(byte[] archive, Action<System.Text.Json.Nodes.JsonObject> change)
    {
        var files = Unzip(archive);
        var node = System.Text.Json.Nodes.JsonNode.Parse(files[ManifestFormat.ManifestEntry])!.AsObject();
        change(node);
        files[ManifestFormat.ManifestEntry] = System.Text.Encoding.UTF8.GetBytes(node.ToJsonString());
        return Zip([.. files.Select(f => (f.Key, f.Value))]);
    }

    private static async Task<SceneDto> AddItemAsync(AdminSession admin, string url, string sceneId, string source) =>
        await admin.Client.PostJsonAsync($"{url}/scenes/{sceneId}/items", new AddSceneItemRequest(source, null, null, null, null, null, null)).ExpectAsync<SceneDto>();

    private static async Task<SceneDto> ReplaceItemAsync(AdminSession admin, string url, SceneDto scene, SceneItemDto item) =>
        await admin.Client.PutJsonAsync($"{url}/scenes/{scene.Id}/items/{item.Id}", item).ExpectAsync<SceneDto>();
}
