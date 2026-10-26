using System.Buffers.Binary;
using System.IO.Compression;
using System.Net;
using System.Text;
using Microsoft.AspNetCore.Hosting;
using Opten.StudioFlow.Core.Contracts;
using Opten.StudioFlow.Core.Domain.Transfer;
using Opten.StudioFlow.Web.Tests.Support;
using static Opten.StudioFlow.Web.Tests.Support.TransferSupport;

namespace Opten.StudioFlow.Web.Tests;

/// <summary>
/// Files an import must refuse (spec 4.2.2, issue #14): each answers with the right status and code, creates no production and
/// leaves no file in the media folder – also when a medium was stored before the file turned out to be bad.
/// </summary>
public sealed class ProductionImportSecurityTests(StudioFlowApp app) : IClassFixture<StudioFlowApp>
{
    private static readonly byte[] Png = MediaSamples.Png(64, 48, 2000);

    public static TheoryData<string> UnsafeNames => new()
    {
        "../evil.png",
        "media/../../evil.png",
        "/etc/evil.png",
        "media/..",
        "media\\..\\evil.png",
        "C:/evil.png",
        "media//a1.png",
        "media/./a1.png",
        "..",
    };

    [Theory]
    [MemberData(nameof(UnsafeNames))]
    public async Task ZipSlip_NamesOutsideTheArchive_AreRefusedAndNothingIsWritten(string name)
    {
        var (manifest, content) = ManifestWithImage(Png);
        var archive = Zip(("manifest.json", ManifestJson.Serialize(manifest)), ("media/a1.png", content), (name, "evil"u8.ToArray()));

        await RefusedAsync(archive, HttpStatusCode.BadRequest, ErrorCodes.InvalidArchive);

        var parent = Path.GetDirectoryName(app.MediaPath)!;
        Assert.False(File.Exists(Path.Combine(parent, "evil.png")));
        Assert.False(File.Exists(Path.Combine(app.MediaPath, "evil.png")));
    }

    [Fact]
    public async Task ZipSlip_ANameInTheManifest_CannotLeaveTheMediaFolder()
    {
        var (manifest, content) = ManifestWithImage(Png);
        var evil = manifest with { Assets = [manifest.Assets[0] with { File = "media/../../evil.png" }] };
        var archive = Zip(("manifest.json", ManifestJson.Serialize(evil)), ("media/../../evil.png", content));

        await RefusedAsync(archive, HttpStatusCode.BadRequest, ErrorCodes.InvalidArchive);
    }

    [Fact]
    public async Task ZipBomb_HighCompressionRatio_IsRefusedBeforeAnythingIsUnpacked()
    {
        var (manifest, _) = ManifestWithImage(Png);
        var bomb = new byte[30 * 1024 * 1024];
        Png.CopyTo(bomb, 0);
        var archive = Zip(("manifest.json", ManifestJson.Serialize(manifest)), ("media/a1.png", bomb));
        Assert.True(archive.Length < 200_000);

        await RefusedAsync(archive, HttpStatusCode.BadRequest, ErrorCodes.InvalidArchive);
    }

    [Fact]
    public async Task ZipBomb_ADirectoryThatLiesAboutTheSize_IsRefusedWhileReading()
    {
        var content = new byte[5 * 1024 * 1024];
        Png.CopyTo(content, 0);
        var (manifest, _) = ManifestWithImage(content);
        var archive = Zip(("manifest.json", ManifestJson.Serialize(manifest with { Assets = [manifest.Assets[0] with { SizeBytes = 100_000 }] })), ("media/a1.png", content));
        // The directory says 100 000 bytes unpacked where the data holds 5 MiB: the ratio then looks harmless.
        PatchUncompressedSize(archive, "media/a1.png", 100_000);

        await RefusedAsync(archive, HttpStatusCode.BadRequest, ErrorCodes.InvalidArchive);
    }

    [Fact]
    public async Task TooManyEntries_AreRefused()
    {
        var (manifest, content) = ManifestWithImage(Png);
        var files = new List<(string, byte[])> { ("manifest.json", ManifestJson.Serialize(manifest)), ("media/a1.png", content) };
        files.AddRange(Enumerable.Range(0, 1100).Select(i => ($"media/extra{i}.png", Array.Empty<byte>())));

        await RefusedAsync(Zip([.. files]), HttpStatusCode.RequestEntityTooLarge, ErrorCodes.ArchiveTooLarge);
    }

