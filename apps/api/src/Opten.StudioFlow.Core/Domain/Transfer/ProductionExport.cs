using System.Globalization;
using Opten.StudioFlow.Core.Contracts;

namespace Opten.StudioFlow.Core.Domain.Transfer;

/// <summary>A media file that goes into an export.</summary>
/// <param name="AssetId">The asset in the production that is exported.</param>
/// <param name="FileName">File name inside the media folder of that production.</param>
/// <param name="Entry">The entry of the manifest; its checksum is filled in while the file is written.</param>
public sealed record ExportMedia(string AssetId, string FileName, ManifestAsset Entry);

/// <summary>
/// Turns a production into the manifest of an export (spec 4.2.2). A duplicate takes the same way: the manifest is the one
/// description of everything a production hands on. What it holds and what it leaves out is decided here, for every field:
/// <list type="bullet">
/// <item>Taken over: name, canvas, both slates, the text colours, texts, media, scenes with all items in list order, the
/// channels of the audio mixer for the sound of videos (fader, mute, mode, delay).</item>
/// <item>Device sources become placeholders (code, name, original slot) – but only those the scenes use. Their channels of the
/// audio mixer (audio station, microphones, sound of a screen) stay behind: they belong to the device that fills the place.</item>
/// <item>Left out: devices, their secrets, invites, pairing requests and incidents; the output links and their keys and IP
/// restrictions (the copy gets a fresh default link); the broadcast state, program and preview scene, last transition;
/// the audit log; whether the production is active.</item>
/// </list>
/// </summary>
public static class ProductionExport
{
    /// <summary>Describes the production; the media files are listed in the order of the manifest.</summary>
    public static (ProductionManifest Manifest, IReadOnlyList<ExportMedia> Media) Capture(
        Production production,
        IReadOnlyList<Device> devices,
        IReadOnlyList<Asset> assets,
        string appVersion,
        DateTimeOffset exportedAt)
    {
        ArgumentNullException.ThrowIfNull(production);
        ArgumentNullException.ThrowIfNull(devices);
        ArgumentNullException.ThrowIfNull(assets);
        var assetKeys = new Dictionary<string, string>(StringComparer.Ordinal);
        var media = new List<ExportMedia>(assets.Count);
        for (var i = 0; i < assets.Count; i++)
        {
            var asset = assets[i];
            var key = Key("a", i);
            assetKeys[asset.Id] = key;
            var file = ManifestFormat.MediaFolder + key + Path.GetExtension(asset.FileName);
            media.Add(new ExportMedia(asset.Id, asset.FileName, new ManifestAsset(key, asset.Code, asset.Kind, asset.Name, asset.ContentType, asset.SizeBytes, file, string.Empty)));
        }

        var textKeys = new Dictionary<string, string>(StringComparer.Ordinal);
        var texts = new List<ManifestText>(production.TextSources.Count);
        for (var i = 0; i < production.TextSources.Count; i++)
        {
            var text = production.TextSources[i];
            textKeys[text.Id] = Key("t", i);
            texts.Add(new ManifestText(textKeys[text.Id], text.Code, text.Line1, text.Style, text.Align, text.Line2));
        }

        var placeholders = Placeholders(production, devices);
        var sources = new SourceKeys(assetKeys, textKeys, placeholders.Keys);
        var manifest = new ProductionManifest(
            ManifestFormat.Name,
            ManifestFormat.CurrentVersion,
            new ManifestApp(appVersion, exportedAt),
            new ManifestProduction(
                production.Name,
                new ManifestCanvas(production.CanvasFormat, production.CanvasResolution),
                Slate(production.StandbySlate, assetKeys),
                Slate(production.EndSlate, assetKeys),
                new ManifestTextTheme(production.TextTheme.Accent, production.TextTheme.Background, production.TextTheme.Foreground)),
            texts,
            [.. media.Select(m => m.Entry)],
            placeholders.List,
            [.. production.OrderedScenes.Select(scene => Scene(scene, sources))],
            AudioChannels(production, assets, assetKeys));
        return (manifest, media);
    }

    /// <summary>The channels of the videos in the order of the media; a channel of a source that is no medium of the production is left out.</summary>
    private static List<ManifestAudioChannel> AudioChannels(Production production, IReadOnlyList<Asset> assets, Dictionary<string, string> assetKeys)
    {
        var channels = new List<ManifestAudioChannel>();
        foreach (var asset in assets.Where(a => a.Kind == AssetKind.Video))
        {
            if (production.FindAudioChannel(asset.Id) is { } channel)
            {
                channels.Add(new ManifestAudioChannel(ManifestRefs.Asset + assetKeys[asset.Id], channel.GainDb, channel.Muted, channel.Mode, channel.SyncOffsetMs));
            }
        }

        return channels;
    }

    private static string Key(string prefix, int index) => prefix + (index + 1).ToString(CultureInfo.InvariantCulture);

    private static ManifestSlate Slate(SlateDto slate, Dictionary<string, string> assetKeys) =>
        new(slate.Title, slate.Subtitle, KeyOf(slate.BackgroundAssetId, assetKeys));

