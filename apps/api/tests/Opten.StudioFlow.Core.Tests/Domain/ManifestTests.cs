using System.Text;
using System.Text.Json.Nodes;
using Opten.StudioFlow.Core.Contracts;
using Opten.StudioFlow.Core.Domain;
using Opten.StudioFlow.Core.Domain.Transfer;

namespace Opten.StudioFlow.Core.Tests.Domain;

public sealed class ManifestMigratorTests
{
    private static ManifestMigrator Chain(int current = 3) => new(
        current,
        new Dictionary<int, Func<JsonObject, JsonObject>>
        {
            [1] = manifest =>
            {
                manifest["audio"] = new JsonArray();
                return manifest;
            },
            [2] = manifest =>
            {
                manifest["mixer"] = manifest["audio"]!.DeepClone();
                manifest.Remove("audio");
                return manifest;
            },
        });

    private static JsonObject Manifest(JsonNode? version) => new() { ["format"] = ManifestFormat.Name, ["formatVersion"] = version, ["production"] = new JsonObject() };

    [Fact]
    public void Default_CurrentVersion_PassesThroughUnchanged()
    {
        var manifest = Manifest(ManifestFormat.CurrentVersion);

        var result = ManifestMigrator.Default.Upgrade(manifest);

        Assert.Same(manifest, result);
        Assert.Equal(ManifestFormat.CurrentVersion, ManifestMigrator.VersionOf(result));
    }

    [Fact]
    public void FormatVersion_IsTwo_SinceTheAudioMixer() => Assert.Equal(2, ManifestFormat.CurrentVersion);

    [Fact]
    public void Default_Version1_GetsAnEmptyListOfAudioChannels()
    {
        var manifest = Manifest(1);
        manifest["audioChannels"] = JsonValue.Create("left over from nowhere");

        var upgraded = ManifestMigrator.Default.Upgrade(manifest);

        Assert.Equal(ManifestFormat.CurrentVersion, ManifestMigrator.VersionOf(upgraded));
        Assert.Empty(upgraded["audioChannels"]!.AsArray());
    }

    [Fact]
    public void Default_HasAStepForEveryOlderVersion() =>
        Assert.Equal(Enumerable.Range(1, ManifestFormat.CurrentVersion - 1), ManifestMigrations.Steps.Keys.Order());

    [Fact]
    public void Upgrade_OlderManifest_RunsEveryStepInOrder()
    {
        var upgraded = Chain().Upgrade(Manifest(1));

        Assert.Equal(3, ManifestMigrator.VersionOf(upgraded));
        Assert.Null(upgraded["audio"]);
        Assert.NotNull(upgraded["mixer"]);
    }

    [Fact]
    public void Upgrade_ManifestOfTheMiddleVersion_RunsOnlyTheRemainingSteps()
    {
        var manifest = Manifest(2);
        manifest["audio"] = new JsonArray(JsonValue.Create("channel"));

        var upgraded = Chain().Upgrade(manifest);

        Assert.Equal(3, ManifestMigrator.VersionOf(upgraded));
        Assert.Equal("channel", upgraded["mixer"]![0]!.GetValue<string>());
    }

    [Fact]
    public void Upgrade_CurrentVersion_RunsNoStep()
    {
        var manifest = Manifest(3);

        Assert.Null(Chain().Upgrade(manifest)["audio"]);
        Assert.Null(manifest["mixer"]);
    }

    [Theory]
    [InlineData(4)]
    [InlineData(100)]
    public void Upgrade_NewerVersion_IsUnsupportedFormat(int version)
    {
        var error = Assert.Throws<StudioFlowException>(() => Chain().Upgrade(Manifest(version)));

        Assert.Equal((ErrorKind.Validation, ErrorCodes.UnsupportedFormat), (error.Kind, error.Code));
    }

    [Fact]
    public void Upgrade_MissingStep_IsInvalid()
    {
        var migrator = new ManifestMigrator(3, new Dictionary<int, Func<JsonObject, JsonObject>>());

        Assert.Equal(ErrorCodes.InvalidArchive, Assert.Throws<StudioFlowException>(() => migrator.Upgrade(Manifest(1))).Code);
    }