    [Fact]
    public async Task ADirectoryWithMillionsOfEntries_IsRefusedWithoutReadingIt()
    {
        // The end-of-directory record claims 60 000 entries; the real directory is tiny. It is refused by the claim alone.
        var (manifest, content) = ManifestWithImage(Png);
        var archive = Zip(("manifest.json", ManifestJson.Serialize(manifest)), ("media/a1.png", content));
        BinaryPrimitives.WriteUInt16LittleEndian(archive.AsSpan(archive.Length - 22 + 10), 60_000);

        await RefusedAsync(archive, HttpStatusCode.RequestEntityTooLarge, ErrorCodes.ArchiveTooLarge);
    }

    [Theory]
    [InlineData("random")]
    [InlineData("text")]
    [InlineData("truncated")]
    public async Task NotAZipFile_IsRefused(string kind)
    {
        var (manifest, content) = ManifestWithImage(Png);
        var valid = Zip(("manifest.json", ManifestJson.Serialize(manifest)), ("media/a1.png", content));
        var file = kind switch
        {
            "random" => Enumerable.Range(0, 5000).Select(i => (byte)(i * 31 % 251)).ToArray(),
            "text" => "This is not an export."u8.ToArray(),
            _ => valid[..(valid.Length / 2)],
        };

        await RefusedAsync(file, HttpStatusCode.BadRequest, ErrorCodes.InvalidArchive);
    }

