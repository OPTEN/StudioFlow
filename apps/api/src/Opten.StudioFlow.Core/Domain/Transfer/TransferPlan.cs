using System.Text.RegularExpressions;
using Opten.StudioFlow.Core.Contracts;

namespace Opten.StudioFlow.Core.Domain.Transfer;

/// <summary>A media file of an import and the asset it becomes.</summary>
/// <param name="Key">Key of the file in the manifest.</param>
/// <param name="AssetId">The new id of the asset; the file is stored under it.</param>
/// <param name="Code">Slot code of the asset (the one of the original).</param>
/// <param name="Name">Display name of the asset.</param>
/// <param name="Entry">The entry of the manifest.</param>
public sealed record PlannedAsset(string Key, string AssetId, string Code, string Name, ManifestAsset Entry);

/// <summary>
/// An import (or duplicate) that is checked and prepared but not stored yet (spec 4.2.2): the manifest is validated
/// completely, every id is new (nothing of the file is used as an id), every reference points to a part that exists, and
/// the limits of a production hold (99 scenes, 32 items per scene, 64 texts, 100 placeholders). Anything wrong is
/// <c>invalid_archive</c> with the JSON path of every error; a limit is <c>limit_reached</c>. A plan changes nothing:
/// the caller stores the media files under the new asset ids, then asks for the production and saves it in one transaction.
/// </summary>
public sealed partial class TransferPlan
{
    private readonly ProductionManifest manifest;
    private readonly List<Scene> scenes;
    private readonly List<TextSourceDto> texts;
    private readonly List<AudioChannelDto> audioChannels;
    private readonly string? standbyBackground;
    private readonly string? endBackground;

    private TransferPlan(
        ProductionManifest manifest,
        string productionId,
        string name,
        List<PlannedAsset> assets,
        List<TextSourceDto> texts,
        List<SourcePlaceholderDto> placeholders,
        List<Scene> scenes,
        List<AudioChannelDto> audioChannels,
        string? standbyBackground,
        string? endBackground)
    {
        this.manifest = manifest;
        ProductionId = productionId;
        Name = name;
        Assets = assets;
        this.texts = texts;
        Placeholders = placeholders;
        this.scenes = scenes;
        this.audioChannels = audioChannels;
        this.standbyBackground = standbyBackground;
        this.endBackground = endBackground;
    }

    /// <summary>The id of the new production.</summary>
    public string ProductionId { get; }

    /// <summary>The name in the file, cleaned; the caller makes it unique.</summary>
    public string Name { get; }

    /// <summary>Version of StudioFlow that wrote the file.</summary>
    public string AppVersion => TextRules.Truncate(manifest.App.Version, 40) ?? string.Empty;

    /// <summary>The media files with their new ids.</summary>
    public IReadOnlyList<PlannedAsset> Assets { get; }

    /// <summary>The device sources that become placeholders.</summary>
    public IReadOnlyList<SourcePlaceholderDto> Placeholders { get; }

    /// <summary>The channels of the audio mixer that the file carries, for the new ids of the videos.</summary>
    public IReadOnlyList<AudioChannelDto> AudioChannels => audioChannels;

    /// <summary>Number of scenes.</summary>
    public int SceneCount => scenes.Count;

    /// <summary>Number of texts.</summary>
    public int TextCount => texts.Count;

    /// <summary>Size of the media files together, as the file declares it.</summary>
    public long MediaBytes => Assets.Sum(a => a.Entry.SizeBytes);