    [Theory]
    [InlineData("0")]
    [InlineData("-3")]
    [InlineData("1.5")]
    [InlineData("\"1\"")]
    [InlineData("true")]
    [InlineData("null")]
    public void Upgrade_UnusableVersion_IsInvalid(string version)
    {
        var error = Assert.Throws<StudioFlowException>(() => Chain().Upgrade(Manifest(JsonNode.Parse(version))));

        Assert.Equal(ErrorCodes.InvalidArchive, error.Code);
    }

    [Fact]
    public void Upgrade_NoVersion_IsInvalid()
    {
        var manifest = Manifest(1);
        manifest.Remove("formatVersion");

        Assert.Equal(ErrorCodes.InvalidArchive, Assert.Throws<StudioFlowException>(() => Chain().Upgrade(manifest)).Code);
    }

    [Fact]
    public void Read_MigratesBeforeTheTypedReading()
    {
        // A "version 1" file that lacks a part the current format requires: the step supplies it, so the file is read.
        var current = ManifestJson.Serialize(Fixture.Manifest());
        var old = JsonNode.Parse(current)!.AsObject();
        old["formatVersion"] = 1;
        old.Remove("scenes");
        var migrator = new ManifestMigrator(2, new Dictionary<int, Func<JsonObject, JsonObject>>
        {
            [1] = manifest =>
            {
                manifest["scenes"] = JsonNode.Parse("""[{"name":"Migrated","layoutMode":"free","background":{"color":"#000000"},"items":[]}]""");
                return manifest;
            },
        });

        var manifest = ManifestJson.Read(Encoding.UTF8.GetBytes(old.ToJsonString()), migrator);

        Assert.Equal(["Migrated"], manifest.Scenes.Select(s => s.Name));
    }
}

public sealed class ManifestJsonTests
{
    [Fact]
    public void RoundTrip_KeepsEverything()
    {
        var manifest = Fixture.Manifest();

        var read = ManifestJson.Read(ManifestJson.Serialize(manifest));

        Assert.Equal(ManifestJson.Serialize(manifest), ManifestJson.Serialize(read));
        Assert.Equal(manifest.Production, read.Production);
        Assert.Equal(manifest.Scenes[0].Items[0].OnLost, read.Scenes[0].Items[0].OnLost);
    }

    [Fact]
    public void Serialize_IsCamelCaseWithEnumsAsText()
    {
        var text = Encoding.UTF8.GetString(ManifestJson.Serialize(Fixture.Manifest()));

        Assert.Contains("\"formatVersion\": 2", text, StringComparison.Ordinal);
        Assert.Contains("\"layoutMode\": \"free\"", text, StringComparison.Ordinal);
        Assert.Contains("\"resolution\": \"p1080\"", text, StringComparison.Ordinal);
        Assert.Contains("\"fit\": \"cover\"", text, StringComparison.Ordinal);
        Assert.Contains("\"source\": \"placeholder:p1\"", text, StringComparison.Ordinal);
    }

    [Fact]
    public void Read_UnknownProperties_AreIgnored()
    {
        var node = JsonNode.Parse(ManifestJson.Serialize(Fixture.Manifest()))!.AsObject();
        node["future"] = new JsonObject { ["x"] = 1 };
        node["scenes"]![0]!["note"] = "ignored";

        var read = ManifestJson.Read(Encoding.UTF8.GetBytes(node.ToJsonString()));

        Assert.Equal("Intro", read.Scenes[0].Name);
    }

    [Fact]
    public void Read_OptionalPartsMayBeMissingOrNull()
    {
        var node = JsonNode.Parse(ManifestJson.Serialize(Fixture.Manifest()))!.AsObject();
        node["production"]!["standbySlate"]!.AsObject().Remove("subtitle");
        node["scenes"]![0]!["items"]![0]!.AsObject().Remove("border");
        node["scenes"]![0]!["items"]![0]!["onLost"] = new JsonObject();

        var read = ManifestJson.Read(Encoding.UTF8.GetBytes(node.ToJsonString()));

        Assert.Null(read.Production.StandbySlate.Subtitle);
        Assert.Null(read.Scenes[0].Items[0].Border);
        Assert.Equal(new ManifestOnLost(), read.Scenes[0].Items[0].OnLost);
    }