    [Fact]
    public async Task EmptyFile_IsRefused()
    {
        var admin = await app.AdminAsync();
        using var response = await ImportAsync(admin, []);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task ZipFileWithoutManifest_IsRefused()
    {
        await RefusedAsync(Zip(("media/a1.png", Png)), HttpStatusCode.BadRequest, ErrorCodes.InvalidArchive);
    }

    [Theory]
    [InlineData("{ not json")]
    [InlineData("[1, 2, 3]")]
    [InlineData("\"text\"")]
    [InlineData("null")]
    [InlineData("{}")]
    public async Task BrokenManifest_IsRefused(string manifest)
    {
        await RefusedAsync(Zip(("manifest.json", Encoding.UTF8.GetBytes(manifest))), HttpStatusCode.BadRequest, ErrorCodes.InvalidArchive);
    }

    [Fact]
    public async Task ManifestOfAnotherProgram_IsRefused()
    {
        var manifest = ManifestJsonWith(MinimalManifest(), root => root["format"] = "something-else");

        await RefusedAsync(Zip(("manifest.json", manifest)), HttpStatusCode.BadRequest, ErrorCodes.InvalidArchive);
    }

    [Theory]
    [InlineData(2)]
    [InlineData(3)]
    [InlineData(99)]
    [InlineData(int.MaxValue)]
    public async Task NewerFormatVersion_IsUnsupportedFormat(int version)
    {
        var manifest = ManifestJsonWith(MinimalManifest(), root =>
        {
            root["formatVersion"] = version;
            root["somethingNew"] = new System.Text.Json.Nodes.JsonObject { ["unknown"] = true };
            root.Remove("scenes");
        });

        await RefusedAsync(Zip(("manifest.json", manifest)), HttpStatusCode.BadRequest, ErrorCodes.UnsupportedFormat);
    }

    [Theory]
    [InlineData("0")]
    [InlineData("-1")]
    [InlineData("\"1\"")]
    [InlineData("1.5")]
    [InlineData("null")]
    public async Task UnusableFormatVersion_IsInvalid(string version)
    {
        var manifest = ManifestJsonWith(MinimalManifest(), root => root["formatVersion"] = System.Text.Json.Nodes.JsonNode.Parse(version));

        await RefusedAsync(Zip(("manifest.json", manifest)), HttpStatusCode.BadRequest, ErrorCodes.InvalidArchive);
    }

    [Fact]
    public async Task ManifestWithoutFormatVersion_IsInvalid()
    {
        var manifest = ManifestJsonWith(MinimalManifest(), root => root.Remove("formatVersion"));

        await RefusedAsync(Zip(("manifest.json", manifest)), HttpStatusCode.BadRequest, ErrorCodes.InvalidArchive);
    }

    [Fact]
    public async Task ManifestMissingAPart_NamesThePath()
    {
        var manifest = ManifestJsonWith(MinimalManifest(), root => root["production"]!.AsObject().Remove("name"));
        var admin = await app.AdminAsync();

        using var response = await ImportAsync(admin, Zip(("manifest.json", manifest)));

        await response.ExpectAsync(HttpStatusCode.BadRequest);
        var body = await response.Content.ReadAsStringAsync(TestContext.Current.CancellationToken);
        Assert.Contains("invalid_archive", body, StringComparison.Ordinal);
        Assert.Contains("$.production", body, StringComparison.Ordinal);
    }

    [Fact]
    public async Task ManifestWithWrongTypes_IsRefused()
    {
        var manifest = ManifestJsonWith(MinimalManifest(), root =>
        {
            root["scenes"]![0]!["layoutMode"] = "diagonal";
            root["texts"] = "none";
        });

        await RefusedAsync(Zip(("manifest.json", manifest)), HttpStatusCode.BadRequest, ErrorCodes.InvalidArchive);
    }

    [Fact]
    public async Task ManifestTooDeeplyNested_IsRefused()
    {
        var deep = new string('[', 5000) + new string(']', 5000);

        await RefusedAsync(Zip(("manifest.json", Encoding.UTF8.GetBytes(deep))), HttpStatusCode.BadRequest, ErrorCodes.InvalidArchive);
    }

    [Fact]
    public async Task FileTheManifestDoesNotName_IsRefused()
    {
        var (manifest, content) = ManifestWithImage(Png);

        await RefusedAsync(Zip(("manifest.json", ManifestJson.Serialize(manifest)), ("media/a1.png", content), ("media/hidden.png", Png)), HttpStatusCode.BadRequest, ErrorCodes.InvalidArchive);
        await RefusedAsync(Zip(("manifest.json", ManifestJson.Serialize(manifest)), ("media/a1.png", content), ("readme.txt", "hi"u8.ToArray())), HttpStatusCode.BadRequest, ErrorCodes.InvalidArchive);
    }

    [Fact]
    public async Task FileTheManifestNames_ButTheArchiveLacks_IsRefused()
    {
        var (manifest, _) = ManifestWithImage(Png);

        await RefusedAsync(Zip(("manifest.json", ManifestJson.Serialize(manifest))), HttpStatusCode.BadRequest, ErrorCodes.InvalidArchive);
    }

    [Fact]
    public async Task SameNameTwice_IsRefused()
    {
        var (manifest, content) = ManifestWithImage(Png);

        await RefusedAsync(Zip(("manifest.json", ManifestJson.Serialize(manifest)), ("media/a1.png", content), ("media/a1.png", content)), HttpStatusCode.BadRequest, ErrorCodes.InvalidArchive);
    }

    [Theory]
    [InlineData("svg")]
    [InlineData("gif")]
    [InlineData("text")]
    [InlineData("html")]
    public async Task MediumOfAForbiddenType_IsRefusedAsAnUploadWould(string kind)
    {
        var content = kind switch
        {
            "svg" => MediaSamples.Svg(),
            "gif" => MediaSamples.Gif(),
            "html" => "<html><script>alert(1)</script></html>"u8.ToArray(),
            _ => "just text"u8.ToArray(),
        };
        var (manifest, _) = ManifestWithImage(content);

        await RefusedAsync(Zip(("manifest.json", ManifestJson.Serialize(manifest)), ("media/a1.png", content)), HttpStatusCode.UnsupportedMediaType, ErrorCodes.UnsupportedMedia);
    }

    [Fact]
    public async Task MediumTooLarge_IsRefusedAsAnUploadWould()
    {
        var big = MediaSamples.Png(64, 48, (int)StudioFlowApp.MaxImageBytes + 1);
        var (manifest, _) = ManifestWithImage(big);

        await RefusedAsync(Zip(("manifest.json", ManifestJson.Serialize(manifest)), ("media/a1.png", big)), HttpStatusCode.RequestEntityTooLarge, ErrorCodes.UnsupportedMedia);
    }

    [Fact]
    public async Task ASecondMediumThatFails_LeavesNoFileOfTheFirst()
    {
        var (manifest, content) = ManifestWithImage(Png);
        var svg = MediaSamples.Svg();
        var two = manifest with
        {
            Assets = [manifest.Assets[0], manifest.Assets[0] with { Key = "a2", Code = "M2", Name = "Second", File = "media/a2.png", SizeBytes = svg.Length, Sha256 = Sha256(svg) }],
        };

        await RefusedAsync(Zip(("manifest.json", ManifestJson.Serialize(two)), ("media/a1.png", content), ("media/a2.png", svg)), HttpStatusCode.UnsupportedMediaType, ErrorCodes.UnsupportedMedia);
    }

    [Fact]
    public async Task ChecksumThatDoesNotMatch_IsRefusedAndTheFileRemoved()
    {
        var (manifest, content) = ManifestWithImage(Png);
        var tampered = manifest with { Assets = [manifest.Assets[0] with { Sha256 = new string('0', 64) }] };

        await RefusedAsync(Zip(("manifest.json", ManifestJson.Serialize(tampered)), ("media/a1.png", content)), HttpStatusCode.BadRequest, ErrorCodes.InvalidArchive);
    }

    [Fact]
    public async Task SizeThatDoesNotMatch_AndAKindThatDoesNotMatch_AreRefused()
    {
        var (manifest, content) = ManifestWithImage(Png);
        var wrongSize = manifest with { Assets = [manifest.Assets[0] with { SizeBytes = content.Length - 1 }] };
        var wrongKind = manifest with { Assets = [manifest.Assets[0] with { Kind = AssetKind.Video }] };

        await RefusedAsync(Zip(("manifest.json", ManifestJson.Serialize(wrongSize)), ("media/a1.png", content)), HttpStatusCode.BadRequest, ErrorCodes.InvalidArchive);
        await RefusedAsync(Zip(("manifest.json", ManifestJson.Serialize(wrongKind)), ("media/a1.png", content)), HttpStatusCode.BadRequest, ErrorCodes.InvalidArchive);
    }

    [Fact]
    public async Task TooManyScenes_TooManyItems_TooManyTexts_AreLimitReached()
    {
        var scene = MinimalManifest().Scenes[0];
        var tooManyScenes = MinimalManifest() with { Scenes = [.. Enumerable.Repeat(scene, 100)] };
        var item = new ManifestItem("text:t1", 0, 0, 100, 100, ItemFit.Cover, new ManifestCrop(0, 0, 0, 0), 0, false, 0, false, false, new ManifestOnLost());
        var texts = new[] { new ManifestText("t1", "T1", "Text", TextStyle.Note, TextAlign.Left) };
        var tooManyItems = MinimalManifest() with { Texts = texts, Scenes = [scene with { Items = [.. Enumerable.Repeat(item, 33)] }] };
        var tooManyTexts = MinimalManifest() with { Texts = [.. Enumerable.Range(1, 65).Select(i => new ManifestText($"t{i}", $"T{i}", "Text", TextStyle.Note, TextAlign.Left))] };

        Assert.Equal(ErrorCodes.LimitReached, await RefusedAsync(Zip(("manifest.json", ManifestJson.Serialize(tooManyScenes))), HttpStatusCode.Conflict, ErrorCodes.LimitReached));
        await RefusedAsync(Zip(("manifest.json", ManifestJson.Serialize(tooManyItems))), HttpStatusCode.Conflict, ErrorCodes.LimitReached);
        await RefusedAsync(Zip(("manifest.json", ManifestJson.Serialize(tooManyTexts))), HttpStatusCode.Conflict, ErrorCodes.LimitReached);
    }

    [Fact]
    public async Task LimitsAreMet_At99ScenesAnd32Items()
    {
        var scene = MinimalManifest().Scenes[0];
        var item = new ManifestItem("text:t1", 0, 0, 100, 100, ItemFit.Cover, new ManifestCrop(0, 0, 0, 0), 0, false, 0, false, false, new ManifestOnLost());
        var texts = new[] { new ManifestText("t1", "T1", "Text", TextStyle.Note, TextAlign.Left) };
        var full = MinimalManifest("At the limits " + Guid.NewGuid().ToString("N")[..6]) with { Texts = texts, Scenes = [.. Enumerable.Repeat(scene with { Items = [.. Enumerable.Repeat(item, 32)] }, 99)] };
        var admin = await app.AdminAsync();

        var created = await ImportAsync(admin, Zip(("manifest.json", ManifestJson.Serialize(full)))).ExpectAsync<ProductionDto>(HttpStatusCode.Created);

        var snapshot = await SnapshotAsync(admin, created.Id);
        Assert.Equal((99, 32), (snapshot.Scenes.Count, snapshot.Scenes[98].Items.Count));
    }

    [Fact]
    public async Task ValuesOutsideTheLimits_ReportThePathOfEveryError()
    {
        var (manifest, content) = ManifestWithImage(Png);
        var item = new ManifestItem("asset:a1", 99999, 0, 5, 100, ItemFit.Cover, new ManifestCrop(0.9, 0, 0, 0), 0, false, 45, false, false, new ManifestOnLost(), new ManifestBorder(0, "red"));
        var broken = manifest with
        {
            Production = manifest.Production with { TextTheme = new ManifestTextTheme("blue", "#000000", "#ffffff") },
            Scenes = [new ManifestScene(" ", SceneLayoutMode.Free, new ManifestBackground("nope", "asset:a1"), [item, item with { Source = "asset:zz" }, item with { Source = "device:1" }])],
        };
        var admin = await app.AdminAsync();

        using var response = await ImportAsync(admin, Zip(("manifest.json", ManifestJson.Serialize(broken)), ("media/a1.png", content)));

        await response.ExpectAsync(HttpStatusCode.BadRequest);
        var body = await response.Content.ReadAsStringAsync(TestContext.Current.CancellationToken);
        foreach (var path in new[] { "production.textTheme.accent", "scenes[0].name", "scenes[0].background.color", "scenes[0].background.asset", "scenes[0].items[0].x", "scenes[0].items[0].w", "scenes[0].items[0].crop.top", "scenes[0].items[0].rotation", "scenes[0].items[0].border.width", "scenes[0].items[0].border.color", "scenes[0].items[1].source", "scenes[0].items[2].source" })
        {
            Assert.Contains($"\"{path}\"", body, StringComparison.Ordinal);
        }
    }

    [Fact]
    public async Task References_ToPartsThatAreNotInTheFile_AreRefused()
    {
        var item = new ManifestItem("placeholder:p9", 0, 0, 100, 100, ItemFit.Cover, new ManifestCrop(0, 0, 0, 0), 0, false, 0, false, false, new ManifestOnLost());
        var scene = MinimalManifest().Scenes[0] with { Items = [item] };
        var texts = new[] { new ManifestText("t1", "T1", "x", TextStyle.Note, TextAlign.Left) };
        var textAsFallback = item with { Source = "text:t1", OnLost = new ManifestOnLost(null, "text:t1") };

        await RefusedAsync(Zip(("manifest.json", ManifestJson.Serialize(MinimalManifest() with { Scenes = [scene] }))), HttpStatusCode.BadRequest, ErrorCodes.InvalidArchive);
        await RefusedAsync(Zip(("manifest.json", ManifestJson.Serialize(MinimalManifest() with { Texts = texts, Scenes = [scene with { Items = [textAsFallback] }] }))), HttpStatusCode.BadRequest, ErrorCodes.InvalidArchive);
    }

    [Fact]
    public async Task DuplicateKeysAndCodes_AreRefused()
    {
        var (manifest, content) = ManifestWithImage(Png);
        var twice = manifest with { Assets = [manifest.Assets[0], manifest.Assets[0] with { File = "media/a2.png" }] };
        var texts = new[] { new ManifestText("t1", "T1", "x", TextStyle.Note, TextAlign.Left), new ManifestText("t2", "T1", "y", TextStyle.Note, TextAlign.Left) };

        await RefusedAsync(Zip(("manifest.json", ManifestJson.Serialize(twice)), ("media/a1.png", content), ("media/a2.png", content)), HttpStatusCode.BadRequest, ErrorCodes.InvalidArchive);
        await RefusedAsync(Zip(("manifest.json", ManifestJson.Serialize(MinimalManifest() with { Texts = texts }))), HttpStatusCode.BadRequest, ErrorCodes.InvalidArchive);
    }

    [Fact]
    public async Task IdsInTheFile_AreNeverUsed()
    {
        // A manifest that tries to say which id the production gets: the property is not part of the format and is ignored.
        var admin = await app.AdminAsync();
        var json = ManifestJsonWith(MinimalManifest("Ids " + Guid.NewGuid().ToString("N")[..6]), root =>
        {
            root["production"]!.AsObject()["id"] = admin.ProductionId;
            root["production"]!.AsObject()["tenantId"] = "another";
            root["production"]!.AsObject()["isActive"] = true;
        });

        var created = await ImportAsync(admin, Zip(("manifest.json", json))).ExpectAsync<ProductionDto>(HttpStatusCode.Created);

        Assert.NotEqual(admin.ProductionId, created.Id);
        Assert.Equal(("opten", false), (created.TenantId, created.IsActive));
    }

    private async Task<string> RefusedAsync(byte[] archive, HttpStatusCode status, string code)
    {
        var admin = await app.AdminAsync();
        var ids = await ProductionIdsAsync(admin);
        var folders = MediaFolders(app);

        Assert.Equal(code, await ImportAsync(admin, archive).ExpectProblemAsync(status));
        Assert.Equal(code, await ImportAsync(admin, archive, dryRun: true).ExpectProblemAsync(status));

        Assert.Equal(ids, await ProductionIdsAsync(admin));
        Assert.Equal(folders, MediaFolders(app));
        Assert.DoesNotContain(Directory.Exists(app.MediaPath) ? Directory.EnumerateFiles(app.MediaPath, "*", SearchOption.AllDirectories) : [], f => f.EndsWith(".part", StringComparison.Ordinal));
        return code;
    }

    /// <summary>Writes another uncompressed size into the central directory entry of a file (a directory that lies).</summary>
    private static void PatchUncompressedSize(byte[] archive, string name, uint size)
    {
        var nameBytes = Encoding.UTF8.GetBytes(name);
        for (var i = 0; i < archive.Length - 46; i++)
        {
            if (archive[i] == 0x50 && archive[i + 1] == 0x4B && archive[i + 2] == 0x01 && archive[i + 3] == 0x02
                && archive.AsSpan(i + 46, nameBytes.Length).SequenceEqual(nameBytes))
            {
                BinaryPrimitives.WriteUInt32LittleEndian(archive.AsSpan(i + 24), size);
                return;
            }
        }

        throw new InvalidOperationException("Entry not found.");
    }
}

/// <summary>The API with small import limits, to test them without files of gigabytes.</summary>
public sealed class SmallImportLimitsApp(PostgresFixture postgres) : StudioFlowApp(postgres)
{
    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        base.ConfigureWebHost(builder);
        builder.UseSetting("Transfer:MaxImportBytes", "1048576");
        builder.UseSetting("Transfer:MaxUnpackedBytes", "4194304");
        builder.UseSetting("Transfer:MaxEntries", "20");
        builder.UseSetting("Transfer:MaxManifestBytes", "65536");
    }
}