    /// <summary>
    /// Checks the manifest and prepares the production. Throws <c>invalid_archive</c> with every error found, or
    /// <c>limit_reached</c> when the file holds more than a production may.
    /// </summary>
    public static TransferPlan Create(ProductionManifest manifest)
    {
        ArgumentNullException.ThrowIfNull(manifest);
        var errors = new ValidationErrors();
        RequireLimit(manifest.Scenes.Count, Production.MaxScenes, "A production can have at most 99 scenes.");
        RequireLimit(manifest.Texts.Count, TextSourceRules.MaxPerProduction, $"A production can have at most {TextSourceRules.MaxPerProduction} texts.");
        RequireLimit(manifest.Placeholders.Count, SourcePlaceholders.MaxPerProduction, $"A production can have at most {SourcePlaceholders.MaxPerProduction} device sources.");
        foreach (var scene in manifest.Scenes)
        {
            RequireLimit(scene.Items.Count, SceneItemRules.MaxItems, "A scene can have at most 32 items.");
        }

        var productionId = EntityIds.New(EntityIds.Production);
        var name = TextRules.RequiredName(manifest.Production.Name, TextRules.NameMax, "production.name", errors);
        Canvases.Validate(manifest.Production.Canvas.Format, manifest.Production.Canvas.Resolution, errors);
        TextSourceRules.ValidateTheme(
            new TextThemeDto(manifest.Production.TextTheme.Accent, manifest.Production.TextTheme.Background, manifest.Production.TextTheme.Foreground),
            "production.textTheme",
            errors);

        var assets = PlanAssets(manifest, errors);
        var assetIds = Index(assets.Select(a => (a.Key, a.AssetId)));
        var imageKeys = assets.Where(a => a.Entry.Kind == AssetKind.Image).Select(a => a.Key).ToHashSet(StringComparer.Ordinal);
        var texts = PlanTexts(manifest, errors);
        var textIds = Index(manifest.Texts.Zip(texts, (entry, text) => (entry.Key, text.Id)));
        var placeholders = PlanPlaceholders(manifest, errors);
        var placeholderIds = Index(manifest.Placeholders.Zip(placeholders, (entry, placeholder) => (entry.Key, placeholder.SourceId)));
        var standby = BackgroundOf(manifest.Production.StandbySlate.BackgroundAsset, "production.standbySlate.backgroundAsset", imageKeys, assetIds, errors);
        var end = BackgroundOf(manifest.Production.EndSlate.BackgroundAsset, "production.endSlate.backgroundAsset", imageKeys, assetIds, errors);
        RequireSlateTitle(manifest.Production.StandbySlate, "production.standbySlate", errors);
        RequireSlateTitle(manifest.Production.EndSlate, "production.endSlate", errors);

        var resolver = new Resolver(assetIds, textIds, placeholderIds, imageKeys);
        var builtScenes = new List<Scene>(manifest.Scenes.Count);
        for (var i = 0; i < manifest.Scenes.Count; i++)
        {
            builtScenes.Add(PlanScene(productionId, manifest.Scenes[i], i, resolver, errors));
        }

        var videoKeys = assets.Where(a => a.Entry.Kind == AssetKind.Video).Select(a => a.Key).ToHashSet(StringComparer.Ordinal);
        var channels = PlanAudioChannels(manifest, assetIds, videoKeys, errors);

        TransferErrors.ThrowIfAny(errors);
        return new TransferPlan(manifest, productionId, name!, assets, texts, placeholders, builtScenes, channels, standby, end);
    }

    /// <summary>
    /// Gives the new production the channels of the audio mixer for its videos: the defaults of a new video for every video that
    /// has sound here, then the settings of the file. A channel of a video that has no sound in this installation (the file
    /// says what the exporting program saw) is left out. Call it with the assets once they are stored, before the production is saved.
    /// </summary>
    public void SeedAudioChannels(Production production, IReadOnlyList<Asset> assets)
    {
        ArgumentNullException.ThrowIfNull(production);
        ArgumentNullException.ThrowIfNull(assets);
        var catalog = new SourceCatalog([], assets, production.TextSources);
        production.SyncAudioChannels(catalog);
        var requested = audioChannels.Where(c => catalog.Find(c.SourceId) is { } source && AudioMixerRules.CarriesSound(source)).ToList();
        if (requested.Count > 0)
        {
            production.ApplyAudioChannels(requested, catalog);
        }
    }