    [Theory]
    [InlineData("production")]
    [InlineData("scenes")]
    [InlineData("assets")]
    [InlineData("audioChannels")]
    [InlineData("app")]
    public void Read_MissingRequiredPart_IsInvalidAndNamesTheField(string part)
    {
        var node = JsonNode.Parse(ManifestJson.Serialize(Fixture.Manifest()))!.AsObject();
        node.Remove(part);

        var error = Assert.Throws<StudioFlowException>(() => ManifestJson.Read(Encoding.UTF8.GetBytes(node.ToJsonString())));

        Assert.Equal(ErrorCodes.InvalidArchive, error.Code);
        Assert.NotNull(error.Errors);
    }

    [Fact]
    public void Read_NullWhereAValueIsRequired_AndNumbersAsText_AreInvalid()
    {
        var nullName = JsonNode.Parse(ManifestJson.Serialize(Fixture.Manifest()))!.AsObject();
        nullName["production"]!["name"] = null;
        var textNumber = JsonNode.Parse(ManifestJson.Serialize(Fixture.Manifest()))!.AsObject();
        textNumber["scenes"]![0]!["items"]![0]!["x"] = "10";
        var integerEnum = JsonNode.Parse(ManifestJson.Serialize(Fixture.Manifest()))!.AsObject();
        integerEnum["scenes"]![0]!["layoutMode"] = 1;

        foreach (var node in new[] { nullName, textNumber, integerEnum })
        {
            Assert.Equal(ErrorCodes.InvalidArchive, Assert.Throws<StudioFlowException>(() => ManifestJson.Read(Encoding.UTF8.GetBytes(node.ToJsonString()))).Code);
        }
    }

    [Theory]
    [InlineData("")]
    [InlineData("not json")]
    [InlineData("[]")]
    [InlineData("{\"format\":\"other\"}")]
    [InlineData("{\"format\":\"studioflow-production\"}")]
    public void Read_NotAManifest_IsInvalid(string json)
    {
        Assert.Equal(ErrorCodes.InvalidArchive, Assert.Throws<StudioFlowException>(() => ManifestJson.Read(Encoding.UTF8.GetBytes(json))).Code);
    }

    [Fact]
    public void Read_NewerFormat_IsUnsupportedWhateverElseIsInIt()
    {
        var json = """{"format":"studioflow-production","formatVersion":3,"somethingNew":[1,2,3]}""";

        var error = Assert.Throws<StudioFlowException>(() => ManifestJson.Read(Encoding.UTF8.GetBytes(json)));

        Assert.Equal(ErrorCodes.UnsupportedFormat, error.Code);
    }

    [Fact]
    public void Read_FileOfVersion1_IsMigratedAndHasNoAudioChannels()
    {
        var node = JsonNode.Parse(ManifestJson.Serialize(Fixture.Manifest()))!.AsObject();
        node["formatVersion"] = 1;
        node.Remove("audioChannels");

        var read = ManifestJson.Read(Encoding.UTF8.GetBytes(node.ToJsonString()));

        Assert.Equal(ManifestFormat.CurrentVersion, read.FormatVersion);
        Assert.Empty(read.AudioChannels);
        Assert.Equal("Intro", read.Scenes[0].Name);
    }

    [Fact]
    public void RoundTrip_KeepsTheAudioChannelsOfVideos()
    {
        var manifest = Fixture.Manifest() with { AudioChannels = [new ManifestAudioChannel("asset:a2", -6.5, true, AudioMode.Off, 120)] };

        var text = Encoding.UTF8.GetString(ManifestJson.Serialize(manifest));
        var read = ManifestJson.Read(Encoding.UTF8.GetBytes(text));

        Assert.Contains("\"mode\": \"off\"", text, StringComparison.Ordinal);
        Assert.Contains("\"gainDb\": -6.5", text, StringComparison.Ordinal);
        Assert.Equal(manifest.AudioChannels, read.AudioChannels);
    }