public sealed class ProductionImportLimitsTests(SmallImportLimitsApp app) : IClassFixture<SmallImportLimitsApp>
{
    [Fact]
    public async Task FileOverTheImportLimit_IsRefusedBeforeItIsRead()
    {
        var admin = await app.AdminAsync();
        var big = new byte[3 * 1024 * 1024];
        new Random(1).NextBytes(big);

        Assert.Equal(ErrorCodes.ArchiveTooLarge, await ImportAsync(admin, big).ExpectProblemAsync(HttpStatusCode.RequestEntityTooLarge));
    }

    [Fact]
    public async Task UnpackedSizeOverTheLimit_IsRefused()
    {
        var admin = await app.AdminAsync();
        var content = MediaSamples.Png(64, 48, 5 * 1024 * 1024);
        var random = new Random(2);
        for (var i = 100; i < content.Length; i++)
        {
            content[i] = (byte)random.Next(2);
        }

        var (manifest, _) = ManifestWithImage(content);
        var archive = Zip(("manifest.json", ManifestJson.Serialize(manifest)), ("media/a1.png", content));
        Assert.InRange(archive.Length, 1, 1024 * 1024);
        var ids = await ProductionIdsAsync(admin);

        Assert.Equal(ErrorCodes.ArchiveTooLarge, await ImportAsync(admin, archive).ExpectProblemAsync(HttpStatusCode.RequestEntityTooLarge));
        Assert.Equal(ids, await ProductionIdsAsync(admin));
    }

    [Fact]
    public async Task MoreEntriesThanTheLimit_AreRefused()
    {
        var admin = await app.AdminAsync();
        var files = Enumerable.Range(0, 25).Select(i => ($"media/f{i}.png", new byte[] { 1 })).ToList();
        files.Add(("manifest.json", ManifestJson.Serialize(MinimalManifest())));

        Assert.Equal(ErrorCodes.ArchiveTooLarge, await ImportAsync(admin, Zip([.. files])).ExpectProblemAsync(HttpStatusCode.RequestEntityTooLarge));
    }

    [Fact]
    public async Task ManifestOverTheLimit_IsRefused()
    {
        var admin = await app.AdminAsync();
        var huge = ManifestJsonWith(MinimalManifest(), root => root["padding"] = new string('x', 200_000));

        Assert.Equal(ErrorCodes.ArchiveTooLarge, await ImportAsync(admin, Zip(("manifest.json", huge))).ExpectProblemAsync(HttpStatusCode.RequestEntityTooLarge));
    }
}