    private static string? KeyOf(string? assetId, Dictionary<string, string> assetKeys) =>
        assetId is not null && assetKeys.TryGetValue(assetId, out var key) ? key : null;

    private static ManifestScene Scene(Scene scene, SourceKeys sources) => new(
        scene.Name,
        scene.LayoutMode,
        new ManifestBackground(scene.Background.Color, KeyOf(scene.Background.AssetId, sources.Assets)),
        [.. scene.Items.Select(item => Item(item, sources)).OfType<ManifestItem>()]);

    /// <summary>The item, or null when its source is gone (a deleted text or medium: nothing is left to show).</summary>
    private static ManifestItem? Item(SceneItemDto item, SourceKeys sources)
    {
        if (sources.RefOf(item.Source) is not { } source)
        {
            return null;
        }

        var fallback = item.OnLost.FallbackSource is { } id && !string.Equals(id, item.Source, StringComparison.Ordinal) ? sources.RefOf(id) : null;
        if (fallback?.StartsWith(ManifestRefs.Text, StringComparison.Ordinal) == true)
        {
            fallback = null;
        }

        return new ManifestItem(
            source,
            item.X,
            item.Y,
            item.W,
            item.H,
            item.Fit,
            new ManifestCrop(item.Crop.Top, item.Crop.Right, item.Crop.Bottom, item.Crop.Left),
            item.Radius,
            item.Mirror,
            item.Rotation,
            item.Hidden,
            item.Locked,
            new ManifestOnLost(item.OnLost.HoldMs, fallback),
            item.Border is null ? null : new ManifestBorder(item.Border.Width, item.Border.Color));
    }

    /// <summary>
    /// The device sources the scenes use, in the order they first appear. A source of an existing device keeps its code and its
    /// label, a placeholder of the production keeps its own; a source whose device is gone (an item that already says
    /// “Source missing”) gets the next free code of its kind and no name.
    /// </summary>
    private static (List<ManifestPlaceholder> List, Dictionary<string, string> Keys) Placeholders(Production production, IReadOnlyList<Device> devices)
    {
        var references = new List<string>();
        foreach (var scene in production.OrderedScenes)
        {
            foreach (var item in scene.Items)
            {
                foreach (var source in new[] { item.Source, item.OnLost.FallbackSource })
                {
                    if (source is not null && SourceRef.TryParse(source, out var parsed) && parsed.IsDevice && !references.Contains(source, StringComparer.Ordinal))
                    {
                        references.Add(source);
                    }
                }
            }
        }

        var known = new Dictionary<string, (string Code, SourceKind Kind, string Slot, string? Label)>(StringComparer.Ordinal);
        var unknown = new List<(string Reference, SourceKind Kind, string Slot)>();
        foreach (var reference in references)
        {
            if (!SourceRef.TryParse(reference, out var parsed))
            {
                continue;
            }

            var device = devices.FirstOrDefault(d => string.Equals(d.Id, parsed.DeviceId, StringComparison.Ordinal));
            if (device?.FindSlot(parsed.Slot!) is { } slot)
            {
                known[reference] = (slot.Code, slot.Kind, slot.Slot, device.LabelOf(slot));
            }
            else if (production.Placeholders.FirstOrDefault(p => string.Equals(p.SourceId, reference, StringComparison.Ordinal)) is { } placeholder)
            {
                known[reference] = (placeholder.Code, placeholder.Kind, parsed.Slot!, placeholder.Label);
            }
            else
            {
                unknown.Add((reference, SourcePlaceholders.KindOfSlot(parsed.Slot!) ?? SourceKind.Camera, parsed.Slot!));
            }
        }

        var usedCodes = known.Values.Select(v => v.Code).ToList();
        foreach (var (reference, kind, slot) in unknown)
        {
            var code = SlotCodes.Allocate(kind, usedCodes);
            usedCodes.Add(code);
            known[reference] = (code, kind, slot, null);
        }

        var list = new List<ManifestPlaceholder>(references.Count);
        var keys = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var reference in references)
        {
            var (code, kind, slot, label) = known[reference];
            var key = Key("p", list.Count);
            keys[reference] = key;
            list.Add(new ManifestPlaceholder(key, code, kind, slot, label));
        }

        return (list, keys);
    }

    /// <summary>The keys of the parts a source reference can point to.</summary>
    private sealed record SourceKeys(Dictionary<string, string> Assets, Dictionary<string, string> Texts, Dictionary<string, string> Placeholders)
    {
        public string? RefOf(string source)
        {
            if (!SourceRef.TryParse(source, out var parsed))
            {
                return null;
            }

            if (parsed.IsDevice)
            {
                return Placeholders.TryGetValue(source, out var placeholder) ? ManifestRefs.Placeholder + placeholder : null;
            }

            if (parsed.AssetId is not null)
            {
                return Assets.TryGetValue(parsed.AssetId, out var asset) ? ManifestRefs.Asset + asset : null;
            }

            return parsed.TextId is not null && Texts.TryGetValue(parsed.TextId, out var text) ? ManifestRefs.Text + text : null;
        }
    }
}