    [Fact]
    public void Read_VersionTwoWithoutAudioChannels_OrWithAChannelOfTheWrongShape_IsInvalid()
    {
        var channel = new ManifestAudioChannel("asset:a2", 0, false, AudioMode.Follow, 0);
        var withChannel = () => JsonNode.Parse(ManifestJson.Serialize(Fixture.Manifest() with { AudioChannels = [channel] }))!.AsObject();
        var missing = withChannel();
        missing.Remove("audioChannels");
        var textGain = withChannel();
        textGain["audioChannels"]![0]!["gainDb"] = "-6";
        var integerMode = withChannel();
        integerMode["audioChannels"]![0]!["mode"] = 1;
        var unknownMode = withChannel();
        unknownMode["audioChannels"]![0]!["mode"] = "loud";
        var noSource = withChannel();
        noSource["audioChannels"]![0]!["source"] = null;

        foreach (var node in new[] { missing, textGain, integerMode, unknownMode, noSource })
        {
            Assert.Equal(ErrorCodes.InvalidArchive, Assert.Throws<StudioFlowException>(() => ManifestJson.Read(Encoding.UTF8.GetBytes(node.ToJsonString()))).Code);
        }
    }

    [Fact]
    public void Read_NestingBeyondTheLimit_IsInvalid()
    {
        var deep = new string('[', 100) + new string(']', 100);

        Assert.Equal(ErrorCodes.InvalidArchive, Assert.Throws<StudioFlowException>(() => ManifestJson.Read(Encoding.UTF8.GetBytes(deep))).Code);
    }

    [Fact]
    public void ManifestRefs_ParseThePrefixAndKey()
    {
        Assert.True(ManifestRefs.TryParse("asset:a1", out var prefix, out var key));
        Assert.Equal((ManifestRefs.Asset, "a1"), (prefix, key));
        Assert.True(ManifestRefs.TryParse("placeholder:p12", out prefix, out key));
        Assert.Equal((ManifestRefs.Placeholder, "p12"), (prefix, key));
        Assert.True(ManifestRefs.TryParse("text:t3", out prefix, out _));
        Assert.Equal(ManifestRefs.Text, prefix);
        Assert.False(ManifestRefs.TryParse("asset:", out _, out _));
        Assert.False(ManifestRefs.TryParse("device:1", out _, out _));
        Assert.False(ManifestRefs.TryParse(null, out _, out _));
    }
}

internal static class Fixture
{
    /// <summary>A manifest with one of everything.</summary>
    public static ProductionManifest Manifest() => new(
        ManifestFormat.Name,
        ManifestFormat.CurrentVersion,
        new ManifestApp("0.1.0+abc1234", new DateTimeOffset(2026, 10, 26, 10, 0, 0, TimeSpan.Zero)),
        new ManifestProduction(
            "Webinar “Zürich” 😀",
            new ManifestCanvas(CanvasFormat.Widescreen, CanvasResolution.P1080),
            new ManifestSlate("Starting soon", "Back at 10", "a1"),
            new ManifestSlate("Thanks"),
            new ManifestTextTheme("#1f6feb", "#0d1117", "#ffffff")),
        [new ManifestText("t1", "T1", "Mia Meier", TextStyle.LowerThird, TextAlign.Left, "Host")],
        [new ManifestAsset("a1", "M1", AssetKind.Image, "Logo", "image/png", 2000, "media/a1.png", new string('a', 64))],
        [new ManifestPlaceholder("p1", "K1", SourceKind.Camera, "camera", "Stage phone")],
        [
            new ManifestScene(
                "Intro",
                SceneLayoutMode.Free,
                new ManifestBackground("#0d1117", "a1"),
                [
                    new ManifestItem("placeholder:p1", 10, 20, 640, 360, ItemFit.Cover, new ManifestCrop(0.1, 0, 0.1, 0), 12, true, 90, false, true, new ManifestOnLost(2500, "asset:a1"), new ManifestBorder(4, "#00ff00")),
                    new ManifestItem("text:t1", 0, 0, 100, 100, ItemFit.Contain, new ManifestCrop(0, 0, 0, 0), 0, false, 0, true, false, new ManifestOnLost()),
                ]),
        ],
        []);
}