    /// <summary>
    /// The production of the plan under its final name and slug. It is in standby, not active, with the first scene on air
    /// and no preview; the assets are separate (<see cref="Asset"/>), added by the caller once their files are stored.
    /// </summary>
    public Production Build(string name, string slug, DateTimeOffset now)
    {
        var production = manifest.Production;
        return Production.Restore(
            ProductionId,
            TextRules.RequireName(name, TextRules.NameMax, "name"),
            slug,
            now,
            production.Canvas.Format,
            production.Canvas.Resolution,
            Slate(production.StandbySlate, standbyBackground),
            Slate(production.EndSlate, endBackground),
            new TextThemeDto(production.TextTheme.Accent.ToLowerInvariant(), production.TextTheme.Background.ToLowerInvariant(), production.TextTheme.Foreground.ToLowerInvariant()),
            texts,
            Placeholders,
            scenes);
    }

    /// <summary>Key → id; a key that occurs twice keeps its first id (the duplicate is reported by <see cref="CheckKey"/>).</summary>
    private static Dictionary<string, string> Index(IEnumerable<(string Key, string Id)> pairs)
    {
        var index = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var (key, id) in pairs)
        {
            index.TryAdd(key, id);
        }

        return index;
    }

    private static SlateDto Slate(ManifestSlate slate, string? backgroundAssetId) =>
        new(TextRules.Truncate(slate.Title, TextRules.NameMax)!, TextRules.Truncate(slate.Subtitle, TextRules.TextLineMax), backgroundAssetId);

    private static void RequireLimit(int count, int max, string message)
    {
        if (count > max)
        {
            throw StudioFlowException.LimitReached(message);
        }
    }

    private static void RequireSlateTitle(ManifestSlate slate, string path, ValidationErrors errors) =>
        TextRules.RequiredName(slate.Title, TextRules.NameMax, $"{path}.title", errors);

    private static string? BackgroundOf(string? key, string path, HashSet<string> imageKeys, Dictionary<string, string> assetIds, ValidationErrors errors)
    {
        if (key is null)
        {
            return null;
        }

        if (!imageKeys.Contains(key))
        {
            errors.Add(path, "A background must be an image of the file.");
            return null;
        }

        return assetIds[key];
    }

    private static List<PlannedAsset> PlanAssets(ProductionManifest manifest, ValidationErrors errors)
    {
        var planned = new List<PlannedAsset>(manifest.Assets.Count);
        var keys = new HashSet<string>(StringComparer.Ordinal);
        var codes = new HashSet<string>(StringComparer.Ordinal);
        var files = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        for (var i = 0; i < manifest.Assets.Count; i++)
        {
            var asset = manifest.Assets[i];
            var path = $"assets[{i}]";
            CheckKey(asset.Key, keys, $"{path}.key", errors);
            CheckCode(asset.Code, 'M', codes, $"{path}.code", errors);
            var name = TextRules.RequiredName(asset.Name, TextRules.NameMax, $"{path}.name", errors);
            if (!MediaFilePattern().IsMatch(asset.File) || !files.Add(asset.File))
            {
                errors.Add($"{path}.file", "The path of a medium must be unique and look like media/a1.png.");
            }

            if (asset.SizeBytes < 0)
            {
                errors.Add($"{path}.sizeBytes", "The size cannot be negative.");
            }

            planned.Add(new PlannedAsset(asset.Key, EntityIds.New(EntityIds.Asset), asset.Code, name ?? string.Empty, asset));
        }

        return planned;
    }

    private static List<AudioChannelDto> PlanAudioChannels(ProductionManifest manifest, Dictionary<string, string> assetIds, HashSet<string> videoKeys, ValidationErrors errors)
    {
        var planned = new List<AudioChannelDto>(manifest.AudioChannels.Count);
        var seen = new HashSet<string>(StringComparer.Ordinal);
        for (var i = 0; i < manifest.AudioChannels.Count; i++)
        {
            var channel = manifest.AudioChannels[i];
            var path = $"audioChannels[{i}]";
            string? sourceId = null;
            if (!ManifestRefs.TryParse(channel.Source, out var prefix, out var key) || prefix != ManifestRefs.Asset || !videoKeys.Contains(key))
            {
                errors.Add($"{path}.source", "A channel must belong to a video of the file, asset:….");
            }
            else if (!seen.Add(key))
            {
                errors.Add($"{path}.source", "Each video can appear only once.");
            }
            else
            {
                sourceId = assetIds[key];
            }

            var dto = new AudioChannelDto(sourceId ?? string.Empty, channel.GainDb, channel.Muted, channel.Mode, channel.SyncOffsetMs);
            AudioMixerRules.ValidateValues(dto, path, errors);
            if (channel.Mode == AudioMode.Always)
            {
                errors.Add($"{path}.mode", "The sound of a video always belongs to its picture.");
            }

            planned.Add(dto);
        }

        return planned;
    }

    private static List<TextSourceDto> PlanTexts(ProductionManifest manifest, ValidationErrors errors)
    {
        var planned = new List<TextSourceDto>(manifest.Texts.Count);
        var keys = new HashSet<string>(StringComparer.Ordinal);
        var codes = new HashSet<string>(StringComparer.Ordinal);
        for (var i = 0; i < manifest.Texts.Count; i++)
        {
            var text = manifest.Texts[i];
            var path = $"texts[{i}]";
            CheckKey(text.Key, keys, $"{path}.key", errors);
            CheckCode(text.Code, 'T', codes, $"{path}.code", errors);
            var line1 = TextRules.RequiredName(text.Line1, TextRules.TextLineMax, $"{path}.line1", errors);
            var line2 = TextRules.OptionalLine(text.Line2, TextRules.TextLineMax, $"{path}.line2", errors);
            planned.Add(new TextSourceDto(EntityIds.New(EntityIds.Text), text.Code, line1 ?? string.Empty, line2, text.Style, text.Align));
        }

        return planned;
    }

    private static List<SourcePlaceholderDto> PlanPlaceholders(ProductionManifest manifest, ValidationErrors errors)
    {
        var planned = new List<SourcePlaceholderDto>(manifest.Placeholders.Count);
        var keys = new HashSet<string>(StringComparer.Ordinal);
        var codes = new HashSet<string>(StringComparer.Ordinal);
        for (var i = 0; i < manifest.Placeholders.Count; i++)
        {
            var placeholder = manifest.Placeholders[i];
            var path = $"placeholders[{i}]";
            CheckKey(placeholder.Key, keys, $"{path}.key", errors);
            if (!SourcePlaceholders.IsValidCode(placeholder.Code, placeholder.Kind) || !codes.Add(placeholder.Code))
            {
                errors.Add($"{path}.code", "The code must be unique and look like K1 for a camera or S1 for a screen.");
            }

            var slot = SourcePlaceholders.KindOfSlot(placeholder.Slot) == placeholder.Kind ? placeholder.Slot : null;
            if (slot is null)
            {
                errors.Add($"{path}.slot", "The slot must be camera or screen-1 to screen-9 and match the kind.");
            }

            planned.Add(SourcePlaceholders.New(placeholder.Code, placeholder.Kind, slot ?? SourcePlaceholders.DefaultSlot(placeholder.Kind), placeholder.Label));
        }

        return planned;
    }

    private static Scene PlanScene(string productionId, ManifestScene scene, int index, Resolver resolver, ValidationErrors errors)
    {
        var path = $"scenes[{index}]";
        var name = TextRules.RequiredName(scene.Name, TextRules.NameMax, $"{path}.name", errors) ?? string.Empty;
        if (!SceneItemRules.IsHexColor(scene.Background.Color))
        {
            errors.Add($"{path}.background.color", "Enter a colour in the format #rrggbb.");
        }

        string? backgroundAsset = null;
        if (scene.Background.Asset is { } key)
        {
            if (resolver.ImageKeys.Contains(key))
            {
                backgroundAsset = resolver.Assets[key];
            }
            else
            {
                errors.Add($"{path}.background.asset", "A background must be an image of the file.");
            }
        }

        var items = new List<SceneItemDto>(scene.Items.Count);
        for (var i = 0; i < scene.Items.Count; i++)
        {
            items.Add(PlanItem(scene.Items[i], $"{path}.items[{i}]", resolver, errors));
        }

        return Scene.Restore(productionId, name, index, scene.LayoutMode, new SceneBackgroundDto(scene.Background.Color, backgroundAsset), items);
    }

    private static SceneItemDto PlanItem(ManifestItem item, string path, Resolver resolver, ValidationErrors errors)
    {
        var source = resolver.Resolve(item.Source, $"{path}.source", allowText: true, errors);
        var fallback = item.OnLost.FallbackSource is { } reference ? resolver.Resolve(reference, $"{path}.onLost.fallbackSource", allowText: false, errors) : null;

        // An item whose source is not in the file is reported above; a stand-in source lets the rules check the rest of it.
        var planned = new SceneItemDto(
            EntityIds.New(EntityIds.Item),
            source ?? EntityIds.New(EntityIds.Asset),
            item.X,
            item.Y,
            item.W,
            item.H,
            item.Fit,
            new CropDto(item.Crop.Top, item.Crop.Right, item.Crop.Bottom, item.Crop.Left),
            item.Radius,
            item.Mirror,
            item.Rotation,
            item.Hidden,
            item.Locked,
            item.Border is null ? null : new BorderDto(item.Border.Width, item.Border.Color),
            new LostBehaviorDto(item.OnLost.HoldMs, fallback));

        // The references are resolved above; the rules check the geometry, the crop, the border and the fallback.
        SceneItemRules.Validate(planned, path, errors, _ => true, _ => true);
        return planned;
    }

    private static void CheckKey(string key, HashSet<string> seen, string path, ValidationErrors errors)
    {
        if (!KeyPattern().IsMatch(key) || !seen.Add(key))
        {
            errors.Add(path, "A key must be unique and have 1 to 16 lowercase letters or digits.");
        }
    }

    private static void CheckCode(string code, char letter, HashSet<string> seen, string path, ValidationErrors errors)
    {
        if (!CodePattern().IsMatch(code) || code[0] != letter || !seen.Add(code))
        {
            errors.Add(path, $"The code must be unique and look like {letter}1.");
        }
    }

    [GeneratedRegex("^[a-z0-9]{1,16}$", RegexOptions.CultureInvariant)]
    private static partial Regex KeyPattern();

    [GeneratedRegex("^[A-Z][1-9][0-9]{0,3}$", RegexOptions.CultureInvariant)]
    private static partial Regex CodePattern();

    [GeneratedRegex("^media/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$", RegexOptions.CultureInvariant)]
    private static partial Regex MediaFilePattern();

    /// <summary>Turns the references of the manifest into the new ids, and reports the ones that point nowhere.</summary>
    private sealed record Resolver(Dictionary<string, string> Assets, Dictionary<string, string> Texts, Dictionary<string, string> Placeholders, HashSet<string> ImageKeys)
    {
        public string? Resolve(string reference, string path, bool allowText, ValidationErrors errors)
        {
            if (!ManifestRefs.TryParse(reference, out var prefix, out var key))
            {
                errors.Add(path, "A source must be asset:…, text:… or placeholder:….");
                return null;
            }

            var found = prefix switch
            {
                ManifestRefs.Asset => Assets.GetValueOrDefault(key),
                ManifestRefs.Text when allowText => Texts.GetValueOrDefault(key),
                _ => prefix == ManifestRefs.Placeholder ? Placeholders.GetValueOrDefault(key) : null,
            };
            if (found is null)
            {
                errors.Add(path, prefix == ManifestRefs.Text && !allowText ? "A text cannot be a fallback." : "This source is not in the file.");
            }

            return found;
        }
    }
}
